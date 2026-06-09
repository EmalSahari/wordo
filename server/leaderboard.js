// Daily leaderboard + streaks, persisted to data/leaderboard.json.
// Scores are kept per language per day; a player (identified by a client id from
// their browser) can record one score per daily word. Streaks count consecutive
// days solved, per language.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Where to persist the leaderboard. Point WORDO_LEADERBOARD at a persistent
// disk/volume in production so streaks survive restarts/redeploys.
const FILE = process.env.WORDO_LEADERBOARD || join(__dirname, "..", "data", "leaderboard.json");
const KEEP_DAYS = 21; // prune older daily boards

let store = { scores: {}, players: {} };

function load() {
  if (existsSync(FILE)) {
    try {
      store = JSON.parse(readFileSync(FILE, "utf8"));
    } catch {
      store = { scores: {}, players: {} };
    }
  }
  store.scores ||= {};
  store.players ||= {};
  store.gaveUp ||= {};
}
function save() {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(store));
  } catch (e) {
    console.error("[leaderboard] save failed:", e.message);
  }
}
load();

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prevKey(key) {
  const [y, m, dd] = key.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

function bucket(lang, date) {
  store.scores[lang] ||= {};
  store.scores[lang][date] ||= [];
  return store.scores[lang][date];
}

export function hasSolved(lang, date, clientId) {
  return clientId ? bucket(lang, date).some((e) => e.clientId === clientId) : false;
}

function gaveUpBucket(lang, date) {
  store.gaveUp[lang] ||= {};
  store.gaveUp[lang][date] ||= [];
  return store.gaveUp[lang][date];
}
export function hasGivenUp(lang, date, clientId) {
  return clientId ? gaveUpBucket(lang, date).includes(clientId) : false;
}
export function hasPlayed(lang, date, clientId) {
  return hasSolved(lang, date, clientId) || hasGivenUp(lang, date, clientId);
}

/** Giving up reveals the word and breaks the streak; no score is recorded. */
export function recordGiveUp(lang, date, clientId, name) {
  const b = gaveUpBucket(lang, date);
  if (!b.includes(clientId)) b.push(clientId);
  const p = (store.players[clientId] ||= { streaks: {} });
  p.name = name;
  const st = (p.streaks[lang] ||= { count: 0, lastDate: null });
  st.count = 0;
  st.lastDate = date;
  prune();
  save();
}

export function getResult(lang, date, clientId) {
  return bucket(lang, date).find((e) => e.clientId === clientId) || null;
}

/** Record a solve (first one per day per player counts). Returns the current streak. */
export function recordSolve(lang, date, clientId, name, guesses, ms) {
  const day = bucket(lang, date);
  if (day.some((e) => e.clientId === clientId)) {
    return { already: true, streak: getStreak(lang, clientId, date) };
  }
  day.push({ clientId, name, guesses, ms, ts: Date.now() });

  const p = (store.players[clientId] ||= { streaks: {} });
  p.name = name;
  const st = (p.streaks[lang] ||= { count: 0, lastDate: null });
  if (st.lastDate === prevKey(date)) st.count += 1;
  else if (st.lastDate !== date) st.count = 1;
  st.lastDate = date;

  prune();
  save();
  return { already: false, streak: st.count };
}

/** Current streak — only valid if the last solve was today or yesterday. */
export function getStreak(lang, clientId, date = todayKey()) {
  const st = store.players[clientId]?.streaks?.[lang];
  if (!st) return 0;
  if (st.lastDate === date || st.lastDate === prevKey(date)) return st.count;
  return 0;
}

/** Sorted board: fewest guesses, then fastest, then earliest submission. */
export function getBoard(lang, date, clientId, limit = 20) {
  const sorted = [...bucket(lang, date)].sort(
    (a, b) => a.guesses - b.guesses || a.ms - b.ms || a.ts - b.ts
  );
  const youIdx = sorted.findIndex((e) => e.clientId === clientId);
  return {
    date,
    lang,
    total: sorted.length,
    top: sorted.slice(0, limit).map((e, i) => ({
      rank: i + 1,
      name: e.name,
      guesses: e.guesses,
      you: e.clientId === clientId,
    })),
    you: youIdx >= 0 ? { rank: youIdx + 1, guesses: sorted[youIdx].guesses } : null,
  };
}

function prune() {
  for (const map of [store.scores, store.gaveUp]) {
    for (const lang of Object.keys(map)) {
      const dates = Object.keys(map[lang]).sort();
      while (dates.length > KEEP_DAYS) delete map[lang][dates.shift()];
    }
  }
}
