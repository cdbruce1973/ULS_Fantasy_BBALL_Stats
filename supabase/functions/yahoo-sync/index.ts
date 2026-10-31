import { createClient } from "npm:@supabase/supabase-js@2";

// Pulls league data from the Yahoo Fantasy API into the database.
//   POST /yahoo-sync?season=2025            -> sync one season (Yahoo start year)
//   POST /yahoo-sync?current=1              -> sync the current season and the one before it
//   optional: &parts=teams,matchups,draft,players -> limit what is pulled (default: all four)
//   players (current season only): each rostered player's stats for recent days. By default the last
//   3 days (Yahoo corrects stats for a day or two); &from=YYYY-MM-DD&to=YYYY-MM-DD backfills a range (max 31 days).
// Guarded by a private key (header x-sync-key) stored in the sync_config table.

const API = "https://fantasysports.yahooapis.com/fantasy/v2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CLIENT_ID = Deno.env.get("YAHOO_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("YAHOO_CLIENT_SECRET") ?? "";
const REDIRECT = `${SUPABASE_URL}/functions/v1/yahoo-auth`;

const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const reply = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 1), { status: s, headers: { "Content-Type": "application/json" } });

async function accessToken(): Promise<string> {
  const { data: row } = await db.from("yahoo_tokens").select("*").eq("id", 1).maybeSingle();
  if (!row) throw new Error("Yahoo is not authorized yet");
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() - Date.now() > 120_000) {
    return row.access_token;
  }
  const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token, redirect_uri: REDIRECT }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) throw new Error(`Token refresh failed (${res.status}): ${tok.error_description ?? tok.error}`);
  await db.from("yahoo_tokens").upsert({
    id: 1,
    refresh_token: tok.refresh_token ?? row.refresh_token,
    access_token: tok.access_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  return tok.access_token;
}

async function yget(path: string, attempt = 0): Promise<any> {
  const token = await accessToken();
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}format=json`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return yget(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Yahoo's JSON uses arrays of single-key objects and numeric-keyed maps; these flatten them.
const flat = (arr: any): any =>
  Object.assign({}, ...(Array.isArray(arr) ? arr : [arr]).filter((x: any) => x && typeof x === "object" && !Array.isArray(x)));
const items = (obj: any): any[] =>
  Object.entries(obj ?? {}).filter(([k]) => k !== "count").map(([, v]) => v);
const int = (v: any) => (v === "" || v == null || isNaN(parseInt(v)) ? null : parseInt(v));

async function syncTeams(seasonId: number, key: string) {
  const d = await yget(`/league/${key}/standings`);
  const teams = items(d.fantasy_content.league[1].standings[0].teams);
  const rows = teams.map((t: any) => {
    const info = flat(t.team[0]);
    const rest = flat(t.team.slice(1));
    const st = rest.team_standings ?? {};
    const ot = st.outcome_totals ?? {};
    const mgr = info.managers?.[0]?.manager ?? {};
    return {
      season_id: seasonId,
      yahoo_team_key: info.team_key,
      name: info.name,
      manager_name: mgr.nickname ?? null,
      manager_guid: mgr.guid ?? null,
      final_rank: int(st.rank),
      playoff_seed: int(st.playoff_seed),
      wins: int(ot.wins) ?? 0,
      losses: int(ot.losses) ?? 0,
      ties: int(ot.ties) ?? 0,
    };
  });
  const { error } = await db.from("teams").upsert(rows, { onConflict: "yahoo_team_key" });
  if (error) throw new Error(`teams upsert: ${error.message}`);

  // Yahoo hides manager GUIDs ("--hidden--"), so owners are matched in two steps.
  // Teams that already have an owner keep it (the upsert above never touches owner_id).
  // 1) same team name as last season -> same owner (this is what tells the two "Brendan"s apart)
  const { data: season } = await db.from("seasons").select("start_year").eq("id", seasonId).single();
  const { data: prevSeason } = await db.from("seasons").select("id").eq("start_year", season.start_year - 1).maybeSingle();
  if (prevSeason) {
    const { data: prev } = await db.from("teams").select("name, owner_id").eq("season_id", prevSeason.id).not("owner_id", "is", null);
    for (const p of prev ?? []) {
      await db.from("teams").update({ owner_id: p.owner_id })
        .eq("season_id", seasonId).ilike("name", p.name.replace(/[\\%_]/g, "\\$&")).is("owner_id", null);
    }
  }
  // 2) fall back to nickname aliases, but only when the nickname is unique within the season.
  //    Anything still unmatched (a renamed team with a shared nickname) is left for a person to assign.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.manager_name, (counts.get(r.manager_name) ?? 0) + 1);
  const { data: aliases } = await db.from("owner_aliases").select("alias, owner_id");
  for (const a of aliases ?? []) {
    if ((counts.get(a.alias) ?? 0) !== 1) continue;
    await db.from("teams").update({ owner_id: a.owner_id })
      .eq("season_id", seasonId).eq("manager_name", a.alias).is("owner_id", null);
  }
  return rows.length;
}

async function syncMatchups(seasonId: number, key: string) {
  const d = await yget(`/league/${key}/settings`);
  const meta = d.fantasy_content.league[0];
  const settings = flat(d.fantasy_content.league[1]?.settings ?? []);
  const start = int(meta.start_week) ?? 1;
  const current = int(meta.current_week) ?? 999;
  const end = int(meta.end_week) ?? start;
  // League settings for the schedule and playoff odds. Ignored if the columns don't exist yet.
  await db.from("seasons").update({
    end_week: end,
    playoff_start_week: int(settings.playoff_start_week),
    num_playoff_teams: int(settings.num_playoff_teams),
  }).eq("id", seasonId);

  const { data: teamRows } = await db.from("teams").select("id, yahoo_team_key").eq("season_id", seasonId);
  const idByKey = new Map((teamRows ?? []).map((t: any) => [t.yahoo_team_key, t.id]));

  // Every week through the end of the season, so the schedule ahead is stored too (is_complete = false,
  // no stats). Future playoff weeks have no teams yet; Yahoo either skips them or errors, and both are skipped.
  const out: any[] = [];
  const weeks = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  for (let i = 0; i < weeks.length; i += 4) {
    const batch = await Promise.all(weeks.slice(i, i + 4).map((w) =>
      yget(`/league/${key}/scoreboard;week=${w}`).catch((e) => {
        if (w <= current) throw e;
        return null;
      })));
    for (const d of batch) {
      if (!d) continue;
      const sb = d.fantasy_content.league[1].scoreboard;
      const matchups = items((sb["0"] ?? sb).matchups);
      for (const m of matchups) {
        const mm = m.matchup;
        const teams = items((mm["0"] ?? mm).teams);
        if (teams.length !== 2) continue;
        const side = teams.map((t: any) => {
          const info = flat(t.team[0]);
          const rest = flat(t.team.slice(1));
          const stats: Record<string, string> = {};
          for (const s of rest.team_stats?.stats ?? []) stats[s.stat.stat_id] = s.stat.value;
          return { id: idByKey.get(info.team_key), won: parseFloat(rest.team_points?.total ?? "0") || 0, stats };
        });
        if (!side[0].id || !side[1].id) continue;
        const future = mm.status === "preevent";
        out.push({
          season_id: seasonId,
          week: int(mm.week),
          team1_id: side[0].id, team2_id: side[1].id,
          is_complete: mm.status === "postevent",
          is_playoff: mm.is_playoffs === "1",
          is_consolation: mm.is_consolation === "1",
          team1_cats_won: side[0].won, team2_cats_won: side[1].won,
          team1_stats: future ? null : side[0].stats, team2_stats: future ? null : side[1].stats,
        });
      }
    }
  }
  await db.from("matchups").delete().eq("season_id", seasonId);
  for (let i = 0; i < out.length; i += 200) {
    const { error } = await db.from("matchups").insert(out.slice(i, i + 200));
    if (error) throw new Error(`matchups insert: ${error.message}`);
  }
  return out.length;
}

// Yahoo dates games by US Eastern time.
const easternDate = (t: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(t);
const addDays = (iso: string, n: number) => {
  const t = new Date(iso + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

// Each rostered player's stats for each day, with the slot the manager played them in.
async function syncPlayers(seasonId: number, key: string, from?: string | null, to?: string | null) {
  const meta = (await yget(`/league/${key}`)).fantasy_content.league[0];
  const yesterday = addDays(easternDate(new Date()), -1);
  let last = to ?? yesterday;
  if (meta.end_date && last > meta.end_date) last = meta.end_date;
  let first = from ?? addDays(last, -2);
  if (meta.start_date && first < meta.start_date) first = meta.start_date;
  const dates: string[] = [];
  for (let d = first; d <= last && dates.length < 31; d = addDays(d, 1)) dates.push(d);
  if (!dates.length) return 0;

  const { data: teamRows } = await db.from("teams").select("id, yahoo_team_key").eq("season_id", seasonId);
  const jobs = dates.flatMap((date) => (teamRows ?? []).map((t: any) => ({ date, team: t })));
  let n = 0;
  for (let i = 0; i < jobs.length; i += 6) {
    const batch = await Promise.all(jobs.slice(i, i + 6).map(async ({ date, team }) => {
      const d = await yget(`/team/${team.yahoo_team_key}/roster;date=${date}/players/stats;type=date;date=${date}`);
      const roster = flat(d.fantasy_content.team.slice(1)).roster ?? {};
      const players = items((roster["0"] ?? roster).players);
      return players.map((p: any) => {
        const info = flat(p.player[0]);
        const rest = flat(p.player.slice(1));
        const stats: Record<string, string> = {};
        for (const s of rest.player_stats?.stats ?? []) stats[s.stat.stat_id] = s.stat.value;
        return {
          season_id: seasonId,
          game_date: date,
          player_key: info.player_key,
          team_id: team.id,
          name: info.name?.full ?? null,
          nba_team: info.editorial_team_abbr ?? null,
          positions: info.display_position ?? null,
          slot: flat(rest.selected_position ?? []).position ?? null,
          stats,
        };
      });
    }));
    const rows = batch.flat();
    if (!rows.length) continue;
    const { error } = await db.from("player_days").upsert(rows, { onConflict: "season_id,game_date,player_key" });
    if (error) throw new Error(`player_days upsert: ${error.message}`);
    n += rows.length;
  }
  return n;
}

async function syncDraft(seasonId: number, key: string) {
  const d = await yget(`/league/${key}/draftresults`);
  const results = items(d.fantasy_content.league[1].draft_results).map((r: any) => r.draft_result);
  if (!results.length) return 0;

  const { data: teamRows } = await db.from("teams").select("id, yahoo_team_key").eq("season_id", seasonId);
  const idByKey = new Map((teamRows ?? []).map((t: any) => [t.yahoo_team_key, t.id]));

  const names = new Map<string, { first: string; last: string }>();
  const pkeys = [...new Set(results.map((r: any) => r.player_key))] as string[];
  for (let i = 0; i < pkeys.length; i += 25) {
    const p = await yget(`/players;player_keys=${pkeys.slice(i, i + 25).join(",")}`);
    for (const pl of items(p.fantasy_content.players)) {
      const info = flat(pl.player[0]);
      names.set(info.player_key, { first: info.name?.first ?? "", last: info.name?.last ?? "" });
    }
  }
  const rows = results.map((r: any) => ({
    season_id: seasonId,
    pick: int(r.pick),
    round: int(r.round),
    team_id: idByKey.get(r.team_key) ?? null,
    yahoo_player_id: r.player_key,
    first_name: names.get(r.player_key)?.first ?? null,
    last_name: names.get(r.player_key)?.last ?? null,
    cost: r.cost != null ? parseFloat(r.cost) : null,
  }));
  const { error } = await db.from("draft_picks").upsert(rows, { onConflict: "season_id,pick" });
  if (error) throw new Error(`draft upsert: ${error.message}`);
  return rows.length;
}

async function syncSeason(startYear: number, parts: string[], range: { from: string | null; to: string | null }) {
  const { data: s } = await db.from("seasons").select("id, yahoo_league_key, is_current").eq("start_year", startYear).maybeSingle();
  if (!s?.yahoo_league_key) return { season: startYear, skipped: "no Yahoo league key" };
  const result: Record<string, unknown> = { season: startYear };
  for (const part of ["teams", "matchups", "draft", "players"]) {
    if (!parts.includes(part)) continue;
    // Daily player stats are kept for the season in progress only (unless a range is asked for).
    if (part === "players" && !s.is_current && !range.from) continue;
    try {
      result[part] = part === "teams" ? await syncTeams(s.id, s.yahoo_league_key)
        : part === "matchups" ? await syncMatchups(s.id, s.yahoo_league_key)
        : part === "draft" ? await syncDraft(s.id, s.yahoo_league_key)
        : await syncPlayers(s.id, s.yahoo_league_key, range.from, range.to);
    } catch (e) {
      result[part] = `ERROR: ${(e as Error).message}`;
    }
  }
  await db.from("seasons").update({ last_synced_at: new Date().toISOString() }).eq("id", s.id);
  return result;
}

Deno.serve(async (req) => {
  const { data: cfg } = await db.from("sync_config").select("value").eq("key", "sync_key").maybeSingle();
  if (!cfg || req.headers.get("x-sync-key") !== cfg.value) return reply({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const parts = (url.searchParams.get("parts") ?? "teams,matchups,draft,players").split(",");
  const range = { from: url.searchParams.get("from"), to: url.searchParams.get("to") };
  const started = new Date().toISOString();
  try {
    let years: number[] = [];
    if (url.searchParams.get("season")) {
      years = [parseInt(url.searchParams.get("season")!)];
    } else if (url.searchParams.get("current")) {
      const { data } = await db.from("seasons").select("start_year").eq("is_current", true).maybeSingle();
      if (data) years = [data.start_year, data.start_year - 1];
    } else {
      return reply({ error: "pass ?season=YYYY or ?current=1" }, 400);
    }
    const results = [];
    for (const y of years) results.push(await syncSeason(y, parts, range));
    await db.from("sync_log").insert({ started_at: started, finished_at: new Date().toISOString(), status: "ok", detail: JSON.stringify(results).slice(0, 2000) });
    return reply({ ok: true, results });
  } catch (e) {
    await db.from("sync_log").insert({ started_at: started, finished_at: new Date().toISOString(), status: "error", detail: (e as Error).message });
    return reply({ ok: false, error: (e as Error).message }, 500);
  }
});
