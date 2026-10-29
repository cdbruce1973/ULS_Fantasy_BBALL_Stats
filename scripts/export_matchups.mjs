// Writes src/matchups.json: every head-to-head game from finished seasons, baked into the build.
// Finished seasons never change, so the site is rebuilt once a year (see "End of season" in CLAUDE.md).
// The current season is not exported; the page loads it live from Supabase on each visit.
// Runs before the Netlify build and needs no secrets: it reads the public h2h_games view.
import { writeFileSync } from "node:fs";
import { fetchAll, toGame } from "../src/supabase.js";

const select = "start_year,is_current,week,is_playoff,a,a_team,b,b_team,ac,bc,a_stats,b_stats";
const rows = await fetchAll(`h2h_games?select=${select}&is_current=eq.false&order=start_year,week`);
const games = rows.map(toGame);
writeFileSync(new URL("../src/matchups.json", import.meta.url), JSON.stringify(games));
console.log(`export_matchups: wrote ${games.length} games from finished seasons`);
