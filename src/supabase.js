// Public, read-only access to the league data in Supabase.
// The publishable key is meant to ship in the page: row-level security lets it read only the
// league tables (owners, seasons, teams, matchups, draft picks) and the h2h_games view.
export const SUPABASE_URL = "https://bcqzsqbtvukpqgmfctmj.supabase.co";
export const SUPABASE_KEY = "sb_publishable_B5ib-cnUXi270M5c6vV-EA_2Prfp9sm";

// GET a PostgREST path (e.g. "h2h_games?select=*"), following pages until every row is in.
export async function fetchAll(path, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_KEY, Range: `${from}-${from + pageSize - 1}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

// h2h_games row -> the compact shape the head-to-head pages use.
export const toGame = (g) => ({
  start: g.start_year, week: g.week, playoff: g.is_playoff,
  a: g.a, aTeam: g.a_team, b: g.b, bTeam: g.b_team,
  ac: Number(g.ac), bc: Number(g.bc), as: g.a_stats ?? null, bs: g.b_stats ?? null,
});
