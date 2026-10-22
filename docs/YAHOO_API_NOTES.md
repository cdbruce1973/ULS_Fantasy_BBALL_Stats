# Yahoo Fantasy API notes
- Base `https://fantasysports.yahooapis.com/fantasy/v2`, add `format=json`. OAuth2 code flow, scope `fspt-r`.
- Access needs manual approval (https://sports.yahoo.com/developer/access/): sign agreement, create a NEW app with Fantasy Sports read, submit its Client ID on the confirmation form. Until then: 403 "This application is not authorized".
- Reset auth: delete rows in `yahoo_tokens` and `oauth_states`, then open `/functions/v1/yahoo-auth`.
- League keys per season are in `supabase/seed_seasons.sql`. 2026 = `478.l.72617`.
- JSON quirks: arrays of single-key objects and numeric-keyed maps (see `flat()`/`items()` in yahoo-sync).
- Manager nickname is not unique; use `manager.guid`.
- Run sync from SQL: `select net.http_post(url:='https://<ref>.supabase.co/functions/v1/yahoo-sync?season=2025&parts=teams', headers:=jsonb_build_object('x-sync-key','<value from sync_config>'));` then read `net._http_response`.
- Yahoo brand rules: unaltered standalone logo + "Fantasy data provided by Yahoo Fantasy".
