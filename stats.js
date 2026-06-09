// Persistent player stats, achievements, and rank/level — stored in localStorage.

const KEY = "wordo_stats_v1";

// Achievements. test(g, s): g = the game just finished (result, guesses, hints,
// lang, difficulty, sessionCount); s = derived stats over all games.
const ACHIEVEMENTS = [
  { id: "first_win", icon: "🎉", name: "First solve", desc: "Win your first game", test: (g, s) => s.solved >= 1 },
  { id: "wins_5", icon: "🌟", name: "Getting good", desc: "Solve 5 games", test: (g, s) => s.solved >= 5 },
  { id: "wins_25", icon: "⭐", name: "Wordsmith", desc: "Solve 25 games", test: (g, s) => s.solved >= 25 },
  { id: "wins_50", icon: "💫", name: "Veteran", desc: "Solve 50 games", test: (g, s) => s.solved >= 50 },
  { id: "wins_100", icon: "👑", name: "Word master", desc: "Solve 100 games", test: (g, s) => s.solved >= 100 },
  { id: "sharp_20", icon: "🎯", name: "On target", desc: "Solve in 20 guesses or fewer", test: (g) => g.result === "won" && g.guesses <= 20 },
  { id: "sharp_10", icon: "🔥", name: "Sharp", desc: "Solve in 10 or fewer", test: (g) => g.result === "won" && g.guesses <= 10 },
  { id: "sharp_5", icon: "⚡", name: "Razor sharp", desc: "Solve in 5 or fewer", test: (g) => g.result === "won" && g.guesses <= 5 },
  { id: "sharp_3", icon: "🧨", name: "Genius", desc: "Solve in 3 or fewer", test: (g) => g.result === "won" && g.guesses <= 3 },
  { id: "one_shot", icon: "🎰", name: "Hole in one", desc: "Solve on the very first guess", test: (g) => g.result === "won" && g.guesses === 1 },
  { id: "no_hint", icon: "🧠", name: "No help needed", desc: "Win without using a hint", test: (g) => g.result === "won" && !g.hints },
  { id: "no_hint_10", icon: "🦉", name: "Self-made", desc: "Win 10 games without hints", test: (g, s) => s.noHintWins >= 10 },
  { id: "streak_3", icon: "🔗", name: "On a roll", desc: "Win 3 games in a row", test: (g, s) => s.winStreak >= 3 },
  { id: "streak_5", icon: "💪", name: "Unstoppable", desc: "Win 5 in a row", test: (g, s) => s.winStreak >= 5 },
  { id: "streak_10", icon: "🏆", name: "Relentless", desc: "Win 10 in a row", test: (g, s) => s.winStreak >= 10 },
  { id: "games_10", icon: "🎮", name: "Warming up", desc: "Play 10 games", test: (g, s) => s.played >= 10 },
  { id: "games_50", icon: "🕹️", name: "Dedicated", desc: "Play 50 games", test: (g, s) => s.played >= 50 },
  { id: "games_100", icon: "🏅", name: "Centurion", desc: "Play 100 games", test: (g, s) => s.played >= 100 },
  { id: "win_medium", icon: "🟠", name: "Stepping up", desc: "Win on Medium difficulty", test: (g) => g.result === "won" && g.difficulty === "medium" },
  { id: "win_hard", icon: "🔴", name: "Brave", desc: "Win on Hard difficulty", test: (g) => g.result === "won" && g.difficulty === "hard" },
  { id: "hard_sharp", icon: "💎", name: "Hardcore", desc: "Win on Hard in 15 or fewer", test: (g) => g.result === "won" && g.difficulty === "hard" && g.guesses <= 15 },
  { id: "lang_da", icon: "🇩🇰", name: "Dansk", desc: "Solve a Danish word", test: (g) => g.result === "won" && g.lang === "da" },
  { id: "lang_en", icon: "🇬🇧", name: "English", desc: "Solve an English word", test: (g) => g.result === "won" && g.lang === "en" },
  { id: "bilingual", icon: "🌍", name: "Bilingual", desc: "Solve a word in both languages", test: (g, s) => s.langsWon.has("da") && s.langsWon.has("en") },
  { id: "comeback", icon: "🔄", name: "Comeback", desc: "Win right after giving up", test: (g, s) => g.result === "won" && s.prevResult === "gaveup" },
  { id: "marathon", icon: "🏃", name: "Marathon", desc: "Play 5 games in one sitting", test: (g) => (g.sessionCount || 0) >= 5 },
  { id: "explorer", icon: "🧭", name: "Explorer", desc: "Try all three difficulties", test: (g, s) => s.difficultiesPlayed.size >= 3 },
];

const RANKS = [
  { min: 0, name: "Novice", color: "#8a93a6", icon: "🔰" },
  { min: 4, name: "Bronze", color: "#cd7f32", icon: "🥉" },
  { min: 9, name: "Silver", color: "#c5ccd6", icon: "🥈" },
  { min: 15, name: "Gold", color: "#f0c34a", icon: "🥇" },
  { min: 21, name: "Platinum", color: "#5fd0d6", icon: "💠" },
  { min: 27, name: "Diamond", color: "#7fb8ff", icon: "💎" },
];

export function rankFor(count) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (count >= RANKS[i].min) idx = i;
  const cur = RANKS[idx];
  const next = RANKS[idx + 1] || null;
  return {
    name: cur.name,
    color: cur.color,
    icon: cur.icon,
    count,
    next: next ? { name: next.name, needed: next.min - count, from: cur.min, to: next.min } : null,
  };
}

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

function computeStats() {
  const games = data.games;
  const wins = games.filter((g) => g.result === "won");
  return {
    played: games.length,
    solved: wins.length,
    gaveUp: games.length - wins.length,
    avg: wins.length ? wins.reduce((a, g) => a + g.guesses, 0) / wins.length : null,
    best: wins.length ? Math.min(...wins.map((g) => g.guesses)) : null,
    winStreak: data.winStreak,
    bestStreak: data.bestStreak,
    noHintWins: wins.filter((g) => !g.hints).length,
    langsWon: new Set(wins.map((g) => g.lang)),
    difficultiesPlayed: new Set(games.map((g) => g.difficulty)),
    prevResult: games.length >= 2 ? games[games.length - 2].result : null,
    recent: games.slice(-12),
  };
}

function earnedCount() {
  return Object.values(data.achievements).filter(Boolean).length;
}

export function aggregate() {
  const s = computeStats();
  const count = earnedCount();
  return { ...s, earnedCount: count, total: ACHIEVEMENTS.length, rank: rankFor(count) };
}

/** Record a finished game. Returns { agg, newlyEarned, rankUp }. */
export function recordGame(g) {
  data.games.push({ result: g.result, guesses: g.guesses, hints: g.hints || 0, lang: g.lang, difficulty: g.difficulty });
  if (data.games.length > 500) data.games = data.games.slice(-500);
  if (g.result === "won") {
    data.winStreak += 1;
    data.bestStreak = Math.max(data.bestStreak, data.winStreak);
  } else {
    data.winStreak = 0;
  }

  const s = computeStats();
  const before = earnedCount();
  const newlyEarned = [];
  for (const ach of ACHIEVEMENTS) {
    if (!data.achievements[ach.id] && ach.test(g, s)) {
      data.achievements[ach.id] = true;
      newlyEarned.push(ach);
    }
  }
  save();
  const after = earnedCount();
  const rankUp = rankFor(after).name !== rankFor(before).name ? rankFor(after) : null;
  return { agg: aggregate(), newlyEarned, rankUp };
}

export function achievements() {
  return ACHIEVEMENTS.map((a) => ({ id: a.id, icon: a.icon, name: a.name, desc: a.desc, earned: !!data.achievements[a.id] }));
}
