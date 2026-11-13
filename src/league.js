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
  const moves = await loadMoves(ids);
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
        // Transactions (null until they are synced): players added, dropped, trades made, adds off waivers.
        ...(moves && { moves: moves.byTeam.get(t.id) ?? { adds: 0, drops: 0, trades: 0, waivers: 0 } }),
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
  return { seasons: out, draft, ...(moves && { added: moves.added(ownerName, teamById, byId) }) };
}

// Counts every team's adds, drops and trades from the transactions table. Returns null if the table
// doesn't exist yet or is empty, so the site builds the same as before transactions were synced.
async function loadMoves(ids) {
  let rows;
  try {
    rows = await fetchAll(`transactions?select=season_id,yahoo_key,kind,move,source,from_team_id,to_team_id,player_name&season_id=in.(${ids})&order=yahoo_key,player_key`);
  } catch {
    return null;
  }
  if (!rows.length) return null;
  const byTeam = new Map();
  const team = (id) => {
    if (!byTeam.has(id)) byTeam.set(id, { adds: 0, drops: 0, trades: 0, waivers: 0, tradeKeys: new Set() });
    return byTeam.get(id);
  };
  const players = new Map(); // player -> adds, by season and team
  for (const r of rows) {
    if (r.move === "add" && r.to_team_id) {
      const t = team(r.to_team_id);
      t.adds++;
      if (r.source === "waivers") t.waivers++;
      if (r.player_name) {
        if (!players.has(r.player_name)) players.set(r.player_name, []);
        players.get(r.player_name).push(r);
      }
    } else if (r.move === "drop" && r.from_team_id) {
      team(r.from_team_id).drops++;
    } else if (r.move === "trade") {
      for (const id of [r.from_team_id, r.to_team_id]) if (id) team(id).tradeKeys.add(r.yahoo_key);
    }
  }
  for (const t of byTeam.values()) { t.trades = t.tradeKeys.size; delete t.tradeKeys; }
  // The most-added players: how often anyone picked them up, in how many seasons, and who added them most.
  const added = (ownerName, teamById, seasonById) =>
    [...players].map(([player, list]) => {
      const owners = new Map();
      for (const r of list) {
        const o = ownerName.get(teamById.get(r.to_team_id)?.owner_id) ?? "Unknown";
        owners.set(o, (owners.get(o) ?? 0) + 1);
      }
      const [topOwner, topN] = [...owners].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return {
        player,
        adds: list.length,
        seasons: new Set(list.map((r) => seasonById.get(r.season_id).start_year)).size,
        owners: owners.size,
        topOwner, topN,
      };
    }).sort((a, b) => b.adds - a.adds || a.player.localeCompare(b.player)).slice(0, 40);
  return { byTeam, added };
}
