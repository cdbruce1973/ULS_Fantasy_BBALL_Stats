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
export let LAST_FINISHED = null; // label of the newest completed season
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
  LAST_FINISHED = [...sorted].reverse().find((s) => !s.current)?.label ?? null;
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
  // Every career number counts completed seasons only (Craig, 2026-10-30), so all-time stats change once a
  // year. rows still holds the season in progress for the owner's season-by-season table.
  return [...map.entries()].map(([name, rows]) => {
    const done = rows.filter((r) => !r.current);
    const w = sum(done, "w"), l = sum(done, "l"), t = sum(done, "t");
    const count = (key, n) => done.filter((r) => r[key] === n).length;
    const placed = (key) => done.filter((r) => r[key] && r[key] <= 3).length;
    return {
      name,
      slug: slug(name),
      rows,
      seasons: done.length,
      w, l, t,
      pct: winPct(w, l, t, countTies),
      avgW: done.length ? w / done.length : 0,
      avgL: done.length ? l / done.length : 0,
      titles: count("tourney", 1),
      runnerUps: count("tourney", 2),
      thirds: count("tourney", 3),
      regTitles: count("reg", 1),
      regRunnerUps: count("reg", 2),
      regThirds: count("reg", 3),
      placedTourney: placed("tourney"),
      placedReg: placed("reg"),
      first: rows[0].season,
      last: (done[done.length - 1] ?? rows[0]).season,
      inProgress: rows.find((r) => r.current)?.season ?? null,
    };
  });
}
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);

// Draft slot by owner: where each owner picked in round 1 (a snake draft keeps that slot all draft).
export function draftSlots(minDrafts = 10) {
  const map = new Map();
  for (const d of DRAFT) {
    if (d.round !== 1) continue;
    if (!map.has(d.owner)) map.set(d.owner, []);
    map.get(d.owner).push(d);
  }
  return [...map.entries()]
    .map(([owner, picks]) => {
      const slots = picks.map((p) => p.pick);
      return {
        owner,
        drafts: picks.length,
        avg: slots.reduce((a, n) => a + n, 0) / picks.length,
        firsts: slots.filter((n) => n === 1).length,
        best: Math.min(...slots),
        worst: Math.max(...slots),
      };
    })
    .filter((r) => r.drafts >= minDrafts);
}

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

// "Did you know" facts for one player across every draft.
export function playerFacts(player) {
  const picks = DRAFT.filter((d) => d.player === player);
  if (!picks.length) return null;
  const by = new Map();
  for (const d of picks) by.set(d.owner, (by.get(d.owner) || 0) + 1);
  const most = Math.max(...by.values());
  const best = Math.min(...picks.map((d) => d.pick));
  const atBest = picks.filter((d) => d.pick === best).sort((a, b) => a.start - b.start);
  const earliest = { ...atBest[0], times: atBest.length };
  const starts = picks.map((d) => d.start);
  return {
    player,
    times: picks.length,
    owners: by.size,
    most,
    topOwners: [...by].filter(([, n]) => n === most).map(([o]) => o).sort((a, b) => a.localeCompare(b)),
    earliest,
    avgPick: picks.reduce((a, d) => a + d.pick, 0) / picks.length,
    first: picks.find((d) => d.start === Math.min(...starts)).season,
    last: picks.find((d) => d.start === Math.max(...starts)).season,
  };
}

// ---------- draft position vs finish ----------
// The league plays a six-team playoff: seeds 1-6 make it, and final ranks 1-6 are always those six teams.
export const PLAYOFF_TEAMS = 6;
const avg = (xs) => (xs.length ? xs.reduce((a, n) => a + n, 0) / xs.length : NaN);

// Every completed season's first-round slot (a snake draft keeps it all draft) paired with how that
// team finished. rank = tournament finish (Yahoo final_rank), seed = regular-season finish.
export function draftFinishes() {
  const done = new Map(sorted.filter((s) => !s.current).map((s) => [s.start, s]));
  const out = [];
  for (const d of DRAFT) {
    if (d.round !== 1) continue;
    const s = done.get(d.start);
    const t = s && (s.teams.find((x) => x.owner === d.owner && x.team === d.team) ?? s.teams.find((x) => x.owner === d.owner));
    if (!t || !t.rank) continue;
    out.push({ start: d.start, season: d.season, slot: d.pick, owner: d.owner, team: t.team, player: d.player, rank: t.rank, seed: t.seed });
  }
  return out;
}

// How each draft slot finished. key = "rank" (tournament) or "seed" (regular season).
export function draftImpact(key) {
  const rows = draftFinishes();
  const slots = [...new Set(rows.map((r) => r.slot))].sort((a, b) => a - b);
  const sum = (list) => ({
    n: list.length,
    avg: avg(list.map((r) => r[key])),
    firsts: list.filter((r) => r[key] === 1).length,
    top3: list.filter((r) => r[key] <= 3).length,
    playoffs: list.filter((r) => r.seed <= PLAYOFF_TEAMS).length,
    best: Math.min(...list.map((r) => r[key])),
    worst: Math.max(...list.map((r) => r[key])),
  });
  const bySlot = slots.map((slot) => {
    const list = rows.filter((r) => r.slot === slot);
    return { slot, ...sum(list), winners: list.filter((r) => r[key] === 1) };
  });
  const third = Math.ceil(slots.length / 3);
  const groups = [0, 1, 2].map((i) => {
    const part = slots.slice(i * third, (i + 1) * third);
    const list = rows.filter((r) => part.includes(r.slot));
    return { label: `Picks ${part[0]}-${part[part.length - 1]}`, ...sum(list) };
  });
  // Least-squares slope of finish on slot: places lost (or gained) per slot later in the draft.
  const mx = avg(rows.map((r) => r.slot)), my = avg(rows.map((r) => r[key]));
  const cov = rows.reduce((a, r) => a + (r.slot - mx) * (r[key] - my), 0);
  const vx = rows.reduce((a, r) => a + (r.slot - mx) ** 2, 0);
  const slope = vx ? cov / vx : 0;
  const gain = (r) => r.slot - r[key];
  const climbs = [...rows].sort((a, b) => gain(b) - gain(a) || a[key] - b[key] || b.start - a.start).slice(0, 5);
  const falls = [...rows].sort((a, b) => gain(a) - gain(b) || b[key] - a[key] || b.start - a.start).slice(0, 5);
  // Owners who finish better (or worse) than where they draft, with 10 or more drafts.
  const byOwner = new Map();
  for (const r of rows) byOwner.set(r.owner, [...(byOwner.get(r.owner) || []), r]);
  const owners = [...byOwner]
    .filter(([, list]) => list.length >= 10)
    .map(([owner, list]) => ({ owner, drafts: list.length, slot: avg(list.map((r) => r.slot)), finish: avg(list.map((r) => r[key])), gain: avg(list.map(gain)) }));
  return { rows, drafts: new Set(rows.map((r) => r.start)).size, bySlot, groups, slope, spread: slope * (slots.length - 1), climbs, falls, owners };
}

// ---------- one season's record book (standings and draft; the weekly games are in h2h.js) ----------
export function seasonFacts(start, countTies) {
  const i = sorted.findIndex((s) => s.start === start);
  const s = sorted[i];
  if (!s) return null;
  const rows = s.teams.map((t) => ({ ...t, pct: winPct(t.w, t.l, t.t, countTies) }));
  const byPct = [...rows].sort((a, b) => b.pct - a.pct || b.w - a.w);
  const champ = rows.find((t) => t.tourney === 1);
  const regChamp = rows.find((t) => t.reg === 1);
  const draft = DRAFT.filter((d) => d.start === start);
  const firstPick = draft.find((d) => d.pick === 1) ?? null;
  const teamOf = (d) => d && rows.find((t) => t.owner === d.owner && t.team === d.team);
  const slotOf = (t) => t && draft.find((d) => d.round === 1 && d.owner === t.owner && d.team === t.team);
  // Biggest change in tournament finish from the season before, by owner (needs full finishes both years).
  const prev = sorted[i - 1];
  const moves = !prev || s.current ? [] : rows
    .map((t) => ({ t, before: prev.teams.find((p) => p.owner === t.owner) }))
    .filter(({ t, before }) => t.rank && before?.rank)
    .map(({ t, before }) => ({ ...t, before: before.rank, change: before.rank - t.rank }));
  moves.sort((a, b) => b.change - a.change);
  return {
    season: s,
    best: byPct[0],
    worst: byPct[byPct.length - 1],
    champ,
    // 2019-20 (COVID) has no seeds; its stand-in seeds are the final ranks, so a "seed" there means nothing.
    champSeed: rows.every((t) => t.seed === t.rank) ? null : champ?.seed ?? null,
    champSlot: slotOf(champ) ?? null,
    regChamp,
    regChampFinish: regChamp?.rank ?? null,
    firstPick: firstPick && { ...firstPick, finish: teamOf(firstPick) },
    riser: moves[0] && moves[0].change > 0 ? moves[0] : null,
    faller: moves.length && moves[moves.length - 1].change < 0 ? moves[moves.length - 1] : null,
    newOwners: prev ? rows.filter((t) => !sorted.slice(0, i).some((p) => p.teams.some((x) => x.owner === t.owner))) : [],
  };
}
