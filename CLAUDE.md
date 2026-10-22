# Laker Fantasy Bball: project guide

Automated all-time history site for a 12-team Yahoo fantasy basketball league (started 2004-05), replacing a manual Google Sheet.
Owner: Craig (Salesforce solution architect; reads/edits code comfortably, doesn't write from scratch). Explain choices plainly.

## Stack
- Front end: React 19 + Vite, hash routing, single `App.jsx`, tokens in `src/styles.css`. Deploys to Netlify (not yet deployed).
- Back end: Supabase project `bcqzsqbtvukpqgmfctmj` (Postgres, RLS, edge functions, pg_cron/pg_net for scheduled sync).
- Data: Yahoo Fantasy API v2 (OAuth2, scope `fspt-r`). Until sync works, the UI reads `src/data.js` generated from the old sheet (`scripts/parse_sheet.py`).
- Everything under `supabase/` is reference source; the live copies are in the Supabase project.

## Rules and decisions (do not relitigate)
- Yahoo labels seasons by START year (2025 = 2025-26). The old sheet labelled by END year. 2004-05 exists only in the sheet.
- Champions, runner-ups, titles and streaks are DERIVED from data, never hand-counted. The sheet is a guide only.
- Win % is shown both with and without ties (global toggle). Ignore football/side leagues.
- Owners are identified by Yahoo manager GUID (`owners.yahoo_guid`, `teams.manager_guid`), NOT by nickname: two owners both show as "Brendan" (Brendan since 2008; BP since 2025).
- Display names: Smy, Geoff, Scotty, Aaron, Drewber, AK, Brendan, Klink, Cowan, Evan, Craig, BP, Pete, Nate, Owen, Erik, Brice, Will.
- Design: green and white, inspired by University Lake School (Lakers/pines). Original pine/lake artwork. Yahoo logo only unaltered, with "Fantasy data provided by Yahoo Fantasy" in the footer (logo file still to be supplied by Craig).
- Shared league password login is ON HOLD ("wait on the shared pw").
- Never put Yahoo secrets, the sync key, or tokens in chat or in git. Secrets live in Supabase (`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`) and `sync_config`.
- Craig signs in to sites himself; DDL/delete statements through the Supabase tool often get cancelled, so give him SQL to run in the SQL editor instead.

## Status (2026-10-22)
- UI preview done and published as a Claude artifact (owner pages with banners, mobile-tuned).
- Yahoo OAuth works (token stored) but every fantasy endpoint returns 403 "not authorized". Yahoo emailed approval; access turns on after the agreement, a NEW app with Fantasy Sports read permission, and the Client ID on the confirmation form (submitted for old and new app). Waiting on Yahoo support.
- Owner-key migration applied (owners.yahoo_guid etc., teams.manager_guid). `yahoo-sync` v4 captures GUIDs.

## Next steps
1. When Yahoo access works: `net.http_post` to `yahoo-sync?season=2025&parts=teams`, check team rows, manager GUIDs and the two Brendans; fill `owners.yahoo_guid`; backfill all seasons; validate against `data.js`; enable pg_cron nightly `?current=1`.
2. Switch the UI from `data.js` to Supabase reads (supabase-js, anon key); deploy to Netlify.
3. Head-to-head section (full treatment): rivalry grid, owner-vs-opponent pages, regular season vs playoffs, category W/L, season-by-season series, streaks, biggest blowout, last 10 meetings, nemesis/favorite opponent, filters. Built on `v_h2h`. 2004-05 excluded.
4. Open questions: regular-season finish definition (Yahoo playoff seed vs own rule), display names for Pete/Nate/Owen/Erik/Brice/Will vs Yahoo, Yahoo logo file, shared password.

## Commands
- Build preview: `NODE_PATH=<global node_modules> esbuild src/main.jsx --bundle --minify --format=iife --jsx=automatic --define:process.env.NODE_ENV=\"production\" --outdir=dist && python3 build_preview.py`
- Normal build (with registry access): `npm install && npm run build`
- Regenerate sheet data: `python3 scripts/parse_sheet.py` (from repo root)
