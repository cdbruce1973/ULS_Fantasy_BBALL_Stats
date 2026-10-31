import { useEffect, useMemo, useRef, useState } from "react";
import * as C from "./current.js";
import { ordinal, slug } from "./lib.js";

// "This season": the season in progress, read live from Supabase (synced from Yahoo every night).
// Tabs: #now (last night and its Best of), #now-week (this week's matchups by category),
// #now-schedule (results so far and the schedule ahead), #now-trends (who is heating up or cooling off).
const TABS = [
  ["", "Last night"],
  ["week", "This week"],
  ["schedule", "Schedule"],
  ["trends", "Trends"],
];

const OwnerLink = ({ name }) => <a href={"#owner-" + slug(name)}>{name}</a>;
const fmtDate = (iso, opts = { weekday: "long", month: "long", day: "numeric" }) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const shift = (iso, n) => {
  const t = new Date(iso + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const signed = (v, digits = 1) => (v == null || !Number.isFinite(v) ? "-" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(digits));

// ---------- in-context explanations ----------
// A small (i) button: hover shows the tip, a click or tap pins it open; a click elsewhere or Escape closes it.
// The pop-up is fixed to the window so it isn't clipped by scrolling tables.
const TIPS = {
  nightScore: "Night score: in each of the 11 categories the 12 teams are ranked on their starters' totals. Best gets 12 points, worst 1, ties split. The points are added up, so 132 is a perfect night.",
  value: "Value: one score for how much a player helped across all 11 categories. 0 is an average game, about +3 is good, +6 or more is a big night, below 0 cost you. FG% and FT% count by attempts; fewer turnovers is better.",
  bench: "The best games from players on a bench or IL slot that night. Their stats didn't count for the team.",
  topPlayers: "Starters only, ranked by value.",
  fgMin: "Players with at least 8 field goal attempts, so a 2-for-2 night doesn't top the list.",
  ftMin: "Players with at least 5 free throw attempts.",
  mostTo: "Most turnovers. Fewer turnovers wins the TO category.",
  matchScore: "Categories won-lost (and tied, if any). Most categories wins the week.",
  record: "Yahoo's record counts categories: winning 7 of 11 in a week adds 7 wins and 4 losses. It includes the week in progress.",
  matchups: "Whole weeks won, lost and tied, from finished weeks only.",
  weeksLeft: "Regular-season weeks still to play, including this one.",
  change: "Window average minus season average. Green means playing above his usual level; red means slipping. For TO, fewer is better, so a drop shows green.",
  window: "His per-game average over the chosen window. Only games while he was on a league roster count.",
  season: "His per-game average for the whole season so far.",
  gp: "Games played in the window.",
  rank: "Small number: the team's league rank in this category that week (1 is best).",
  lastVsAvg: "Last finished week's total minus the team's average for finished weeks. Green is better than usual.",
};

function Info({ tip, label = "What does this mean?" }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(300, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12));
    const below = r.bottom + 8 + 160 < window.innerHeight;
    setPos({ left, width: w, ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
  };
  const show = (pin) => { place(); setOpen(true); if (pin) setPinned(true); };
  const hide = () => { setOpen(false); setPinned(false); };
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!btn.current?.contains(e.target)) hide(); };
    const esc = (e) => { if (e.key === "Escape") hide(); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);
  const text = TIPS[tip] ?? tip;
  return (
    <span className="info" ref={btn}>
      <button
        type="button"
        className="info-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); pinned ? hide() : show(true); }}
        onMouseEnter={() => !pinned && show(false)}
        onMouseLeave={() => !pinned && setOpen(false)}
      >i</button>
      {open && pos && <span className="info-pop" role="tooltip" style={pos}>{text}</span>}
    </span>
  );
}

// The owner a visitor picked as "my team" is remembered in this browser only.
function useMyOwner() {
  const [me, setMe] = useState(() => {
    try { return localStorage.getItem("laker-my-owner") || ""; } catch { return ""; }
  });
  const set = (v) => {
    setMe(v);
    try { v ? localStorage.setItem("laker-my-owner", v) : localStorage.removeItem("laker-my-owner"); } catch { /* private mode */ }
  };
  return [me, set];
}

function OwnerPicker({ id, teams, value, onChange, allLabel = "Every team" }) {
  return (
    <div className="field">
      <label htmlFor={id}>Team</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {[...teams].sort((a, b) => a.owner.localeCompare(b.owner)).map((t) => (
          <option key={t.id} value={t.owner}>{t.owner} ({t.team})</option>
        ))}
      </select>
    </div>
  );
}

export default function CurrentSeason({ tab }) {
  const [core, setCore] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    C.loadSeasonCore().then(setCore).catch((e) => setError(e.message));
  }, []);
  const current = TABS.some(([id]) => id === (tab || "")) ? tab || "" : "";

  return (
    <>
      <header className="page-head">
        <h1>{core ? `This season, ${core.season.label}` : "This season"}</h1>
        <p className="lede">Last night's box scores, this week's matchups, the schedule and who is trending, updated from Yahoo every morning.</p>
      </header>
      <nav aria-label="This season" className="pills">
        {TABS.map(([id, label]) => (
          <a key={id || "last"} href={"#now" + (id ? "-" + id : "")} aria-current={current === id ? "page" : undefined}>{label}</a>
        ))}
      </nav>
      {error && <p className="notice">The season in progress couldn't be loaded right now ({error}). Try again in a minute.</p>}
      {!core && !error && <p className="hint now-loading">Loading the season from Yahoo data…</p>}
      {core && current === "" && <LastNight core={core} />}
      {core && current === "week" && <ThisWeek core={core} />}
      {core && current === "schedule" && <Schedule core={core} />}
      {core && current === "trends" && <Trends core={core} />}
      {core && <HowItWorks />}
    </>
  );
}

// ---------- Last night + Best of ----------
function LastNight({ core }) {
  const [date, setDate] = useState(null);
  const [latest, setLatest] = useState(undefined);
  const [rows, setRows] = useState(null);
  const [me, setMe] = useMyOwner();
  useEffect(() => {
    C.latestDate(core.season.id).then((d) => { setLatest(d); setDate(d); }).catch(() => setLatest(null));
  }, [core]);
  useEffect(() => {
    if (!date) return;
    setRows(null);
    C.loadNight(core.season.id, date).then(setRows).catch(() => setRows([]));
  }, [core, date]);
  const night = useMemo(() => (rows ? C.nightSummary(rows, core) : null), [rows, core]);

  if (latest === undefined) return <p className="hint now-loading">Loading…</p>;
  if (!latest) return <p className="notice">Player stats haven't been synced yet. They arrive with the nightly Yahoo update.</p>;
  const start = core.season.start_date;
  const teams = night ? [...night.teams].sort((a, b) => (b.owner === me) - (a.owner === me) || (b.score ?? -1) - (a.score ?? -1)) : [];
  const shown = me ? teams.filter((t) => t.owner === me) : teams;

  return (
    <>
      <div className="controls now-controls">
        <div className="field">
          <span className="field-label">Night</span>
          <div className="day-nav">
            <button type="button" onClick={() => setDate(shift(date, -1))} disabled={start && date <= start} aria-label="Night before">‹</button>
            <input type="date" value={date} max={latest} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a night" />
            <button type="button" onClick={() => setDate(shift(date, 1))} disabled={date >= latest} aria-label="Next night">›</button>
          </div>
        </div>
        <OwnerPicker id="night-owner" teams={core.teams} value={me} onChange={setMe} />
      </div>
      <h2 className="now-date">{fmtDate(date)}</h2>
      {!night && <p className="hint now-loading">Loading…</p>}
      {night && night.games === 0 && <p className="hint">No rostered player had a game this night.</p>}
      {night && night.games > 0 && (
        <>
          <BestOf night={night} />
          <section aria-labelledby="box-h">
            <div className="section-head">
              <h2 id="box-h">{me ? `${me}'s night` : "Every team's night"}</h2>
              <p className="hint">Starters count; bench and IL games are shown dimmed. Tap a team to open it.</p>
            </div>
            <div className="box-list">
              {shown.map((t, i) => <TeamNight key={t.id + date} t={t} teamsPlayed={night.ranked.length} open={!!me || i < 3} />)}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function BestOf({ night }) {
  const [owner, ...rest] = night.ranked;
  return (
    <section aria-labelledby="best-h">
      <div className="section-head">
        <h2 id="best-h">Best of the night</h2>
        <p className="hint">Tap <span className="info-btn info-demo" aria-hidden="true">i</span> for what a number means. The full story is at the bottom of the page.</p>
      </div>
      <div className="grid-3 best-grid">
        <div>
          <h3>Owner of the night <Info tip="nightScore" /></h3>
          <ol className="ledger">
            {[owner, ...rest.slice(0, 4)].map((t) => (
              <li key={t.id}>
                <span className="l-main"><OwnerLink name={t.owner} /></span>
                <span className="l-val">{t.score.toFixed(1)}</span>
                <span className="l-sub">{t.team} · {t.counted.length} played</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Top players <Info tip="value" /></h3>
          <ol className="ledger">
            {night.topPlayers.map((p) => (
              <li key={p.player_key}>
                <span className="l-main">{p.name} <span className="dim">{p.nba_team}</span></span>
                <span className="l-val">{p.value.toFixed(1)}</span>
                <span className="l-sub">{shortLine(p.line)} · {p.team.owner}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Left on the bench <Info tip="bench" /></h3>
          {night.bench.length === 0 ? (
            <p className="hint">Nobody on a bench or IL had a game.</p>
          ) : (
            <ol className="ledger">
              {night.bench.map((p) => (
                <li key={p.player_key}>
                  <span className="l-main">{p.name} <span className="dim">{p.slot}</span></span>
                  <span className="l-val">{p.value.toFixed(1)}</span>
                  <span className="l-sub">{shortLine(p.line)} · {p.team.owner}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <h3 className="cat-leaders-h">Top 5 in each category</h3>
      <div className="cat-leaders">
        {night.leaders.map(({ cat, top }) => (
          <div key={cat.id} className="cat-card">
            <h4>
              {cat.low ? "Most TO" : cat.label}{cat.id === "5" ? " (8+ FGA)" : cat.id === "8" ? " (5+ FTA)" : ""}
              {cat.id === "5" && <Info tip="fgMin" />}{cat.id === "8" && <Info tip="ftMin" />}{cat.low && <Info tip="mostTo" />}
            </h4>
            <ol>
              {top.map(({ p, v }) => (
                <li key={p.player_key}>
                  <span>{p.name} <span className="dim">· {p.team.owner}</span></span>
                  <span className="num">{C.fmtCat(cat, v)}</span>
                </li>
              ))}
              {top.length === 0 && <li className="dim">None</li>}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

// The long explanations, at the bottom of every tab. The (i) pop-ups give the short version in place.
function HowItWorks() {
  return (
    <section aria-labelledby="how-h" className="how">
      <div className="section-head">
        <h2 id="how-h">How the numbers work</h2>
      </div>
      <div className="how-grid">
        <div>
          <h3>Player value</h3>
          <p>
            One score for how much a player helped across all 11 categories. Each category is scored on its own: how far the
            player's line was above or below the average (for everyone who played that night, or per game for every rostered
            player in Trends), measured in "typical gaps" so steals and blocks count as much as points. The 11 scores are added up.
            Turnovers count in reverse. FG% and FT% are weighted by attempts: 10-for-14 helps a lot, 1-for-1 barely moves it,
            4-for-17 hurts.
          </p>
          <p>
            0 is an average game, about +3 is good, +6 or more is a big night, and below 0 means he cost you across the board.
            Because every category counts the same, a center with 14 rebounds and 4 blocks can match a guard with 30 points.
          </p>
        </div>
        <div>
          <h3>What value tells you</h3>
          <p>
            <strong>Last night:</strong> who really won your night across the categories, not just who scored most. Left on the bench
            shows the best games your lineup didn't count, a nudge to check who you start.
          </p>
          <p>
            <strong>Trends:</strong> Change is recent form against his own season norm. A big plus (more minutes, a hot streak, a teammate out)
            says start or hold him. A big minus is a warning before you start or trade for him, or a chance to sell high. Pick a single
            category to see where the change comes from.
          </p>
          <p className="dim">
            It weighs all 11 categories equally, so it doesn't know if you're punting one (a poor free-throw shooter is worth more to a
            team punting FT%). Over 2 or 3 games it swings a lot.
          </p>
        </div>
        <div>
          <h3>Night score</h3>
          <p>
            Rotisserie scoring for one night. In each of the 11 categories the 12 teams are ranked on their starters' totals: best gets 12
            points, worst 1, ties split. Adding the 11 categories gives a score from 11 to 132. The highest is Owner of the night.
          </p>
          <h3>Records</h3>
          <p>
            Yahoo's record counts categories, so a 7-4 week adds 7 wins and 4 losses, and it includes the week in progress. The Matchups
            column counts whole weeks won, lost and tied, from finished weeks.
          </p>
        </div>
      </div>
    </section>
  );
}

const shortLine = (l) =>
  `${l["12"]} pts, ${l["15"]} reb, ${l["16"]} ast` +
  (l["17"] ? `, ${l["17"]} st` : "") + (l["18"] ? `, ${l["18"]} blk` : "") + (l["10"] ? `, ${l["10"]} 3s` : "");

const LINE_COLS = [
  ["FG", (l) => `${l["4"]}-${l["3"]}`],
  ["FT", (l) => `${l["7"]}-${l["6"]}`],
  ["3PTM", (l) => l["10"]],
  ["PTS", (l) => l["12"]],
  ["REB", (l) => l["15"]],
  ["AST", (l) => l["16"]],
  ["ST", (l) => l["17"]],
  ["BLK", (l) => l["18"]],
  ["TO", (l) => l["19"]],
];

function TeamNight({ t, teamsPlayed, open }) {
  const list = [...t.counted, ...t.benched].sort((a, b) => b.active - a.active || b.value - a.value);
  return (
    <details className="box" open={open}>
      <summary>
        <span className="box-owner"><OwnerLink name={t.owner} /> <span className="dim">{t.team}</span></span>
        <span className="box-score">
          {t.score != null ? <>Night score {t.score.toFixed(1)} · {ordinal(t.place)} of {teamsPlayed} <Info tip="nightScore" /></> : "No games"}
        </span>
      </summary>
      {list.length > 0 && (
        <div className="tbl-wrap">
          <table className="dt dt-tight">
            <thead>
              <tr>
                <th>Player</th><th>Slot</th>
                {LINE_COLS.map(([h]) => <th key={h} className="num">{h}</th>)}
                <th className="num">Value <Info tip="value" /></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.player_key} className={p.active ? undefined : "benched"}>
                  <td>{p.name} <span className="dim">{p.nba_team}</span></td>
                  <td>{p.slot}</td>
                  {LINE_COLS.map(([h, f]) => <td key={h} className="num">{f(p.line)}</td>)}
                  <td className="num">{signed(p.value)}</td>
                </tr>
              ))}
              {t.totals && (
                <tr className="totals">
                  <td colSpan={2}>Team (starters)</td>
                  {LINE_COLS.map(([h, f]) => <td key={h} className="num">{f(t.totals)}</td>)}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {t.sat.length > 0 && <p className="hint box-idle">Didn't play: {t.sat.map((p) => `${p.name}${C.BENCH.has(p.slot) ? "" : " (started)"}`).join(", ")}</p>}
      {t.idle.length > 0 && <p className="hint box-idle">No game: {t.idle.map((p) => p.name).join(", ")}</p>}
    </details>
  );
}

// ---------- This week ----------
function ThisWeek({ core }) {
  const weeks = [...new Set(core.matchups.filter((m) => m.done || m.started).map((m) => m.week))];
  const [week, setWeek] = useState(core.currentWeek);
  const [me] = useMyOwner();
  const games = core.matchups
    .filter((m) => m.week === week && !m.consolation)
    .sort((x, y) => ((y.a.owner === me || y.b.owner === me) - (x.a.owner === me || x.b.owner === me)));
  const live = games.some((m) => !m.done);
  return (
    <>
      <div className="controls now-controls">
        <div className="field">
          <label htmlFor="wk">Week</label>
          <select id="wk" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {weeks.map((w) => <option key={w} value={w}>Week {w}{w === core.currentWeek ? " (now)" : ""}</option>)}
          </select>
        </div>
      </div>
      <section aria-labelledby="week-h">
        <div className="section-head">
          <h2 id="week-h">Week {week}{live ? ", in progress" : ", final"}</h2>
          <p className="hint">{live ? "Totals as of this morning's Yahoo update. " : ""}The leader in each category is highlighted.</p>
        </div>
        {games.length === 0 && <p className="hint">No matchups this week.</p>}
        <div className="match-list">
          {games.map((m, i) => <MatchCard key={i} m={m} />)}
        </div>
      </section>
    </>
  );
}

function MatchCard({ m }) {
  const cats = C.catResults(m.as, m.bs);
  const tie = cats.filter((c) => c.a != null && c.lead === 0).length;
  const aw = cats.filter((c) => c.lead === 1).length, bw = cats.filter((c) => c.lead === -1).length;
  return (
    <article className="match">
      <header className="match-head">
        <div className={aw > bw ? "match-side lead" : "match-side"}>
          <OwnerLink name={m.a.owner} /><span className="dim">{m.a.team}</span>
        </div>
        <div className="match-score">{aw}-{bw}{tie ? `-${tie}` : ""}<Info tip="matchScore" />{m.playoff ? <span className="match-tag">Playoffs</span> : null}</div>
        <div className={bw > aw ? "match-side right lead" : "match-side right"}>
          <OwnerLink name={m.b.owner} /><span className="dim">{m.b.team}</span>
        </div>
      </header>
      <table className="match-cats">
        <tbody>
          {cats.map((c) => (
            <tr key={c.id}>
              <td className={"num" + (c.lead === 1 ? " win" : "")}>{C.fmtCat(c, c.a)}</td>
              <th scope="row">{c.label}{c.low && <Info tip="mostTo" />}</th>
              <td className={c.lead === -1 ? "win" : undefined}>{C.fmtCat(c, c.b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

// ---------- Schedule ----------
function Schedule({ core }) {
  const [me, setMe] = useMyOwner();
  // Yahoo's record counts categories (a 7-4 week adds 7 wins and 4 losses); matchups counts whole weeks.
  const standings = useMemo(() => {
    const rows = core.teams.map((t) => {
      const mine = core.matchups.filter((m) => m.done && !m.playoff && (m.a.id === t.id || m.b.id === t.id));
      let mw = 0, ml = 0, mt = 0;
      for (const m of mine) {
        const a = m.a.id === t.id, f = a ? m.ac : m.bc, g = a ? m.bc : m.ac;
        f > g ? mw++ : f < g ? ml++ : mt++;
      }
      const left = core.matchups.filter((m) => !m.done && !m.playoff && (m.a.id === t.id || m.b.id === t.id)).length;
      return { ...t, mw, ml, mt, left };
    });
    return rows.sort((a, b) => b.w + b.t / 2 - (a.w + a.t / 2) || b.mw - a.mw);
  }, [core]);
  const weeks = [...new Set(core.matchups.map((m) => m.week))].sort((a, b) => a - b);
  const team = core.teams.find((t) => t.owner === me);

  return (
    <>
      <div className="controls now-controls">
        <OwnerPicker id="sched-owner" teams={core.teams} value={me} onChange={setMe} allLabel="Whole league" />
      </div>
      <section aria-labelledby="stand-h">
        <div className="section-head">
          <h2 id="stand-h">Standings</h2>
          <p className="hint">Sorted by Yahoo's record.</p>
        </div>
        <div className="tbl-wrap">
          <table className="dt">
            <thead><tr><th>#</th><th>Owner</th><th>Team</th><th className="num">Record <Info tip="record" /></th><th className="num">Matchups <Info tip="matchups" /></th><th className="num">Weeks left <Info tip="weeksLeft" /></th></tr></thead>
            <tbody>
              {standings.map((t, i) => (
                <tr key={t.id} className={t.owner === me ? "mine" : undefined}>
                  <td>{i + 1}</td>
                  <td><OwnerLink name={t.owner} /></td>
                  <td>{t.team}</td>
                  <td className="num">{t.w}-{t.l}-{t.t}</td>
                  <td className="num">{t.mw}-{t.ml}-{t.mt}</td>
                  <td className="num">{t.left}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="sched-h">
        <div className="section-head">
          <h2 id="sched-h">{team ? `${team.owner}'s schedule` : "Every week"}</h2>
          <p className="hint">Finished weeks show categories won. Playoff matchups appear once Yahoo sets them.</p>
        </div>
        {team ? <OwnerSchedule core={core} team={team} /> : <LeagueSchedule core={core} weeks={weeks} />}
      </section>
    </>
  );
}

function OwnerSchedule({ core, team }) {
  const rows = core.matchups
    .filter((m) => !m.consolation && (m.a.id === team.id || m.b.id === team.id))
    .map((m) => {
      const mine = m.a.id === team.id;
      const opp = mine ? m.b : m.a;
      const cf = mine ? m.ac : m.bc, ca = mine ? m.bc : m.ac;
      return { m, opp, cf, ca, res: !m.done ? null : cf > ca ? "W" : cf < ca ? "L" : "T" };
    });
  return (
    <div className="tbl-wrap">
      <table className="dt">
        <thead><tr><th>Week</th><th>Opponent</th><th className="num">Their record</th><th>Result</th></tr></thead>
        <tbody>
          {rows.map(({ m, opp, cf, ca, res }) => (
            <tr key={m.week} className={m.week === core.currentWeek ? "mine" : undefined}>
              <td>{m.week}{m.playoff ? " (playoffs)" : ""}</td>
              <td><a href={`#h2h-${slug(team.owner)}-vs-${slug(opp.owner)}`}>{opp.owner}</a> <span className="dim">{opp.team}</span></td>
              <td className="num">{opp.w}-{opp.l}-{opp.t}</td>
              <td>
                {res ? <><span className={"res res-" + res}>{res}</span> {cf}-{ca}</>
                  : m.started ? <span className="dim">Live, {cf}-{ca}</span>
                  : <span className="dim">Upcoming</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeagueSchedule({ core, weeks }) {
  return (
    <div className="sched-weeks">
      {weeks.map((w) => {
        const games = core.matchups.filter((m) => m.week === w && !m.consolation);
        return (
          <div key={w} className={"sched-week" + (w === core.currentWeek ? " now" : "")}>
            <h3>Week {w}{w === core.currentWeek ? " (now)" : ""}</h3>
            <ul>
              {games.map((m, i) => {
                const show = m.done || m.started;
                const aw = show && m.ac > m.bc, bw = show && m.bc > m.ac;
                return (
                  <li key={i}>
                    <span className={aw && m.done ? "n" : undefined}>{m.a.owner}</span>
                    <span className="dim">{show ? ` ${m.ac}-${m.bc} ` : " vs "}</span>
                    <span className={bw && m.done ? "n" : undefined}>{m.b.owner}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Trends ----------
const WINDOWS = [[7, "Last 7 days"], [30, "Last 30 days"], [0, "Season"]];

function Trends({ core }) {
  const [games, setGames] = useState(null);
  const [days, setDays] = useState(7);
  const [cat, setCat] = useState("value");
  const [me, setMe] = useMyOwner();
  const [view, setView] = useState("players");
  const [sortDir, setSortDir] = useState("desc");
  const [open, setOpen] = useState(null);
  useEffect(() => {
    C.loadPlayerGames(core.season.id).then(setGames).catch(() => setGames([]));
  }, [core]);
  const trends = useMemo(() => (games ? C.playerTrends(games, core, days) : null), [games, core, days]);

  if (!trends) return <p className="hint now-loading">Loading every game so far…</p>;
  if (!trends.rows.length) return <p className="notice">Player stats haven't been synced yet. They arrive with the nightly Yahoo update.</p>;

  const catDef = C.CATS.find((c) => c.id === cat);
  const minGames = days ? 2 : 3;
  const val = (r, which) => (cat === "value" ? (which === "win" ? r.winValue : r.seasonValue) : r[which]?.[cat]);
  const change = (r) => {
    if (!days || !r.win) return null;
    const d = val(r, "win") - val(r, "season");
    return catDef?.low ? -d : d;
  };
  let rows = trends.rows.filter((r) => r.team && (!me || r.team.owner === me) && r.win && r.win.gp >= (me ? 1 : minGames));
  const key = days ? change : (r) => (catDef?.low ? -val(r, "season") : val(r, "season"));
  rows = [...rows].sort((a, b) => ((key(b) ?? -99) - (key(a) ?? -99)) * (sortDir === "desc" ? 1 : -1));
  if (!me) rows = rows.slice(0, 40);
  const digits = catDef?.pct ? 3 : cat === "value" ? 2 : 1;
  const fmt = (v) => (catDef ? C.fmtCat(catDef, v) : Number.isFinite(v) ? v.toFixed(2) : "-");

  return (
    <>
      <div className="controls now-controls">
        <div className="field">
          <span className="field-label">Show</span>
          <div className="seg" role="group" aria-label="Players or teams">
            {[["players", "Players"], ["teams", "Teams"]].map(([v, t]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{t}</button>
            ))}
          </div>
        </div>
        {view === "players" && (
          <div className="field">
            <span className="field-label">Window</span>
            <div className="seg" role="group" aria-label="Time window">
              {WINDOWS.map(([d, t]) => (
                <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{t}</button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="tr-cat">Category {cat === "value" && view === "players" && <Info tip="value" />}</label>
          <select id="tr-cat" value={view === "teams" && cat === "value" ? "12" : cat} onChange={(e) => setCat(e.target.value)}>
            {view === "players" && <option value="value">Overall value</option>}
            {C.CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <OwnerPicker id="tr-owner" teams={core.teams} value={me} onChange={setMe} />
      </div>

      {view === "teams" ? (
        <TeamTrends core={core} cat={cat === "value" ? "12" : cat} me={me} />
      ) : (
        <section aria-labelledby="trend-h">
          <div className="section-head">
            <h2 id="trend-h">
              {days ? (sortDir === "desc" ? "Heating up" : "Cooling off") : "Season leaders"}
              {me ? `, ${me}'s players` : ""}
            </h2>
            <p className="hint">
              Per-game averages{days ? ` from ${fmtDate(trends.since, { month: "short", day: "numeric" })} to ${fmtDate(trends.lastDate, { month: "short", day: "numeric" })}, against the player's season average` : " for the season"}.
              {me ? "" : ` Players with ${minGames}+ games.`}
            </p>
          </div>

          {days > 0 && (
            <div className="seg trend-dir" role="group" aria-label="Sort direction">
              <button type="button" aria-pressed={sortDir === "desc"} onClick={() => setSortDir("desc")}>Improving first</button>
              <button type="button" aria-pressed={sortDir === "asc"} onClick={() => setSortDir("asc")}>Slipping first</button>
            </div>
          )}
          <div className="tbl-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Player</th>
                  {days > 0 && <th className="num">Change <Info tip="change" /></th>}
                  {days > 0 && <th className="num">Window <Info tip="window" /></th>}
                  <th className="num">Season <Info tip="season" /></th>
                  {days > 0 && <th className="num">GP <Info tip="gp" /></th>}
                  <th className="num">Season GP</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ch = change(r);
                  return [
                    <tr key={r.key}>
                      <td>
                        <button type="button" className="linkish" aria-expanded={open === r.key} onClick={() => setOpen(open === r.key ? null : r.key)}>{r.name}</button>
                        <span className="cell-sub">{r.nba} · {r.pos}{me ? "" : ` · ${r.team.owner}`}</span>
                      </td>
                      {days > 0 && <td className={"num " + (ch > 0 ? "up" : ch < 0 ? "down" : "")}>{ch > 0 ? "▲ " : ch < 0 ? "▼ " : ""}{signed(ch, digits)}</td>}
                      {days > 0 && <td className="num">{fmt(val(r, "win"))}</td>}
                      <td className="num">{fmt(val(r, "season"))}</td>
                      {days > 0 && <td className="num">{r.win.gp}</td>}
                      <td className="num">{r.season.gp}</td>
                      <td><OwnerLink name={r.team.owner} /></td>
                    </tr>,
                    open === r.key && (
                      <tr key={r.key + "-log"} className="log-row">
                        <td colSpan={7}><GameLog r={r} /></td>
                      </tr>
                    ),
                  ];
                })}
                {rows.length === 0 && <tr><td colSpan={7} className="empty">No games in this window yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function GameLog({ r }) {
  const games = [...r.games].reverse().slice(0, 15);
  return (
    <div className="game-log">
      <p className="hint">Last {games.length} games on a league roster (newest first). Dim rows were on the bench.</p>
      <table className="dt dt-tight">
        <thead><tr><th>Date</th><th>Slot</th>{LINE_COLS.map(([h]) => <th key={h} className="num">{h}</th>)}</tr></thead>
        <tbody>
          {games.map((g) => (
            <tr key={g.game_date} className={C.BENCH.has(g.slot) ? "benched" : undefined}>
              <td>{fmtDate(g.game_date, { month: "short", day: "numeric" })}</td>
              <td>{g.slot}</td>
              {LINE_COLS.map(([h, f]) => <td key={h} className="num">{f(g.line)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Each team's weekly totals in one category, week by week, with the league rank that week.
function TeamTrends({ core, cat, me }) {
  const c = C.CATS.find((x) => x.id === cat);
  const weeks = [...new Set(core.matchups.filter((m) => m.done || m.started).map((m) => m.week))].sort((a, b) => a - b);
  const valueOf = (team, w) => {
    const m = core.matchups.find((x) => x.week === w && (x.a.id === team.id || x.b.id === team.id));
    if (!m) return null;
    const s = m.a.id === team.id ? m.as : m.bs;
    const v = parseFloat(s?.[cat]);
    return Number.isFinite(v) ? v : null;
  };
  const rows = core.teams.map((t) => {
    const vals = weeks.map((w) => valueOf(t, w));
    const known = vals.filter((v) => v != null);
    const done = weeks.map((w, i) => (core.matchups.some((m) => m.week === w && !m.done) ? null : vals[i])).filter((v) => v != null);
    const avg = done.length ? done.reduce((a, b) => a + b, 0) / done.length : null;
    const lastDone = done.length ? done[done.length - 1] : null;
    return { t, vals, avg, trend: lastDone != null && avg != null && done.length > 1 ? lastDone - avg : null, known };
  });
  rows.sort((a, b) => (c.low ? (a.avg ?? 1e9) - (b.avg ?? 1e9) : (b.avg ?? -1) - (a.avg ?? -1)));
  const rankIn = (w, v) => {
    if (v == null) return null;
    const all = core.teams.map((t) => valueOf(t, w)).filter((x) => x != null);
    return 1 + all.filter((x) => (c.low ? x < v : x > v)).length;
  };
  const live = new Set(weeks.filter((w) => core.matchups.some((m) => m.week === w && !m.done)));
  return (
    <section aria-labelledby="tt-h">
      <div className="section-head">
        <h2 id="tt-h">{c.label} by week</h2>
        <p className="hint">Each team's weekly total from the matchups. Average uses finished weeks only. <Info tip="rank" /></p>
      </div>
      <div className="tbl-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Owner</th>
              {weeks.map((w) => <th key={w} className="num">Wk {w}{live.has(w) ? " (live)" : ""}</th>)}
              <th className="num">Average</th>
              <th className="num">Last vs avg <Info tip="lastVsAvg" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, vals, avg, trend }) => {
              const good = trend == null ? 0 : c.low ? -trend : trend;
              return (
                <tr key={t.id} className={t.owner === me ? "mine" : undefined}>
                  <td><OwnerLink name={t.owner} /></td>
                  {vals.map((v, i) => (
                    <td key={weeks[i]} className="num">
                      {C.fmtCat(c, v)} {v != null && <span className="rank">{rankIn(weeks[i], v)}</span>}
                    </td>
                  ))}
                  <td className="num n">{C.fmtCat(c, avg)}</td>
                  <td className={"num " + (good > 0 ? "up" : good < 0 ? "down" : "")}>{trend == null ? "-" : signed(trend, c.pct ? 3 : 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
