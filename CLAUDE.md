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
- Win % is shown both with and without ties (global toggle). Ignore football/side leagues.
- Yahoo hides manager GUIDs (every `teams.manager_guid` is "--hidden--"), so owners are NOT matched by GUID. Seasons 2005-06 to 2025-26 were matched to the sheet by team name + record (all 252 teams, done 2026-10-29). New seasons: `yahoo-sync` carries the owner forward from last season's team with the same name, then falls back to nickname aliases (`owner_aliases`) only when the nickname is unique. Two owners both show as "Brendan" (Brendan since 2008, team Quad Duces; BP since 2025, team Luka Gone-cic). `teams.owner_id` is never overwritten by a re-sync.
- Display names: Smy, Geoff, Scotty, Aaron, Drewber, AK, Brendan, Klink, Cowan, Evan, Craig, BP, Pete, Nate, Owen, Erik, Brice, Will.
- Design: green and white, inspired by University Lake School (Lakers/pines). Original pine/lake artwork. Yahoo logo only unaltered, with "Fantasy data provided by Yahoo Fantasy" in the footer (logo file still to be supplied by Craig).
- Shared league password login is ON HOLD ("wait on the shared pw").
- League stats are PUBLIC (Craig, 2026-10-29): anon can read owners, seasons, teams, matchups, draft_picks and the `h2h_games` view (`supabase/public_read.sql`). The publishable key lives in `src/supabase.js`. Tokens/sync config stay service-role only.
- No scheduled Netlify rebuilds (they cost credits). Finished seasons are baked into the build; the current season loads live from Supabase in the browser. One rebuild per year at season end.
- Never put Yahoo secrets, the sync key, or tokens in chat or in git. Secrets live in Supabase (`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`) and `sync_config`.
- Craig signs in to sites himself; DDL/delete statements through the Supabase tool often get cancelled, so give him SQL to run in the SQL editor instead.

## Status (2026-10-22)
- UI preview done and published as a Claude artifact (owner pages with banners, mobile-tuned).
- Yahoo API access works (approved 2026-10-29 after a long 403 wait). Teams synced for every season 2005-06 to 2026-27; all teams have owners.
- Head-to-head (`src/h2h.js` + H2H views in `App.jsx`, routes `#h2h`, `#h2h-<owner>`, `#h2h-<owner>-vs-<opp>`): finished seasons come from `src/matchups.json`, written at build time by `scripts/export_matchups.mjs` from the public `h2h_games` view (no secrets needed; `is_current = false` only). The current season is fetched live from `h2h_games` (`is_current = true`) on page load. `SAMPLE_H2H=1` builds with no real games show made-up games with a banner.

## Next steps
1. Nightly refresh: `supabase/nightly_sync.sql` (pg_cron 09:00 UTC `yahoo-sync?current=1`; no rebuild).
2. Move the other pages (record book, owners, seasons, teams, draft) off `data.js` the same way: history baked at build time, current season live. Until then they stop at 2025-26.
3. Head-to-head: live with real data since 2026-10-29 (backfill verified against standings).
4. Open questions: regular-season finish definition (Yahoo playoff seed vs own rule), display names for Pete/Nate/Owen/Erik/Brice/Will vs Yahoo, Yahoo logo file, shared password.

## End of season (once a year, after the final playoff week)
1. Run a full sync of the finished season: `yahoo-sync?season=<start year>` (teams, matchups, draft) and check it.
2. In `seasons`, set `is_current = false` on the finished season and `true` on the next one (insert the next season with its Yahoo league key first if needed).
3. In Netlify, Deploys > Trigger deploy > Deploy site (one build). The export bakes the finished season into `src/matchups.json`; from then on it never changes.

## Commands
- Preview with sample H2H data: `SAMPLE_H2H=1 npm run dev`
- Build preview: `NODE_PATH=<global node_modules> esbuild src/main.jsx --bundle --minify --format=iife --jsx=automatic --define:process.env.NODE_ENV=\"production\" --define:__SAMPLE_H2H__=false --outdir=dist && python3 build_preview.py`
- Normal build (with registry access): `npm install && npm run build`
- Regenerate sheet data: `python3 scripts/parse_sheet.py` (from repo root)
