// Seasons, teams and draft picks from Yahoo (via the public Supabase tables), in the shape lib.js uses.
// The build bakes finished seasons into src/history.json (scripts/export_data.mjs); the page loads the
// current season live with the same function.
import { fetchAll } from "./supabase.js";

const top3 = (n) => (n && n <= 3 ? n : null);

export async function loadLeague({ current }) {
  const seasons = await fetchAll(
    `seasons?select=id,start_year,label,end_year&is_current=eq.${current}&yahoo_league_key=not.is.null&order=start_year`
  );
  if (!seasons.length) return { seasons: [], draft: [] };
  const ids = seasons.map((s) => s.id).join(",");
  const [owners, teams, picks] = await Promise.all([
    fetchAll("owners?select=id,name&order=id"),
    fetchAll(`teams?select=id,season_id,name,owner_id,wins,losses,ties,final_rank,playoff_seed&season_id=in.(${ids})&order=id`),
    fetchAll(`draft_picks?select=season_id,pick,round,team_id,first_name,last_name&season_id=in.(${ids})&order=season_id,pick`),
  ]);
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const byId = new Map(seasons.map((s) => [s.id, s]));

  const out = seasons.map((s) => {
    const rows = teams.filter((t) => t.season_id === s.id);
    // Regular-season finish is Yahoo's playoff seed. 2019-20 (COVID) has no seeds, so its final rank stands in.
    const seeded = rows.some((t) => t.playoff_seed);
    return {
      start: s.start_year,
      label: s.label,
      end: s.end_year,
      ...(current && { current: true }),
      teams: rows.map((t) => ({
        owner: ownerName.get(t.owner_id) ?? "Unknown",
        team: t.name,
        w: t.wins ?? 0,
        l: t.losses ?? 0,
        t: t.ties ?? 0,
        // A season in progress has no finishes yet; its standings come from the record.
        reg: current ? null : top3(seeded ? t.playoff_seed : t.final_rank),
        tourney: current ? null : top3(t.final_rank),
        // Full finishes (1-12) for the draft-position and season record book pages.
        ...(!current && { rank: t.final_rank ?? null, seed: (seeded ? t.playoff_seed : t.final_rank) ?? null }),
      })),
    };
  });

  const draft = picks.map((p) => {
    const t = teamById.get(p.team_id);
    return {
      start: byId.get(p.season_id).start_year,
      round: p.round,
      pick: p.pick,
      player: [p.first_name, p.last_name].filter(Boolean).join(" "),
      team: t?.name ?? "",
      owner: ownerName.get(t?.owner_id) ?? "Unknown",
    };
  });
  return { seasons: out, draft };
}
