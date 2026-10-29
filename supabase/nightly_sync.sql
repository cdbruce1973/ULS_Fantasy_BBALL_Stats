-- Nightly refresh: pull the latest Yahoo data into Supabase. The site reads the current season
-- live from Supabase, so no Netlify rebuild is needed (rebuilds cost Netlify credits).
-- Run once in the Supabase SQL editor. Re-running is safe (cron.schedule replaces a job with the same name).
-- 09:00 UTC is 4 am Central (3 am in winter), after the night's NBA games are final.

create extension if not exists pg_cron;

-- Sync the current season and the one before it (teams, matchups, draft).
-- The sync key is read from sync_config inside the job, so it never appears here.
select cron.schedule('yahoo-nightly-sync', '0 9 * * *', $$
  select net.http_post(
    url := 'https://bcqzsqbtvukpqgmfctmj.supabase.co/functions/v1/yahoo-sync?current=1',
    headers := jsonb_build_object('x-sync-key', (select value from sync_config where key = 'sync_key')),
    timeout_milliseconds := 150000);
$$);

-- Check: select jobname, schedule, active from cron.job;
-- History: select * from cron.job_run_details order by start_time desc limit 10;
