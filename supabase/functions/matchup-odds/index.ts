import { createClient } from "npm:@supabase/supabase-js@2";
import { CATEGORIES, STAT_IDS, replacementGames, simulateMatchup, type Line, type TeamIn } from "./model.ts";

// Each team's chance to win this week's matchup, recomputed every morning.
//   POST /matchup-odds                          -> current season, this week, as of today (US Eastern)
//   POST /matchup-odds?date=2026-11-12          -> as of the morning of that date (for re-runs)
// Run every day by pg_cron (supabase/matchup_odds.sql) at 09:30 UTC, half an hour after the nightly Yahoo
// sync has pulled last night's stats, today's rosters and injury statuses. Writes one row per team into
// matchup_odds for (season, week, as_of); earlier mornings are kept so the page can show how odds moved.
// Guarded by the same x-sync-key as yahoo-sync. The model itself is in model.ts (back-test:
// scripts/backtest_matchup_odds.ts, results in docs/MATCHUP_ODDS.md).
//
// Inputs:
//  - totals so far: matchups.team1_stats / team2_stats (Yahoo's week totals through last night)
//  - rosters and injury status: roster_now (yahoo-sync part "rosters"); falls back to the latest player_days
//  - every game each player has played this season: player_days
//  - which NBA teams play on each remaining day: ESPN's public scoreboard (Yahoo's API has no NBA schedule)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SIMS = 10000;

const reply = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 1), { status: s, headers: { "Content-Type": "application/json" } });

const easternDate = (t: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(t);
const addDays = (iso: string, n: number) => {
  const t = new Date(iso + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 864e5);

// A Yahoo day line -> the model's 11 counting stats, or null when he didn't play ("-" = no game, all zeros = sat).
function toLine(stats: Record<string, string> | null): Line | null {
  if (!stats || stats["12"] == null || stats["12"] === "-") return null;
  const l = STAT_IDS.map((id) => Number(stats[id]) || 0);
  return l.some((x) => x !== 0) ? l : null;
}
const satOut = (stats: Record<string, string> | null) => !!stats && stats["12"] != null && stats["12"] !== "-" && !toLine(stats);

// ESPN abbreviations that differ from Yahoo's.
const ESPN_TO_YAHOO: Record<string, string> = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BRK: "BKN" };

// date -> set of NBA teams playing that day (US Eastern dates), or null if the schedule couldn't be read.
// One request per day (ESPN files games under their US Eastern date). scheduleError says why it failed.
let scheduleError = "";
async function nbaSchedule(dates: string[]): Promise<Map<string, Set<string>> | null> {
  const out = new Map<string, Set<string>>();
  try {
    const pages = await Promise.all(dates.map(async (day) => {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day.replaceAll("-", "")}`, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (league stats site)" },
      });
      if (!res.ok) throw new Error(`ESPN ${res.status} for ${day}`);
      return { day, d: await res.json() };
    }));
    for (const { day, d } of pages) {
      out.set(day, new Set());
      for (const e of d.events ?? []) {
        if (e.season?.type === 1) continue; // preseason
        for (const c of e.competitions?.[0]?.competitors ?? []) {
          const ab = c.team?.abbreviation;
          if (ab) out.get(day)!.add(ESPN_TO_YAHOO[ab] ?? ab);
        }
      }
    }
    return out;
  } catch (e) {
    scheduleError = (e as Error).message;
    return null;
  }
}

// All rows of a query, 1000 at a time (PostgREST caps each response).
async function all(q: () => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

Deno.serve(async (req) => {
  const { data: cfg } = await db.from("sync_config").select("value").eq("key", "sync_key").maybeSingle();
  if (!cfg || req.headers.get("x-sync-key") !== cfg.value) return reply({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  try {
    const { data: season } = await db.from("seasons").select("id, start_year").eq("is_current", true).maybeSingle();
    if (!season) return reply({ error: "no current season" }, 404);
    const today = url.searchParams.get("date") ?? easternDate(new Date());

    // This week: the earliest week not yet final.
    let { data: games, error: gErr } = await db.from("matchups")
      .select("week, team1_id, team2_id, team1_stats, team2_stats, is_complete, week_start, week_end")
      .eq("season_id", season.id).eq("is_complete", false).order("week");
    if (gErr) {
      // week_start/week_end not added yet (supabase/matchup_odds.sql): Yahoo weeks run Monday to Sunday.
      ({ data: games } = await db.from("matchups")
        .select("week, team1_id, team2_id, team1_stats, team2_stats, is_complete")
        .eq("season_id", season.id).eq("is_complete", false).order("week"));
    }
    if (!games?.length) return reply({ ok: true, skipped: "no week in progress" });
    const week = games[0].week;
    const these = games.filter((g: any) => g.week === week);
    const monday = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
    const weekStart = these[0].week_start ?? monday;
    const weekEnd = these[0].week_end ?? addDays(monday, 6);
    const first = today < weekStart ? weekStart : today;
    const days = Math.max(0, daysBetween(weekEnd, first) + 1);
    const dates = Array.from({ length: days }, (_, i) => addDays(first, i));

    // Rosters (today's, with injury status) or, failing that, the latest night in player_days.
    let roster: any[] = [];
    const { data: rn, error: rErr } = await db.from("roster_now")
      .select("player_key, team_id, name, nba_team, positions, slot, status, injury_note, updated_at").eq("season_id", season.id);
    if (!rErr && rn?.length) roster = rn;
    if (!roster.length) {
      const { data: last } = await db.from("player_days").select("game_date").eq("season_id", season.id).order("game_date", { ascending: false }).limit(1);
      if (last?.length) {
        const { data } = await db.from("player_days").select("player_key, team_id, name, nba_team, positions, slot")
          .eq("season_id", season.id).eq("game_date", last[0].game_date);
        roster = (data ?? []).map((r: any) => ({ ...r, status: null }));
      }
    }

    // Every game a rostered player has had this season (before today), and whether he sat his team's last two.
    const logs = await all(() => db.from("player_days").select("game_date, player_key, stats")
      .eq("season_id", season.id).lt("game_date", first).not("stats", "cs", '{"12":"-"}').order("game_date"));
    const byPlayer = new Map<string, { date: string; line: Line | null; sat: boolean }[]>();
    for (const r of logs) {
      if (!byPlayer.has(r.player_key)) byPlayer.set(r.player_key, []);
      byPlayer.get(r.player_key)!.push({ date: r.game_date, line: toLine(r.stats), sat: satOut(r.stats) });
    }
    const lines = new Map([...byPlayer].map(([k, g]) => [k, g.filter((x) => x.line).map((x) => x.line!)]));
    const replacement = replacementGames(lines);

    const schedule = days ? await nbaSchedule(dates) : new Map();

    const teamIn = (id: number, stats: Record<string, string> | null): TeamIn & { info: any[] } => {
      const players = roster.filter((p) => p.team_id === id).map((p) => {
        const g = byPlayer.get(p.player_key) ?? [];
        // Healthy by Yahoo but sat his team's last two games: treat as day-to-day.
        const sat2 = g.length >= 2 && g.slice(-2).every((x) => x.sat);
        const status = p.status || (sat2 ? "DTD" : "");
        const hasGame: number[] = dates.map((d) => (schedule ? (schedule.get(d)?.has(p.nba_team) ? 1 : 0) : 0.5));
        return {
          key: p.player_key, status, hasGame,
          games: g.filter((x) => x.line).map((x) => ({ line: x.line!, age: daysBetween(first, x.date) })),
          meta: { name: p.name, nba: p.nba_team, pos: p.positions, slot: p.slot, status: p.status || null, guess: !p.status && sat2, note: p.injury_note ?? null, games_left: hasGame.reduce((a, b) => a + b, 0), gp: g.filter((x) => x.line).length },
        };
      });
      return {
        id,
        sofar: STAT_IDS.map((sid) => Number(stats?.[sid]) || 0),
        players,
        info: players.map((p) => p.meta),
      };
    };

    const computed = new Date().toISOString();
    const out: any[] = [];
    these.forEach((m: any, i: number) => {
      const A = teamIn(m.team1_id, m.team1_stats), B = teamIn(m.team2_id, m.team2_stats);
      const r = simulateMatchup(A, B, days, { sims: SIMS }, replacement, Date.parse(first) / 864e5 + i);
      const r1 = (x: number) => Math.round(1000 * x) / 10;
      const side = (me: any, opp: any, mine: boolean) => ({
        season_id: season.id, week, as_of: first, team_id: me.id, opp_id: opp.id,
        win_pct: r1(mine ? r.win : r.loss), tie_pct: r1(r.tie),
        cat_win: Object.fromEntries(CATEGORIES.map((c, k) => [c.id, r1(mine ? r.catWin[k] : 1 - r.catWin[k] - r.catTie[k])])),
        proj: Object.fromEntries(CATEGORIES.map((c, k) => [c.id, Math.round(1000 * (mine ? r.projA[k] : r.projB[k])) / 1000])),
        starts_left: Math.round(10 * (mine ? r.startsA : r.startsB)) / 10,
        days_left: days,
        players: me.info,
        sims: SIMS, computed_at: computed,
      });
      out.push(side(A, B, true), side(B, A, false));
    });
    const { error } = await db.from("matchup_odds").upsert(out, { onConflict: "season_id,week,as_of,team_id" });
    if (error) throw new Error(`matchup_odds upsert: ${error.message}`);
    return reply({
      ok: true, week, as_of: first, days_left: days, schedule: schedule ? "espn" : `unknown, assumed half the days (${scheduleError})`,
      rosters: roster.length, odds: out.map((o) => ({ team: o.team_id, win: o.win_pct, tie: o.tie_pct })),
    });
  } catch (e) {
    return reply({ ok: false, error: (e as Error).message }, 500);
  }
});
