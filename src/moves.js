// Transactions (adds, drops, trades) against how teams finished. Completed seasons only for the
// all-time numbers; the season in progress shows in the by-season table and the transaction log.
import * as L from "./lib.js";
import { fetchAll } from "./supabase.js";

const avg = (xs) => (xs.length ? xs.reduce((a, n) => a + n, 0) / xs.length : NaN);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

export const hasMoves = () => L.TEAM_SEASONS.some((t) => t.moves);

// Where a team's adds rank in its own season: 1 = most active. Ties share the better rank.
// Ranking within each season matters because activity has changed a lot over the years.
function withActivity(teams) {
  return teams.map((t) => ({ ...t, activity: 1 + teams.filter((o) => o.moves.adds > t.moves.adds).length }));
}

// Every finished team with transactions and a final rank.
export function moveFinishes() {
  return L.SEASON_LIST.filter((s) => !s.current && s.teams.every((t) => t.moves && t.rank))
    .flatMap((s) => withActivity(s.teams).map((t) => ({
      start: s.start, season: s.label, owner: t.owner, team: t.team,
      ...t.moves, activity: t.activity, rank: t.rank, seed: t.seed,
    })));
}

// Pearson correlation of two lists.
function corr(xs, ys) {
  const mx = avg(xs), my = avg(ys);
  let c = 0, vx = 0, vy = 0;
  xs.forEach((x, i) => { c += (x - mx) * (ys[i] - my); vx += (x - mx) ** 2; vy += (ys[i] - my) ** 2; });
  return vx && vy ? c / Math.sqrt(vx * vy) : 0;
}

// key = "rank" (tournament) or "seed" (regular season).
export function movesImpact(key) {
  const rows = moveFinishes();
  if (!rows.length) return null;
  const sum = (list) => ({
    n: list.length,
    avg: avg(list.map((r) => r[key])),
    adds: avg(list.map((r) => r.adds)),
    firsts: list.filter((r) => r[key] === 1).length,
    top3: list.filter((r) => r[key] <= 3).length,
    playoffs: list.filter((r) => r.seed <= L.PLAYOFF_TEAMS).length,
    winners: list.filter((r) => r[key] === 1),
  });
  const ranks = [...new Set(rows.map((r) => r.activity))].sort((a, b) => a - b);
  // Ranks 1-12, with a tie shared by two teams counted at the better rank.
  const byRank = ranks.map((rank) => ({ slot: rank, ...sum(rows.filter((r) => r.activity === rank)) }));
  const groups = [[1, 4, "Most active 4"], [5, 8, "Middle 4"], [9, 12, "Least active 4"]].map(([a, b, label]) => ({
    label, ...sum(rows.filter((r) => r.activity >= a && r.activity <= b)),
  }));
  // Best-fit line of finish on activity rank: places gained or lost from most to least active.
  const slope = (() => {
    const mx = avg(rows.map((r) => r.activity)), my = avg(rows.map((r) => r[key]));
    const c = rows.reduce((a, r) => a + (r.activity - mx) * (r[key] - my), 0);
    const v = rows.reduce((a, r) => a + (r.activity - mx) ** 2, 0);
    return v ? c / v : 0;
  })();
  // Correlation within seasons (both numbers ranked inside their season), so busy eras don't skew it.
  // Both ranks run 1 = most active / best finish, so above zero means more moves go with a better finish.
  const r = corr(rows.map((x) => x.activity), rows.map((x) => x[key]));
  const champs = rows.filter((x) => x[key] === 1).map((c) => {
    const season = rows.filter((x) => x.start === c.start);
    return { ...c, median: median(season.map((x) => x.adds)) };
  });
  const traded = rows.filter((x) => x.trades > 0), none = rows.filter((x) => x.trades === 0);
  const busiest = [...rows].sort((a, b) => b.adds - a.adds || a[key] - b[key]).slice(0, 5);
  const quietest = [...rows].sort((a, b) => a.adds - b.adds || a[key] - b[key]).slice(0, 5);
  return {
    rows,
    seasons: new Set(rows.map((x) => x.start)).size,
    first: rows[0].season,
    last: rows[rows.length - 1].season,
    byRank, groups, slope, spread: slope * 11,
    r,
    champs,
    champAbove: champs.filter((c) => c.adds > c.median).length,
    champMedianRank: median(champs.map((c) => c.activity)),
    trades: { with: sum(traded), without: sum(none) },
    busiest, quietest,
  };
}

// Career transaction habits, completed seasons only, for owners with 3 or more such seasons.
export function movesByOwner(key) {
  const rows = moveFinishes();
  const by = new Map();
  for (const r of rows) by.set(r.owner, [...(by.get(r.owner) || []), r]);
  return [...by].filter(([, list]) => list.length >= 3).map(([owner, list]) => {
    const most = [...list].sort((a, b) => b.adds - a.adds)[0];
    const adds = list.reduce((a, r) => a + r.adds, 0);
    const waivers = list.reduce((a, r) => a + r.waivers, 0);
    return {
      owner,
      seasons: list.length,
      adds,
      perSeason: adds / list.length,
      trades: list.reduce((a, r) => a + r.trades, 0),
      waiverPct: adds ? (waivers / adds) * 100 : 0,
      activity: avg(list.map((r) => r.activity)),
      finish: avg(list.map((r) => r[key])),
      most: most.adds, mostSeason: most.season,
    };
  });
}

// One row per season with transactions, the season in progress included.
export function movesBySeason() {
  return L.SEASON_LIST.filter((s) => s.teams.some((t) => t.moves)).map((s) => {
    const teams = withActivity(s.teams.filter((t) => t.moves));
    const by = [...teams].sort((a, b) => b.moves.adds - a.moves.adds);
    const champ = teams.find((t) => t.tourney === 1);
    return {
      start: s.start,
      season: s.label,
      current: !!s.current,
      adds: teams.reduce((a, t) => a + t.moves.adds, 0),
      // A trade involves two teams, so each team's count adds up to twice the league's trades.
      trades: Math.round(teams.reduce((a, t) => a + t.moves.trades, 0) / 2),
      busiest: by[0],
      quietest: by[by.length - 1],
      champ: champ && { ...champ, adds: champ.moves.adds },
    };
  });
}

// The full transaction log for one season, loaded live (any season; the table is public).
export async function loadLog(start) {
  const s = L.SEASON_LIST.find((x) => x.start === start);
  if (!s) return [];
  const [season] = await fetchAll(`seasons?select=id&start_year=eq.${start}`);
  if (!season) return [];
  const [rows, teams] = await Promise.all([
    fetchAll(`transactions?select=yahoo_key,ts,kind,move,source,from_team_id,to_team_id,player_name,positions,nba_team&season_id=eq.${season.id}&order=ts.desc,yahoo_key`),
    fetchAll(`teams?select=id,name,owner_id&season_id=eq.${season.id}`),
  ]);
  const owners = await fetchAll("owners?select=id,name");
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const team = new Map(teams.map((t) => [t.id, { team: t.name, owner: ownerName.get(t.owner_id) ?? "Unknown" }]));
  // Group the player rows back into transactions.
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.yahoo_key)) out.set(r.yahoo_key, { key: r.yahoo_key, ts: r.ts, kind: r.kind, players: [] });
    out.get(r.yahoo_key).players.push({
      name: r.player_name, pos: r.positions, nba: r.nba_team, move: r.move, source: r.source,
      from: team.get(r.from_team_id) ?? null, to: team.get(r.to_team_id) ?? null,
    });
  }
  return [...out.values()];
}
