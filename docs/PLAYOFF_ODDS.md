# Playoff odds

The `#odds` page shows each team's chance of making the playoffs in the season in progress.

## How it runs
- `supabase/functions/playoff-odds` (edge function) simulates the rest of the regular season 10,000 times and
  upserts one row per team into `playoff_odds`, keyed by season and `through_week`. Every week's run is kept,
  which is what the page's Last week and Trend columns use.
- pg_cron job `playoff-odds-weekly` calls it every Monday at 10:00 UTC, an hour after the nightly Yahoo sync
  (09:00 UTC) has pulled the week that ended Sunday. Set up by `supabase/playoff_odds.sql`.
- The site reads `playoff_odds_view` live with the public key (`src/Odds.jsx`), so no Netlify rebuild.
- It needs the full regular-season schedule in `matchups` (future weeks with `is_complete = false`) and
  `seasons.num_playoff_teams` / `playoff_start_week`, which `yahoo-sync` stores.
- Manual run or backfill: `POST /playoff-odds?season=2026&through=3` with the `x-sync-key` header
  (same pattern as yahoo-sync: `net.http_post` reading the key from `sync_config`).

## The model
- Standings are category records (every category of every week is a W, L or T), ranked by win % with
  ties as half a win. Top 6 make the playoffs; seeds 1 and 2 get a first-round bye.
- Team strength = category win rate so far, with 100 categories of .500 play added to each side (about
  nine weeks), so early results are pulled toward average.
- Each simulation draws every team's true strength from that estimate's uncertainty, gives each team a
  random swing each week (sd 0.7 on the log-odds scale: injuries, games played, slumps), then plays every
  remaining category: a tie at the league's tie rate so far, otherwise log5 from the two strengths.
- Exact ties in the final standings are broken at random.

## Back-test (2026-10-31)
Run on every finished season 2005-06 to 2025-26 except 2019-20 (no seeds), from every week of the
regular season, against who actually finished top 6. Brier score 0.140 overall (0.25 is a coin flip;
0.244 after week 1, 0.20 after week 4, 0.13 after week 10, 0.05 after week 18).

| predicted | actually made it | team-weeks |
|---|---|---|
| 2% | 1% | 834 |
| 15% | 14% | 310 |
| 25% | 26% | 326 |
| 35% | 36% | 357 |
| 46% | 46% | 595 |
| 54% | 54% | 585 |
| 65% | 63% | 371 |
| 75% | 79% | 348 |
| 85% | 84% | 332 |
| 98% | 99% | 802 |

Tried: prior 10/40/60/100/150/200 categories and weekly swing 0/0.3/0.6/0.8/1.1; 100 and 0.7 scored best
(nearby values were within 0.001).
