// Wordo client — talks to the server over WebSocket.

import * as sfx from "./sound.js";

const $ = (id) => document.getElementById(id);
const LANG_META = {
  da: { flag: "🇩🇰", name: "Danish" },
  en: { flag: "🇬🇧", name: "English" },
};
const fmt = (n) => n.toLocaleString("en-US");

let ws = null;
let me = null;          // { id, name }
let guesses = [];       // my guesses this round
let roundEnded = false;
let maxRank = 40000;    // vocab size; updated from the server on join
let rowEls = new Map(); // word -> <li> element, reused across re-sorts for FLIP
let selectedLang = null; // must be chosen explicitly before playing
let isDaily = false;

// Stable per-browser id (for the daily leaderboard) + remembered name.
let clientId = localStorage.getItem("wordo_cid");
if (!clientId) {
  clientId = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  localStorage.setItem("wordo_cid", clientId);
}

// ---- Language picker (required choice) -----------------------------------
function updatePlayEnabled() {
  $("join-btn").disabled = !selectedLang;
}

fetch("/api/languages")
  .then((r) => r.json())
  .then(({ languages }) => {
    const box = $("lang-options");
    box.innerHTML = "";
    for (const code of languages.length ? languages : ["da"]) {
      const meta = LANG_META[code] || { flag: "🌐", name: code };
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lang-btn";
      btn.dataset.lang = code;
      btn.innerHTML = `<span class="flag">${meta.flag}</span> ${meta.name}`;
      btn.addEventListener("click", () => {
        selectedLang = code;
        box.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b === btn));
        updatePlayEnabled();
      });
      box.appendChild(btn);
    }
  })
  .catch(() => {});

// ---- Mode tabs (solo / daily / multiplayer) -------------------------------
let mode = "solo";
const BTN_LABEL = { solo: "Start game", daily: "Play today's word", multi: "Play" };
for (const tab of document.querySelectorAll(".mode-tab")) {
  tab.addEventListener("click", () => {
    mode = tab.dataset.mode;
    document.querySelectorAll(".mode-tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("room-field").classList.toggle("hidden", mode !== "multi");
    $("join-btn").textContent = BTN_LABEL[mode] || "Play";
  });
}

// Remembered name
$("name").value = localStorage.getItem("wordo_name") || "";

// Sound toggle
$("sound-btn").textContent = sfx.soundEnabled() ? "🔊" : "🔇";
$("sound-btn").addEventListener("click", () => {
  const on = !sfx.soundEnabled();
  sfx.setSoundEnabled(on);
  $("sound-btn").textContent = on ? "🔊" : "🔇";
  if (on) sfx.playClick();
});

// Invite link: ?room=CODE pre-selects Friends mode and fills the code.
const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) {
  document.querySelector('.mode-tab[data-mode="multi"]').click();
  $("room").value = urlRoom.toUpperCase().slice(0, 4);
}

let roomCode = null;

// One hint per round, available whenever you want it.
let hintsUsed = 0;

function updateHintBtn() {
  const btn = $("hint-btn");
  if (roundEnded || hintsUsed > 0) {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
  btn.disabled = false;
  btn.textContent = "💡 Get a hint";
}

function updateCounts() {
  $("guess-count").textContent = guesses.length;
  $("history-title").textContent = guesses.length ? `Your guesses (${guesses.length})` : "Your guesses";
}

$("hint-btn").addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN && !$("hint-btn").disabled) {
    ws.send(JSON.stringify({ type: "hint" }));
  }
});

// In-app confirm modal (replaces the browser's native dialog).
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

$("giveup-btn").addEventListener("click", async () => {
  if (roundEnded || !ws || ws.readyState !== WebSocket.OPEN) return;
  const text = isDaily
    ? "Give up? This reveals the word and resets your streak."
    : "Give up and reveal the word?";
  if (!(await confirmModal(text, "Give up", true))) return;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "giveup" }));
});

// ---- Join ----------------------------------------------------------------
$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  $("join-error").textContent = "";
  if (!selectedLang) {
    $("join-error").textContent = "Pick a language first.";
    return;
  }
  sfx.prime(); // resume audio within the user gesture
  const name = $("name").value.trim();
  localStorage.setItem("wordo_name", name);
  const solo = mode === "solo";
  const daily = mode === "daily";
  const room = mode === "multi" ? $("room").value.trim().toUpperCase() : "";
  connect({ name, room, lang: selectedLang, solo, daily });
});

let lastJoin = null;
let intentionalClose = false;
let reconnectTries = 0;

function connect(params) {
  lastJoin = params;
  intentionalClose = false;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.addEventListener("open", () => {
    reconnectTries = 0;
    $("conn-bar").classList.add("hidden");
    ws.send(JSON.stringify({ type: "join", ...params, clientId }));
  });
  ws.addEventListener("message", (ev) => handle(JSON.parse(ev.data)));
  ws.addEventListener("close", () => {
    if (intentionalClose) return;
    if (!$("game").classList.contains("hidden")) handleDisconnect();
  });
  ws.addEventListener("error", () => {
    if ($("game").classList.contains("hidden")) {
      $("join-error").textContent = "Couldn't connect to the server.";
    }
  });
}

// Lost connection mid-game: show it, auto-reconnect a few times, then offer reload.
function handleDisconnect() {
  const bar = $("conn-bar");
  bar.classList.remove("hidden");
  if (reconnectTries < 5 && lastJoin) {
    reconnectTries += 1;
    bar.textContent = `Connection lost — reconnecting… (${reconnectTries}/5)`;
    setTimeout(() => connect(lastJoin), 1000);
  } else {
    bar.innerHTML = `Connection lost. <button type="button" class="ghost" id="reload-btn">Reload</button>`;
    $("reload-btn").addEventListener("click", () => location.reload());
  }
}

// ---- Message handling ----------------------------------------------------
function handle(msg) {
  switch (msg.type) {
    case "joined":
      me = msg.you;
      isDaily = !!msg.daily;
      roomCode = msg.room;
      if (msg.maxRank) maxRank = msg.maxRank;
      $("game").classList.toggle("solo", !!msg.solo);
      $("game").classList.toggle("daily", isDaily);
      document.querySelector(".daily-badge").classList.toggle("hidden", !isDaily);
      $("invite-btn").classList.toggle("hidden", !!msg.solo || isDaily); // multiplayer only
      startRound(msg);
      $("join").classList.add("hidden");
      $("game").classList.remove("hidden");
      $("room-code").textContent = msg.room;
      $("round-num").textContent = msg.round;
      renderScoreboard(msg.players);
      if (msg.solved && msg.winner) showWinner(msg.winner, null, false);
      $("guess").focus();
      break;

    case "leaderboard":
      renderLeaderboard(msg.board, msg.streak);
      break;

    case "dailyDone":
      showDailyDone(msg);
      break;

    case "revealed":
      showRevealed(msg);
      break;

    case "guessResult":
      handleGuessResult(msg.guess);
      break;

    case "players":
      $("round-num").textContent = msg.round;
      renderScoreboard(msg.players);
      break;

    case "feed":
      addFeed(msg.event);
      break;

    case "winner":
      showWinner(msg.winner, msg.word, false);
      break;

    case "newRound":
      if (msg.maxRank) maxRank = msg.maxRank;
      startRound(msg);
      $("round-num").textContent = msg.round;
      break;

    case "error":
      if ($("game").classList.contains("hidden")) {
        $("join-error").textContent = msg.message;
      } else {
        $("guess-msg").textContent = msg.message;
        $("guess-msg").classList.add("bad");
      }
      break;
  }
}

function startRound(msg) {
  guesses = [];
  roundEnded = false;
  hintsUsed = 0;
  rowEls = new Map();
  $("guesses").innerHTML = "";
  $("guesses").classList.remove("hidden");
  $("history").classList.remove("hidden");
  $("history-list").innerHTML = `<li class="history-empty">No guesses yet</li>`;
  $("guess-form").classList.remove("hidden");
  $("giveup-btn").classList.remove("hidden");
  updateCounts();
  updateHintBtn();
  $("leaderboard").classList.add("hidden");
  $("win-banner").classList.add("hidden");
  $("new-round").classList.add("hidden");
  $("guess-msg").textContent = "";
  $("guess").disabled = false;
  $("guess").focus();
}

// ---- Guessing ------------------------------------------------------------
$("guess-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (roundEnded) return; // already solved this round
  const word = $("guess").value.trim();
  if (!word || !ws || ws.readyState !== WebSocket.OPEN) return;
  sfx.prime(); // resume audio within the user gesture
  ws.send(JSON.stringify({ type: "guess", word }));
  $("guess").value = "";
  $("guess").focus();
});

function handleGuessResult(g) {
  const msgEl = $("guess-msg");
  msgEl.classList.remove("bad");
  if (g.status === "unknown") {
    msgEl.textContent = `"${g.word}" isn't in the word list.`;
    msgEl.classList.add("bad");
    sfx.playError();
    return;
  }
  if (g.repeat) {
    msgEl.textContent = `You already guessed "${g.word}".`;
    return;
  }
  msgEl.textContent = "";
  guesses.push(g);
  if (g.hint) hintsUsed += 1;
  renderGuesses(g);
  renderHistory(g.word);
  updateCounts();
  updateHintBtn();
  if (g.hint) sfx.playHint();
  else if (g.rank === 1) sfx.playWin();
  else sfx.playGuess(g.rank, maxRank);
  if (g.rank !== 1) showToast(g); // win gets the banner instead
  if (g.rank === 1) {
    roundEnded = true;
    showWinner({ name: me.name, guessCount: guesses.length }, g.word, true);
  }
}

// Warmth on a log scale: rank 1 is hot, the vocab tail is cold.
function warmth(rank) {
  return Math.min(1, Math.log(rank) / Math.log(maxRank)); // 0 hot .. 1 cold
}

// hot -> orange/red (25°), warm -> green (140°), cold -> muted blue (220°)
function rankColor(rank) {
  const t = warmth(rank);
  const h = 25 + t * 195;
  const light = 58 - t * 18;
  return `hsl(${h}, ${70 - t * 35}%, ${light}%)`;
}

function rankEmoji(rank) {
  if (rank === 1) return "🎉";
  if (rank <= 50) return "🔥";
  if (rank <= 300) return "😅";
  if (rank <= 1000) return "🙂";
  if (rank <= 5000) return "😐";
  return "❄️";
}

function renderGuesses(newest) {
  const list = $("guesses");
  const sorted = [...guesses].sort((a, b) => a.rank - b.rank);

  // FLIP: record where existing rows are before we reorder.
  const oldTops = new Map();
  for (const [word, el] of rowEls) oldTops.set(word, el.getBoundingClientRect().top);

  // Create the freshly played row (it's the only one not yet in the map).
  if (!rowEls.has(newest.word)) rowEls.set(newest.word, rowFor(newest));

  // Highlight only the newest row.
  for (const [word, el] of rowEls) el.classList.toggle("is-new", word === newest.word);

  // Reorder the DOM by rank (appendChild moves existing nodes).
  for (const g of sorted) list.appendChild(rowEls.get(g.word));

  // Animate existing rows from their old position to the new one.
  for (const [word, el] of rowEls) {
    if (word === newest.word) continue;
    const dy = (oldTops.get(word) ?? 0) - el.getBoundingClientRect().top;
    if (!dy) continue;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "";
      el.style.transform = "";
    });
  }

  // Entrance for the new row + grow its warmth bar from zero.
  const newRow = rowEls.get(newest.word);
  newRow.classList.add("enter");
  const bar = newRow.querySelector(".bar");
  const targetWidth = bar.style.width;
  bar.style.width = "0%";
  requestAnimationFrame(() => {
    newRow.classList.remove("enter");
    bar.style.width = targetWidth;
  });
}

// Chronological history (left column): guesses in the order played, newest first.
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

// Quick popup near the top showing the just-played guess + rank, then it fades.
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
  void toastEl.offsetWidth; // restart the animation
  toastEl.classList.add("show");
}

function rowFor(g) {
  const li = document.createElement("li");
  li.className = "guess-row" + (g.rank === 1 ? " solved" : "");
  const color = rankColor(g.rank);
  const pct = 100 - warmth(g.rank) * 100; // warmer = fuller bar

  const bar = document.createElement("div");
  bar.className = "bar";
  bar.style.background = color;
  bar.style.width = pct + "%";

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

// ---- Scoreboard & feed ---------------------------------------------------
function renderScoreboard(players) {
  const list = $("scoreboard");
  list.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    if (me && p.id === me.id) li.classList.add("me");
    if (p.solved) li.classList.add("solved");
    const name = document.createElement("span");
    name.className = "pname";
    name.textContent = (p.solved ? "🏆 " : "") + p.name;
    const stat = document.createElement("span");
    stat.className = "pstat";
    const best = p.bestRank == null ? "–" : fmt(p.bestRank);
    stat.textContent = `${p.guessCount} guesses · best ${best}`;
    li.append(name, stat);
    list.appendChild(li);
  }
}

function addFeed(event) {
  const list = $("feed");
  const li = document.createElement("li");
  if (event.kind === "join") li.innerHTML = `<b>${esc(event.name)}</b> joined`;
  else if (event.kind === "leave") li.innerHTML = `<b>${esc(event.name)}</b> left the room`;
  else if (event.kind === "solve")
    li.innerHTML = `<b>${esc(event.name)}</b> guessed the word in ${event.guessCount} guesses! 🎉`;
  list.prepend(li);
  while (list.children.length > 25) list.removeChild(list.lastChild);
}

function showWinner(winner, word, iWon) {
  const banner = $("win-banner");
  banner.classList.remove("hidden");
  if (iWon) {
    banner.className = "banner win";
    banner.textContent = `You guessed "${word}" in ${winner.guessCount} guesses! 🎉`;
    $("guess").disabled = true;
  } else {
    banner.className = "banner lose";
    const wordTxt = word ? ` The word was "${word}".` : "";
    banner.textContent = `${winner.name} won in ${winner.guessCount} guesses.${wordTxt} Keep guessing.`;
  }
  // Daily is one-and-done; the leaderboard replaces the replay button.
  $("new-round").classList.toggle("hidden", isDaily);
  $("hint-btn").classList.add("hidden");
  $("giveup-btn").classList.add("hidden");
  if (isDaily) $("guess-form").classList.add("hidden");
}

// Player gave up — reveal the word, end the round.
function showRevealed(msg) {
  roundEnded = true;
  sfx.playReveal();
  $("guess").disabled = true;
  $("guess-form").classList.add("hidden");
  $("hint-btn").classList.add("hidden");
  $("giveup-btn").classList.add("hidden");
  const banner = $("win-banner");
  banner.className = "banner lose";
  banner.classList.remove("hidden");
  banner.textContent = msg.daily
    ? `You gave up. The word was "${msg.word}". Streak reset — come back tomorrow! 🗓️`
    : `You gave up. The word was "${msg.word}".`;
  if (msg.daily && msg.board) renderLeaderboard(msg.board, 0, false);
  else $("new-round").classList.remove("hidden");
}

// ---- Daily leaderboard ---------------------------------------------------
function renderLeaderboard(board, streak, showShare = true) {
  const el = $("leaderboard");
  let html = `<div class="lb-head">Today's leaderboard <span>${board.total} player${board.total === 1 ? "" : "s"}</span></div>`;
  if (streak > 0) {
    html += `<div class="lb-streak">🔥 ${streak}-day streak</div>`;
  }
  html += `<ol class="lb-list">`;
  for (const e of board.top) {
    html += `<li class="${e.you ? "you" : ""}"><span class="lb-rank">${e.rank}</span><span class="lb-name">${esc(e.name)}${e.you ? " (you)" : ""}</span><span class="lb-guesses"><b>${e.guesses}</b> guesses</span></li>`;
  }
  html += `</ol>`;
  if (board.you && board.you.rank > board.top.length) {
    html += `<div class="lb-you-rank">You: #${board.you.rank} · ${board.you.guesses} guesses</div>`;
  }
  if (showShare && board.you) {
    html += `<button type="button" class="primary lb-share" id="share-btn">🔗 Share result</button>`;
  }
  el.innerHTML = html;
  el.classList.remove("hidden");

  if (showShare && board.you) {
    lastDailyShare = {
      date: board.date,
      langName: (LANG_META[board.lang] || {}).name || board.lang,
      guesses: board.you.guesses,
      streak: streak || 0,
    };
    $("share-btn").addEventListener("click", shareDaily);
  }
}

// Player already solved today's word — show their result + the board, no replay.
function showDailyDone(msg) {
  isDaily = true;
  $("game").classList.add("solo", "daily");
  document.querySelector(".daily-badge").classList.remove("hidden");
  $("join").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("guess-form").classList.add("hidden");
  $("guesses").classList.add("hidden");
  $("history").classList.add("hidden");
  $("hint-btn").classList.add("hidden");
  $("giveup-btn").classList.add("hidden");
  $("new-round").classList.add("hidden");
  $("guess-msg").textContent = "";

  const banner = $("win-banner");
  const solved = !!msg.result;
  banner.className = solved ? "banner win" : "banner lose";
  banner.textContent = solved
    ? `You already solved today's word in ${msg.result.guesses} guesses. Come back tomorrow! 🗓️`
    : `You gave up on today's word. Come back tomorrow! 🗓️`;
  banner.classList.remove("hidden");

  renderLeaderboard(msg.board, msg.streak, solved);
}

$("new-round").addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "newRound" }));
});

$("leave-btn").addEventListener("click", () => {
  intentionalClose = true;
  if (ws) ws.close();
  location.reload();
});

// ---- Invite link & share -------------------------------------------------
async function copyText(text, btn, okLabel) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = okLabel;
    setTimeout(() => (btn.textContent = old), 1500);
  }
}

$("invite-btn").addEventListener("click", () => {
  if (!roomCode) return;
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  copyText(url, $("invite-btn"), "✓ Link copied!");
});

let lastDailyShare = null;

async function shareDaily() {
  if (!lastDailyShare) return;
  const s = lastDailyShare;
  const url = `${location.origin}${location.pathname}`;
  const streakLine = s.streak > 0 ? ` · 🔥 ${s.streak}-day streak` : "";
  const text = `Wordo 🗓️ ${s.date} · ${s.langName}\nSolved in ${s.guesses} guesses${streakLine}\n${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      /* fall through to clipboard */
    }
  }
  copyText(text, $("share-btn"), "✓ Copied!");
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
