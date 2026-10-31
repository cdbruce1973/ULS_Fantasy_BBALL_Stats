-- Current season hub: nightly player stats and league settings.
-- Run once in the Supabase SQL editor. Re-running is safe.

-- 1) One row per rostered player per day of the current season (synced nightly by yahoo-sync, part "players").
--    slot is where the manager played them that day (PG, Util, BN, IL...); BN/IL stats do not count.
--    stats holds Yahoo's numbers by stat id (3 FGA, 4 FGM, 6 FTA, 7 FTM, 10 3PTM, 12 PTS, 15 REB,
--    16 AST, 17 ST, 18 BLK, 19 TO; 5 FG% and 8 FT% too).
create table if not exists player_days (
  season_id bigint not null references seasons(id),
  game_date date not null,
  player_key text not null,
  team_id bigint references teams(id),
  name text,
  nba_team text,
  positions text,
  slot text,
  stats jsonb,
  primary key (season_id, game_date, player_key)
);
create index if not exists player_days_team_date on player_days (team_id, game_date);
alter table player_days enable row level security;
drop policy if exists "public read player days" on player_days;
create policy "public read player days" on player_days for select to anon, authenticated using (true);

-- 2) League settings from Yahoo, filled on every sync (used for the schedule and playoff odds).
alter table seasons add column if not exists end_week int;
alter table seasons add column if not exists playoff_start_week int;
alter table seasons add column if not exists num_playoff_teams int;
