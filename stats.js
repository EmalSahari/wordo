// Persistent player stats + achievements, stored in localStorage (survives visits).

const KEY = "wordo_stats_v1";

const ACHIEVEMENTS = [
  { id: "first_win", icon: "🎉", name: "First solve", test: (g, a) => a.solved >= 1 },
  { id: "sharp_10", icon: "🎯", name: "Solved in 10 or fewer", test: (g) => g.result === "won" && g.guesses <= 10 },
  { id: "sharp_5", icon: "🔥", name: "Sharp — 5 or fewer", test: (g) => g.result === "won" && g.guesses <= 5 },
  { id: "no_hint", icon: "🧠", name: "Solved without a hint", test: (g) => g.result === "won" && !g.hints },
  { id: "streak_3", icon: "⚡", name: "3 wins in a row", test: (g, a) => a.winStreak >= 3 },
  { id: "games_25", icon: "🏅", name: "Played 25 games", test: (g, a) => a.played >= 25 },
];

function fresh() {
  return { games: [], achievements: {}, winStreak: 0, bestStreak: 0 };
}

let data = load();
function load() {
  try {
    return Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY)) || {});
  } catch {
    return fresh();
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

export function aggregate() {
  const games = data.games;
  const wins = games.filter((g) => g.result === "won");
  const vals = wins.map((g) => g.guesses);
  return {
    played: games.length,
    solved: wins.length,
    gaveUp: games.length - wins.length,
    avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    best: vals.length ? Math.min(...vals) : null,
    winStreak: data.winStreak,
    bestStreak: data.bestStreak,
    recent: games.slice(-12),
  };
}

/** Record a finished game. Returns { agg, newlyEarned: [achievement...] }. */
export function recordGame(g) {
  data.games.push({ result: g.result, guesses: g.guesses, hints: g.hints || 0 });
  if (data.games.length > 500) data.games = data.games.slice(-500);
  if (g.result === "won") {
    data.winStreak += 1;
    data.bestStreak = Math.max(data.bestStreak, data.winStreak);
  } else {
    data.winStreak = 0;
  }
  const agg = aggregate();
  const newlyEarned = [];
  for (const ach of ACHIEVEMENTS) {
    if (!data.achievements[ach.id] && ach.test(g, agg)) {
      data.achievements[ach.id] = true;
      newlyEarned.push(ach);
    }
  }
  save();
  return { agg, newlyEarned };
}

export function achievements() {
  return ACHIEVEMENTS.map((a) => ({ id: a.id, icon: a.icon, name: a.name, earned: !!data.achievements[a.id] }));
}
