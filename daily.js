// Daily-challenge state in localStorage: one shared word per day (per language),
// a streak, and a "played today" guard. No server — the word itself is chosen
// deterministically from the date by engine.dailyWord().

const KEY = "wordo_daily_v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function save(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
}
let store = load();

export function todayKey(dt = new Date()) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

/** Today's daily state for a language: played?, result, current streak. */
export function getDaily(lang) {
  const s = store[lang] || {};
  const today = todayKey();
  const played = s.playedDate === today;
  let streak = 0;
  if (s.streakDate === today || s.streakDate === yesterdayKey()) streak = s.streak || 0;
  return { date: today, played, result: played ? s.lastResult : null, streak };
}

/** Record today's result and update the streak. Returns the fresh daily state. */
export function recordDaily(lang, status, guesses) {
  const today = todayKey();
  const s = (store[lang] = store[lang] || {});
  s.playedDate = today;
  s.lastResult = { status, guesses, date: today };
  if (status === "won") {
    if (s.streakDate === yesterdayKey()) s.streak = (s.streak || 0) + 1;
    else if (s.streakDate !== today) s.streak = 1;
    s.streakDate = today;
  } else {
    s.streak = 0; // giving up breaks the streak
  }
  save(store);
  return getDaily(lang);
}
