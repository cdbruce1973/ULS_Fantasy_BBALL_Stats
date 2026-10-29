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
- Design: green and white, inspired by University Lake School (Lakers/pines). Original pine/lake artwork. Footer carries Yahoo's required "Powered by Yahoo" logo, hotlinked unaltered from poweredby.yahoo.com (purple on light, white in dark mode) and linked to https://www.yahoo.com/?ilc=401 per developer.yahoo.com/attribution, plus "Fantasy data provided by Yahoo Fantasy".
- Shared league password login is ON HOLD ("wait on the shared pw").
- Never put Yahoo secrets, the sync key, or tokens in chat or in git. Secrets live in Supabase (`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`) and `sync_config`.
- Craig signs in to sites himself; DDL/delete statements through the Supabase tool often get cancelled, so give him SQL to run in the SQL editor instead.

## Status (2026-10-22)
- UI preview done and published as a Claude artifact (owner pages with banners, mobile-tuned).
- Yahoo API access works (approved 2026-10-29 after a long 403 wait). Teams synced for every season 2005-06 to 2026-27; all teams have owners.
- Head-to-head section built (`src/h2h.js` + H2H views in `App.jsx`, routes `#h2h`, `#h2h-<owner>`, `#h2h-<owner>-vs-<opp>`). It reads `src/matchups.json`, written at build time by `scripts/export_matchups.mjs` from Supabase (needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Netlify env). Empty until Yahoo sync runs; production shows an empty state, PR previews and `SAMPLE_H2H=1` builds show made-up games with a banner.

## Next steps
1. Finish backfill of matchups and drafts, validate head-to-head, then enable pg_cron nightly `?current=1`.
2. Switch the UI from `data.js` to Supabase reads (supabase-js, anon key); deploy to Netlify.
3. Head-to-head: built. After the first matchup sync, check it against real data (category stat ids in `CATEGORIES`, playoff flag, owner mapping).
4. Open questions: regular-season finish definition (Yahoo playoff seed vs own rule), display names for Pete/Nate/Owen/Erik/Brice/Will vs Yahoo, Yahoo logo file, shared password.

## Commands
- Preview with sample H2H data: `SAMPLE_H2H=1 npm run dev`
- Build preview: `NODE_PATH=<global node_modules> esbuild src/main.jsx --bundle --minify --format=iife --jsx=automatic --define:process.env.NODE_ENV=\"production\" --define:__SAMPLE_H2H__=false --outdir=dist && python3 build_preview.py`
- Normal build (with registry access): `npm install && npm run build`
- Regenerate sheet data: `python3 scripts/parse_sheet.py` (from repo root)
