// The matchup model, kept apart from the edge function so the back-test (scripts/backtest_matchup_odds.ts)
// runs exactly the same code. No Supabase or Yahoo calls in here.
//
// A week is decided by 11 categories. Each team already has its totals so far (from Yahoo). For every
// remaining day of the week we know which rostered players have an NBA game, and each player's games this
// season. One simulated rest-of-week:
//   1. each player with a game plays or sits, with a chance set by his Yahoo injury status (and a small
//      healthy-scratch rate even when healthy),
//   2. the team starts its best players who play that day, up to the number of starting slots (8),
//   3. each starter's game is one of his real games this season, picked at random, recent games more often
//      (that is how hot and cold streaks count), so his good nights, bad nights and category mix are real,
//   4. those lines are added to the totals so far, and the 11 categories are scored like Yahoo does.
// Repeat a few thousand times; the share of simulated weeks each team wins is its chance.

// Counting stats, in this order everywhere in the model.
export const STAT_IDS = ["3", "4", "6", "7", "10", "12", "15", "16", "17", "18", "19"] as const;
const FGA = 0, FGM = 1, FTA = 2, FTM = 3;
// The 11 categories: [Yahoo stat id, how to read it from a totals array, lower is better].
export const CATEGORIES: { id: string; get: (t: Float64Array | number[]) => number; low?: boolean; pct?: boolean }[] = [
  { id: "4", get: (t) => t[FGM] },
  { id: "5", get: (t) => (t[FGA] ? t[FGM] / t[FGA] : 0), pct: true },
  { id: "7", get: (t) => t[FTM] },
  { id: "8", get: (t) => (t[FTA] ? t[FTM] / t[FTA] : 0), pct: true },
  { id: "10", get: (t) => t[4] },
  { id: "12", get: (t) => t[5] },
  { id: "15", get: (t) => t[6] },
  { id: "16", get: (t) => t[7] },
  { id: "17", get: (t) => t[8] },
  { id: "18", get: (t) => t[9] },
  { id: "19", get: (t) => t[10], low: true },
];

export type Line = number[]; // 11 numbers in STAT_IDS order

export type ModelOptions = {
  sims: number;
  slots: number;         // starting lineup spots per day (PG SG G SF PF F C Util = 8)
  halfLife: number;      // days: a game this many days old counts half as much as last night's
  minGames: number;      // players with fewer games are filled out with replacement-level games
  healthyPlay: number;   // chance a healthy player with a game plays
  teamNoise: number;     // sd (log scale) of a team's whole rest-of-week output: pickups, streaming, minutes
  playerNoise: number;   // sd (log scale) of one player's form for the rest of the week
};
export const DEFAULTS: ModelOptions = { sims: 4000, slots: 8, halfLife: 21, minGames: 5, healthyPlay: 0.95, teamNoise: 0.1, playerNoise: 0 };

// Chance a player with a game actually plays, by Yahoo status, today and on later days of the week.
// (Out today often means back in two or three days; long-term injuries stay out.)
export function playChance(status: string | null | undefined, dayOffset: number, healthy = DEFAULTS.healthyPlay): number {
  switch ((status ?? "").toUpperCase()) {
    // Yahoo uses the NBA's injury report tags: P probable, Q questionable, D doubtful, O out.
    case "": return healthy;
    case "P": return Math.min(healthy, 0.9);
    case "GTD": case "DTD": case "Q": return dayOffset === 0 ? 0.55 : 0.8;
    case "D": return dayOffset === 0 ? 0.2 : 0.55;
    case "O": return dayOffset === 0 ? 0.03 : dayOffset <= 2 ? 0.25 : 0.45;
    case "INJ": case "IL": case "IL+": return 0.03;
    case "SUSP": case "NA": case "NR": return 0;      // suspended, not active (G League, overseas)
    default: return 0.5;
  }
}

export type PlayerIn = {
  key: string;
  status?: string | null;
  games: { line: Line; age: number }[];  // his games this season; age = days before the first simulated day
  hasGame: number[];                     // per remaining day: 1 = his NBA team plays, 0 = no game, 0..1 = unsure
};
export type TeamIn = { id: number; sofar: Line; players: PlayerIn[] };

type Prepared = { pool: Line[]; cum: Float64Array; value: number; gameP: number[]; playP: number[] };

function rng(seed: number) {
  // Small fast deterministic generator (mulberry32), so a run is repeatable.
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One overall per-game value per player (same idea as the site's "value": z-scores summed over the
// 11 categories, percentages weighted by attempts), used only to pick who starts on a crowded day.
function perGameValue(avg: Line, ref: { mean: number[]; sd: number[]; fg: number; ft: number }) {
  const cols = [avg[FGM] - ref.fg * avg[FGA], avg[FTM] - ref.ft * avg[FTA], avg[FGM], avg[FTM], avg[4], avg[5], avg[6], avg[7], avg[8], avg[9], -avg[10]];
  return cols.reduce((s, x, i) => s + (x - ref.mean[i]) / (ref.sd[i] || 1), 0);
}

function prepare(teams: TeamIn[], o: ModelOptions, replacement: Line[]): Map<string, Prepared> {
  const out = new Map<string, Prepared>();
  const avgOf = (p: PlayerIn): Line => {
    const g = p.games.length ? p.games.map((x) => x.line) : replacement;
    return STAT_IDS.map((_, i) => g.reduce((s, l) => s + l[i], 0) / Math.max(1, g.length));
  };
  const all = teams.flatMap((t) => t.players);
  const avgs = all.map(avgOf);
  const fg = avgs.reduce((s, a) => s + a[FGM], 0) / Math.max(1, avgs.reduce((s, a) => s + a[FGA], 0));
  const ft = avgs.reduce((s, a) => s + a[FTM], 0) / Math.max(1, avgs.reduce((s, a) => s + a[FTA], 0));
  const colsOf = (a: Line) => [a[FGM] - fg * a[FGA], a[FTM] - ft * a[FTA], a[FGM], a[FTM], a[4], a[5], a[6], a[7], a[8], a[9], -a[10]];
  const cols = avgs.map(colsOf);
  const mean = cols[0]?.map((_, i) => cols.reduce((s, c) => s + c[i], 0) / cols.length) ?? [];
  const sd = mean.map((m, i) => Math.sqrt(cols.reduce((s, c) => s + (c[i] - m) ** 2, 0) / cols.length));
  const ref = { mean, sd, fg, ft };

  all.forEach((p, k) => {
    // Weighted pool of games to draw from: his own (recent ones weigh more), topped up with
    // replacement-level games when he has played only a few (a new pickup, a player back from injury).
    const pool: Line[] = [], w: number[] = [];
    for (const g of p.games) { pool.push(g.line); w.push(Math.pow(0.5, g.age / o.halfLife)); }
    const own = w.reduce((a, b) => a + b, 0);
    const missing = Math.max(0, o.minGames - p.games.length);
    if (missing > 0 && replacement.length) {
      const each = (missing * (p.games.length ? own / p.games.length : 1)) / replacement.length;
      for (const l of replacement) { pool.push(l); w.push(each); }
    }
    const cum = new Float64Array(w.length);
    w.reduce((s, x, i) => (cum[i] = s + x), 0);
    out.set(p.key, {
      pool, cum,
      value: perGameValue(avgs[k], ref),
      gameP: p.hasGame,
      playP: p.hasGame.map((_, d) => playChance(p.status, d, o.healthyPlay)),
    });
  });
  return out;
}

function pick(prep: Prepared, r: number): Line {
  const x = r * prep.cum[prep.cum.length - 1];
  let lo = 0, hi = prep.cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (prep.cum[m] < x) lo = m + 1; else hi = m; }
  return prep.pool[lo];
}

// Yahoo shows FG% and FT% to three places and compares those; counting stats compare exactly.
const score = (c: (typeof CATEGORIES)[number], t: Float64Array) => (c.pct ? Math.round(c.get(t) * 1000) : c.get(t));

export type MatchupOut = {
  win: number; loss: number; tie: number;                  // for team A, 0..1
  catWin: number[]; catTie: number[];                      // per category, for team A
  projA: number[]; projB: number[];                        // average final value per category
  startsA: number; startsB: number;                        // expected starter games left
};

export function simulateMatchup(A: TeamIn, B: TeamIn, days: number, opts: Partial<ModelOptions> = {}, replacement: Line[] = [], seed = 1): MatchupOut {
  const o = { ...DEFAULTS, ...opts };
  const prep = prepare([A, B], o, replacement);
  const rand = rng(seed);
  const nc = CATEGORIES.length;
  const catWin = new Float64Array(nc), catTie = new Float64Array(nc);
  const projA = new Float64Array(nc), projB = new Float64Array(nc);
  let win = 0, loss = 0, tie = 0, startsA = 0, startsB = 0;
  const tA = new Float64Array(11), tB = new Float64Array(11);
  const order = (t: TeamIn) => [...t.players].sort((x, y) => prep.get(y.key)!.value - prep.get(x.key)!.value).map((p) => prep.get(p.key)!);
  const oA = order(A), oB = order(B);

  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
  const add = new Float64Array(11);
  const playWeek = (ord: Prepared[], tot: Float64Array) => {
    let starts = 0;
    add.fill(0);
    const form = ord.map(() => (o.playerNoise ? Math.exp(o.playerNoise * gauss()) : 1));
    for (let d = 0; d < days; d++) {
      let used = 0;
      for (let q = 0; q < ord.length; q++) { // best first, so the lineup is the best players who play that day
        const p = ord[q];
        if (used >= o.slots) break;
        if (!p.pool.length) continue;     // no games to go on at all (first night of the season)
        if (!(rand() < (p.gameP[d] ?? 0))) continue;
        if (!(rand() < p.playP[d])) continue;
        const l = pick(p, rand());
        for (let i = 0; i < 11; i++) add[i] += l[i] * form[q];
        used++;
      }
      starts += used;
    }
    // Volume swings scale makes and attempts together, so they move the counting stats, not the percentages.
    const f = o.teamNoise ? Math.exp(o.teamNoise * gauss()) : 1;
    for (let i = 0; i < 11; i++) tot[i] += Math.round(add[i] * f);
    return starts;
  };

  for (let s = 0; s < o.sims; s++) {
    for (let i = 0; i < 11; i++) { tA[i] = A.sofar[i] ?? 0; tB[i] = B.sofar[i] ?? 0; }
    startsA += playWeek(oA, tA);
    startsB += playWeek(oB, tB);
    let a = 0, b = 0;
    CATEGORIES.forEach((c, k) => {
      const x = score(c, tA), y = score(c, tB);
      projA[k] += c.get(tA); projB[k] += c.get(tB);
      if (x === y) catTie[k]++;
      else if ((x > y) !== !!c.low) { a++; catWin[k]++; }
      else b++;
    });
    if (a > b) win++; else if (b > a) loss++; else tie++;
  }
  const n = o.sims;
  return {
    win: win / n, loss: loss / n, tie: tie / n,
    catWin: [...catWin].map((x) => x / n), catTie: [...catTie].map((x) => x / n),
    projA: [...projA].map((x) => x / n), projB: [...projB].map((x) => x / n),
    startsA: startsA / n, startsB: startsB / n,
  };
}

// Replacement level: the games of rostered players in the bottom quarter by points per game.
export function replacementGames(byPlayer: Map<string, Line[]>): Line[] {
  // Early in the season few players have 3 games yet; then take everyone who has played.
  const enough = [...byPlayer.values()].filter((g) => g.length >= 3).length >= 40 ? 3 : 1;
  const list = [...byPlayer.values()].filter((g) => g.length >= enough)
    .map((g) => ({ g, pts: g.reduce((s, l) => s + l[5], 0) / g.length }))
    .sort((x, y) => x.pts - y.pts);
  return list.slice(0, Math.max(1, Math.floor(list.length / 4))).flatMap((x) => x.g);
}
