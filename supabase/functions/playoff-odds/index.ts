import { createClient } from "npm:@supabase/supabase-js@2";

// Playoff odds for the current season, by simulation (Monte Carlo).
//   POST /playoff-odds                       -> current season, through the last completed week
//   POST /playoff-odds?season=2026&through=3 -> any season, as if only weeks 1-3 had been played
// Run every Monday by pg_cron (supabase/playoff_odds.sql), an hour after the nightly Yahoo sync has
// pulled the week that just ended. Writes one row per team into playoff_odds; older weeks are kept so
// the site can show how each team's odds moved. Guarded by the same x-sync-key as yahoo-sync.
//
// The model (tested on every finished season 2005-06 to 2025-26, see docs/PLAYOFF_ODDS.md for the back-test):
//  - Standings are category records (W-L-T over every category of every week), ranked by win %
//    with ties as half a win. The top num_playoff_teams make the playoffs (6 in this league).
//  - Each team's strength is its category win rate so far, pulled toward .500 by PRIOR categories
//    of average play (about 9 weeks' worth), so two lucky weeks don't make a contender.
//  - Each simulated season: draw each team's true strength from that estimate's uncertainty, give every
//    team a random good or bad week (injuries, games played, streaks: WEEK_NOISE), then play every
//    remaining category: a tie at the league's tie rate, otherwise a win with the log5 chance
//    from the two strengths. Rank the final standings and count where each team lands.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const SIMS = 10000;     // about half a second; Supabase allows 2 s of CPU per call
const PRIOR = 100;       // categories of .500 play added to each team's record (both sides)
const WEEK_NOISE = 0.7;  // sd of a team's week-to-week swing, on the log-odds scale

const reply = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 1), { status: s, headers: { "Content-Type": "application/json" } });

const logit = (p: number) => Math.log(p / (1 - p));
const inv = (x: number) => 1 / (1 + Math.exp(-x));
function randn() {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

type Game = { week: number; a: number; b: number; ca: number; cb: number };

export function simulate(teamIds: number[], played: Game[], future: Game[], ncats: number, spots: number, sims = SIMS) {
  const n = teamIds.length;
  const idx = new Map(teamIds.map((id, i) => [id, i]));
  const W = new Float64Array(n), L = new Float64Array(n), T = new Float64Array(n);
  for (const g of played) {
    const i = idx.get(g.a)!, j = idx.get(g.b)!, t = Math.max(0, ncats - g.ca - g.cb);
    W[i] += g.ca; L[i] += g.cb; W[j] += g.cb; L[j] += g.ca; T[i] += t; T[j] += t;
  }
  const catsPlayed = played.length * ncats;
  const tieRate = catsPlayed ? Math.max(0.01, played.reduce((s, g) => s + Math.max(0, ncats - g.ca - g.cb), 0) / catsPlayed) : 0.06;

  // Strength on the log-odds scale, with its uncertainty (beta posterior, delta method).
  const mu: number[] = [], sd: number[] = [];
  for (let i = 0; i < n; i++) {
    const al = PRIOR + W[i] + T[i] / 2, be = PRIOR + L[i] + T[i] / 2, m = al / (al + be);
    mu.push(logit(m));
    sd.push(Math.sqrt((al * be) / ((al + be) ** 2 * (al + be + 1))) / (m * (1 - m)));
  }

  const seedCount = Array.from({ length: n }, () => new Float64Array(n));
  const projW = new Float64Array(n), projL = new Float64Array(n), projT = new Float64Array(n);
  const weeks = [...new Set(future.map((g) => g.week))];
  const games = future.map((g) => ({ ...g, i: idx.get(g.a)!, j: idx.get(g.b)!, k: weeks.indexOf(g.week) }));
  const noise = new Float64Array(weeks.length * n);
  const w = new Float64Array(n), l = new Float64Array(n), t = new Float64Array(n), pct = new Float64Array(n);
  const order = teamIds.map((_, i) => i);

  for (let s = 0; s < sims; s++) {
    const str = mu.map((m, i) => m + sd[i] * randn());
    for (let x = 0; x < noise.length; x++) noise[x] = WEEK_NOISE * randn();
    w.set(W); l.set(L); t.set(T);
    for (const g of games) {
      const q = inv(str[g.i] + noise[g.k * n + g.i] - str[g.j] - noise[g.k * n + g.j]);
      for (let c = 0; c < ncats; c++) {
        if (Math.random() < tieRate) { t[g.i]++; t[g.j]++; }
        else if (Math.random() < q) { w[g.i]++; l[g.j]++; }
        else { w[g.j]++; l[g.i]++; }
      }
    }
    // Exact ties in the standings are broken at random (Yahoo's own tiebreak can't be known ahead).
    for (let i = 0; i < n; i++) pct[i] = (w[i] + t[i] / 2) / Math.max(1, w[i] + l[i] + t[i]) + Math.random() * 1e-9;
    order.sort((x, y) => pct[y] - pct[x]);
    for (let r = 0; r < n; r++) seedCount[order[r]][r]++;
    for (let i = 0; i < n; i++) { projW[i] += w[i]; projL[i] += l[i]; projT[i] += t[i]; }
  }

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return teamIds.map((id, i) => {
    const seedPct = Array.from(seedCount[i], (c) => r1((100 * c) / sims));
    return {
      team_id: id,
      cat_w: W[i], cat_l: L[i], cat_t: T[i],
      strength: Math.round(1000 * inv(mu[i])) / 1000,
      proj_w: r1(projW[i] / sims), proj_l: r1(projL[i] / sims), proj_t: r1(projT[i] / sims),
      playoff_pct: r1((100 * seedCount[i].slice(0, spots).reduce((a, b) => a + b, 0)) / sims),
      top_seed_pct: seedPct[0],
      avg_seed: Math.round((100 * seedCount[i].reduce((a, c, r) => a + c * (r + 1), 0)) / sims) / 100,
      seed_pct: seedPct,
    };
  });
}

Deno.serve(async (req) => {
  const { data: cfg } = await db.from("sync_config").select("value").eq("key", "sync_key").maybeSingle();
  if (!cfg || req.headers.get("x-sync-key") !== cfg.value) return reply({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  try {
    const q = db.from("seasons").select("id, start_year, playoff_start_week, num_playoff_teams");
    const { data: season } = url.searchParams.get("season")
      ? await q.eq("start_year", parseInt(url.searchParams.get("season")!)).maybeSingle()
      : await q.eq("is_current", true).maybeSingle();
    if (!season) return reply({ error: "season not found" }, 404);

    const { data: teams } = await db.from("teams").select("id").eq("season_id", season.id).order("id");
    const { data: rows } = await db.from("matchups")
      .select("week, team1_id, team2_id, team1_cats_won, team2_cats_won, is_complete, is_playoff")
      .eq("season_id", season.id).eq("is_playoff", false).order("week");
    const reg = (rows ?? []).filter((m: any) => !season.playoff_start_week || m.week < season.playoff_start_week);
    const lastDone = Math.max(0, ...reg.filter((m: any) => m.is_complete).map((m: any) => m.week));
    const through = url.searchParams.get("through") ? parseInt(url.searchParams.get("through")!) : lastDone;

    const toGame = (m: any): Game => ({ week: m.week, a: m.team1_id, b: m.team2_id, ca: Number(m.team1_cats_won ?? 0), cb: Number(m.team2_cats_won ?? 0) });
    const played = reg.filter((m: any) => m.is_complete && m.week <= through).map(toGame);
    const future = reg.filter((m: any) => !(m.is_complete && m.week <= through)).map(toGame);
    if (!future.length) return reply({ ok: true, skipped: "no regular-season games left to play", through });
    if (!played.length && !url.searchParams.get("through")) {
      // Nothing played yet: every team is a coin flip, so there is nothing worth publishing.
      return reply({ ok: true, skipped: "no completed weeks yet" });
    }
    // 11 categories since 2010-11; older seasons had fewer, so take the most any week added up to.
    const ncats = season.start_year >= 2010 || !played.length ? 11 : Math.max(...played.map((g) => g.ca + g.cb));
    const spots = season.num_playoff_teams ?? 6;

    const out = simulate((teams ?? []).map((t: any) => t.id), played, future, ncats, spots).map((r) => ({
      season_id: season.id, through_week: through, sims: SIMS, computed_at: new Date().toISOString(), ...r,
    }));
    const { error } = await db.from("playoff_odds").upsert(out, { onConflict: "season_id,through_week,team_id" });
    if (error) throw new Error(`playoff_odds upsert: ${error.message}`);
    return reply({ ok: true, season: season.start_year, through, games_left: future.length, teams: out.length });
  } catch (e) {
    return reply({ ok: false, error: (e as Error).message }, 500);
  }
});
