// Wordo — singleplayer, fully client-side. Scoring runs in the browser (engine.js);
// no server, no network calls during play.

import * as eng from "./engine.js";
import * as sfx from "./sound.js";

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("en-US");

const LANGUAGES = ["da", "en"];
const LANG_META = {
  da: { flag: "🇩🇰", name: "Danish" },
  en: { flag: "🇬🇧", name: "English" },
};

let lang = null;
let secret = null;
let guesses = [];
let roundEnded = false;
let round = 0;
let hintsUsed = 0;
let maxRank = 25000;
let rowEls = new Map();
let selectedLang = null;
let sessionGames = []; // { result: 'won'|'gaveup', guesses }

// ---- Language picker (required choice) -----------------------------------
const langBox = $("lang-options");
for (const code of LANGUAGES) {
  const meta = LANG_META[code] || { flag: "🌐", name: code };
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lang-btn";
  btn.dataset.lang = code;
  btn.innerHTML = `<span class="flag">${meta.flag}</span> ${meta.name}`;
  btn.addEventListener("click", () => {
    selectedLang = code;
    langBox.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b === btn));
    $("join-btn").disabled = false;
  });
  langBox.appendChild(btn);
}

// ---- Start a game --------------------------------------------------------
$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("join-error").textContent = "";
  if (!selectedLang) {
    $("join-error").textContent = "Pick a language first.";
    return;
  }
  sfx.prime();
  const btn = $("join-btn");
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    await eng.loadLanguage(selectedLang);
  } catch {
    $("join-error").textContent = "Could not load the word data. Try again.";
    btn.disabled = false;
    btn.textContent = "Play";
    return;
  }
  lang = selectedLang;
  maxRank = eng.maxRank(lang);
  round = 0;
  $("join").classList.add("hidden");
  $("game").classList.remove("hidden");
  renderStats();
  newRound();
});

$("sound-btn").textContent = sfx.soundEnabled() ? "🔊" : "🔇";
$("sound-btn").addEventListener("click", () => {
  const on = !sfx.soundEnabled();
  sfx.setSoundEnabled(on);
  $("sound-btn").textContent = on ? "🔊" : "🔇";
  if (on) sfx.playClick();
});

$("leave-btn").addEventListener("click", () => location.reload());

// ---- Round lifecycle -----------------------------------------------------
function newRound() {
  secret = eng.randomSecret(lang);
  guesses = [];
  roundEnded = false;
  hintsUsed = 0;
  rowEls = new Map();
  round += 1;
  $("round-num").textContent = round;
  $("guesses").innerHTML = "";
  $("history-list").innerHTML = `<li class="history-empty">No guesses yet</li>`;
  $("win-banner").classList.add("hidden");
  $("new-round").classList.add("hidden");
  $("guess-msg").textContent = "";
  $("guess-form").classList.remove("hidden");
  $("giveup-btn").classList.remove("hidden");
  $("guess").disabled = false;
  $("guess").value = "";
  updateCounts();
  updateHintBtn();
  $("guess").focus();
}

$("new-round").addEventListener("click", newRound);

// ---- Guessing ------------------------------------------------------------
$("guess-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (roundEnded) return;
  const word = $("guess").value.trim();
  if (!word) return;
  sfx.prime();
  $("guess").value = "";
  $("guess").focus();
  submitGuess(word);
});

function submitGuess(word, isHint = false) {
  const g = eng.scoreGuess(lang, secret, word);
  const msgEl = $("guess-msg");
  msgEl.classList.remove("bad");

  if (g.status === "unknown") {
    msgEl.textContent = `"${g.word}" isn't in the word list.`;
    msgEl.classList.add("bad");
    sfx.playError();
    return;
  }
  if (guesses.some((x) => x.word === g.word)) {
    msgEl.textContent = `You already guessed "${g.word}".`;
    return;
  }

  msgEl.textContent = "";
  g.hint = isHint;
  guesses.push(g);
  if (isHint) hintsUsed += 1;

  renderGuesses(g);
  renderHistory(g.word);
  updateCounts();
  updateHintBtn();

  if (isHint) sfx.playHint();
  else if (g.rank === 1) sfx.playWin();
  else sfx.playGuess(g.rank, maxRank);

  if (g.rank === 1) {
    roundEnded = true;
    showWin(g.word, guesses.length);
  } else {
    showToast(g);
  }
}

// ---- Hint (one per round, your choice when) ------------------------------
$("hint-btn").addEventListener("click", () => {
  if (roundEnded || hintsUsed > 0) return;
  const word = eng.hintWord(lang, secret, guesses.map((x) => x.word));
  if (!word) return;
  submitGuess(word, true);
});

function updateHintBtn() {
  const btn = $("hint-btn");
  btn.classList.toggle("hidden", roundEnded || hintsUsed > 0);
  btn.disabled = false;
  btn.textContent = "💡 Get a hint";
}

// ---- Give up -------------------------------------------------------------
$("giveup-btn").addEventListener("click", async () => {
  if (roundEnded) return;
  if (!(await confirmModal("Give up and reveal the word?", "Give up", true))) return;
  roundEnded = true;
  sfx.playReveal();
  $("guess-form").classList.add("hidden");
  $("hint-btn").classList.add("hidden");
  $("giveup-btn").classList.add("hidden");
  const banner = $("win-banner");
  banner.className = "banner lose";
  banner.textContent = `You gave up. The word was "${secret}".`;
  banner.classList.remove("hidden");
  $("new-round").classList.remove("hidden");
  sessionGames.push({ result: "gaveup", guesses: guesses.length });
  renderStats();
});

function showWin(word, count) {
  const banner = $("win-banner");
  banner.className = "banner win";
  banner.textContent = `You guessed "${word}" in ${count} guesses! 🎉`;
  banner.classList.remove("hidden");
  $("guess-form").classList.add("hidden");
  $("hint-btn").classList.add("hidden");
  $("giveup-btn").classList.add("hidden");
  $("new-round").classList.remove("hidden");
  sessionGames.push({ result: "won", guesses: count });
  renderStats();
}

// ---- Session stats (right column) ----------------------------------------
function perfClass(g) {
  return g <= 15 ? "good" : g <= 40 ? "ok" : "far";
}
function renderStats() {
  const summary = $("stats-summary");
  const chart = $("stats-chart");
  const played = sessionGames.length;
  if (!played) {
    summary.innerHTML = `<div class="stats-empty">Finish a game to see your stats.</div>`;
    chart.innerHTML = "";
    return;
  }
  const wins = sessionGames.filter((g) => g.result === "won");
  const vals = wins.map((g) => g.guesses);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const best = vals.length ? Math.min(...vals) : null;

  summary.innerHTML = `
    <div class="stat"><span class="stat-val">${played}</span><span class="stat-lbl">Played</span></div>
    <div class="stat"><span class="stat-val">${wins.length}</span><span class="stat-lbl">Solved</span></div>
    <div class="stat"><span class="stat-val">${vals.length ? avg.toFixed(1) : "–"}</span><span class="stat-lbl">Avg guesses</span></div>
    <div class="stat"><span class="stat-val">${best ?? "–"}</span><span class="stat-lbl">Best</span></div>`;

  const recent = sessionGames.slice(-12);
  const maxG = Math.max(1, ...recent.filter((g) => g.result === "won").map((g) => g.guesses));
  chart.innerHTML = "";
  for (const g of recent) {
    const col = document.createElement("div");
    col.className = "chart-col";
    const bar = document.createElement("div");
    bar.className = "chart-bar " + (g.result === "won" ? perfClass(g.guesses) : "gaveup");
    bar.style.height = (g.result === "won" ? Math.max(8, (g.guesses / maxG) * 100) : 100) + "%";
    bar.title = g.result === "won" ? `${g.guesses} guesses` : "gave up";
    const num = document.createElement("div");
    num.className = "chart-num";
    num.textContent = g.result === "won" ? g.guesses : "✗";
    col.append(bar, num);
    chart.appendChild(col);
  }
}

function updateCounts() {
  $("guess-count").textContent = guesses.length;
  $("history-title").textContent = guesses.length ? `Your guesses (${guesses.length})` : "Your guesses";
}

// ---- Warmth colours ------------------------------------------------------
function warmth(rank) {
  return Math.min(1, Math.log(rank) / Math.log(maxRank));
}
function rankColor(rank) {
  const t = warmth(rank);
  return `hsl(${25 + t * 195}, ${70 - t * 35}%, ${58 - t * 18}%)`;
}
function rankEmoji(rank) {
  if (rank === 1) return "🎉";
  if (rank <= 50) return "🔥";
  if (rank <= 300) return "😅";
  if (rank <= 1000) return "🙂";
  if (rank <= 5000) return "😐";
  return "❄️";
}

// ---- Sorted list (with FLIP animation) -----------------------------------
function renderGuesses(newest) {
  const list = $("guesses");
  const sorted = [...guesses].sort((a, b) => a.rank - b.rank);

  const oldTops = new Map();
  for (const [w, el] of rowEls) oldTops.set(w, el.getBoundingClientRect().top);

  if (!rowEls.has(newest.word)) rowEls.set(newest.word, rowFor(newest));
  for (const [w, el] of rowEls) el.classList.toggle("is-new", w === newest.word);
  for (const g of sorted) list.appendChild(rowEls.get(g.word));

  for (const [w, el] of rowEls) {
    if (w === newest.word) continue;
    const dy = (oldTops.get(w) ?? 0) - el.getBoundingClientRect().top;
    if (!dy) continue;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "";
      el.style.transform = "";
    });
  }

  const row = rowEls.get(newest.word);
  row.classList.add("enter");
  const bar = row.querySelector(".bar");
  const target = bar.style.width;
  bar.style.width = "0%";
  requestAnimationFrame(() => {
    row.classList.remove("enter");
    bar.style.width = target;
  });
}

function rowFor(g) {
  const li = document.createElement("li");
  li.className = "guess-row" + (g.rank === 1 ? " solved" : "");
  const color = rankColor(g.rank);
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.style.background = color;
  bar.style.width = 100 - warmth(g.rank) * 100 + "%";
  const word = document.createElement("span");
  word.className = "word";
  word.textContent = (g.hint ? "💡 " : "") + g.word;
  const rank = document.createElement("span");
  rank.className = "rank";
  rank.style.color = color;
  rank.textContent = `${fmt(g.rank)} ${rankEmoji(g.rank)}`;
  li.append(bar, word, rank);
  return li;
}

// ---- Chronological history (left column) ---------------------------------
function renderHistory(newestWord) {
  const list = $("history-list");
  if (!guesses.length) {
    list.innerHTML = `<li class="history-empty">No guesses yet</li>`;
    return;
  }
  list.innerHTML = "";
  for (let i = guesses.length - 1; i >= 0; i--) {
    const g = guesses[i];
    const li = document.createElement("li");
    if (g.word === newestWord) li.className = "is-new";
    const color = rankColor(g.rank);
    const w = document.createElement("span");
    w.className = "hword";
    w.textContent = (g.hint ? "💡 " : "") + g.word;
    const r = document.createElement("span");
    r.className = "hrank";
    r.style.color = color;
    r.textContent = fmt(g.rank);
    li.append(w, r);
    list.appendChild(li);
  }
}

// ---- Toast (quick peek of the latest guess) ------------------------------
const toastEl = $("toast");
toastEl.addEventListener("animationend", () => toastEl.classList.add("hidden"));
function showToast(g) {
  const color = rankColor(g.rank);
  toastEl.innerHTML = "";
  const word = document.createElement("span");
  word.className = "t-word";
  word.textContent = (g.hint ? "💡 " : "") + g.word;
  const rank = document.createElement("span");
  rank.className = "t-rank";
  rank.style.color = color;
  rank.textContent = `${fmt(g.rank)} ${rankEmoji(g.rank)}`;
  toastEl.append(word, rank);
  toastEl.style.borderColor = color;
  toastEl.classList.remove("hidden", "show");
  void toastEl.offsetWidth;
  toastEl.classList.add("show");
}

// ---- Modal ---------------------------------------------------------------
function confirmModal(text, okLabel = "OK", danger = false) {
  return new Promise((resolve) => {
    const overlay = $("modal"), ok = $("modal-ok"), cancel = $("modal-cancel");
    $("modal-text").textContent = text;
    ok.textContent = okLabel;
    ok.className = "primary" + (danger ? " danger" : "");
    overlay.classList.remove("hidden");
    const done = (val) => {
      overlay.classList.add("hidden");
      ok.onclick = cancel.onclick = overlay.onclick = null;
      resolve(val);
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
  });
}
