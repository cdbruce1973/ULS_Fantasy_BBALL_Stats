# Matchup predictor

This season > This week (`#now-week`) shows each team's chance to win the current week's matchup, the chance of
winning each category, games left per player and injury statuses. Recomputed every morning; no Netlify rebuild.

## How it runs
1. `yahoo-sync` (09:00 UTC nightly, `?current=1`) also pulls part `rosters`: today's roster for every team with
   Yahoo's injury status (INJ, O, GTD, DTD, SUSP, NA) into `roster_now`, and stores each week's dates
   (`matchups.week_start`, `week_end`).
2. `matchup-odds` (pg_cron `matchup-odds-nightly`, 09:30 UTC) simulates the rest of the week 10,000 times and
   upserts one row per team into `matchup_odds` for (season, week, as_of). Earlier mornings are kept, so the page
   shows how the odds moved and, for finished weeks, what was predicted on Monday.
3. The site reads `matchup_odds` live with the public key (`C.loadMatchupOdds` in `src/current.js`).

Set up by `supabase/matchup_odds.sql` (run it before deploying the two functions). Manual run:
`net.http_post` to `/functions/v1/matchup-odds` with the `x-sync-key` header read from `sync_config`
(add `?date=YYYY-MM-DD` to predict as of another morning of the current week).

The NBA schedule (which teams play on each remaining day) comes from ESPN's public scoreboard, one request per day, because Yahoo's API
doesn't expose it. If ESPN can't be reached, every player is assumed to have a game on half the days left.

## The model (`supabase/functions/matchup-odds/model.ts`)
- Start from Yahoo's week totals so far (through last night).
- For each remaining day and each rostered player whose NBA team plays: he plays with a chance set by his status
  (Yahoo uses NBA injury report tags: healthy 95%, P 90%, Q/GTD/DTD 55% today and 80% later, D 20% today and
  55% later, O 3% today rising to 45% by day 4, INJ 3%, SUSP/NA 0).
  A healthy player who sat his team's last two games is treated as DTD.
- The team starts its best players who play that day, up to 8 (positions are ignored).
- Each start is one of the player's real games this season, picked at random, weighted by recency (half-life
  21 days). Players with fewer than 5 games are topped up with replacement-level games (bottom quarter of
  rostered players by points per game).
- Each team gets one random volume swing per simulated week (sd 0.1 on the log scale) for pickups, streaming
  and minutes the model can't see. It scales makes and attempts together, so percentages don't move.
- Score the 11 categories like Yahoo (FG%/FT% to three places, fewer TO wins). Win, loss or tie by categories.

## Back-test (2026-11-13, `scripts/backtest_matchup_odds.ts`)
Weeks 1 to 3 of 2026-27, from every morning of each week (120 predictions, 18 matchups), with the rosters and
schedule known that morning. Injury status isn't stored for past days, so the back-test uses only the
"sat his last two games" rule; the live model has Yahoo's real statuses too.

| | Brier | picked the winner |
|---|---|---|
| all weeks | 0.125 | 80% |
| weeks 2-3, Monday morning | 0.178 | 67% |
| weeks 2-3, Tuesday morning | 0.125 | 92% |
| weeks 2-3, Thursday morning | 0.089 | 92% |
| weeks 2-3, Sunday morning | 0.042 | 83% |

(0.25 is a coin flip.) Calibration on weeks 2-3: predicted 0-20% won 12% (avg 7%), 20-40% won 33%, 40-60% won 50%,
80-100% won 100% (avg 93%). Week 1 was worse (one or two games per player to go on).

Tried: recency half-life 7/14/21 days and none (all within 0.001 Brier; 21 kept so recent form counts), no lineup
limit (slightly worse), no injury guess (worse: 0.110 vs 0.102 on weeks 2-3), team volume swing 0/0.1/0.2/0.3 and
per-player form swing 0.2/0.3 (0.1 team swing had the best log loss). Only 12 matchups after week 1, so re-run the
back-test after a few more weeks (export commands are at the top of the script).
