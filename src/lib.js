import { SEASONS } from "./data.js";

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

// ---------- flatten ----------
const sorted = [...SEASONS].sort((a, b) => a.start - b.start);
export const SEASON_LIST = sorted;
export const CURRENT = sorted[sorted.length - 1];

export const TEAM_SEASONS = sorted.flatMap((s) =>
  s.teams.map((t) => ({ ...t, season: s.label, start: s.start, end: s.end }))
);
export const OWNER_NAMES = [...new Set(TEAM_SEASONS.map((t) => t.owner))].sort((a, b) =>
  a.localeCompare(b)
);

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
      avgW: w / rows.length,
      avgL: l / rows.length,
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

// ---------- banners ----------
export function buildBanners() {
  return [...sorted].reverse().map((s) => {
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
  const rows = TEAM_SEASONS.map((t) => ({ ...t, pct: winPct(t.w, t.l, t.t, countTies) }));
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
