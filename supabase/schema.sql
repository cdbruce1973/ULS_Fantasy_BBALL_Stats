-- Reference schema for the Laker Fantasy Bball project (Supabase project bcqzsqbtvukpqgmfctmj).
-- Reconstructed from the live database. Constraint/index details beyond the ones listed
-- (pks, uniques) should be checked against the live project before re-creating from scratch.

create table owners (
  id bigint generated always as identity primary key,
  name text not null unique,            -- display name (e.g. Geoff, BP, Brendan)
  notes text,
  created_at timestamptz not null default now(),
  yahoo_guid text unique,               -- stable Yahoo manager GUID: the reliable owner key
  yahoo_display_name text,              -- what Yahoo shows (e.g. "Geoff", "Alex K")
  member_since int
);
create table owner_aliases (alias text primary key, owner_id bigint not null references owners(id));
create table seasons (
  id bigint generated always as identity primary key,
  start_year int not null unique,       -- Yahoo labels by START year (2025 = 2025-26)
  label text generated always as (start_year || '-' || lpad(((start_year + 1) % 100)::text, 2, '0')) stored,
  end_year int generated always as (start_year + 1) stored,
  yahoo_league_key text unique,
  source text not null default 'yahoo', -- 'yahoo' | 'sheet' (2004-05 is sheet-only)
  is_current boolean not null default false,
  last_synced_at timestamptz
);
create table teams (
  id bigint generated always as identity primary key,
  season_id bigint not null references seasons(id),
  yahoo_team_key text unique,
  name text not null,
  manager_name text,                    -- Yahoo nickname; NOT unique (two "Brendan"s in 2025-26)
  manager_guid text,
  owner_id bigint references owners(id),
  final_rank int, playoff_seed int,
  wins int not null default 0, losses int not null default 0, ties int not null default 0
);
create table matchups (
  id bigint generated always as identity primary key,
  season_id bigint not null references seasons(id),
  week int not null,
  team1_id bigint not null references teams(id), team2_id bigint not null references teams(id),
  is_complete boolean not null default false, is_playoff boolean not null default false,
  is_consolation boolean not null default false,
  team1_cats_won numeric, team2_cats_won numeric, team1_stats jsonb, team2_stats jsonb
);
create table draft_picks (
  id bigint generated always as identity primary key,
  season_id bigint not null references seasons(id),
  pick int not null, round int, team_id bigint references teams(id),
  yahoo_player_id text, first_name text, last_name text, cost numeric,
  unique (season_id, pick)
);
create table sync_log (id bigint generated always as identity primary key, started_at timestamptz not null default now(), finished_at timestamptz, status text, detail text);
create table yahoo_tokens (id int primary key default 1, refresh_token text not null, access_token text, expires_at timestamptz, updated_at timestamptz not null default now());
create table oauth_states (state text primary key, created_at timestamptz not null default now());
create table sync_config (key text primary key, value text not null);  -- holds sync_key (x-sync-key header)

-- RLS: on everywhere. Signed-in users can read league tables; everything else is service-role only.
alter table owners enable row level security; alter table owner_aliases enable row level security;
alter table seasons enable row level security; alter table teams enable row level security;
alter table matchups enable row level security; alter table draft_picks enable row level security;
alter table sync_log enable row level security; alter table yahoo_tokens enable row level security;
alter table oauth_states enable row level security; alter table sync_config enable row level security;
create policy "members read owners" on owners for select to authenticated using (true);
create policy "members read aliases" on owner_aliases for select to authenticated using (true);
create policy "members read seasons" on seasons for select to authenticated using (true);
create policy "members read teams" on teams for select to authenticated using (true);
create policy "members read matchups" on matchups for select to authenticated using (true);
create policy "members read draft picks" on draft_picks for select to authenticated using (true);

-- Views (security_invoker)
create view v_owner_season_results with (security_invoker=on) as
 select o.name as owner, s.start_year, s.label as season, s.end_year, t.name as team_name, t.wins, t.losses, t.ties,
   t.final_rank, t.playoff_seed,
   round(100.0*t.wins/nullif(t.wins+t.losses,0),2) as win_pct_excl_ties,
   round(100.0*t.wins/nullif(t.wins+t.losses+t.ties,0),2) as win_pct_incl_ties
 from teams t join seasons s on s.id=t.season_id left join owners o on o.id=t.owner_id;
create view v_owner_totals with (security_invoker=on) as
 select o.id as owner_id, o.name as owner, count(*) as seasons, sum(t.wins) as wins, sum(t.losses) as losses, sum(t.ties) as ties,
   round(100.0*sum(t.wins)/nullif(sum(t.wins)+sum(t.losses),0),2) as win_pct_excl_ties,
   round(100.0*sum(t.wins)/nullif(sum(t.wins)+sum(t.losses)+sum(t.ties),0),2) as win_pct_incl_ties,
   round(avg(t.wins),1) as avg_wins, round(avg(t.losses),1) as avg_losses
 from teams t join owners o on o.id=t.owner_id group by o.id, o.name;
create view v_tournament_results with (security_invoker=on) as
 select o.name as owner, count(*) as seasons, count(*) filter (where t.final_rank=1) as titles,
   count(*) filter (where t.final_rank=2) as runner_ups, count(*) filter (where t.final_rank=3) as third_places,
   count(*) filter (where t.final_rank<=3) as times_placed
 from teams t join owners o on o.id=t.owner_id group by o.name;
create view v_h2h with (security_invoker=on) as
 with sides as (
   select season_id, week, is_playoff, team1_id as team_id, team2_id as opp_team_id, team1_cats_won as cats_for, team2_cats_won as cats_against
     from matchups where is_complete and not is_consolation
   union all
   select season_id, week, is_playoff, team2_id, team1_id, team2_cats_won, team1_cats_won
     from matchups where is_complete and not is_consolation)
 select o.name as owner, p.name as opponent, s.is_playoff, count(*) as games,
   count(*) filter (where s.cats_for>s.cats_against) as wins, count(*) filter (where s.cats_for<s.cats_against) as losses,
   count(*) filter (where s.cats_for=s.cats_against) as ties, sum(s.cats_for) as cats_for, sum(s.cats_against) as cats_against
 from sides s join teams t on t.id=s.team_id join teams ot on ot.id=s.opp_team_id
 join owners o on o.id=t.owner_id join owners p on p.id=ot.owner_id group by o.name, p.name, s.is_playoff;
