// The season in progress, loaded live from Supabase in the browser (nothing here is baked into the build).
//   loadSeasonCore()  teams, owners and every matchup (played, this week and the schedule ahead)
//   loadNight(date)   every rostered player's stats for one day (player_days, synced nightly)
//   loadPlayerGames() every game a rostered player has played this season, for trends
// Yahoo stat ids are the ones in h2h.js CATEGORIES; 3 = FGA and 6 = FTA (needed for the percentages).
import { fetchAll } from "./supabase.js";

export const CATS = [
  { id: "4", label: "FGM" },
  { id: "5", label: "FG%", pct: ["4", "3"] },
  { id: "7", label: "FTM" },
  { id: "8", label: "FT%", pct: ["7", "6"] },
  { id: "10", label: "3PTM" },
  { id: "12", label: "PTS" },
  { id: "15", label: "REB" },
  { id: "16", label: "AST" },
  { id: "17", label: "ST" },
  { id: "18", label: "BLK" },
  { id: "19", label: "TO", low: true },
];
const COUNTING = ["3", "4", "6", "7", "10", "12", "15", "16", "17", "18", "19"];
// Slots whose stats don't count for the fantasy team that day.
export const BENCH = new Set(["BN", "IL", "IL+", "NA"]);

const num = (v) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : null;
};

// A player's stat line for one day: counting stats as numbers. Yahoo shows "-" on days without a game,
// and all zeros when the player's NBA team played but he didn't (injured, rested, DNP): both return null.
// Some leagues give shots as "FGM/FGA" (stat 9004003) instead of FGA; both are handled.
export function statLine(stats) {
  if (!stats) return null;
  const s = {};
  for (const id of COUNTING) s[id] = num(stats[id]);
  const split = (combo, made, att) => {
    if (s[att] == null && typeof stats[combo] === "string" && stats[combo].includes("/")) {
      const [m, a] = stats[combo].split("/").map(num);
      if (s[made] == null) s[made] = m;
      s[att] = a;
    }
  };
  split("9004003", "4", "3");
  split("9007006", "7", "6");
  if (s["12"] == null) return null; // no game that day
  for (const id of COUNTING) if (s[id] == null) s[id] = 0;
  if (COUNTING.every((id) => s[id] === 0)) return null;
  return s;
}

// True when the player's NBA team played that day but he didn't get in.
export const sat = (stats) => stats?.["12"] === "0" && !statLine(stats);

// Sum stat lines and work out the percentages.
export function addUp(lines) {
  const t = Object.fromEntries(COUNTING.map((id) => [id, 0]));
  for (const l of lines) for (const id of COUNTING) t[id] += l[id] ?? 0;
  t["5"] = t["3"] ? t["4"] / t["3"] : null;
  t["8"] = t["6"] ? t["7"] / t["6"] : null;
  return t;
}

export function fmtCat(cat, v) {
  if (v == null || !Number.isFinite(v)) return "-";
  if (cat.pct) return v.toFixed(3).replace(/^0/, "");
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ---------- season core ----------
export async function loadSeasonCore() {
  const [season] = await fetchAll("seasons?select=*&is_current=eq.true&limit=1");
  if (!season) return null;
  const [owners, teams, games] = await Promise.all([
    fetchAll("owners?select=id,name"),
    fetchAll(`teams?select=id,name,owner_id,wins,losses,ties&season_id=eq.${season.id}`),
    fetchAll(`matchups?select=week,team1_id,team2_id,is_complete,is_playoff,is_consolation,team1_cats_won,team2_cats_won,team1_stats,team2_stats&season_id=eq.${season.id}&order=week`),
  ]);
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const teamById = new Map(
    teams.map((t) => [t.id, { id: t.id, team: t.name, owner: ownerName.get(t.owner_id) ?? t.name, w: t.wins, l: t.losses, t: t.ties }])
  );
  const matchups = games
    .filter((g) => teamById.has(g.team1_id) && teamById.has(g.team2_id))
    .map((g) => ({
      week: g.week,
      a: teamById.get(g.team1_id),
      b: teamById.get(g.team2_id),
      done: g.is_complete,
      playoff: g.is_playoff,
      consolation: g.is_consolation,
      ac: Number(g.team1_cats_won) || 0,
      bc: Number(g.team2_cats_won) || 0,
      as: g.team1_stats,
      bs: g.team2_stats,
      started: !!(g.team1_stats && Object.values(g.team1_stats).some((v) => num(v) != null)),
    }));
  // This week = the first week not yet final that has started; otherwise the last week played.
  const live = matchups.filter((m) => !m.done && m.started);
  const played = matchups.filter((m) => m.done);
  const currentWeek = live.length ? Math.min(...live.map((m) => m.week)) : played.length ? Math.max(...played.map((m) => m.week)) : 1;
  return { season, teams: [...teamById.values()], teamById, matchups, currentWeek };
}

// Category-by-category result of one matchup from the stored weekly totals.
export function catResults(as, bs) {
  return CATS.map((c) => {
    const x = num(as?.[c.id]), y = num(bs?.[c.id]);
    let lead = 0;
    if (x != null && y != null && x !== y) lead = (x > y) !== !!c.low ? 1 : -1;
    return { ...c, a: x, b: y, lead };
  });
}

// ---------- one night ----------
export async function latestDate(seasonId) {
  const rows = await fetchAll(`player_days?select=game_date&season_id=eq.${seasonId}&order=game_date.desc&limit=1`);
  return rows[0]?.game_date ?? null;
}

export async function loadNight(seasonId, date) {
  return fetchAll(`player_days?select=player_key,team_id,name,nba_team,positions,slot,stats&season_id=eq.${seasonId}&game_date=eq.${date}`);
}

// Ranks values 1..n (n = best), sharing points on ties: the usual rotisserie scoring.
function rotoPoints(values, low) {
  const order = values.map((v, i) => ({ v, i })).filter((x) => x.v != null).sort((p, q) => (low ? q.v - p.v : p.v - q.v));
  const pts = values.map(() => 0);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const share = (k + 1 + j + 1) / 2;
    for (let m = k; m <= j; m++) pts[order[m].i] = share;
    k = j + 1;
  }
  return pts;
}

// z-scores summed across the league's categories. The percentages count by volume (made shots above the
// group's average rate), so 1-for-1 doesn't beat 12-for-20. ref is the group the averages come from
// (the lines themselves by default), so a window can be scored on the same scale as the season.
export function playerValues(lines, ref = lines) {
  if (!lines.length || !ref.length) return lines.map(() => 0);
  const all = addUp(ref);
  const fgRate = all["3"] ? all["4"] / all["3"] : 0, ftRate = all["6"] ? all["7"] / all["6"] : 0;
  const cols = CATS.map((c) => {
    const get = c.id === "5" ? (l) => l["4"] - fgRate * l["3"] : c.id === "8" ? (l) => l["7"] - ftRate * l["6"] : (l) => l[c.id];
    const rs = ref.map(get);
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length) || 1;
    return lines.map((l) => (c.low ? mean - get(l) : get(l) - mean) / sd);
  });
  return lines.map((_, i) => cols.reduce((a, col) => a + col[i], 0));
}

// Everything the Last night and Best of sections show for one date.
export function nightSummary(rows, core) {
  const players = rows
    .map((r) => ({ ...r, line: statLine(r.stats), team: core.teamById.get(r.team_id), active: !BENCH.has(r.slot) }))
    .filter((p) => p.team);
  const played = players.filter((p) => p.line);
  const values = playerValues(played.map((p) => p.line));
  played.forEach((p, i) => (p.value = values[i]));

  const teams = core.teams.map((t) => {
    const mine = players.filter((p) => p.team.id === t.id);
    const counted = mine.filter((p) => p.line && p.active);
    return {
      ...t,
      players: mine,
      counted,
      benched: mine.filter((p) => p.line && !p.active),
      sat: mine.filter((p) => !p.line && sat(p.stats)),
      idle: mine.filter((p) => !p.line && !sat(p.stats)),
      totals: counted.length ? addUp(counted.map((p) => p.line)) : null,
    };
  });
  // Owner of the night: rotisserie points across the 11 categories among the teams that played.
  const withGames = teams.filter((t) => t.totals);
  const pts = CATS.map((c) => rotoPoints(withGames.map((t) => t.totals[c.id]), c.low));
  withGames.forEach((t, i) => (t.score = pts.reduce((a, col) => a + col[i], 0)));
  const ranked = [...withGames].sort((a, b) => b.score - a.score);
  ranked.forEach((t) => (t.place = 1 + ranked.filter((x) => x.score > t.score).length));

  const counted = played.filter((p) => p.active);
  const topPlayers = [...counted].sort((a, b) => b.value - a.value).slice(0, 5);
  const leaders = CATS.map((c) => {
    let list = counted;
    let key = (p) => p.line[c.id];
    if (c.id === "5") { list = counted.filter((p) => p.line["3"] >= 8); key = (p) => p.line["4"] / p.line["3"]; }
    if (c.id === "8") { list = counted.filter((p) => p.line["6"] >= 5); key = (p) => p.line["7"] / p.line["6"]; }
    const top = [...list].filter((p) => key(p) > 0).sort((a, b) => key(b) - key(a)).slice(0, 5);
    return { cat: c, top: top.map((p) => ({ p, v: key(p) })) };
  });
  // Points left on the bench: best games by benched players.
  const bench = played.filter((p) => !p.active).sort((a, b) => b.value - a.value).slice(0, 5);
  return { teams, ranked, topPlayers, leaders, bench, games: played.length };
}

// ---------- trends ----------
// Every day a rostered player played, for the whole season so far (days without a game are left out).
export async function loadPlayerGames(seasonId) {
  const rows = await fetchAll(
    `player_days?select=game_date,player_key,team_id,name,nba_team,positions,slot,stats&season_id=eq.${seasonId}&stats->>12=neq.-&order=game_date`
  );
  return rows.map((r) => ({ ...r, line: statLine(r.stats) })).filter((r) => r.line);
}

const perGame = (lines) => {
  if (!lines.length) return null;
  const t = addUp(lines);
  const out = { gp: lines.length };
  for (const c of CATS) out[c.id] = c.pct ? t[c.id] : t[c.id] / lines.length;
  out["3"] = t["3"] / lines.length;
  out["6"] = t["6"] / lines.length;
  return out;
};

const shiftDays = (iso, n) => {
  const t = new Date(iso + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

// Per-player averages over the window (last 7 or 30 days, or the season) next to their season averages.
// value = per-game z-score total (same scoring as Best of), so "change" is one number for overall form.
export function playerTrends(games, core, days) {
  const lastDate = games.length ? games[games.length - 1].game_date : null;
  if (!lastDate) return { rows: [], lastDate };
  const since = days ? shiftDays(lastDate, -(days - 1)) : null;
  const byPlayer = new Map();
  for (const g of games) {
    if (!byPlayer.has(g.player_key)) byPlayer.set(g.player_key, []);
    byPlayer.get(g.player_key).push(g);
  }
  const rows = [];
  for (const [key, list] of byPlayer) {
    const last = list[list.length - 1];
    const season = perGame(list.map((g) => g.line));
    const recent = since ? list.filter((g) => g.game_date >= since) : list;
    const win = perGame(recent.map((g) => g.line));
    rows.push({
      key,
      name: last.name,
      nba: last.nba_team,
      pos: last.positions,
      team: core.teamById.get(last.team_id),
      season,
      win,
      games: list,
    });
  }
  // Value per game from season averages, scored against every rostered player; same for the window.
  const seasonVals = playerValues(rows.map((r) => r.season));
  const withWin = rows.filter((r) => r.win);
  const winVals = playerValues(withWin.map((r) => r.win), rows.map((r) => r.season));
  rows.forEach((r, i) => (r.seasonValue = seasonVals[i]));
  withWin.forEach((r, i) => (r.winValue = winVals[i]));
  return { rows, lastDate, since };
}

// Week-by-week category totals for one fantasy team, from the stored matchups (played weeks and this week).
export function teamWeeks(core, teamId) {
  return core.matchups
    .filter((m) => (m.done || m.started) && (m.a.id === teamId || m.b.id === teamId))
    .map((m) => {
      const mine = m.a.id === teamId;
      return { week: m.week, done: m.done, opp: mine ? m.b : m.a, stats: mine ? m.as : m.bs, oppStats: mine ? m.bs : m.as, cf: mine ? m.ac : m.bc, ca: mine ? m.bc : m.ac };
    })
    .sort((x, y) => x.week - y.week);
}
