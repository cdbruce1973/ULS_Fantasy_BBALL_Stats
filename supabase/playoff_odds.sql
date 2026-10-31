-- Playoff odds: computed every Monday by the playoff-odds edge function, read live by the site (#odds).
-- Run once in the Supabase SQL editor. Re-running is safe.

create table if not exists playoff_odds (
  season_id bigint not null references seasons(id),
  through_week int not null,            -- odds as of the end of this week (0 = before any games)
  team_id bigint not null references teams(id),
  cat_w numeric not null, cat_l numeric not null, cat_t numeric not null,  -- category record so far
  strength numeric,                     -- estimated category win rate, pulled toward .500
  proj_w numeric, proj_l numeric, proj_t numeric,                          -- average final record
  playoff_pct numeric not null,         -- % of simulated seasons finishing in a playoff spot
  top_seed_pct numeric,                 -- % finishing 1st
  avg_seed numeric,
  seed_pct jsonb,                       -- [% 1st, % 2nd, ... % 12th]
  sims int not null,
  computed_at timestamptz not null default now(),
  primary key (season_id, through_week, team_id)
);

-- Public, like the rest of the league stats (only the service role can write).
alter table playoff_odds enable row level security;
drop policy if exists "public read playoff odds" on playoff_odds;
create policy "public read playoff odds" on playoff_odds for select to anon, authenticated using (true);

-- The shape the site reads: one row per team per week, with owner and team names.
create or replace view playoff_odds_view with (security_invoker = on) as
select s.start_year, s.is_current, s.num_playoff_teams, p.through_week, o.name as owner, t.name as team,
  p.cat_w, p.cat_l, p.cat_t, p.strength, p.proj_w, p.proj_l, p.proj_t,
  p.playoff_pct, p.top_seed_pct, p.avg_seed, p.seed_pct, p.sims, p.computed_at
from playoff_odds p
join seasons s on s.id = p.season_id
join teams t on t.id = p.team_id
left join owners o on o.id = t.owner_id;
grant select on playoff_odds_view to anon, authenticated;

-- Every Monday at 10:00 UTC (5 am Central, 4 am in winter): an hour after the nightly Yahoo sync
-- (09:00 UTC) has pulled the week that ended Sunday night. The key is read from sync_config inside the job.
select cron.schedule('playoff-odds-weekly', '0 10 * * 1', $$
  select net.http_post(
    url := 'https://bcqzsqbtvukpqgmfctmj.supabase.co/functions/v1/playoff-odds',
    headers := jsonb_build_object('x-sync-key', (select value from sync_config where key = 'sync_key')),
    timeout_milliseconds := 60000);
$$);

-- Check: select jobname, schedule, active from cron.job;
-- Latest odds: select owner, team, playoff_pct from playoff_odds_view where is_current order by through_week desc, playoff_pct desc;
