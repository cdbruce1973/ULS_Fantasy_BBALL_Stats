-- Applied 2026-10-29 (migration public_read_league_data). League stats are public by Craig's choice;
-- yahoo_tokens, oauth_states, sync_config and sync_log keep no policies, so only the service role sees them.
create policy "public read owners" on owners for select to anon using (true);
create policy "public read seasons" on seasons for select to anon using (true);
create policy "public read teams" on teams for select to anon using (true);
create policy "public read matchups" on matchups for select to anon using (true);
create policy "public read draft picks" on draft_picks for select to anon using (true);

-- One row per completed, non-consolation game, in the shape the head-to-head pages use.
create or replace view h2h_games with (security_invoker = on) as
select s.start_year, s.is_current, m.week, m.is_playoff,
  oa.name as a, ta.name as a_team, ob.name as b, tb.name as b_team,
  m.team1_cats_won as ac, m.team2_cats_won as bc, m.team1_stats as a_stats, m.team2_stats as b_stats
from matchups m
join seasons s on s.id = m.season_id
join teams ta on ta.id = m.team1_id join owners oa on oa.id = ta.owner_id
join teams tb on tb.id = m.team2_id join owners ob on ob.id = tb.owner_id
where m.is_complete and not m.is_consolation;
grant select on h2h_games to anon, authenticated;
