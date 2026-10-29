import { SEASONS as SHEET } from "./data.js";
import HISTORY from "./history.json";
import { loadLeague } from "./league.js";

// ---------- formatting ----------
export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
export const fmtPct = (v) => (Number.isFinite(v) ? v.toFixed(2) + "%" : "-");
export const fmtInt = (n) => n.toLocaleString("en-US");
export const ordinal = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n + "th");

// Win % with or without ties counted as games played.
// The sheet's Record Book leaves ties out; its Totals tab includes them.
export const winPct = (w, l, t, countTies) => {
  const games = w + l + (countTies ? t : 0);
  return games ? (w / games) * 100 : NaN;
};

// ---------- data ----------
// Finished seasons from Yahoo are baked into the build (src/history.json). 2004-05 predates the
// league's Yahoo history, so it comes from the commissioner's sheet. The current season is added
// live by loadLiveSeason(). These are live bindings: setData() rebuilds them and the App re-renders.
const BAKED = [...SHEET.filter((s) => s.start < 2005), ...HISTORY.seasons];
let sorted = [];
export let SEASON_LIST = [];
export let CURRENT = null;
export let TEAM_SEASONS = [];
export let OWNER_NAMES = [];
export let DRAFT = [];
// Finished seasons only: a season in progress would top the best-season lists on a few weeks of games.
let FINISHED = [];
function setData(seasons, draft) {
  sorted = [...seasons].sort((a, b) => a.start - b.start);
  SEASON_LIST = sorted;
  CURRENT = sorted[sorted.length - 1];
  TEAM_SEASONS = sorted.flatMap((s) =>
    s.teams.map((t) => ({ ...t, season: s.label, start: s.start, end: s.end, current: !!s.current }))
  );
  FINISHED = TEAM_SEASONS.filter((t) => !t.current);
  OWNER_NAMES = [...new Set(TEAM_SEASONS.map((t) => t.owner))].sort((a, b) => a.localeCompare(b));
  const label = new Map(sorted.map((s) => [s.start, s.label]));
  DRAFT = draft.map((d) => ({ ...d, season: label.get(d.start) }));
}
setData(BAKED, HISTORY.draft);

// Add the current season's teams and draft. Resolves to true if anything was added; if Supabase
// can't be reached the pages keep showing the finished seasons.
export async function loadLiveSeason() {
  const live = await loadLeague({ current: true });
  const seasons = live.seasons.filter((s) => !BAKED.some((b) => b.start === s.start)); // baked wins
  if (!seasons.length) return false;
  const starts = new Set(seasons.map((s) => s.start));
  setData([...BAKED, ...seasons], [...HISTORY.draft, ...live.draft.filter((d) => starts.has(d.start))]);
  return true;
}

// ---------- owners ----------
export function buildOwners(countTies) {
  const map = new Map();
  for (const t of TEAM_SEASONS) {
    if (!map.has(t.owner)) map.set(t.owner, []);
    map.get(t.owner).push(t);
  }
  return [...map.entries()].map(([name, rows]) => {
    const w = sum(rows, "w"), l = sum(rows, "l"), t = sum(rows, "t");
    const count = (key, n) => rows.filter((r) => r[key] === n).length;
    const placed = (key) => rows.filter((r) => r[key] && r[key] <= 3).length;
    return {
      name,
      slug: slug(name),
      rows,
      seasons: rows.length,
      w, l, t,
      pct: winPct(w, l, t, countTies),
      // Averages leave out a season in progress.
      avgW: avg(rows, "w"),
      avgL: avg(rows, "l"),
      titles: count("tourney", 1),
      runnerUps: count("tourney", 2),
      thirds: count("tourney", 3),
      regTitles: count("reg", 1),
      regRunnerUps: count("reg", 2),
      regThirds: count("reg", 3),
      placedTourney: placed("tourney"),
      placedReg: placed("reg"),
      first: rows[0].season,
      last: rows[rows.length - 1].season,
    };
  });
}
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const avg = (rows, k) => {
  const done = rows.filter((r) => !r.current);
  return done.length ? sum(done, k) / done.length : 0;
};

// ---------- banners ----------
export function buildBanners() {
  return sorted.filter((s) => !s.current).reverse().map((s) => {
    const by = (key, n) => s.teams.find((t) => t[key] === n);
    const champ = by("tourney", 1);
    const reg = by("reg", 1);
    return {
      season: s,
      champ,
      runnerUp: by("tourney", 2),
      third: by("tourney", 3),
      regChamp: reg,
      sweep: !!(champ && reg && champ.owner === reg.owner),
    };
  });
}

// ---------- records ----------
export function bestSeasons(countTies, key, n = 5) {
  const rows = FINISHED.map((t) => ({ ...t, pct: winPct(t.w, t.l, t.t, countTies) }));
  rows.sort((a, b) => (key === "pct" ? b.pct - a.pct : b.w - a.w));
  return rows.slice(0, n);
}

// Longest run of back-to-back seasons finishing in the top three.
export function streaks(key) {
  const out = [];
  for (const name of OWNER_NAMES) {
    let best = null, run = null;
    for (const s of sorted) {
      const t = s.teams.find((x) => x.owner === name);
      const hit = t && t[key] && t[key] <= 3;
      if (hit) {
        run = run && run.lastStart === s.start - 1
          ? { ...run, len: run.len + 1, to: s.label, lastStart: s.start }
          : { len: 1, from: s.label, to: s.label, lastStart: s.start };
        if (!best || run.len > best.len) best = { ...run };
      } else run = null;
    }
    if (best && best.len >= 2) out.push({ owner: name, ...best });
  }
  return out.sort((a, b) => b.len - a.len || a.owner.localeCompare(b.owner));
}

export function sweeps() {
  return buildBanners().filter((b) => b.sweep).map((b) => ({ owner: b.champ.owner, season: b.season.label }));
}

export function repeatChamps(key) {
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].teams.find((t) => t[key] === 1);
    const b = sorted[i].teams.find((t) => t[key] === 1);
    if (a && b && a.owner === b.owner) out.push({ owner: a.owner, span: `${sorted[i - 1].label} and ${sorted[i].label}` });
  }
  return out;
}
