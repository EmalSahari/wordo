import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadData, availableLanguages, hasLanguage, maxRank, hintWord } from "./data.js";
import { RoomManager, Player } from "./rooms.js";
import { todayKey, hasSolved, hasPlayed, hasGivenUp, getResult, recordSolve, recordGiveUp, getStreak, getBoard } from "./leaderboard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

loadData();

const app = express();
app.use(express.static(join(__dirname, "..", "public")));
app.get("/api/languages", (_req, res) => res.json({ languages: availableLanguages() }));
app.get("/health", (_req, res) => res.json({ ok: true, languages: availableLanguages() }));

const server = createServer(app);
const wss = new WebSocketServer({ server });
const manager = new RoomManager();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  for (const p of room.players.values()) {
    if (p.id !== exceptId) send(p.ws, msg);
  }
}

function broadcastStats(room) {
  broadcast(room, { type: "players", players: room.playerStats(), round: room.round });
}

wss.on("connection", (ws) => {
  let player = null;
  let room = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", message: "Invalid message" });
    }

    if (msg.type === "join") {
      const lang = hasLanguage(msg.lang) ? msg.lang : availableLanguages()[0] || "da";
      const code = (msg.room || "").toUpperCase().trim();

      // Daily challenge: one shared word per day, leaderboard + streaks.
      if (msg.daily) {
        const date = todayKey();
        const clientId = msg.clientId || randomUUID();
        // Already solved today? Show the result + leaderboard, no replay.
        if (hasPlayed(lang, date, clientId)) {
          const result = getResult(lang, date, clientId);
          return send(ws, {
            type: "dailyDone",
            date,
            lang,
            result,
            gaveUp: !result && hasGivenUp(lang, date, clientId),
            streak: getStreak(lang, clientId, date),
            board: getBoard(lang, date, clientId),
          });
        }
        room = manager.createDaily(lang, date);
        player = new Player(randomUUID(), msg.name, ws, clientId);
        room.addPlayer(player);
        return send(ws, {
          type: "joined",
          you: { id: player.id, name: player.name },
          room: room.code,
          solo: true,
          daily: true,
          date,
          lang: room.lang,
          maxRank: maxRank(room.lang),
          round: room.round,
          players: room.playerStats(),
        });
      }

      if (msg.solo) {
        room = manager.createRoom(lang, true); // private, single-player room
      } else if (code) {
        const existing = manager.rooms.get(code);
        if (existing && existing.solo) {
          return send(ws, { type: "error", message: "That room is taken" });
        }
        room = manager.getOrCreate(code, lang);
      } else {
        room = manager.createRoom(lang);
      }

      player = new Player(randomUUID(), msg.name, ws);
      room.addPlayer(player);

      send(ws, {
        type: "joined",
        you: { id: player.id, name: player.name },
        room: room.code,
        solo: room.solo,
        lang: room.lang,
        maxRank: maxRank(room.lang),
        round: room.round,
        solved: room.solved,
        winner: room.winner,
        players: room.playerStats(),
      });
      if (!room.solo) {
        broadcast(room, { type: "feed", event: { kind: "join", name: player.name } }, player.id);
        broadcastStats(room);
      }
      return;
    }

    if (!room || !player) return send(ws, { type: "error", message: "You're not in a room" });

    if (msg.type === "guess") {
      if (player.gaveUp || player.solved) return;
      const result = room.guess(player, msg.word);
      send(ws, { type: "guessResult", guess: result });

      if (result.rank === 1 && room.daily) {
        const ms = Date.now() - room.startedAt;
        const rec = recordSolve(room.lang, room.dailyDate, player.clientId, player.name, player.guessCount, ms);
        send(ws, {
          type: "leaderboard",
          board: getBoard(room.lang, room.dailyDate, player.clientId),
          streak: rec.streak,
        });
        return;
      }

      broadcastStats(room);
      if (result.rank === 1) {
        broadcast(
          room,
          { type: "feed", event: { kind: "solve", name: player.name, guessCount: player.guessCount } },
          player.id
        );
        if (room.winner && room.winner.id === player.id) {
          broadcast(room, {
            type: "winner",
            winner: room.winner,
            word: room.puzzle.word,
          }, player.id);
        }
      }
      return;
    }

    if (msg.type === "hint") {
      if (player.solved || player.gaveUp) return;
      if (player.hintsUsed >= 1) return send(ws, { type: "error", message: "No hint left" });

      // One hint per round: a single warm word, not a variant of what's been tried.
      const word = hintWord(room.lang, room.puzzle.word, player.guesses.map((g) => g.word));
      if (!word) return send(ws, { type: "error", message: "No hint available" });

      const entry = room.guess(player, word); // scores + adds; counts toward guesses
      player.hintsUsed += 1;
      send(ws, { type: "guessResult", guess: { ...entry, hint: true } });
      if (!room.daily) broadcastStats(room);
      return;
    }

    if (msg.type === "giveup") {
      if (player.solved || player.gaveUp) return;
      player.gaveUp = true;
      const word = room.puzzle.word;
      const extra = {};
      if (room.daily) {
        recordGiveUp(room.lang, room.dailyDate, player.clientId, player.name);
        extra.board = getBoard(room.lang, room.dailyDate, player.clientId);
      }
      send(ws, { type: "revealed", word, daily: room.daily, ...extra });
      return;
    }

    if (msg.type === "newRound") {
      room.startNewRound();
      broadcast(room, { type: "newRound", round: room.round, lang: room.lang, maxRank: maxRank(room.lang) }, null);
      broadcastStats(room);
      return;
    }
  });

  ws.on("close", () => {
    if (room && player) {
      room.removePlayer(player.id);
      broadcast(room, { type: "feed", event: { kind: "leave", name: player.name } });
      broadcastStats(room);
      if (room.isEmpty()) manager.remove(room.code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Wordo running on http://localhost:${PORT}`);
  const langs = availableLanguages();
  if (langs.length === 0) {
    console.warn("⚠  No language data loaded. Run: npm run pipeline (see pipeline/README.md)");
  }
});
