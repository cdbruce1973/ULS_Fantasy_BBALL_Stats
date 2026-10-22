import { useEffect, useMemo, useRef, useState } from "react";
import * as L from "./lib.js";
import { DRAFT } from "./data.js";

const NAV = [
  ["", "Record book"],
  ["owners", "Owners"],
  ["seasons", "Seasons"],
  ["teams", "Teams"],
  ["draft", "Draft"],
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
  return [hash, null];
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
function Banner({ b }) {
  const { season, champ, runnerUp, sweep } = b;
  return (
    <li className={"banner" + (sweep ? " banner-sweep" : "")}>
      <a href={"#season-" + season.start} title={`Runner-up: ${runnerUp ? runnerUp.owner : "n/a"}${sweep ? ". Also won the regular season." : ""}`}>
        <Pine className="banner-crest" />
        <span className="banner-year">{season.label}</span>
        <span className="banner-name">{champ ? champ.owner : "-"}</span>
        <span className="banner-team">{champ ? champ.team : ""}</span>
      </a>
    </li>
  );
}

function Rafters({ owner }) {
  const banners = useMemo(
    () => L.buildBanners().filter((b) => !owner || (b.champ && b.champ.owner === owner)),
    [owner]
  );
  if (owner && !banners.length) return null;
  return (
    <section aria-labelledby="banners-h">
      <div className="section-head">
        <h2 id="banners-h">{owner ? "Championship banners" : "Championship banners"}</h2>
        <p className="hint">{owner ? "Newest first. Gold banners also won the regular season." : "Newest first. Gold banners won the regular season too."}</p>
      </div>
      <div className="rafters" tabIndex={0} aria-label="Championship banners, scrollable">
        <ol className="banner-row">
          {banners.map((b) => (
            <Banner key={b.season.start} b={b} />
          ))}
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
      <header className="page-head">
        <h1>Record book</h1>
        <p className="lede">Every title, streak and standing since the first season in 2004-05.</p>
        <Shoreline />
      </header>
      <Rafters />

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
          <p className="hint">Owners with at least 10 seasons. {countTies ? "Ties count as games played." : "Ties are left out of win %."}</p>
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
        <p className="lede">Career totals for everyone who has run a team. {countTies ? "Win % counts ties as games." : "Win % leaves ties out."}</p>
      </header>
      <div className="controls">
        <Field id="owner-search" label="Search owners">
          <input id="owner-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={vetsOnly} onChange={(e) => setVetsOnly(e.target.checked)} />
          Only owners with 10 or more seasons
        </label>
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
        <p className="lede">{o.seasons} seasons, {o.first} to {o.last}.</p>
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
        </div>
        <Sparkline rows={o.rows} countTies={countTies} />
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
            { key: "start", label: "Season", render: (r) => <a href={"#season-" + r.start}>{r.season}</a> },
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
        <div className="section-head"><h2 id="season-h">{season.label}</h2></div>
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
    </>
  );
}

// ---------- Teams (search every team name across every season) ----------
function TeamsPage({ countTies }) {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [sort, onSort] = useSort("start");
  const all = useMemo(
    () => L.TEAM_SEASONS.map((t) => ({ ...t, pct: L.winPct(t.w, t.l, t.t, countTies) })),
    [countTies]
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
  const [year, setYear] = useState("");
  const [owner, setOwner] = useState("");
  const [query, setQuery] = useState("");
  const [sort, onSort] = useSort("year");
  const years = [...new Set(DRAFT.map((d) => d.year))].sort((a, b) => b - a);
  const owners = [...new Set(DRAFT.map((d) => d.owner))].sort();
  const q = query.trim().toLowerCase();
  const rows = sortRows(
    DRAFT.filter((d) => (!year || d.year === +year) && (!owner || d.owner === owner) && (!q || d.player.toLowerCase().includes(q))),
    sort
  );
  return (
    <>
      <header className="page-head">
        <h1>Draft history</h1>
        <p className="lede">Sample: the first five picks of each draft from 2017 to 2024. The full drafts for every season will load from Yahoo.</p>
      </header>
      <div className="controls">
        <Field id="draft-search" label="Search player">
          <input id="draft-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try Luka" />
        </Field>
        <Field id="draft-year" label="Year">
          <select id="draft-year" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field id="draft-owner" label="Owner">
          <select id="draft-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">All owners</option>
            {owners.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      <DataTable
        caption="Draft picks"
        sort={sort}
        onSort={onSort}
        rowKey={(r) => r.year + "-" + r.pick}
        rows={rows}
        columns={[
          { key: "year", label: "Year" },
          { key: "pick", label: "Pick", num: true },
          { key: "player", label: "Player" },
          { key: "team", label: "Team" },
          { key: "owner", label: "Owner", render: (r) => <OwnerLink name={r.owner} /> },
        ]}
      />
    </>
  );
}

// ---------- shell ----------
export default function App() {
  const hash = useHash();
  const [countTies, setCountTies] = useState(false);
  const owners = useMemo(() => L.buildOwners(countTies), [countTies]);
  const [route, param] = parseRoute(hash);
  useEffect(() => { window.scrollTo(0, 0); }, [hash]);
  const active = route === "owner" ? "owners" : route;

  let page;
  if (route === "owner") page = <OwnerPage slug={param} owners={owners} countTies={countTies} />;
  else if (route === "owners") page = <OwnersPage owners={owners} countTies={countTies} />;
  else if (route === "seasons") page = <SeasonsPage start={param} countTies={countTies} />;
  else if (route === "teams") page = <TeamsPage countTies={countTies} />;
  else if (route === "draft") page = <DraftPage />;
  else page = <RecordBook owners={owners} countTies={countTies} />;

  return (
    <div className="shell">
      <div className="masthead">
        <a className="brand" href="#"><Pine />Laker Fantasy Bball</a>
        <nav aria-label="Main" className="nav">
          {NAV.map(([id, label]) => (
            <a key={id || "home"} href={"#" + id} aria-current={active === id || (id === "" && !NAV.some(([n]) => n === active) ) ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <Segmented
          label="How win percentage is figured"
          value={countTies}
          onChange={setCountTies}
          options={[[false, "Ties left out"], [true, "Ties count"]]}
        />
      </div>
      <p className="notice">
        Preview with data from the commissioner's spreadsheet through 2025-26. It switches to live Yahoo data once access is approved.
      </p>
      <main>{page}</main>
      <footer className="foot">
        <p>Fantasy data provided by Yahoo Fantasy</p>
        <p>An independent league site. Colors and pines nod to University Lake School, home of the Lakers, and it is not affiliated with the school.</p>
      </footer>
    </div>
  );
}
