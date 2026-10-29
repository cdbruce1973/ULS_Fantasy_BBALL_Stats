-- Nightly refresh: pull the latest Yahoo data, then rebuild the Netlify site so it shows it.
-- Run once in the Supabase SQL editor. Re-running is safe (cron.schedule replaces a job with the same name).
-- Times are UTC: 09:00 UTC is 4 am Central (3 am in winter), after the night's NBA games are final.

create extension if not exists pg_cron;

-- The Netlify build hook URL lives in sync_config, like the sync key, so it never sits in git.
-- Netlify: Project configuration > Build & deploy > Continuous deployment > Build hooks > Add build hook (branch: main).
-- insert into sync_config (key, value) values ('netlify_build_hook', '<paste the hook URL>')
--   on conflict (key) do update set value = excluded.value;

-- 1) Sync the current season and the one before it (teams, matchups, draft).
select cron.schedule('yahoo-nightly-sync', '0 9 * * *', $$
  select net.http_post(
    url := 'https://bcqzsqbtvukpqgmfctmj.supabase.co/functions/v1/yahoo-sync?current=1',
    headers := jsonb_build_object('x-sync-key', (select value from sync_config where key = 'sync_key')),
    timeout_milliseconds := 150000);
$$);

-- 2) Fifteen minutes later, rebuild the site so scripts/export_matchups.mjs picks up the new games.
select cron.schedule('netlify-nightly-rebuild', '15 9 * * *', $$
  select net.http_post(url := value, body := '{}'::jsonb)
  from sync_config where key = 'netlify_build_hook';
$$);

-- Check: select jobname, schedule, active from cron.job;
-- History: select * from cron.job_run_details order by start_time desc limit 10;
