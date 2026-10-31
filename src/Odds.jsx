import { useEffect, useState } from "react";
import { fetchAll } from "./supabase.js";

// Playoff odds for the season in progress. The playoff-odds edge function simulates the rest of the
// regular season every Monday and writes playoff_odds; this reads it live (playoff_odds_view), so no
// site rebuild is needed. Every week's run is kept, which is what the "trend" column draws.

const select = "start_year,num_playoff_teams,through_week,owner,team,cat_w,cat_l,cat_t,proj_w,proj_l,proj_t,playoff_pct,top_seed_pct,avg_seed,seed_pct,sims,computed_at";

export async function loadPlayoffOdds() {
  const rows = await fetchAll(`playoff_odds_view?select=${select}&is_current=eq.true&order=through_week`);
  if (!rows.length) return null;
  const weeks = [...new Set(rows.map((r) => r.through_week))].sort((a, b) => a - b);
  const latest = weeks[weeks.length - 1];
  const prevWeek = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const spots = rows[0].num_playoff_teams ?? 6;
  const history = new Map();
  for (const r of rows) {
    if (!history.has(r.team)) history.set(r.team, []);
    history.get(r.team).push({ week: r.through_week, pct: Number(r.playoff_pct) });
  }
  const teams = rows
    .filter((r) => r.through_week === latest)
    .map((r) => {
      const seeds = (r.seed_pct ?? []).map(Number);
      const prev = prevWeek == null ? null : rows.find((x) => x.through_week === prevWeek && x.team === r.team);
      return {
        owner: r.owner ?? "Unknown",
        team: r.team,
        w: Number(r.cat_w), l: Number(r.cat_l), t: Number(r.cat_t),
        pw: Math.round(r.proj_w), pl: Math.round(r.proj_l), pt: Math.round(r.proj_t),
        pct: Number(r.playoff_pct),
        change: prev ? Number(r.playoff_pct) - Number(prev.playoff_pct) : null,
        // With six playoff teams, Yahoo gives the top two seeds a first-round bye.
        bye: spots === 6 ? seeds.slice(0, 2).reduce((a, b) => a + b, 0) : null,
        top: Number(r.top_seed_pct),
        avgSeed: Number(r.avg_seed),
        history: history.get(r.team),
      };
    })
    .sort((a, b) => b.pct - a.pct || a.avgSeed - b.avgSeed);
  return { season: rows[0].start_year, through: latest, spots, sims: rows[0].sims, computedAt: rows.find((r) => r.through_week === latest).computed_at, teams };
}

const pctText = (v) => (v >= 99.95 ? ">99.9%" : v > 0 && v < 0.05 ? "<0.1%" : v.toFixed(1) + "%");
const rec = (w, l, t) => `${w}-${l}-${t}`;

function Change({ v }) {
  if (v == null) return <span className="dim">-</span>;
  if (Math.abs(v) < 0.5) return <span className="dim">even</span>;
  return <span className={v > 0 ? "odds-up" : "odds-down"}>{v > 0 ? "▲" : "▼"} {Math.abs(v).toFixed(0)}</span>;
}

function OddsBar({ v }) {
  return (
    <span className="odds-bar" aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
    </span>
  );
}

function Trend({ points }) {
  if (!points || points.length < 2) return <span className="dim">-</span>;
  const W = 72, H = 22, n = points.length;
  const X = (i) => 2 + (i / (n - 1)) * (W - 4);
  const Y = (v) => 2 + (1 - v / 100) * (H - 4);
  const last = points[n - 1];
  return (
    <svg className="odds-trend" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Playoff odds by week: ${points.map((p) => `week ${p.week} ${p.pct.toFixed(0)}%`).join(", ")}`}>
      <line x1="2" x2={W - 2} y1={Y(50)} y2={Y(50)} className="odds-trend-mid" />
      <polyline fill="none" points={points.map((p, i) => `${X(i)},${Y(p.pct)}`).join(" ")} />
      <circle cx={X(n - 1)} cy={Y(last.pct)} r="2.5" />
    </svg>
  );
}

// The odds table on its own, for the current-season hub. `limit` shows only the top rows.
export function PlayoffOdds({ odds, limit }) {
  if (!odds) return null;
  const rows = limit ? odds.teams.slice(0, limit) : odds.teams;
  return (
    <div className="tbl-wrap">
      <table className="dt odds">
        <caption className="sr">Playoff odds after week {odds.through}</caption>
        <thead>
          <tr>
            <th>Team</th>
            <th>Make playoffs</th>
            <th className="num">Last week</th>
            {odds.spots === 6 && <th className="num">Bye</th>}
            <th className="num">1st seed</th>
            <th className="num">Avg seed</th>
            <th className="num">Record</th>
            <th className="num">Projected</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team} className={i === odds.spots - 1 && !limit ? "odds-cutline" : undefined}>
              <td>
                <a href={"#owner-" + r.owner.toLowerCase().replace(/[^a-z0-9]/g, "")} className="n">{r.owner}</a>
                <div className="dim odds-team">{r.team}</div>
              </td>
              <td><span className="odds-cell"><OddsBar v={r.pct} /><span className="n">{pctText(r.pct)}</span></span></td>
              <td className="num"><Change v={r.change} /></td>
              {odds.spots === 6 && <td className="num">{pctText(r.bye)}</td>}
              <td className="num">{pctText(r.top)}</td>
              <td className="num">{r.avgSeed.toFixed(1)}</td>
              <td className="num">{rec(r.w, r.l, r.t)}</td>
              <td className="num dim">{rec(r.pw, r.pl, r.pt)}</td>
              <td><Trend points={r.history} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function useOdds() {
  const [state, setState] = useState({ loading: true, odds: null, error: null });
  useEffect(() => {
    loadPlayoffOdds()
      .then((odds) => setState({ loading: false, odds, error: null }))
      .catch((e) => setState({ loading: false, odds: null, error: e.message }));
  }, []);
  return state;
}

export default function OddsPage() {
  const { loading, odds, error } = useOdds();
  const updated = odds && new Date(odds.computedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <>
      <header className="page-head">
        <h1>Playoff odds</h1>
        <p className="lede">
          Each team's chance of finishing in the top {odds?.spots ?? 6} of the regular season and making the playoffs,
          from {odds ? odds.sims.toLocaleString("en-US") : "10,000"} simulations of the rest of the schedule. Recalculated every Monday after the week ends.
        </p>
      </header>
      {loading && <p className="hint">Loading the latest odds...</p>}
      {error && <p className="empty-note">The odds could not be loaded right now. Try again in a minute.</p>}
      {!loading && !error && !odds && (
        <p className="empty-note">Odds start the Monday after the first full week of the season, once there are results to go on.</p>
      )}
      {odds && (
        <>
          <p className="count odds-asof">After week {odds.through} · updated {updated} · the line marks the last playoff spot</p>
          <PlayoffOdds odds={odds} />
          <details className="odds-how">
            <summary>How the odds work</summary>
            <p>
              Standings in this league are category records: every category of every week is a win, loss or tie, and the
              top {odds.spots} by win % make the playoffs. So the simulation plays out each remaining week one category at a time.
            </p>
            <p>
              A team's strength is its category win rate so far, pulled toward .500 by about nine weeks of average play, so a
              hot start counts but doesn't settle anything. Each simulated season also gives every team random good and bad weeks
              (injuries, light schedules, slumps), then ranks the final standings. A team's odds are how often it lands in a playoff spot.
            </p>
            <p>
              Tested on every finished season since 2005-06: teams given about 25% made the playoffs 26% of the time, teams
              given about 75% made it 79% of the time, and the odds sharpen steadily as the weeks go by. "Projected" is the
              average final category record. Bye is a top-two seed.
            </p>
          </details>
        </>
      )}
    </>
  );
}
