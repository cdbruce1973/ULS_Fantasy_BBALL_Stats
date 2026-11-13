// Back-test for the matchup predictor (supabase/functions/matchup-odds/model.ts).
// For every finished week of the current season and every morning of that week, predict each matchup
// using only what was known that morning, then score the predictions against the real result.
//
// Needs two exports from the SQL editor (not checked in; they are league data, not code):
//   days.txt:    select string_agg(concat_ws('|', game_date, player_key, team_id, slot,
//                  case when stats->>'12'='-' then '-' else concat_ws(',',stats->>'3',stats->>'4',stats->>'6',stats->>'7',
//                  stats->>'10',stats->>'12',stats->>'15',stats->>'16',stats->>'17',stats->>'18',stats->>'19') end),
//                  E'\n' order by game_date, team_id) from player_days where season_id = <id>;
//   results.json: [[week, team1_id, team2_id, team1_cats_won, team2_cats_won], ...] for finished weeks
// Run: node scripts/backtest_matchup_odds.ts <dir with both files> <week start dates, e.g. 2026-10-20,2026-10-26,2026-11-02,2026-11-09>
//
// Injury status isn't stored for past days, so here a player who sat his team's last two games counts as "O"
// and everyone else as healthy. The live model uses Yahoo's real status, which should only do better.
import { readFileSync } from "node:fs";
import { simulateMatchup, replacementGames, type Line, type TeamIn, type ModelOptions } from "../supabase/functions/matchup-odds/model.ts";

const [dir, startsArg] = process.argv.slice(2);
const weekStarts = startsArg.split(",");
const BENCH = new Set(["BN", "IL", "IL+", "NA"]);
type Row = { date: string; key: string; team: number; slot: string; line: Line | null; game: boolean };
const rows: Row[] = readFileSync(`${dir}/days.txt`, "utf8").trim().split("\n").map((s) => {
  const [date, key, team, slot, st] = s.split("|");
  const v = st === "-" ? null : st.split(",").map((x) => Number(x || 0));
  const played = v && v.some((x) => x !== 0) ? v : null;
  return { date, key, team: Number(team), slot, line: played, game: st !== "-" };
});
const results: number[][] = JSON.parse(readFileSync(`${dir}/results.json`, "utf8"));

const addDays = (iso: string, n: number) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const diff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

function predictAll(opts: Partial<ModelOptions>, useStatus = true) {
  const preds: { week: number; day: number; p: number; tie: number; y: number }[] = [];
  for (const [week, a, b, ac, bc] of results) {
    const start = weekStarts[week - 1], end = addDays(weekStarts[week] ?? addDays(start, 7), -1);
    const len = diff(end, start) + 1;
    for (let k = 0; k < len; k++) {
      const today = addDays(start, k);
      const before = rows.filter((r) => r.date < today);
      const byPlayer = new Map<string, Line[]>();
      for (const r of before) if (r.line) (byPlayer.get(r.key) ?? byPlayer.set(r.key, []).get(r.key)!).push(r.line);
      const repl = replacementGames(byPlayer);
      const team = (id: number): TeamIn => {
        const sofar = new Array(11).fill(0);
        for (const r of before) if (r.team === id && r.date >= start && r.line && !BENCH.has(r.slot)) r.line.forEach((x, i) => (sofar[i] += x));
        const roster = rows.filter((r) => r.team === id && r.date === today);
        return {
          id, sofar,
          players: roster.map((p) => {
            const mine = before.filter((r) => r.key === p.key);
            const teamGames = mine.filter((r) => r.game);
            const sat2 = teamGames.length >= 2 && teamGames.slice(-2).every((r) => !r.line);
            const hasGame = Array.from({ length: len - k }, (_, d) => {
              const r = rows.find((x) => x.key === p.key && x.date === addDays(today, d));
              return r ? (r.game ? 1 : 0) : 0.5;
            });
            return {
              key: p.key, status: useStatus && sat2 ? "O" : "",
              games: mine.filter((r) => r.line).map((r) => ({ line: r.line!, age: diff(today, r.date) })),
              hasGame,
            };
          }),
        };
      };
      const out = simulateMatchup(team(a), team(b), len - k, { sims: 2000, ...opts }, repl, week * 100 + k);
      preds.push({ week, day: k, p: out.win, tie: out.tie, y: ac > bc ? 1 : ac < bc ? 0 : 0.5 });
    }
  }
  return preds;
}

const brier = (ps: { p: number; tie: number; y: number }[]) => ps.reduce((s, x) => s + (x.p + x.tie / 2 - x.y) ** 2, 0) / ps.length;
const acc = (ps: { p: number; y: number }[]) => ps.filter((x) => (x.p > 0.5) === (x.y === 1)).length / ps.length;

const logloss = (ps: { p: number; tie: number; y: number }[]) => ps.reduce((s, x) => {
  const q = Math.min(0.99, Math.max(0.01, x.p + x.tie / 2));
  return s - (x.y * Math.log(q) + (1 - x.y) * Math.log(1 - q));
}, 0) / ps.length;
const grid = process.env.GRID ? JSON.parse(process.env.GRID) : null;
if (grid) {
  for (const o of grid) {
    const ps = predictAll(o).filter((x) => x.week > 1);
    console.log(JSON.stringify(o), "Brier", brier(ps).toFixed(4), "log loss", logloss(ps).toFixed(4));
  }
  process.exit(0);
}
const variants: [string, Partial<ModelOptions>, boolean?][] = [
  ["default (half-life 21 days)", {}],
  ["half-life 7 days", { halfLife: 7 }],
  ["half-life 14 days", { halfLife: 14 }],
  ["no recency weighting", { halfLife: 1e9 }],
  ["no lineup limit", { slots: 99 }],
  ["no injury guess", {}, false],
];
for (const [name, o, st] of variants) {
  const ps = predictAll(o, st ?? true);
  const late = ps.filter((x) => x.week > 1);
  console.log(`${name.padEnd(30)} Brier ${brier(ps).toFixed(3)}  (weeks 2+ ${brier(late).toFixed(3)})  log loss ${logloss(late).toFixed(3)}  picks right ${(100 * acc(ps)).toFixed(0)}%  n=${ps.length}`);
  if (name.startsWith("default")) {
    const byDay = new Map<number, typeof ps>();
    for (const x of late) (byDay.get(x.day) ?? byDay.set(x.day, []).get(x.day)!).push(x);
    console.log("   weeks 2+ only:");
    for (const [d, list] of byDay) console.log(`   morning of day ${d + 1}: Brier ${brier(list).toFixed(3)}, right ${(100 * acc(list)).toFixed(0)}%, n=${list.length}`);
    const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.01];
    for (let i = 0; i < bins.length - 1; i++) {
      const b = late.filter((x) => x.p >= bins[i] && x.p < bins[i + 1]);
      if (b.length) console.log(`   predicted ${(100 * bins[i]).toFixed(0)}-${Math.min(100, 100 * bins[i + 1]).toFixed(0)}%: avg ${(100 * b.reduce((s, x) => s + x.p, 0) / b.length).toFixed(0)}%, won ${(100 * b.reduce((s, x) => s + x.y, 0) / b.length).toFixed(0)}%, n=${b.length}`);
    }
  }
}
