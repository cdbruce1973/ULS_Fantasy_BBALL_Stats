# Laker Fantasy Bball: project guide

Automated all-time history site for a 12-team Yahoo fantasy basketball league (started 2004-05), replacing a manual Google Sheet.
Owner: Craig (Salesforce solution architect; reads/edits code comfortably, doesn't write from scratch). Explain choices plainly.

## Stack
- Front end: React 19 + Vite, hash routing, single `App.jsx`, tokens in `src/styles.css`. Deploys to Netlify from GitHub `cdbruce1973/ULS_Fantasy_BBALL_Stats` (`netlify.toml`).
- Back end: Supabase project `bcqzsqbtvukpqgmfctmj` (Postgres, RLS, edge functions, pg_cron/pg_net for scheduled sync).
- Data: Yahoo Fantasy API v2 (OAuth2, scope `fspt-r`). Until sync works, the UI reads `src/data.js` generated from the old sheet (`scripts/parse_sheet.py`).
- Everything under `supabase/` is reference source; the live copies are in the Supabase project.

## Rules and decisions (do not relitigate)
- Yahoo labels seasons by START year (2025 = 2025-26). The old sheet labelled by END year. 2004-05 exists only in the sheet.
- Champions, runner-ups, titles and streaks are DERIVED from data, never hand-counted. The sheet is a guide only.
- Finishes (Craig, 2026-10-29): tournament finish = Yahoo `final_rank`; regular-season finish = Yahoo `playoff_seed` (2019-20 has no seeds, so `final_rank`). This corrected two sheet errors: 2005-06 reg 3rd is Drewber (sheet said AK), 2015-16 reg 3rd is Aaron (sheet said Pete). All 252 records and every tournament top 3 matched the sheet. 2004-05 is sheet-only.
- Completed seasons only (Craig, 2026-10-30, including career W-L and win %): Record book and Owners stats (podium %, seasons, titles, streaks, averages, best seasons, career W-L/win %) count completed seasons only. The season in progress shows on Seasons, Teams, owner season tables ("in progress") and H2H.
- Win % is shown both with and without ties (global toggle). Ignore football/side leagues.
- Yahoo hides manager GUIDs (every `teams.manager_guid` is "--hidden--"), so owners are NOT matched by GUID. Seasons 2005-06 to 2025-26 were matched to the sheet by team name + record (all 252 teams, done 2026-10-29). New seasons: `yahoo-sync` carries the owner forward from last season's team with the same name, then falls back to nickname aliases (`owner_aliases`) only when the nickname is unique. Two owners both show as "Brendan" (Brendan since 2008, team Quad Duces; BP since 2025, team Luka Gone-cic). `teams.owner_id` is never overwritten by a re-sync.
- Display names: Smy, Geoff, Scotty, Aaron, Drewber, AK, Brendan, Klink, Cowan, Evan, Craig, BP, Pete, Nate, Owen, Erik, Brice, Will, Will V (Craig, 2026-10-30: keep these as is). Will V co-owned/ran Three Point Club for Cowan in 2009-10 and 2010-11 and gets credit for those two seasons (Cowan returned 2011-12, same team name); he is not the Will of 2018-19.
- Design: green and white, inspired by University Lake School (Lakers/pines). Original pine/lake artwork. Footer carries Yahoo's required "Powered by Yahoo" logo, hotlinked unaltered from poweredby.yahoo.com (purple on light, white in dark mode) and linked to https://www.yahoo.com/?ilc=401 per developer.yahoo.com/attribution, plus "Fantasy data provided by Yahoo Fantasy".
- Shared league password login is ON HOLD ("wait on the shared pw").
- League stats are PUBLIC (Craig, 2026-10-29): anon can read owners, seasons, teams, matchups, draft_picks and the `h2h_games` view (`supabase/public_read.sql`). The publishable key lives in `src/supabase.js`. Tokens/sync config stay service-role only.
- No scheduled Netlify rebuilds (they cost credits). Finished seasons are baked into the build; the current season loads live from Supabase in the browser. One rebuild per year at season end.
- Never put Yahoo secrets, the sync key, or tokens in chat or in git. Secrets live in Supabase (`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`) and `sync_config`.
- Craig signs in to sites himself; DDL/delete statements through the Supabase tool often get cancelled, so give him SQL to run in the SQL editor instead.

## Status (2026-10-29)
- Yahoo API access works. Teams, matchups and drafts synced for every season 2005-06 to 2026-27; all teams have owners.
- Every page reads Yahoo data. Finished seasons are written at build time by `scripts/export_data.mjs` (public tables, no secrets) into `src/matchups.json` (H2H games) and `src/history.json` (teams, finishes, full drafts, via `src/league.js`). 2004-05 comes from `src/data.js` (the sheet). The current season loads live in the browser: `L.loadLiveSeason()` (teams, draft) and `H.loadLiveGames()` (H2H). A season in progress has no finishes and is left out of best-season lists, banners and per-season averages.
- Every finished team also carries `rank` (Yahoo final_rank, 1-12) and `seed` (regular-season finish, 1-12) for the Draft page's "Does draft position matter?" analysis and each season's record book (Seasons page). The league plays a six-team playoff (seeds 1-6; final ranks 1-6 are always those teams).
- Head-to-head routes: `#h2h`, `#h2h-<owner>`, `#h2h-<owner>-vs-<opp>`. `SAMPLE_H2H=1` builds with no real games show made-up games with a banner.
- Nightly refresh: `supabase/nightly_sync.sql` (pg_cron 09:00 UTC `yahoo-sync?current=1`; no rebuild).
- Playoff odds (`#odds`): edge function `playoff-odds` simulates the rest of the regular season every Monday 10:00 UTC (`supabase/playoff_odds.sql`) into `playoff_odds`; the page reads `playoff_odds_view` live. Model and back-test in `docs/PLAYOFF_ODDS.md`.

## Next steps
1. Open question: shared password (likely unneeded: production is public, Netlify team login only guards previews).

## End of season (once a year, after the final playoff week)
1. Run a full sync of the finished season: `yahoo-sync?season=<start year>` (teams, matchups, draft) and check it.
2. In `seasons`, set `is_current = false` on the finished season and `true` on the next one (insert the next season with its Yahoo league key first if needed).
3. In Netlify, Deploys > Trigger deploy > Deploy site (one build). The export bakes the finished season into `src/matchups.json` and `src/history.json`; from then on it never changes.

## Commands
- Preview with sample H2H data: `SAMPLE_H2H=1 npm run dev`
- Build preview: `NODE_PATH=<global node_modules> esbuild src/main.jsx --bundle --minify --format=iife --jsx=automatic --define:process.env.NODE_ENV=\"production\" --define:__SAMPLE_H2H__=false --outdir=dist && python3 build_preview.py`
- Normal build (with registry access): `npm install && npm run build`
- Regenerate sheet data: `python3 scripts/parse_sheet.py` (from repo root)
