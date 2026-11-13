-- Transactions: every add, drop and trade from Yahoo, one row per player moved.
-- Run once in the Supabase SQL editor. Re-running is safe.
-- Filled by yahoo-sync, part "transactions" (every season on a full sync; the nightly ?current=1 run
-- refreshes this season and last).

create table if not exists transactions (
  season_id bigint not null references seasons(id),
  yahoo_key text not null,            -- Yahoo transaction key; one transaction can move several players
  player_key text not null,
  ts timestamptz not null,            -- when Yahoo processed it
  kind text not null,                 -- Yahoo transaction type: add | drop | add/drop | trade | commish
  move text not null,                 -- what happened to this player: add | drop | trade
  source text,                        -- for adds: freeagents | waivers; for trades: team
  from_team_id bigint references teams(id),  -- dropping or trading team
  to_team_id bigint references teams(id),    -- adding or receiving team
  player_name text,
  positions text,
  nba_team text,
  faab_bid int,
  primary key (yahoo_key, player_key)
);
create index if not exists transactions_season on transactions (season_id, ts);
alter table transactions enable row level security;
drop policy if exists "public read transactions" on transactions;
create policy "public read transactions" on transactions for select to anon, authenticated using (true);

-- Yahoo's own move and trade counts for each team (from the standings), kept as a cross-check.
alter table teams add column if not exists moves int;
alter table teams add column if not exists trades int;
