import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as L from "./lib.js";
import * as H from "./h2h.js";
import OddsPage from "./Odds.jsx";
import CurrentSeason from "./CurrentSeason.jsx";

const NAV = [
  ["", "Record book"],
  ["now", "This season"],
  ["owners", "Owners"],
  ["seasons", "Seasons"],
  ["h2h", "Head-to-head"],
  ["teams", "Teams"],
  ["draft", "Draft"],
  ["odds", "Playoff odds"],
];

// ---------- routing (hash based, works on any static host) ----------
function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}
function parseRoute(hash) {
  if (hash.startsWith("owner-")) return ["owner", hash.slice(6)];
  if (hash.startsWith("season-")) return ["seasons", parseInt(hash.slice(7), 10)];
  if (hash.startsWith("h2h-")) return ["h2h", hash.slice(4)];
  if (hash.startsWith("now-")) return ["now", hash.slice(4)];
  return [hash, null];
}

// ---------- page help ----------
// "What can I do here?" for each page: what it shows and the questions it answers.
const HELP = {
  home: [
    "The all-time highlights of the league, from 2004-05 through the last completed season.",
    "Championship banners: every tournament champion, newest first. Gold banners won the regular season too. Hover to pause them, or tap one to open that season.",
    "Podium finishes: who has the most 1st, 2nd and 3rd place finishes, in the tournament and the regular season, and how often they make the top three.",
    "Career leaders, best single seasons, and streaks of back-to-back top-three finishes.",
    "Use the Ties toggle next to any win % to figure it with or without ties. The choice applies across the site.",
  ],
  now: [
    "The season in progress, updated from Yahoo every morning.",
    "Last night: every team's box score (starters count, bench games are shown dimmed), plus the Best of the night: owner of the night, top players, the best games left on a bench, and the top 5 in each category. Use the arrows to step back through earlier nights.",
    "This week: every matchup category by category, with the leader in each highlighted.",
    "Schedule: standings, results so far and every matchup still to come. Pick your team to see just your weeks.",
    "Trends: who is heating up or cooling off over the last 7 or 30 days against their season average, overall or in one category. Switch to Teams for each team's weekly category totals. Click a player for their game log.",
    "Pick your team once and the page remembers it in this browser.",
  ],
  owners: [
    "Career totals for every owner: seasons, record, win %, wins per season and podium finishes.",
    "Sort by any column, search a name, or show only owners with 10 or more seasons.",
    "Pick an owner to open their page.",
  ],
  owner: [
    "One owner's career: record, win %, titles and regular-season finishes.",
    "Their championship banners, a win % trend by season (gold dots are titles), and every team they ran.",
    "Follow the head-to-head link to see how they do against each opponent.",
  ],
  seasons: [
    "Pick a season to see the tournament and regular-season top three and the full standings.",
    "Each season has its own record book: the champion's seed and draft slot, the final, best and worst records, biggest risers and drops, the biggest blowout, the longest streaks and the best single week in every category.",
    "The season in progress shows live standings and records so far that update nightly; finishes appear after the playoffs.",
  ],
  h2h: [
    "Every owner's record against every other owner, built from the weekly matchups.",
    "Filter by regular season or playoffs, or a range of seasons.",
    "Pick an owner to see their nemesis and favorite opponent, or two owners to see their whole rivalry, including categories won and biggest blowouts.",
  ],
  teams: [
    "Every team from every season, with its owner, record and finishes.",
    "Team names change often, so search a name (or part of one) to find who had it.",
  ],
  draft: [
    "Does draft position matter? How each first-round slot has finished: average finish, titles, top three and playoffs, for the tournament or the regular season. Hover a bar for its numbers.",
    "Biggest climbs and falls from draft slot to finish, and which owners finish better than they pick.",
    "Average draft position: where each owner usually picks in round 1, and how often they had the #1 pick.",
    "Every pick of every draft since 2005-06. Filter by season, pick number (try #1 for every first overall pick) or owner.",
    "Search a player, or click a player's name, for a Did you know card: how often they were drafted, who took them most, and their earliest pick.",
  ],
  odds: [
    "Each team's chance of making the playoffs this season, recalculated every Monday from the week that just ended.",
    "Last week shows how much each team's odds moved, and the trend line shows every week so far.",
    "Bye is the chance of a top-two seed, which skips the first playoff round. Open How the odds work for the method.",
  ],
};

function PageHelp({ page }) {
  const items = HELP[page];
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => setOpen(false), [page]);
  // Close the pop-up on a click outside it or on Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!items) return null;
  return (
    <details className="help" ref={ref} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>What can I do here?</summary>
      <ul>
        {items.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </details>
  );
}

// ---------- feedback (Netlify Forms) ----------
// Netlify finds the form from the hidden copy in index.html at deploy time and stores each submission.
// Emails go to whatever address is set in Netlify (Forms > Form notifications), so no address lives in the code.
function Feedback() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const submit = async (e) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const body = new URLSearchParams(new FormData(e.currentTarget)).toString();
      const res = await fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      if (!res.ok) throw new Error(res.status);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };
  if (status === "sent") return <p className="fb-done" role="status">Thanks! Your note is on its way to Craig.</p>;
  if (!open) return <button type="button" className="fb-open" onClick={() => setOpen(true)}>Send feedback</button>;
  return (
    <form className="fb" name="feedback" method="POST" data-netlify="true" netlify-honeypot="bot-field" onSubmit={submit}>
      <input type="hidden" name="form-name" value="feedback" />
      <p hidden><label>Leave this empty <input name="bot-field" tabIndex={-1} autoComplete="off" /></label></p>
      <div className="fb-row">
        <label className="field">
          <span className="field-label">Your name (optional)</span>
          <input type="text" name="name" autoComplete="name" maxLength={80} />
        </label>
        <label className="field">
          <span className="field-label">Email for a reply (optional)</span>
          <input type="email" name="email" autoComplete="email" maxLength={120} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Idea, bug or wrong stat</span>
        <textarea name="message" rows={4} required maxLength={2000} />
      </label>
      <div className="fb-actions">
        <button type="submit" className="fb-send" disabled={status === "sending"}>{status === "sending" ? "Sending..." : "Send"}</button>
        <button type="button" className="fb-cancel" onClick={() => { setOpen(false); setStatus("idle"); }}>Cancel</button>
        {status === "error" && <span className="fb-err" role="alert">That didn't go through. Try again in a minute.</span>}
      </div>
    </form>
  );
}

// ---------- artwork (original drawings: a pine and a shoreline) ----------
function Pine({ className }) {
  return (
    <svg className={"pine " + (className || "")} viewBox="0 0 24 28" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 1 19 11h-4l6 8h-7v8h-4v-8H3l6-8H5z" />
    </svg>
  );
}

function pinePath(cx, base, h) {
  const w = h * 0.5;
  const r = (k) => cx + w * k;
  const l = (k) => cx - w * k;
  const y = (k) => base - h * k;
  return `M${cx} ${y(1)}L${r(0.3)} ${y(0.62)}L${r(0.15)} ${y(0.62)}L${r(0.4)} ${y(0.3)}L${r(0.2)} ${y(0.3)}L${r(0.5)} ${base}` +
    `L${l(0.5)} ${base}L${l(0.2)} ${y(0.3)}L${l(0.4)} ${y(0.3)}L${l(0.15)} ${y(0.62)}L${l(0.3)} ${y(0.62)}Z`;
}

// A row of pines on a shore with three lines of water below. Fixed layout, so it never shifts between renders.
function Shoreline() {
  const W = 1200, base = 62;
  const far = [], near = [];
  for (let i = 0, x = 14; x < W; i++) {
    far.push(pinePath(x, base - 4, 30 + ((i * 7) % 13)));
    x += 26 + ((i * 5) % 9);
  }
  for (let i = 0, x = 40; x < W; i++) {
    near.push(pinePath(x, base, 44 + ((i * 11) % 23)));
    x += 52 + ((i * 17) % 38);
  }
  const wave = (y, phase) => {
    let d = "";
    for (let x = 0; x <= W; x += 20) d += `${x ? "L" : "M"}${x} ${(y + Math.sin((x + phase) / 38) * 3).toFixed(1)}`;
    return d;
  };
  return (
    <svg className="shoreline" viewBox={`0 0 ${W} 96`} preserveAspectRatio="xMidYMax slice" role="img" aria-label="Pine trees on a lake shore">
      {far.map((d, i) => <path key={"f" + i} className="far" d={d} />)}
      {near.map((d, i) => <path key={"n" + i} className="near" d={d} />)}
      {[[72, 0], [82, 40], [92, 90]].map(([y, ph]) => <path key={y} className="wave" d={wave(y, ph)} />)}
    </svg>
  );
}

// ---------- small shared pieces ----------
function useSort(key, dir = "desc") {
  const [sort, setSort] = useState({ key, dir });
  const toggle = (k) =>
    setSort((p) => (p.key === k ? { key: k, dir: p.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" }));
  return [sort, toggle];
}
const sortRows = (rows, { key, dir }) =>
  [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    const c = typeof x === "string" ? x.localeCompare(y) : (x ?? -1) - (y ?? -1);
    return dir === "asc" ? c : -c;
  });

function DataTable({ caption, columns, rows, sort, onSort, rowKey }) {
  return (
    <div className="tbl-wrap">
      <table className="dt">
        <caption className="sr">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.num ? "num" : undefined}
                aria-sort={sort && sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
              >
                {onSort && c.sortable !== false ? (
                  <button type="button" onClick={() => onSort(c.key)}>
                    {c.label}
                    <span className="arrow" aria-hidden="true">
                      {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? "num" : undefined}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty">
                Nothing matches. Clear the search or filters to see every row.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const OwnerLink = ({ name }) => <a href={"#owner-" + L.slug(name)}>{name}</a>;
const Finish = ({ n }) =>
  n && n <= 3 ? <span className={"chip chip-" + n}>{L.ordinal(n)}</span> : <span className="dim">-</span>;
const record = (r) => `${r.w}-${r.l}-${r.t}`;

// Win % with or without ties: one site-wide choice, shown as a small toggle next to the win % it changes.
const TiesContext = createContext({ countTies: false, setCountTies: () => {} });
function TiesToggle({ field }) {
  const { countTies, setCountTies } = useContext(TiesContext);
  const toggle = (
    <span className="ties-toggle">
      <Segmented
        label="How win percentage is figured"
        value={countTies}
        onChange={setCountTies}
        options={[[false, "Ties left out"], [true, "Ties count"]]}
      />
    </span>
  );
  // In a row of filters it gets a label like the other fields.
  return field ? <div className="field"><span className="field-label">Win %</span>{toggle}</div> : toggle;
}

function Segmented({ label, value, onChange, options }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Field({ id, label, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

// ---------- Record book ----------
function Banner({ b, copy }) {
  const { season, champ, runnerUp, sweep } = b;
  return (
    <li className={"banner" + (sweep ? " banner-sweep" : "")} aria-hidden={copy || undefined}>
      <a href={"#season-" + season.start} tabIndex={copy ? -1 : undefined} title={`Runner-up: ${runnerUp ? runnerUp.owner : "n/a"}${sweep ? ". Also won the regular season." : ""}`}>
        <Pine className="banner-crest" />
        <span className="banner-year">{season.label}</span>
        <span className="banner-name">{champ ? champ.owner : "-"}</span>
        <span className="banner-team">{champ ? champ.team : ""}</span>
      </a>
    </li>
  );
}

// drift: the banners creep slowly sideways in a loop. They stop while the pointer is over them or a
// banner has focus, can still be scrolled by hand, and stay still for people who ask for reduced motion.
function Rafters({ owner, drift }) {
  const banners = useMemo(
    () => L.buildBanners().filter((b) => !owner || (b.champ && b.champ.owner === owner)),
    [owner]
  );
  const ref = useRef(null);
  const loop = drift && banners.length > 0;
  useEffect(() => {
    const el = ref.current;
    if (!loop || !el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let paused = false, resumeAt = 0, last = performance.now(), pos = el.scrollLeft, frame;
    const pause = () => { paused = true; };
    const resume = () => { paused = false; resumeAt = performance.now() + 1500; pos = el.scrollLeft; };
    const touch = () => { resumeAt = performance.now() + 4000; pos = el.scrollLeft; };
    const step = (now) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const half = el.scrollWidth / 2; // the row is drawn twice, so half its width is one full lap
      if (!paused && now > resumeAt && el.scrollWidth > el.clientWidth) {
        pos += dt * 0.03; // about 30 pixels a second
        if (pos >= half) pos -= half;
        el.scrollLeft = pos;
      } else if (el.scrollLeft >= half) {
        el.scrollLeft -= half;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", resume);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", resume);
    el.addEventListener("touchstart", touch, { passive: true });
    el.addEventListener("wheel", touch, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerenter", pause);
      el.removeEventListener("pointerleave", resume);
      el.removeEventListener("focusin", pause);
      el.removeEventListener("focusout", resume);
      el.removeEventListener("touchstart", touch);
      el.removeEventListener("wheel", touch);
    };
  }, [loop]);
  if (owner && !banners.length) return null;
  return (
    <section aria-labelledby="banners-h">
      <div className="section-head">
        <h2 id="banners-h">Championship banners</h2>
        <p className="hint">{owner ? "Newest first. Gold banners also won the regular season." : "Newest first. Gold banners won the regular season too."}</p>
      </div>
      <div className="rafters" ref={ref} tabIndex={0} aria-label="Championship banners, scrollable">
        <ol className="banner-row">
          {banners.map((b) => (
            <Banner key={b.season.start} b={b} />
          ))}
          {/* A second copy, hidden from screen readers and keyboard, lets the drift loop without a jump. */}
          {loop && banners.map((b) => <Banner key={"copy" + b.season.start} b={b} copy />)}
        </ol>
      </div>
    </section>
  );
}

function PodiumTable({ title, owners, kind }) {
  const f = kind === "tourney"
    ? { a: "titles", b: "runnerUps", c: "thirds", p: "placedTourney" }
    : { a: "regTitles", b: "regRunnerUps", c: "regThirds", p: "placedReg" };
  const rows = owners
    .filter((o) => o[f.a] + o[f.b] + o[f.c] > 0)
    .sort((x, y) => y[f.a] - x[f.a] || y[f.b] - x[f.b] || y[f.c] - x[f.c] || y[f.p] - x[f.p])
    .map((o) => ({ ...o, id: o.name }));
  const count = (key) => (r) => (r[key] ? <span className="n">{r[key]}</span> : <span className="dim">-</span>);
  return (
    <div>
      <h3>{title}</h3>
      <DataTable
        caption={title}
        rowKey={(r) => r.id}
        rows={rows}
        columns={[
          { key: "name", label: "Owner", render: (r) => <OwnerLink name={r.name} /> },
          { key: f.a, label: "1st", num: true, render: count(f.a) },
          { key: f.b, label: "2nd", num: true, render: count(f.b) },
          { key: f.c, label: "3rd", num: true, render: count(f.c) },
          {
            key: f.p,
            label: "Top three",
            num: true,
            render: (r) => `${r[f.p]} of ${r.seasons} (${Math.round((r[f.p] / r.seasons) * 100)}%)`,
          },
        ]}
      />
    </div>
  );
}

function Ledger({ title, items, empty }) {
  return (
    <div>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <ol className="ledger">
          {items.map((it, i) => (
            <li key={i}>
              <span className="l-main">{it.main}</span>
              <span className="l-val">{it.val}</span>
              <span className="l-sub">{it.sub}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RecordBook({ owners, countTies }) {
  const vets = owners.filter((o) => o.seasons >= 10);
  const byPct = [...vets].sort((a, b) => b.pct - a.pct).slice(0, 5);
  const byWins = [...vets].sort((a, b) => b.w - a.w).slice(0, 5);
  const byAvg = [...vets].sort((a, b) => b.avgW - a.avgW).slice(0, 5);
  const bestPct = L.bestSeasons(countTies, "pct");
  const bestWins = L.bestSeasons(countTies, "w");
  const regStreaks = L.streaks("reg").slice(0, 4);
  const tourneyStreaks = L.streaks("tourney").slice(0, 4);
  const sweeps = L.sweeps();
  return (
    <>
      <header className="page-head page-head-home">
        <div>
          <h1>Record book</h1>
          <p className="lede">Every title, streak and standing, 2004-05 through {L.LAST_FINISHED}.</p>
        </div>
        <Shoreline />
      </header>
      <Rafters drift />

      <section aria-labelledby="podium-h">
        <div className="section-head">
          <h2 id="podium-h">Podium finishes</h2>
          <p className="hint">Tournament is the playoff finish. Regular season is the standings finish.</p>
        </div>
        <div className="grid-2">
          <PodiumTable title="Tournament" owners={owners} kind="tourney" />
          <PodiumTable title="Regular season" owners={owners} kind="reg" />
        </div>
      </section>

      <section aria-labelledby="career-h">
        <div className="section-head">
          <h2 id="career-h">Career leaders</h2>
          <p className="hint">Owners with at least 10 seasons.</p>
          <TiesToggle />
        </div>
        <div className="grid-3">
          <Ledger title="Win %" items={byPct.map((o) => ({ main: <OwnerLink name={o.name} />, val: L.fmtPct(o.pct), sub: `${L.fmtInt(o.w)}-${L.fmtInt(o.l)}` }))} />
          <Ledger title="Total wins" items={byWins.map((o) => ({ main: <OwnerLink name={o.name} />, val: L.fmtInt(o.w), sub: `${o.seasons} seasons` }))} />
          <Ledger title="Wins per season" items={byAvg.map((o) => ({ main: <OwnerLink name={o.name} />, val: o.avgW.toFixed(1), sub: `${o.seasons} seasons` }))} />
        </div>
      </section>

      <section aria-labelledby="seasons-h">
        <div className="section-head">
          <h2 id="seasons-h">Best single seasons</h2>
          <TiesToggle />
        </div>
        <div className="grid-2">
          <Ledger title="Win %" items={bestPct.map((r) => ({ main: <OwnerLink name={r.owner} />, val: L.fmtPct(r.pct), sub: `${r.season}, ${r.team}` }))} />
          <Ledger title="Wins" items={bestWins.map((r) => ({ main: <OwnerLink name={r.owner} />, val: r.w, sub: `${r.season}, ${r.team}` }))} />
        </div>
      </section>

      <section aria-labelledby="streaks-h">
        <div className="section-head">
          <h2 id="streaks-h">Streaks and sweeps</h2>
          <p className="hint">A streak is consecutive seasons finishing in the top three.</p>
        </div>
        <div className="grid-3">
          <Ledger title="Regular season streaks" items={regStreaks.map((s) => ({ main: <OwnerLink name={s.owner} />, val: `${s.len} seasons`, sub: `${s.from} to ${s.to}` }))} />
          <Ledger title="Tournament streaks" items={tourneyStreaks.map((s) => ({ main: <OwnerLink name={s.owner} />, val: `${s.len} seasons`, sub: `${s.from} to ${s.to}` }))} />
          <Ledger title="Sweeps: both titles in one season" items={sweeps.map((s) => ({ main: <OwnerLink name={s.owner} />, val: s.season, sub: "" }))} />
        </div>
      </section>
    </>
  );
}

// ---------- Owners ----------
function OwnersPage({ owners, countTies }) {
  const [query, setQuery] = useState("");
  const [vetsOnly, setVetsOnly] = useState(false);
  const [sort, onSort] = useSort("pct");
  const rows = sortRows(
    owners.filter((o) => (!vetsOnly || o.seasons >= 10) && o.name.toLowerCase().includes(query.trim().toLowerCase())),
    sort
  );
  const columns = [
    { key: "name", label: "Owner", render: (r) => <OwnerLink name={r.name} /> },
    { key: "seasons", label: "Seasons", num: true },
    { key: "w", label: "W", num: true, render: (r) => L.fmtInt(r.w) },
    { key: "l", label: "L", num: true, render: (r) => L.fmtInt(r.l) },
    { key: "t", label: "T", num: true },
    { key: "pct", label: "Win %", num: true, render: (r) => L.fmtPct(r.pct) },
    { key: "avgW", label: "Avg W", num: true, render: (r) => r.avgW.toFixed(1) },
    { key: "titles", label: "Titles", num: true },
    { key: "runnerUps", label: "Runner-up", num: true },
    { key: "regTitles", label: "Reg. season titles", num: true },
    { key: "placedTourney", label: "Tournament top three", num: true },
  ];
  return (
    <>
      <header className="page-head">
        <h1>Owners</h1>
        <p className="lede">Career totals for everyone who has run a team, through {L.LAST_FINISHED}.</p>
      </header>
      <div className="controls">
        <Field id="owner-search" label="Search owners">
          <input id="owner-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={vetsOnly} onChange={(e) => setVetsOnly(e.target.checked)} />
          Only owners with 10 or more seasons
        </label>
        <TiesToggle field />
      </div>
      <DataTable caption="Career totals by owner" columns={columns} rows={rows} sort={sort} onSort={onSort} rowKey={(r) => r.name} />
    </>
  );
}

function useWidth(min, start) {
  const ref = useRef(null);
  const [w, setW] = useState(start);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w];
}

function Sparkline({ rows, countTies }) {
  const [ref, W] = useWidth(280, 640);
  const H = 170, pad = { l: 40, r: 14, t: 12, b: 28 };
  const lo = 20, hi = 80;
  const xs = rows.map((r) => r.start);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = (v) => pad.l + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const pts = rows.map((r) => ({ ...r, x: X(r.start), y: Y(L.winPct(r.w, r.l, r.t, countTies)), p: L.winPct(r.w, r.l, r.t, countTies) }));
  const runs = [];
  pts.forEach((p, i) => {
    if (i > 0 && p.start === pts[i - 1].start + 1) runs[runs.length - 1].push(p);
    else runs.push([p]);
  });
  return (
    <div className="spark-wrap" ref={ref}>
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Win percentage by season">
      {[25, 50, 75].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} className={v === 50 ? "grid grid-mid" : "grid"} />
          <text x={pad.l - 8} y={Y(v) + 4} textAnchor="end" className="axis">{v}%</text>
        </g>
      ))}
      {runs.filter((r) => r.length > 1).map((r, i) => (
        <polyline key={i} fill="none" className="spark-line" points={r.map((p) => `${p.x},${p.y}`).join(" ")} />
      ))}
      {pts.map((p) => (
        <circle key={p.start} cx={p.x} cy={p.y} r="3.5" className={"spark-dot" + (p.tourney === 1 ? " spark-dot-champ" : "")}>
          <title>{`${p.season}: ${L.fmtPct(p.p)} (${record(p)})${p.tourney === 1 ? ", tournament champion" : ""}`}</title>
        </circle>
      ))}
      <text x={pad.l} y={H - 6} textAnchor="start" className="axis">{pts[0].season}</text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" className="axis">{pts[pts.length - 1].season}</text>
    </svg>
    </div>
  );
}

function OwnerPage({ slug, owners, countTies }) {
  const o = owners.find((x) => x.slug === slug);
  const [sort, onSort] = useSort("start");
  if (!o) {
    return (
      <>
        <header className="page-head"><h1>Owner not found</h1></header>
        <p><a href="#owners">Back to all owners</a></p>
      </>
    );
  }
  const rows = sortRows(o.rows.map((r) => ({ ...r, pct: L.winPct(r.w, r.l, r.t, countTies) })), sort);
  const stat = (label, value, sub, wide) => (
    <div className={"stat" + (wide ? " stat-wide" : "")}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {sub && <dd className="stat-sub">{sub}</dd>}
    </div>
  );
  return (
    <>
      <p className="crumb"><a href="#owners">All owners</a></p>
      <header className="page-head">
        <h1>{o.name}</h1>
        <p className="lede">
          {o.seasons} completed {o.seasons === 1 ? "season" : "seasons"}, {o.first} to {o.last}{o.inProgress && `, plus ${o.inProgress} in progress`}.
          {H.H2H_OWNERS.includes(o.name) && <> <a href={"#h2h-" + o.slug}>Head-to-head records</a></>}
        </p>
      </header>
      <dl className="stats">
        {stat("Record", `${L.fmtInt(o.w)}-${L.fmtInt(o.l)}-${o.t}`, "wins, losses, ties", true)}
        {stat("Win %", L.fmtPct(o.pct))}
        {stat("Wins per season", o.avgW.toFixed(1))}
        {stat("Tournament", `${o.titles} / ${o.runnerUps} / ${o.thirds}`, "1st / 2nd / 3rd")}
        {stat("Regular season", `${o.regTitles} / ${o.regRunnerUps} / ${o.regThirds}`, "1st / 2nd / 3rd")}
      </dl>
      <Rafters owner={o.name} />
      <section aria-labelledby="trend-h">
        <div className="section-head">
          <h2 id="trend-h">Win % by season</h2>
          <p className="hint">Gold dots are tournament titles. The dashed line marks 50%.</p>
          <TiesToggle />
        </div>
        <Sparkline rows={o.rows.filter((r) => !r.current)} countTies={countTies} />
      </section>
      <section aria-labelledby="by-season-h">
        <div className="section-head"><h2 id="by-season-h">Season by season</h2></div>
        <DataTable
          caption={`${o.name} season by season`}
          sort={sort}
          onSort={onSort}
          rowKey={(r) => r.start}
          rows={rows}
          columns={[
            { key: "start", label: "Season", render: (r) => <><a href={"#season-" + r.start}>{r.season}</a>{r.current && <span className="dim"> in progress</span>}</> },
            { key: "team", label: "Team" },
            { key: "w", label: "Record", num: true, render: record },
            { key: "pct", label: "Win %", num: true, render: (r) => L.fmtPct(r.pct) },
            { key: "reg", label: "Regular season", num: true, render: (r) => <Finish n={r.reg} /> },
            { key: "tourney", label: "Tournament", num: true, render: (r) => <Finish n={r.tourney} /> },
          ]}
        />
      </section>
    </>
  );
}

// ---------- Seasons ----------
function SeasonsPage({ start, countTies }) {
  const season = L.SEASON_LIST.find((s) => s.start === start) || L.CURRENT;
  const [sort, onSort] = useSort("w");
  const rows = sortRows(season.teams.map((t) => ({ ...t, pct: L.winPct(t.w, t.l, t.t, countTies) })), sort);
  const find = (key, n) => season.teams.find((t) => t[key] === n);
  const results = [
    ["Tournament", [1, 2, 3].map((n) => find("tourney", n))],
    ["Regular season", [1, 2, 3].map((n) => find("reg", n))],
  ];
  return (
    <>
      <header className="page-head">
        <h1>Seasons</h1>
        <p className="lede">Pick a season to see how all {season.teams.length} teams finished.</p>
      </header>
      <nav aria-label="Seasons" className="pills">
        {[...L.SEASON_LIST].reverse().map((s) => (
          <a key={s.start} href={"#season-" + s.start} aria-current={s.start === season.start ? "page" : undefined}>
            {s.label}
          </a>
        ))}
      </nav>
      <section aria-labelledby="season-h">
        <div className="section-head"><h2 id="season-h">{season.label}</h2><TiesToggle /></div>
        {season.current && <p className="hint">Season in progress. Records update nightly from Yahoo; finishes appear once the playoffs are done.</p>}
        {!season.current && (
          <div className="results">
            {results.map(([title, list]) => (
              <div key={title}>
                <h3>{title}</h3>
                <ol className="podium">
                  {list.map((t, i) =>
                    t ? (
                      <li key={i}>
                        <span className={"chip chip-" + (i + 1)}>{L.ordinal(i + 1)}</span>
                        <span><OwnerLink name={t.owner} /> <span className="dim">{t.team}</span></span>
                      </li>
                    ) : null
                  )}
                </ol>
              </div>
            ))}
          </div>
        )}
        <DataTable
          caption={`${season.label} standings`}
          sort={sort}
          onSort={onSort}
          rowKey={(r) => r.owner + r.team}
          rows={rows}
          columns={[
            { key: "owner", label: "Owner", render: (r) => <OwnerLink name={r.owner} /> },
            { key: "team", label: "Team" },
            { key: "w", label: "Record", num: true, render: record },
            { key: "pct", label: "Win %", num: true, render: (r) => L.fmtPct(r.pct) },
            { key: "reg", label: "Regular season", num: true, render: (r) => <Finish n={r.reg} /> },
            { key: "tourney", label: "Tournament", num: true, render: (r) => <Finish n={r.tourney} /> },
          ]}
        />
      </section>
      <SeasonBook start={season.start} countTies={countTies} />
    </>
  );
}

// A mini record book for one season: standings and draft notes, then records from that season's weekly games.
function SeasonBook({ start, countTies }) {
  const f = L.seasonFacts(start, countTies);
  const g = H.seasonGameRecords(start);
  if (!f) return null;
  const s = f.season;
  const team = (t) => <><OwnerLink name={t.owner} /> <span className="dim">{t.team}</span></>;
  const vs = (r) => <>vs <OwnerLink name={r.opp} />, week {r.week}{r.playoff ? " (playoffs)" : ""}</>;
  const final = g && f.champ ? g.sideFor(f.champ.owner) : null;
  const runnerUp = s.teams.find((t) => t.tourney === 2);
  const notes = [];
  if (f.champ && !s.current) {
    notes.push(
      <><OwnerLink name={f.champ.owner} /> won the title{f.champSeed && <> as the {f.champSeed === 1 ? "top seed" : `#${f.champSeed} seed`}</>}
        {f.champSlot && <>, after drafting {L.ordinal(f.champSlot.pick)} ({f.champSlot.player} in round 1)</>}.
        {final && runnerUp && final.opp === runnerUp.owner && <> Beat <OwnerLink name={final.opp} /> {fmtCats(final.cf)}-{fmtCats(final.ca)} in the final.</>}
      </>
    );
  }
  if (f.regChamp && f.regChampFinish && f.regChamp !== f.champ) {
    notes.push(<><OwnerLink name={f.regChamp.owner} /> won the regular season and finished {L.ordinal(f.regChampFinish)} in the tournament.</>);
  }
  if (f.firstPick && f.firstPick.owner !== f.champ?.owner) {
    const t = f.firstPick.finish;
    notes.push(
      <><OwnerLink name={f.firstPick.owner} /> took {f.firstPick.player} with the #1 pick
        {t && t.rank ? <> and finished {L.ordinal(t.rank)}.</> : "."}
      </>
    );
  }
  if (f.newOwners.length) notes.push(<>First season in the league: {f.newOwners.map((t, i) => <span key={t.owner}>{i ? ", " : ""}<OwnerLink name={t.owner} /></span>)}.</>);
  return (
    <section aria-labelledby="book-h">
      <div className="section-head">
        <h2 id="book-h">{s.label} record book</h2>
        {s.current && <p className="hint">So far this season. Updates nightly.</p>}
      </div>
      {notes.length > 0 && (
        <ul className="notes">
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      <dl className="stats">
        <Stat label="Best record" value={record(f.best)} sub={<>{team(f.best)}, {L.fmtPct(f.best.pct)}</>} />
        <Stat label="Worst record" value={record(f.worst)} sub={<>{team(f.worst)}, {L.fmtPct(f.worst.pct)}</>} />
        {f.riser && <Stat label="Most improved" value={`${L.ordinal(f.riser.before)} to ${L.ordinal(f.riser.rank)}`} sub={<>{team(f.riser)}, tournament finish up {f.riser.change} places from last season</>} />}
        {f.faller && <Stat label="Biggest drop" value={`${L.ordinal(f.faller.before)} to ${L.ordinal(f.faller.rank)}`} sub={<>{team(f.faller)}, tournament finish down {-f.faller.change} places from last season</>} />}
        {g?.blowout && <Stat label="Biggest blowout" value={`${fmtCats(g.blowout.cf)}-${fmtCats(g.blowout.ca)}`} sub={<><OwnerLink name={g.blowout.owner} /> {vs(g.blowout)}</>} />}
        {g?.winRun && <Stat label="Longest win streak" value={`${g.winRun.n} weeks`} sub={<><OwnerLink name={g.winRun.from.owner} />, weeks {g.winRun.from.week} to {g.winRun.to.week}</>} />}
        {g?.loseRun && <Stat label="Longest losing streak" value={`${g.loseRun.n} weeks`} sub={<><OwnerLink name={g.loseRun.from.owner} />, weeks {g.loseRun.from.week} to {g.loseRun.to.week}</>} />}
      </dl>
      {g && g.highs.length > 0 && (
        <>
          <h3 className="sub-h">Best single weeks by category</h3>
          <p className="hint">Highest weekly total in each category (fewest for turnovers), regular season and playoffs. Long weeks, like the All-Star break, tend to hold the counting records.</p>
          <DataTable
            caption={`${s.label} weekly category highs`}
            rowKey={(r) => r.id}
            rows={g.highs}
            columns={[
              { key: "label", label: "Category" },
              { key: "v", label: "Best week", num: true, render: (r) => (r.raw.includes(".") ? r.raw : L.fmtInt(r.v)) + (r.low ? " (fewest)" : "") },
              { key: "owner", label: "Owner", render: (r) => <OwnerLink name={r.side.owner} /> },
              { key: "week", label: "When", render: (r) => <>Week {r.side.week}{r.side.playoff ? ", playoffs" : ""} <span className="dim">vs {r.side.opp}</span></> },
            ]}
          />
        </>
      )}
      {!g && !s.current && s.start >= 2005 && <p className="hint">Weekly game records appear once the matchups are loaded.</p>}
    </section>
  );
}

// ---------- Head-to-head ----------
const go = (hash) => { window.location.hash = hash; };
const h2hHref = (owner, opp) => "#h2h-" + L.slug(owner) + (opp ? "-vs-" + L.slug(opp) : "");
const H2HLink = ({ owner, opp, children }) => <a href={h2hHref(owner, opp)}>{children}</a>;
const wlt = (t) => `${t.w}-${t.l}-${t.t}`;
const cats = (t) => `${fmtCats(t.cf)}-${fmtCats(t.ca)}`;
const fmtCats = (n) => (Number.isInteger(n) ? L.fmtInt(n) : n.toFixed(1));
const meeting = (r) => `${H.seasonLabel(r.start)}, week ${r.week}${r.playoff ? ", playoffs" : ""}`;
const Res = ({ res }) => <span className={"res res-" + res}>{res}</span>;
const streakText = (s) => (s ? `${s.res === "W" ? "Won" : "Lost"} ${s.n}` : "-");

// Shade a grid cell from loss color through neutral to win color.
function cellTone(t) {
  if (!t || !t.games || !Number.isFinite(t.pct)) return "";
  const p = t.pct;
  return p >= 62 ? "tone-w2" : p >= 53 ? "tone-w1" : p > 47 ? "tone-even" : p > 38 ? "tone-l1" : "tone-l2";
}

function H2HFilters({ filter, setFilter, children }) {
  const seasons = H.H2H_SEASONS;
  const set = (k) => (e) => setFilter({ ...filter, [k]: e.target.value === "" ? null : +e.target.value });
  return (
    <div className="controls">
      {children}
      <div className="field">
        <span className="field-label">Games</span>
        <Segmented
          label="Which games to count"
          value={filter.phase}
          onChange={(phase) => setFilter({ ...filter, phase })}
          options={[["all", "All"], ["reg", "Regular season"], ["playoff", "Playoffs"]]}
        />
      </div>
      <TiesToggle field />
      <Field id="h2h-from" label="From">
        <select id="h2h-from" className="narrow" value={filter.from ?? ""} onChange={set("from")}>
          <option value="">First season</option>
          {seasons.map((s) => <option key={s} value={s}>{H.seasonLabel(s)}</option>)}
        </select>
      </Field>
      <Field id="h2h-to" label="To">
        <select id="h2h-to" className="narrow" value={filter.to ?? ""} onChange={set("to")}>
          <option value="">Latest season</option>
          {seasons.map((s) => <option key={s} value={s}>{H.seasonLabel(s)}</option>)}
        </select>
      </Field>
    </div>
  );
}

function OwnerPicker({ id, label, value, onChange, exclude, placeholder }) {
  return (
    <Field id={id} label={label}>
      <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {H.H2H_OWNERS.filter((n) => n !== exclude).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </Field>
  );
}

function H2HPage({ param, countTies, filter, setFilter, liveGames }) {
  const sides = useMemo(
    () => H.filterSides({ phase: filter.phase, from: filter.from ?? -Infinity, to: filter.to ?? Infinity }),
    [filter, liveGames]
  );
  if (!H.HAS_DATA) {
    return (
      <>
        <header className="page-head">
          <h1>Head-to-head</h1>
          <p className="lede">Every owner's record against every other owner, built from the weekly matchups.</p>
        </header>
        <p className="empty-note">
          No head-to-head games have loaded. Weekly matchups come from Yahoo; 2004-05 has none because
          that season only exists in the spreadsheet.
        </p>
      </>
    );
  }
  const [a, b] = (param || "").split("-vs-");
  const owner = a ? H.ownerBySlug(a) : null;
  const opp = b ? H.ownerBySlug(b) : null;
  const shared = { sides, countTies, filter, setFilter };
  if (owner && opp) return <RivalryView owner={owner} opp={opp} {...shared} />;
  if (owner) return <OwnerH2HView owner={owner} {...shared} />;
  return <LeagueH2HView {...shared} />;
}

function LeagueH2HView({ sides, countTies, filter, setFilter }) {
  const grid = useMemo(() => H.rivalryGrid(sides, countTies), [sides, countTies]);
  const owners = H.H2H_OWNERS.filter((n) => grid.has(n));
  const streaks = H.longestRivalryStreaks(sides, 6);
  const blowouts = H.biggestBlowouts(sides, 6);
  const { mostPlayed, lopsided } = H.rivalryLists(grid, 10);
  return (
    <>
      <header className="page-head">
        <h1>Head-to-head</h1>
        <p className="lede">Every owner's record against every other owner. Pick a cell to open that rivalry.</p>
      </header>
      <H2HFilters filter={filter} setFilter={setFilter}>
        <OwnerPicker id="h2h-jump" label="Go to an owner" value="" onChange={(n) => n && go(h2hHref(n))} placeholder="Pick an owner" />
      </H2HFilters>

      <section aria-labelledby="grid-h">
        <div className="section-head">
          <h2 id="grid-h">Rivalry grid</h2>
          <p className="hint">Read across: the row owner's wins, losses and ties against each column owner. Green means the row owner leads.</p>
        </div>
        <div className="tbl-wrap grid-wrap" tabIndex={0} aria-label="Rivalry grid, scrollable">
          <table className="dt h2h-grid">
            <caption className="sr">Head-to-head records, row owner against column owner</caption>
            <thead>
              <tr>
                <th scope="col">Owner</th>
                {owners.map((n) => <th key={n} scope="col" className="num">{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o}>
                  <th scope="row"><H2HLink owner={o}>{o}</H2HLink></th>
                  {owners.map((p) => {
                    const t = grid.get(o).get(p);
                    if (o === p) return <td key={p} className="num self" aria-label="Same owner" />;
                    if (!t) return <td key={p} className="num dim">-</td>;
                    return (
                      <td key={p} className={"num cell " + cellTone(t)}>
                        <a href={h2hHref(o, p)} title={`${o} vs ${p}: ${wlt(t)}, ${L.fmtPct(t.pct)}`}>{wlt(t)}</a>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="league-h2h-h">
        <div className="section-head">
          <h2 id="league-h2h-h">Rivalry records</h2>
          <p className="hint">One-sided rivalries need at least 10 meetings.</p>
        </div>
        <div className="grid-2">
          <Ledger
            title="Most one-sided"
            empty="No rivalry has 10 meetings in this range yet."
            items={lopsided.map((r) => ({ main: <H2HLink owner={r.owner} opp={r.opp}>{r.owner} over {r.opp}</H2HLink>, val: L.fmtPct(r.pct), sub: `${wlt(r)} in ${r.games} meetings` }))}
          />
          <Ledger
            title="Most played"
            empty="No games in this range."
            items={mostPlayed.map((r) => ({ main: <H2HLink owner={r.owner} opp={r.opp}>{r.owner} and {r.opp}</H2HLink>, val: r.games, sub: `${r.owner} leads ${wlt(r)}` }))}
          />
          <Ledger
            title="Longest win streak in a rivalry"
            empty="No one has won three straight against the same owner in this range."
            items={streaks.map((s) => ({ main: <H2HLink owner={s.owner} opp={s.opp}>{s.owner} over {s.opp}</H2HLink>, val: s.n, sub: `${meeting(s.from)} to ${meeting(s.to)}${s.active ? ", still going" : ""}` }))}
          />
          <Ledger
            title="Biggest blowouts"
            empty="No games in this range."
            items={blowouts.map((r) => ({ main: <H2HLink owner={r.owner} opp={r.opp}>{r.owner} over {r.opp}</H2HLink>, val: `${fmtCats(r.cf)}-${fmtCats(r.ca)}`, sub: meeting(r) }))}
          />
        </div>
      </section>
    </>
  );
}

function OwnerH2HView({ owner, sides, countTies, filter, setFilter }) {
  const [sort, onSort] = useSort("games");
  const opps = useMemo(() => H.opponentsOf(owner, sides, countTies), [owner, sides, countTies]);
  const total = opps.reduce((a, o) => ({ w: a.w + o.w, l: a.l + o.l, t: a.t + o.t, games: a.games + o.games }), { w: 0, l: 0, t: 0, games: 0 });
  const { nemesis, favorite } = H.nemesisAndFavorite(opps, 8);
  const rows = sortRows(opps.map((o) => ({ ...o, regPct: o.reg.pct, postGames: o.post.games, margin: o.cf - o.ca, lastStart: o.last.start * 100 + o.last.week })), sort);
  return (
    <>
      <p className="crumb"><a href="#h2h">All head-to-head</a> <span className="dim">·</span> <a href={"#owner-" + L.slug(owner)}>{owner}'s profile</a></p>
      <header className="page-head">
        <h1>{owner}: head-to-head</h1>
        <p className="lede">{owner}'s record against every owner they have faced.</p>
      </header>
      <H2HFilters filter={filter} setFilter={setFilter}>
        <OwnerPicker id="h2h-owner" label="Owner" value={owner} onChange={(n) => n && go(h2hHref(n))} placeholder="Pick an owner" />
        <OwnerPicker id="h2h-opp" label="Compare with" value="" exclude={owner} onChange={(n) => n && go(h2hHref(owner, n))} placeholder="Pick an opponent" />
      </H2HFilters>
      <dl className="stats">
        <Stat label="Record" value={wlt(total)} sub={`${total.games} games`} wide />
        <Stat label="Win %" value={L.fmtPct(L.winPct(total.w, total.l, total.t, countTies))} />
        <Stat label="Nemesis" value={nemesis ? <H2HLink owner={owner} opp={nemesis.opp}>{nemesis.opp}</H2HLink> : "-"} sub={nemesis ? `${wlt(nemesis)}, ${L.fmtPct(nemesis.pct)}` : "8 or more meetings"} />
        <Stat label="Favorite opponent" value={favorite ? <H2HLink owner={owner} opp={favorite.opp}>{favorite.opp}</H2HLink> : "-"} sub={favorite ? `${wlt(favorite)}, ${L.fmtPct(favorite.pct)}` : "8 or more meetings"} />
      </dl>
      <section aria-labelledby="opps-h">
        <div className="section-head"><h2 id="opps-h">Against each owner</h2></div>
        <DataTable
          caption={`${owner} against each owner`}
          sort={sort}
          onSort={onSort}
          rowKey={(r) => r.opp}
          rows={rows}
          columns={[
            { key: "opp", label: "Opponent", render: (r) => <H2HLink owner={owner} opp={r.opp}>{r.opp}</H2HLink> },
            { key: "games", label: "Games", num: true },
            { key: "w", label: "Record", num: true, render: wlt },
            { key: "pct", label: "Win %", num: true, render: (r) => L.fmtPct(r.pct) },
            { key: "regPct", label: "Regular season", num: true, render: (r) => wlt(r.reg) },
            { key: "postGames", label: "Playoffs", num: true, render: (r) => (r.post.games ? wlt(r.post) : <span className="dim">-</span>) },
            { key: "margin", label: "Categories", num: true, render: cats },
            { key: "streak", label: "Streak", sortable: false, render: (r) => streakText(r.streak) },
            { key: "lastStart", label: "Last met", num: true, render: (r) => meeting(r.last) },
          ]}
        />
      </section>
    </>
  );
}

function Stat({ label, value, sub, wide }) {
  return (
    <div className={"stat" + (wide ? " stat-wide" : "")}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {sub && <dd className="stat-sub">{sub}</dd>}
    </div>
  );
}

function RivalryView({ owner, opp, sides, countTies, filter, setFilter }) {
  const r = useMemo(() => H.rivalry(owner, opp, sides, countTies), [owner, opp, sides, countTies]);
  const [sort, onSort] = useSort("start");
  const seasonRows = sortRows(r.seasons, sort);
  const run = (s, who) => (s ? { main: `${who}: ${s.n} straight`, val: s.n, sub: `${meeting(s.from)} to ${meeting(s.to)}` } : { main: `${who}: no wins`, val: "-", sub: "" });
  const blow = (g, who) => (g ? { main: `${who}'s biggest win`, val: `${fmtCats(Math.max(g.cf, g.ca))}-${fmtCats(Math.min(g.cf, g.ca))}`, sub: meeting(g) } : null);
  return (
    <>
      <p className="crumb"><a href="#h2h">All head-to-head</a> <span className="dim">·</span> <H2HLink owner={owner}>{owner}'s rivalries</H2HLink></p>
      <header className="page-head">
        <h1>{owner} vs {opp}</h1>
        <p className="lede">
          {r.all.games
            ? `${r.all.games} meetings from ${H.seasonLabel(r.rows[0].start)} to ${H.seasonLabel(r.rows[r.rows.length - 1].start)}. Records are from ${owner}'s side.`
            : "These two have not met in the games and seasons picked below."}
          {" "}<a href={h2hHref(opp, owner)}>Flip sides</a>
        </p>
      </header>
      <H2HFilters filter={filter} setFilter={setFilter}>
        <OwnerPicker id="riv-a" label="Owner" value={owner} exclude={opp} onChange={(n) => n && go(h2hHref(n, opp))} placeholder="Pick an owner" />
        <OwnerPicker id="riv-b" label="Opponent" value={opp} exclude={owner} onChange={(n) => n && go(h2hHref(owner, n))} placeholder="Pick an opponent" />
      </H2HFilters>
      {r.all.games > 0 && (
        <>
          <dl className="stats">
            <Stat label="Series" value={wlt(r.all)} sub="wins, losses, ties" wide />
            <Stat label="Win %" value={L.fmtPct(r.all.pct)} />
            <Stat label="Regular season" value={wlt(r.reg)} />
            <Stat label="Playoffs" value={r.post.games ? wlt(r.post) : "-"} sub={r.post.games ? `${r.post.games} meetings` : "never met"} />
            <Stat label="Categories won" value={cats(r.all)} />
            <Stat label="Current streak" value={streakText(r.streak)} sub={r.streak ? `for ${owner}` : "last game was a tie"} />
          </dl>

          <section aria-labelledby="riv-seasons-h">
            <div className="section-head"><h2 id="riv-seasons-h">Season by season</h2></div>
            <DataTable
              caption={`${owner} vs ${opp} by season`}
              sort={sort}
              onSort={onSort}
              rowKey={(x) => x.start}
              rows={seasonRows}
              columns={[
                { key: "start", label: "Season", render: (x) => <a href={"#season-" + x.start}>{x.season}</a> },
                { key: "w", label: "Record", num: true, render: wlt },
                { key: "pct", label: "Win %", num: true, render: (x) => L.fmtPct(x.pct) },
                { key: "cf", label: "Categories", num: true, render: cats },
                { key: "playoffGames", label: "Playoff meetings", num: true, render: (x) => x.playoffGames || <span className="dim">-</span> },
                { key: "games", label: "Weeks", sortable: false, render: (x) => <span className="res-run">{x.games.map((g, i) => <Res key={i} res={g.res} />)}</span> },
              ]}
            />
          </section>

          <section aria-labelledby="riv-moments-h">
            <div className="section-head"><h2 id="riv-moments-h">Streaks and blowouts</h2></div>
            <div className="grid-2">
              <Ledger title="Longest win streaks" items={[run(r.bestRun, owner), run(r.oppBestRun, opp)]} />
              <Ledger
                title="Biggest wins"
                empty="Every meeting has been a tie."
                items={[blow(r.bigWin, owner), blow(r.bigLoss, opp)].filter(Boolean)}
              />
            </div>
          </section>

          {r.categories.length > 0 && (
            <section aria-labelledby="riv-cats-h">
              <div className="section-head">
                <h2 id="riv-cats-h">Category by category</h2>
                <p className="hint">Each week's 11 categories, counted across every meeting. Fewer turnovers wins TO. FG% isn't in Yahoo's data before 2010-11.</p>
              </div>
              <DataTable
                caption={`${owner} vs ${opp} by category`}
                rowKey={(c) => c.id}
                rows={r.categories}
                columns={[
                  { key: "label", label: "Category" },
                  { key: "w", label: `${owner} won`, num: true },
                  { key: "l", label: `${opp} won`, num: true },
                  { key: "t", label: "Tied", num: true },
                  { key: "edge", label: "Edge", render: (c) => (c.w === c.l ? <span className="dim">Even</span> : <strong>{c.w > c.l ? owner : opp} +{Math.abs(c.w - c.l)}</strong>) },
                ]}
              />
            </section>
          )}

          <section aria-labelledby="riv-last-h">
            <div className="section-head">
              <h2 id="riv-last-h">Last 10 meetings</h2>
              <p className="hint">Newest first. Score is categories won.</p>
            </div>
            <MeetingList rows={r.last10} owner={owner} opp={opp} />
          </section>

          {r.playoffGames.length > 0 && (
            <section aria-labelledby="riv-po-h">
              <div className="section-head"><h2 id="riv-po-h">Playoff meetings</h2></div>
              <MeetingList rows={r.playoffGames} owner={owner} opp={opp} />
            </section>
          )}
        </>
      )}
    </>
  );
}

function MeetingList({ rows, owner, opp }) {
  return (
    <DataTable
      caption={`Meetings between ${owner} and ${opp}`}
      rowKey={(g) => g.start + "-" + g.week}
      rows={rows}
      columns={[
        { key: "res", label: "Result", render: (g) => <Res res={g.res} /> },
        { key: "cf", label: "Score", num: true, render: (g) => `${fmtCats(g.cf)}-${fmtCats(g.ca)}` },
        { key: "when", label: "When", render: meeting },
        { key: "team", label: `${owner}'s team` },
        { key: "oppTeam", label: `${opp}'s team` },
      ]}
    />
  );
}

// ---------- Teams (search every team name across every season) ----------
function TeamsPage({ countTies, ver }) {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [sort, onSort] = useSort("start");
  const all = useMemo(
    () => L.TEAM_SEASONS.map((t) => ({ ...t, pct: L.winPct(t.w, t.l, t.t, countTies) })),
    [countTies, ver]
  );
  const q = query.trim().toLowerCase();
  const rows = sortRows(
    all.filter((t) => (!owner || t.owner === owner) && (!q || t.team.toLowerCase().includes(q) || t.owner.toLowerCase().includes(q))),
    sort
  );
  return (
    <>
      <header className="page-head">
        <h1>Teams</h1>
        <p className="lede">Every team from every season. Team names change often, so search by name to find who had it.</p>
      </header>
      <div className="controls">
        <Field id="team-search" label="Search team or owner">
          <input id="team-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try Koenig or Quad" />
        </Field>
        <Field id="team-owner" label="Owner">
          <select id="team-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">All owners</option>
            {L.OWNER_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <TiesToggle field />
        <p className="count" aria-live="polite">{rows.length} of {all.length} teams</p>
      </div>
      <DataTable
        caption="All teams by season"
        sort={sort}
        onSort={onSort}
        rowKey={(r) => r.start + r.team + r.owner}
        rows={rows}
        columns={[
          { key: "start", label: "Season", render: (r) => <a href={"#season-" + r.start}>{r.season}</a> },
          { key: "team", label: "Team" },
          { key: "owner", label: "Owner", render: (r) => <OwnerLink name={r.owner} /> },
          { key: "w", label: "Record", num: true, render: record },
          { key: "pct", label: "Win %", num: true, render: (r) => L.fmtPct(r.pct) },
          { key: "reg", label: "Regular season", num: true, render: (r) => <Finish n={r.reg} /> },
          { key: "tourney", label: "Tournament", num: true, render: (r) => <Finish n={r.tourney} /> },
        ]}
      />
    </>
  );
}

// ---------- Draft ----------
function DraftPage() {
  const years = [...new Set(L.DRAFT.map((d) => d.start))].sort((a, b) => b - a);
  // Opens on the latest draft; searching a player, an owner or a pick number looks across every year.
  const [year, setYear] = useState(null);
  const [owner, setOwner] = useState("");
  const [pick, setPick] = useState("");
  const [query, setQuery] = useState("");
  const [sort, onSort] = useSort("start");
  const maxPick = Math.max(0, ...L.DRAFT.map((d) => d.pick));
  const owners = [...new Set(L.DRAFT.map((d) => d.owner))].sort((a, b) => a.localeCompare(b));
  // Accents are ignored, so "jokic" finds Jokić.
  const fold = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = fold(query.trim());
  const shown = year ?? (q || owner || pick ? "" : String(years[0] ?? ""));
  const rows = sortRows(
    L.DRAFT.filter((d) => (!shown || d.start === +shown) && (!owner || d.owner === owner) && (!pick || d.pick === +pick) && (!q || fold(d.player).includes(q))),
    sort
  );
  return (
    <>
      <header className="page-head">
        <h1>Draft history</h1>
        <p className="lede">Every pick of every draft since {L.SEASON_LIST.find((s) => s.start === years[years.length - 1])?.label}, from Yahoo.</p>
      </header>
      <DraftImpact />
      <DraftSlots />
      <section aria-labelledby="picks-h">
      <div className="section-head"><h2 id="picks-h">Every pick</h2></div>
      <div className="controls">
        <Field id="draft-search" label="Search player">
          <input id="draft-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try Luka" />
        </Field>
        <Field id="draft-year" label="Season">
          <select id="draft-year" value={shown} onChange={(e) => setYear(e.target.value)}>
            <option value="">All seasons</option>
            {years.map((y) => <option key={y} value={y}>{L.SEASON_LIST.find((s) => s.start === y)?.label ?? y}</option>)}
          </select>
        </Field>
        <Field id="draft-pick" label="Pick">
          <select id="draft-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">All picks</option>
            {Array.from({ length: maxPick }, (_, i) => i + 1).map((n) => <option key={n} value={n}>#{n}</option>)}
          </select>
        </Field>
        <Field id="draft-owner" label="Owner">
          <select id="draft-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">All owners</option>
            {owners.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      <PlayerFacts rows={rows} query={q} />
      <DataTable
        caption="Draft picks"
        sort={sort}
        onSort={onSort}
        rowKey={(r) => r.start + "-" + r.pick}
        rows={rows}
        columns={[
          { key: "start", label: "Season", render: (r) => <a href={"#season-" + r.start}>{r.season}</a> },
          { key: "round", label: "Round", num: true },
          { key: "pick", label: "Pick", num: true },
          { key: "player", label: "Player", render: (r) => <button type="button" className="linkish" onClick={() => setQuery(r.player)} title={`Every time ${r.player} was drafted`}>{r.player}</button> },
          { key: "team", label: "Team" },
          { key: "owner", label: "Owner", render: (r) => <OwnerLink name={r.owner} /> },
        ]}
      />
      </section>
    </>
  );
}

// "Did you know" cards when a player search narrows to one to three players.
function PlayerFacts({ rows, query }) {
  if (!query) return null;
  const players = [...new Set(rows.map((r) => r.player))];
  if (!players.length || players.length > 3) return null;
  const list = (names) => names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  return (
    <div className="facts">
      {players.map((name) => {
        const f = L.playerFacts(name);
        const e = f.earliest;
        return (
          <aside key={name} className="fact" aria-label={`Did you know: ${name}`}>
            <p className="fact-kicker">Did you know?</p>
            <p className="fact-main">
              <strong>{name}</strong> has been drafted {f.times === 1 ? "once" : `${f.times} times`}
              {f.times > 1 && <> by {f.owners === 1 ? "the same owner" : `${f.owners} different owners`}</>}.
              {f.times > 1 && f.most > 1 && <> {list(f.topOwners)} drafted {name} the most ({f.most} times).</>}
            </p>
            <p className="fact-sub">
              Earliest: {e.pick === 1 ? "#1 overall" : `pick ${e.pick}`}{e.times > 1 ? `, ${e.times} times, first` : ","} by {e.owner} in {e.season}. {f.times > 1 && <>Average pick {f.avgPick.toFixed(1)}, from {f.first} to {f.last}.</>}
            </p>
          </aside>
        );
      })}
    </div>
  );
}

// ---------- Draft position vs finish ----------
// Does an early pick pay off? Each owner's first-round slot against how the team finished, completed seasons only.
function DraftImpact() {
  const [key, setKey] = useState("rank");
  const d = useMemo(() => L.draftImpact(key), [key]);
  const [sort, onSort] = useSort("slot", "asc");
  const [oSort, onOSort] = useSort("gain");
  if (!d.rows.length) return null;
  const word = key === "rank" ? "tournament" : "regular season";
  const first = d.bySlot[0];
  const lastSlot = d.bySlot[d.bySlot.length - 1];
  const [early, , late] = d.groups;
  const pctOf = (n, of) => Math.round((n / of) * 100) + "%";
  const finishRow = (r) => ({ main: <OwnerLink name={r.owner} />, val: `#${r.slot} to ${L.ordinal(r[key])}`, sub: `${r.season}, ${r.team}` });
  const places = Math.abs(d.spread);
  return (
    <section aria-labelledby="impact-h">
      <div className="section-head">
        <h2 id="impact-h">Does draft position matter?</h2>
        <p className="hint">Each owner's first-round pick against where the team finished, {d.drafts} drafts ({d.rows[0].season} to {d.rows[d.rows.length - 1].season}). Completed seasons only.</p>
      </div>
      <div className="controls controls-gap">
        <div className="field">
          <span className="field-label">Finish</span>
          <Segmented
            label="Which finish to compare"
            value={key}
            onChange={setKey}
            options={[["rank", "Tournament"], ["seed", "Regular season"]]}
          />
        </div>
      </div>
      <dl className="stats">
        <Stat
          label="The #1 pick"
          value={`${first.top3} of ${first.n} top three`}
          sub={`Average ${word} finish ${first.avg.toFixed(1)}, ${first.firsts} ${key === "rank" ? "title" : "regular-season title"}${first.firsts === 1 ? "" : "s"}`}
        />
        <Stat
          label={`Picks ${early.label.slice(6)} vs ${late.label.slice(6)}`}
          value={`${pctOf(early.top3, early.n)} vs ${pctOf(late.top3, late.n)}`}
          sub={`How often they finish top three. Average finish ${early.avg.toFixed(1)} vs ${late.avg.toFixed(1)}.`}
        />
        <Stat
          label={`Trend from pick 1 to pick ${lastSlot.slot}`}
          value={places < 1 ? "Almost none" : `${places.toFixed(1)} places`}
          sub={places < 1
            ? `The best-fit line moves less than one place across the whole draft (${places.toFixed(1)}): where you pick hardly changes where you finish.`
            : `On the best-fit line, picking ${lastSlot.slot}th instead of 1st means finishing about ${places.toFixed(1)} places ${d.slope > 0 ? "lower" : "higher"}.`}
        />
      </dl>
      <SlotChart rows={d.bySlot} word={word} />
      <DataTable
        caption={`${word} finish by draft slot`}
        sort={sort}
        onSort={onSort}
        rowKey={(r) => r.slot}
        rows={sortRows(d.bySlot, sort)}
        columns={[
          { key: "slot", label: "Pick", num: true, render: (r) => `#${r.slot}` },
          { key: "n", label: "Drafts", num: true },
          { key: "avg", label: "Avg finish", num: true, render: (r) => r.avg.toFixed(1) },
          { key: "firsts", label: key === "rank" ? "Titles" : "1st place", num: true, render: (r) => r.firsts ? <span title={r.winners.map((w) => `${w.owner} ${w.season}`).join(", ")}>{r.firsts}</span> : <span className="dim">-</span> },
          { key: "top3", label: "Top three", num: true, render: (r) => `${r.top3} (${pctOf(r.top3, r.n)})` },
          { key: "playoffs", label: "Made playoffs", num: true, render: (r) => `${r.playoffs} (${pctOf(r.playoffs, r.n)})` },
          { key: "best", label: "Best", num: true, render: (r) => L.ordinal(r.best) },
          { key: "worst", label: "Worst", num: true, render: (r) => L.ordinal(r.worst) },
        ]}
      />
      <div className="grid-2 impact-lists">
        <Ledger title="Biggest climbs: late pick, high finish" items={d.climbs.map(finishRow)} />
        <Ledger title="Biggest falls: early pick, low finish" items={d.falls.map(finishRow)} />
      </div>
      <h3 className="sub-h">Who beats their draft slot?</h3>
      <p className="hint">Owners with 10 or more drafts. Places gained is the average of draft slot minus {word} finish; above zero means they finish better than they pick.</p>
      <DataTable
        caption="Draft slot versus finish by owner"
        sort={oSort}
        onSort={onOSort}
        rowKey={(r) => r.owner}
        rows={sortRows(d.owners, oSort)}
        columns={[
          { key: "owner", label: "Owner", render: (r) => <OwnerLink name={r.owner} /> },
          { key: "drafts", label: "Drafts", num: true },
          { key: "slot", label: "Avg pick", num: true, render: (r) => r.slot.toFixed(1) },
          { key: "finish", label: "Avg finish", num: true, render: (r) => r.finish.toFixed(1) },
          { key: "gain", label: "Places gained", num: true, render: (r) => (Math.abs(r.gain) < 0.05 ? "0.0" : (r.gain > 0 ? "+" : "") + r.gain.toFixed(1)) },
        ]}
      />
    </section>
  );
}

// Bars: how often each draft slot finished in the top three. The dashed line is a fair share (3 of 12).
function SlotChart({ rows, word }) {
  const [ref, W] = useWidth(280, 640);
  const H = 190, pad = { l: 40, r: 10, t: 14, b: 30 };
  const max = Math.max(50, ...rows.map((r) => Math.ceil(((r.top3 / r.n) * 100) / 25) * 25));
  const slotW = (W - pad.l - pad.r) / rows.length;
  const barW = Math.min(36, slotW - 6);
  const Y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const fair = (3 / rows.length) * 100;
  const ticks = [];
  for (let v = 0; v <= max; v += 25) ticks.push(v);
  return (
    <figure className="chart" ref={ref}>
      <figcaption className="chart-title">How often each pick finished top three in the {word}. Dashed line: a fair share ({Math.round(fair)}%).</figcaption>
      <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Top-three ${word} finishes by draft slot. Full numbers are in the table below.`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={pad.l - 8} y={Y(v) + 4} textAnchor="end" className="axis">{v}%</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const p = (r.top3 / r.n) * 100;
          const x = pad.l + i * slotW + (slotW - barW) / 2;
          const y = Y(p), h = Y(0) - y;
          const rad = Math.min(4, h / 2, barW / 2);
          return (
            <g key={r.slot} className="bar-g">
              <title>{`Pick #${r.slot}: top three ${r.top3} of ${r.n} times (${Math.round(p)}%), average finish ${r.avg.toFixed(1)}, ${r.firsts} first-place finish${r.firsts === 1 ? "" : "es"}`}</title>
              <rect x={pad.l + i * slotW} y={pad.t} width={slotW} height={H - pad.t - pad.b} fill="transparent" />
              {h > 0 && (
                <path className="bar" d={`M${x},${Y(0)} V${y + rad} Q${x},${y} ${x + rad},${y} H${x + barW - rad} Q${x + barW},${y} ${x + barW},${y + rad} V${Y(0)} Z`} />
              )}
              <text x={pad.l + i * slotW + slotW / 2} y={H - 10} textAnchor="middle" className="axis">#{r.slot}</text>
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={Y(fair)} y2={Y(fair)} className="grid-mid" />
      </svg>
    </figure>
  );
}

// Average draft slot: the owner's round 1 pick, for owners with 10 or more drafts.
function DraftSlots() {
  const [sort, onSort] = useSort("avg", "asc");
  const rows = sortRows(L.draftSlots(10), sort);
  return (
    <section aria-labelledby="slots-h">
      <div className="section-head">
        <h2 id="slots-h">Average draft position</h2>
        <p className="hint">Each owner's first-round pick, for owners with 10 or more drafts. Lower is earlier.</p>
      </div>
      <DataTable
        caption="Average draft position by owner"
        sort={sort}
        onSort={onSort}
        rowKey={(r) => r.owner}
        rows={rows}
        columns={[
          { key: "owner", label: "Owner", render: (r) => <OwnerLink name={r.owner} /> },
          { key: "drafts", label: "Drafts", num: true },
          { key: "avg", label: "Avg pick", num: true, render: (r) => r.avg.toFixed(1) },
          { key: "firsts", label: "#1 picks", num: true, render: (r) => r.firsts || <span className="dim">-</span> },
          { key: "best", label: "Earliest", num: true },
          { key: "worst", label: "Latest", num: true },
        ]}
      />
    </section>
  );
}

// ---------- shell ----------
export default function App() {
  const hash = useHash();
  const [countTies, setCountTies] = useState(false);
  // Finished seasons are baked into the build; the current season's teams, draft and games load live
  // from Supabase. ver bumps when the live season arrives so the pages recompute.
  const [ver, setVer] = useState(0);
  useEffect(() => {
    L.loadLiveSeason().then((added) => added && setVer((v) => v + 1)).catch((e) => console.warn("Live season not loaded:", e.message));
  }, []);
  const owners = useMemo(() => L.buildOwners(countTies), [countTies, ver]);
  const [h2hFilter, setH2hFilter] = useState({ phase: "all", from: null, to: null });
  const [liveGames, setLiveGames] = useState(0);
  useEffect(() => {
    H.loadLiveGames().then(setLiveGames).catch((e) => console.warn("Live games not loaded:", e.message));
  }, []);
  const [route, param] = parseRoute(hash);
  useEffect(() => { window.scrollTo(0, 0); }, [hash]);
  const active = route === "owner" ? "owners" : route;
  // Phones: the menu is a drop-down list that closes when a page is picked.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [hash]);
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e) => { if (!e.target.closest?.(".masthead")) setMenuOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [menuOpen]);
  const currentLabel = (NAV.find(([id]) => id === active) || NAV[0])[1];

  let page;
  if (route === "owner") page = <OwnerPage slug={param} owners={owners} countTies={countTies} />;
  else if (route === "owners") page = <OwnersPage owners={owners} countTies={countTies} />;
  else if (route === "seasons") page = <SeasonsPage start={param} countTies={countTies} />;
  else if (route === "h2h") page = <H2HPage param={param} countTies={countTies} filter={h2hFilter} setFilter={setH2hFilter} liveGames={liveGames} />;
  else if (route === "teams") page = <TeamsPage countTies={countTies} ver={ver} />;
  else if (route === "draft") page = <DraftPage />;
  else if (route === "odds") page = <OddsPage />;
  else if (route === "now") page = <CurrentSeason tab={param} />;
  else page = <RecordBook owners={owners} countTies={countTies} />;

  return (
    <TiesContext.Provider value={{ countTies, setCountTies }}>
    <div className="shell">
      <div className="masthead">
        <a className="brand" href="#"><Pine />Laker Fantasy NBA</a>
        <button type="button" className="menu-btn" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen((o) => !o)}>
          <span className="menu-icon" aria-hidden="true" />
          {currentLabel}
        </button>
        <nav aria-label="Main" id="main-nav" className={"nav" + (menuOpen ? " open" : "")}>
          {NAV.map(([id, label]) => (
            <a key={id || "home"} href={"#" + id} aria-current={active === id || (id === "" && !NAV.some(([n]) => n === active) ) ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </div>
      {H.IS_SAMPLE && (
        <p className="notice notice-sample">
          Head-to-head numbers on this preview are made up so the pages can be tried out. Real matchups load from Yahoo.
        </p>
      )}
      <PageHelp page={HELP[route] ? route : "home"} />
      <main>{page}</main>
      <footer className="foot">
        <div className="foot-top">
          <div className="foot-left">
            {/* Yahoo's required attribution (developer.yahoo.com/attribution): official logo, unaltered, linked to yahoo.com. */}
            <a className="yahoo-attr" href="https://www.yahoo.com/?ilc=401" target="_blank" rel="noopener">
              <picture>
                <source media="(prefers-color-scheme: dark)" srcSet="https://poweredby.yahoo.com/poweredby_yahoo_h_white.png 1x, https://poweredby.yahoo.com/poweredby_yahoo_h_white_retina.png 2x" />
                <img src="https://poweredby.yahoo.com/poweredby_yahoo_h_purple.png" srcSet="https://poweredby.yahoo.com/poweredby_yahoo_h_purple.png 1x, https://poweredby.yahoo.com/poweredby_yahoo_h_purple_retina.png 2x" width="134" height="20" alt="Powered by Yahoo" />
              </picture>
            </a>
            <p>Fantasy data provided by Yahoo Fantasy</p>
          </div>
          <div className="foot-right">
            <p className="credits">Site managed by Craig <span aria-hidden="true">·</span> Built by Claude</p>
            <Feedback />
          </div>
        </div>
        <p>An independent league site. Colors and pines nod to University Lake School, home of the Lakers, and it is not affiliated with the school.</p>
      </footer>
    </div>
    </TiesContext.Provider>
  );
}
