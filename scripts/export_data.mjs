// Writes the finished seasons into the build:
//   src/matchups.json  every head-to-head game
//   src/history.json   every season's teams (owner, record, finishes) and full draft
// Finished seasons never change, so the site is rebuilt once a year (see "End of season" in CLAUDE.md).
// The current season is not exported; the page loads it live from Supabase on each visit.
// Runs before the Netlify build and needs no secrets: it reads the public tables and h2h_games view.
import { writeFileSync } from "node:fs";
import { fetchAll, toGame } from "../src/supabase.js";
import { loadLeague } from "../src/league.js";

const write = (file, data) => writeFileSync(new URL(`../src/${file}`, import.meta.url), JSON.stringify(data));

const select = "start_year,is_current,week,is_playoff,a,a_team,b,b_team,ac,bc,a_stats,b_stats";
const rows = await fetchAll(`h2h_games?select=${select}&is_current=eq.false&order=start_year,week`);
write("matchups.json", rows.map(toGame));
console.log(`export_data: wrote ${rows.length} games from finished seasons`);

const history = await loadLeague({ current: false });
const teams = history.seasons.reduce((n, s) => n + s.teams.length, 0);
if (history.seasons.some((s) => s.teams.some((t) => t.owner === "Unknown"))) throw new Error("export_data: a team has no owner");
write("history.json", history);
console.log(`export_data: wrote ${history.seasons.length} seasons, ${teams} teams, ${history.draft.length} draft picks`);
