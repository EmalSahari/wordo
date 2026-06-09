// In-memory multiplayer rooms. Everyone in a room races to guess the same secret
// word. Each player has a private guess history; opponents only see aggregate
// stats (best rank, guess count, solved?) — never each other's actual words.

import { pickPuzzle, dailyPuzzle, scoreGuess, puzzleCount, hasLanguage } from "./data.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
const DEFAULT_LANG = "da";

function makeCode() {
  let c = "";
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  getOrCreate(code, lang) {
    let room = this.rooms.get(code);
    if (!room) {
      room = new Room(code, lang);
      this.rooms.set(code, room);
    }
    return room;
  }

  createRoom(lang, solo = false) {
    return this.#make(lang, { solo });
  }

  /** A private daily-challenge room seeded with today's word of the day. */
  createDaily(lang, dateKey) {
    return this.#make(lang, { solo: true, daily: true, dailyDate: dateKey });
  }

  #make(lang, opts) {
    let code;
    do {
      code = makeCode();
    } while (this.rooms.has(code));
    const room = new Room(code, lang, opts);
    this.rooms.set(code, room);
    return room;
  }

  remove(code) {
    this.rooms.delete(code);
  }
}

export class Room {
  constructor(code, lang, opts = {}) {
    this.code = code;
    this.solo = !!opts.solo;
    this.daily = !!opts.daily;
    this.dailyDate = opts.dailyDate || null;
    this.lang = hasLanguage(lang) ? lang : DEFAULT_LANG;
    /** @type {Map<string, Player>} */
    this.players = new Map();
    this.round = 0;
    this.startNewRound();
  }

  startNewRound() {
    this.round += 1;
    if (this.daily) {
      this.puzzle = dailyPuzzle(this.lang, this.dailyDate);
    } else {
      const count = puzzleCount(this.lang);
      const seed = count > 0 ? Math.floor(Math.random() * count) : 0;
      this.puzzle = pickPuzzle(this.lang, seed);
    }
    this.solved = false;
    this.winner = null;
    this.startedAt = Date.now();
    for (const p of this.players.values()) p.resetForRound();
  }

  addPlayer(player) {
    this.players.set(player.id, player);
    player.resetForRound();
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  /** Score a guess for a player and update their stats. */
  guess(player, rawWord) {
    if (!this.puzzle) return { status: "unknown", word: String(rawWord || "") };
    const result = scoreGuess(this.lang, this.puzzle, rawWord);

    if (result.status === "unknown") return result;

    // Don't double-count repeated guesses.
    const already = player.guesses.find((g) => g.word === result.word);
    if (already) return { ...already, repeat: true };

    const entry = { word: result.word, rank: result.rank, status: result.status };
    player.guesses.push(entry);
    player.guessCount = player.guesses.length;
    if (entry.rank < player.bestRank) player.bestRank = entry.rank;

    if (entry.rank === 1 && !player.solved) {
      player.solved = true;
      player.solvedAt = Date.now();
      if (!this.solved) {
        this.solved = true;
        this.winner = { id: player.id, name: player.name, guessCount: player.guessCount };
      }
    }
    return entry;
  }

  /** Aggregate, non-revealing stats for the lobby/scoreboard. */
  playerStats() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        guessCount: p.guessCount,
        bestRank: p.bestRank === Infinity ? null : p.bestRank,
        solved: p.solved,
      }))
      .sort((a, b) => {
        if (a.solved !== b.solved) return a.solved ? -1 : 1;
        const ar = a.bestRank ?? Infinity;
        const br = b.bestRank ?? Infinity;
        return ar - br;
      });
  }

  isEmpty() {
    return this.players.size === 0;
  }
}

export class Player {
  constructor(id, name, ws, clientId = null) {
    this.id = id;
    this.name = name || "Anonymous";
    this.ws = ws;
    this.clientId = clientId; // stable per-browser id, for the daily leaderboard
    this.resetForRound();
  }

  resetForRound() {
    this.guesses = [];
    this.guessCount = 0;
    this.bestRank = Infinity;
    this.solved = false;
    this.solvedAt = null;
    this.hintsUsed = 0; // one hint allowed per round
    this.gaveUp = false;
  }
}
