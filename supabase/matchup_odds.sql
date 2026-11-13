-- Matchup predictor: each team's chance to win this week's matchup, recomputed every morning.
-- Run once in the Supabase SQL editor, BEFORE deploying yahoo-sync v15 and matchup-odds. Re-running is safe.

-- 1) Yahoo's dates for each week (week 1 and the All-Star week aren't Monday to Sunday).
alter table matchups add column if not exists week_start date;
alter table matchups add column if not exists week_end date;

-- 2) Today's roster for every team with Yahoo's injury status, replaced on every nightly sync
--    (yahoo-sync part "rosters"). status: P, Q, D, O (NBA injury report), INJ, SUSP, NA, or null when healthy.
create table if not exists roster_now (
  season_id bigint not null references seasons(id),
  player_key text not null,
  team_id bigint references teams(id),
  name text,
  nba_team text,
  positions text,
  slot text,
  status text,
  status_full text,
  injury_note text,
  updated_at timestamptz not null default now(),
  primary key (season_id, player_key)
);
alter table roster_now enable row level security;
drop policy if exists "public read roster now" on roster_now;
create policy "public read roster now" on roster_now for select to anon, authenticated using (true);

-- 3) The predictions: one row per team per morning (as_of, a US Eastern date) of each week.
create table if not exists matchup_odds (
  season_id bigint not null references seasons(id),
  week int not null,
  as_of date not null,                 -- predicted on the morning of this day, before its games
  team_id bigint not null references teams(id),
  opp_id bigint not null references teams(id),
  win_pct numeric not null,            -- % of simulated weeks this team wins
  tie_pct numeric not null,            -- % that end level (e.g. 5-5-1)
  cat_win jsonb,                       -- {stat id: % chance of winning that category}
  proj jsonb,                          -- {stat id: average final total}
  starts_left numeric,                 -- expected starter games still to come
  days_left int,
  players jsonb,                       -- [{name, nba, pos, slot, status, note, games_left, gp}, ...]
  sims int not null,
  computed_at timestamptz not null default now(),
  primary key (season_id, week, as_of, team_id)
);
alter table matchup_odds enable row level security;
drop policy if exists "public read matchup odds" on matchup_odds;
create policy "public read matchup odds" on matchup_odds for select to anon, authenticated using (true);

-- 4) Every day at 09:30 UTC, half an hour after the nightly Yahoo sync (09:00 UTC).
select cron.schedule('matchup-odds-nightly', '30 9 * * *', $$
  select net.http_post(
    url := 'https://bcqzsqbtvukpqgmfctmj.supabase.co/functions/v1/matchup-odds',
    headers := jsonb_build_object('x-sync-key', (select value from sync_config where key = 'sync_key')),
    timeout_milliseconds := 60000);
$$);

-- Check: select team_id, win_pct, tie_pct from matchup_odds order by as_of desc, week desc limit 12;
