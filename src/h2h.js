import MATCHUP_ROWS from "./matchups.json";
import { SEASON_LIST, slug, winPct } from "./lib.js";

// Head-to-head history, built from weekly matchups.
// src/matchups.json is written by scripts/export_matchups.mjs from the Supabase `matchups` table
// (complete, non-consolation games only). Row shape:
//   { start, week, playoff, a, aTeam, b, bTeam, ac, bc, as, bs }
//   start = season start year, a/b = owner display names, ac/bc = categories won, as/bs = stats by Yahoo stat_id.
// Until the Yahoo sync runs it is empty. A build with SAMPLE_H2H=1 fills it with made-up games
// so the pages can be previewed; that build shows a banner saying so.

// Yahoo NBA stat ids for the league's 11 scoring categories (checked against every week's
// categories-won since 2010-11). Seasons before that have no FG% stat in Yahoo's data, so it is
// skipped there. Turnovers: fewer wins the category.
export const CATEGORIES = [
  ["4", "FGM"], ["5", "FG%"], ["7", "FTM"], ["8", "FT%"], ["10", "3PTM"], ["12", "PTS"],
  ["15", "REB"], ["16", "AST"], ["17", "ST"], ["18", "BLK"], ["19", "TO"],
];
const LOWER_WINS = new Set(["19"]);

/* global __SAMPLE_H2H__ */
export const IS_SAMPLE = typeof __SAMPLE_H2H__ !== "undefined" && __SAMPLE_H2H__ && MATCHUP_ROWS.length === 0;
export const MATCHUPS = IS_SAMPLE ? sampleMatchups() : MATCHUP_ROWS;
export const HAS_DATA = MATCHUPS.length > 0;

// ---------- sides: every matchup seen from both owners ----------
const resultOf = (f, a) => (f > a ? "W" : f < a ? "L" : "T");
const ALL_SIDES = MATCHUPS.flatMap((m) => [
  { owner: m.a, opp: m.b, team: m.aTeam, oppTeam: m.bTeam, start: m.start, week: m.week, playoff: !!m.playoff, cf: m.ac, ca: m.bc, stats: m.as, oppStats: m.bs, res: resultOf(m.ac, m.bc) },
  { owner: m.b, opp: m.a, team: m.bTeam, oppTeam: m.aTeam, start: m.start, week: m.week, playoff: !!m.playoff, cf: m.bc, ca: m.ac, stats: m.bs, oppStats: m.as, res: resultOf(m.bc, m.ac) },
]).sort((x, y) => x.start - y.start || x.week - y.week);

const labelOf = new Map(SEASON_LIST.map((s) => [s.start, s.label]));
export const seasonLabel = (start) => labelOf.get(start) ?? `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
export const H2H_SEASONS = [...new Set(ALL_SIDES.map((s) => s.start))].sort((a, b) => a - b);
export const H2H_OWNERS = [...new Set(ALL_SIDES.map((s) => s.owner))].sort((a, b) => a.localeCompare(b));
export const ownerBySlug = (sl) => H2H_OWNERS.find((n) => slug(n) === sl);

// filter = { phase: "all" | "reg" | "playoff", from, to }  (from/to are season start years, inclusive)
export function filterSides(filter) {
  const { phase = "all", from = -Infinity, to = Infinity } = filter || {};
  return ALL_SIDES.filter(
    (s) => s.start >= from && s.start <= to && (phase === "all" || (phase === "playoff") === s.playoff)
  );
}

// ---------- tallies ----------
function tally(rows, countTies) {
  const w = count(rows, "W"), l = count(rows, "L"), t = count(rows, "T");
  const cf = rows.reduce((a, r) => a + r.cf, 0), ca = rows.reduce((a, r) => a + r.ca, 0);
  return { games: rows.length, w, l, t, cf, ca, pct: winPct(w, l, t, countTies) };
}
const count = (rows, res) => rows.filter((r) => r.res === res).length;

// Rivalry grid: grid.get(owner).get(opp) = tally
export function rivalryGrid(sides, countTies) {
  const groups = new Map();
  for (const s of sides) {
    if (!groups.has(s.owner)) groups.set(s.owner, new Map());
    const row = groups.get(s.owner);
    if (!row.has(s.opp)) row.set(s.opp, []);
    row.get(s.opp).push(s);
  }
  const grid = new Map();
  for (const [o, row] of groups) grid.set(o, new Map([...row].map(([p, rows]) => [p, tally(rows, countTies)])));
  return grid;
}

// One owner against everyone they have played.
export function opponentsOf(owner, sides, countTies) {
  const mine = sides.filter((s) => s.owner === owner);
  const opps = [...new Set(mine.map((s) => s.opp))];
  return opps.map((opp) => {
    const rows = mine.filter((s) => s.opp === opp);
    return {
      opp,
      ...tally(rows, countTies),
      reg: tally(rows.filter((r) => !r.playoff), countTies),
      post: tally(rows.filter((r) => r.playoff), countTies),
      streak: currentStreak(rows),
      last: rows[rows.length - 1],
    };
  });
}

// Nemesis = worst win % against, favorite = best, among opponents with enough meetings.
export function nemesisAndFavorite(opps, minGames) {
  const ok = opps.filter((o) => o.games >= minGames && Number.isFinite(o.pct));
  if (!ok.length) return { nemesis: null, favorite: null };
  const by = [...ok].sort((a, b) => a.pct - b.pct || b.games - a.games);
  const nemesis = by[0], favorite = by[by.length - 1];
  return { nemesis, favorite: favorite === nemesis ? null : favorite };
}

// ---------- streaks ----------
// Current run of identical results (W or L; a tie ends it), newest game last.
export function currentStreak(rows) {
  let n = 0, res = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i].res;
    if (r === "T") break;
    if (res === null) res = r;
    if (r !== res) break;
    n++;
  }
  return res ? { res, n } : null;
}

// Longest win run for the side's owner. Returns { n, from, to } (from/to are sides).
export function longestWinStreak(rows) {
  let best = null, run = null;
  for (const r of rows) {
    if (r.res === "W") {
      run = run ? { ...run, n: run.n + 1, to: r } : { n: 1, from: r, to: r };
      if (!best || run.n > best.n) best = run;
    } else run = null;
  }
  return best;
}

// ---------- one rivalry in full ----------
export function rivalry(owner, opp, sides, countTies) {
  const rows = sides.filter((s) => s.owner === owner && s.opp === opp);
  const theirs = rows.map(flip);
  const seasons = [...new Set(rows.map((r) => r.start))].map((start) => {
    const g = rows.filter((r) => r.start === start);
    return { start, season: seasonLabel(start), ...tally(g, countTies), playoffGames: g.filter((r) => r.playoff).length, games: g };
  });
  const margin = (r) => r.cf - r.ca;
  const wins = rows.filter((r) => r.res === "W").sort((a, b) => margin(b) - margin(a));
  const losses = rows.filter((r) => r.res === "L").sort((a, b) => margin(a) - margin(b));
  return {
    rows,
    all: tally(rows, countTies),
    reg: tally(rows.filter((r) => !r.playoff), countTies),
    post: tally(rows.filter((r) => r.playoff), countTies),
    seasons,
    streak: currentStreak(rows),
    bestRun: longestWinStreak(rows),
    oppBestRun: longestWinStreak(theirs),
    bigWin: wins[0] || null,
    bigLoss: losses[0] || null,
    last10: rows.slice(-10).reverse(),
    playoffGames: rows.filter((r) => r.playoff).reverse(),
    categories: categoryRecord(rows),
  };
}
const flip = (r) => ({ ...r, owner: r.opp, opp: r.owner, team: r.oppTeam, oppTeam: r.team, cf: r.ca, ca: r.cf, stats: r.oppStats, oppStats: r.stats, res: r.res === "W" ? "L" : r.res === "L" ? "W" : "T" });

// Category by category: who won FG%, PTS, TO and the rest across all their meetings.
export function categoryRecord(rows) {
  const out = CATEGORIES.map(([id, label]) => ({ id, label, w: 0, l: 0, t: 0 }));
  let any = false;
  for (const r of rows) {
    if (!r.stats || !r.oppStats) continue;
    for (const c of out) {
      const x = parseFloat(r.stats[c.id]), y = parseFloat(r.oppStats[c.id]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      any = true;
      if (x === y) c.t++;
      else if ((x > y) !== LOWER_WINS.has(c.id)) c.w++;
      else c.l++;
    }
  }
  return any ? out : [];
}

// ---------- league-wide lists ----------
export function biggestBlowouts(sides, n = 10) {
  return sides.filter((s) => s.res === "W").sort((a, b) => b.cf - b.ca - (a.cf - a.ca) || b.start - a.start).slice(0, n);
}

// Longest win runs in any one rivalry.
export function longestRivalryStreaks(sides, n = 10) {
  const pairs = new Map();
  for (const s of sides) {
    const k = s.owner + "|" + s.opp;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(s);
  }
  const out = [];
  for (const rows of pairs.values()) {
    const best = longestWinStreak(rows);
    if (best && best.n >= 3) out.push({ owner: rows[0].owner, opp: rows[0].opp, ...best, active: rows[rows.length - 1] === best.to });
  }
  return out.sort((a, b) => b.n - a.n || b.to.start - a.to.start).slice(0, n);
}

// Most-played and most one-sided rivalries (each pair once, from the leader's side).
export function rivalryLists(grid, minGames) {
  const seen = new Set(), list = [];
  for (const [o, row] of grid) {
    for (const [p, t] of row) {
      const k = [o, p].sort().join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      const leader = t.w >= t.l ? { owner: o, opp: p, ...t } : { owner: p, opp: o, ...grid.get(p).get(o) };
      list.push(leader);
    }
  }
  const mostPlayed = [...list].sort((a, b) => b.games - a.games || a.owner.localeCompare(b.owner)).slice(0, 8);
  const lopsided = list
    .filter((r) => r.games >= minGames && Number.isFinite(r.pct))
    .sort((a, b) => b.pct - a.pct || b.games - a.games)
    .slice(0, 8);
  return { mostPlayed, lopsided };
}

// ---------- sample data (preview builds only) ----------
// Round-robin schedule using each owner's real record that season to weight the coin flips,
// so strong teams usually win. Every number it produces is invented.
function sampleMatchups() {
  let seed = 20041;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (const s of SEASON_LIST) {
    if (s.start === 2004) continue; // 2004-05 is sheet-only; no weekly games exist
    const teams = [...s.teams];
    const strength = new Map(teams.map((t) => [t.owner, winPct(t.w, t.l, t.t, false) / 100]));
    const play = (x, y, week, playoff) => {
      const p = Math.min(0.85, Math.max(0.15, 0.5 + (strength.get(x.owner) - strength.get(y.owner)) * 1.6));
      const as = {}, bs = {};
      let ac = 0, bc = 0;
      for (const [id] of CATEGORIES) {
        const r = rand();
        const base = id === "5" ? 0.47 : id === "8" ? 0.78 : { "4": 205, "7": 95, "10": 55, "12": 560, "15": 230, "16": 130, "17": 40, "18": 28, "19": 70 }[id];
        const spread = base * 0.08;
        let av = base + (rand() - 0.5) * spread, bv = av;
        if (r < 0.06) { /* tie */ } else if (r < 0.06 + p * 0.94) { av += spread * 0.5; ac++; } else { bv += spread * 0.5; bc++; }
        if (LOWER_WINS.has(id)) [av, bv] = [bv, av];
        const fmt = (v) => (id === "5" || id === "8" ? v.toFixed(3) : String(Math.round(v)));
        as[id] = fmt(av); bs[id] = fmt(bv);
      }
      // rounding can collapse a near-tie; recount from the stored values
      ac = 0; bc = 0;
      for (const [id] of CATEGORIES) {
        const x = parseFloat(as[id]), y = parseFloat(bs[id]);
        if (x !== y) ((x > y) !== LOWER_WINS.has(id) ? ac++ : bc++);
      }
      out.push({ start: s.start, week, playoff, a: x.owner, aTeam: x.team, b: y.owner, bTeam: y.team, ac, bc, as, bs });
      return ac > bc ? x : bc > ac ? y : (strength.get(x.owner) >= strength.get(y.owner) ? x : y);
    };
    // circle-method round robin, 19 regular-season weeks
    const ring = teams.slice(1);
    for (let week = 1; week <= 19; week++) {
      const order = [teams[0], ...ring];
      for (let i = 0; i < order.length / 2; i++) play(order[i], order[order.length - 1 - i], week, false);
      ring.unshift(ring.pop());
    }
    // four-team playoff for the best records
    const top = [...teams].sort((a, b) => strength.get(b.owner) - strength.get(a.owner)).slice(0, 4);
    const f1 = play(top[0], top[3], 20, true), f2 = play(top[1], top[2], 20, true);
    play(f1, f2, 21, true);
  }
  return out;
}
