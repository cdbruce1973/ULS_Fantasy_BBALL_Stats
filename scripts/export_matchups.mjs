// Writes src/matchups.json from the Supabase `matchups` table so the site can show head-to-head records.
// Runs before the Netlify build. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the secret key) in the build environment
// (Netlify: Site configuration > Environment variables). The key is only used here, never shipped to the browser.
// Without them it leaves src/matchups.json as is, so local builds keep working.
import { writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("export_matchups: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set, keeping src/matchups.json");
  process.exit(0);
}

const select = [
  "week", "is_playoff", "team1_cats_won", "team2_cats_won", "team1_stats", "team2_stats",
  "season:seasons(start_year)",
  "t1:teams!team1_id(name, owner:owners(name))",
  "t2:teams!team2_id(name, owner:owners(name))",
].join(",");
// Either key type works: a new secret key (sb_secret_...) goes only in the apikey header,
// a legacy service_role key (a JWT starting "eyJ") also needs the Bearer header.
const auth = key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
const page = 1000;
const rows = [];
for (let from = 0; ; from += page) {
  const res = await fetch(`${url}/rest/v1/matchups?select=${encodeURIComponent(select)}&is_complete=eq.true&is_consolation=eq.false&order=id`, {
    headers: { ...auth, Range: `${from}-${from + page - 1}` },
  });
  if (!res.ok) throw new Error(`export_matchups: ${res.status} ${await res.text()}`);
  const batch = await res.json();
  rows.push(...batch);
  if (batch.length < page) break;
}

// Games where either team has no owner yet (GUID not mapped) are skipped and counted.
let skipped = 0;
const out = [];
for (const m of rows) {
  const a = m.t1?.owner?.name, b = m.t2?.owner?.name;
  if (!a || !b) { skipped++; continue; }
  out.push({
    start: m.season.start_year, week: m.week, playoff: m.is_playoff,
    a, aTeam: m.t1.name, b, bTeam: m.t2.name,
    ac: Number(m.team1_cats_won), bc: Number(m.team2_cats_won),
    as: m.team1_stats ?? null, bs: m.team2_stats ?? null,
  });
}
out.sort((x, y) => x.start - y.start || x.week - y.week);
writeFileSync(new URL("../src/matchups.json", import.meta.url), JSON.stringify(out));
console.log(`export_matchups: wrote ${out.length} games${skipped ? `, skipped ${skipped} with no owner` : ""}`);
