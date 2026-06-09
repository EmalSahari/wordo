// Loads the compact vector data produced by the Python pipeline and ranks a
// secret word's neighbours ON DEMAND at runtime (cached). This keeps memory/disk
// small and fixed regardless of how many secret words exist.
//
// Layout on disk, per language:
//   data/<lang>/vocab.json    -> ["word", ...]   (index = word id)
//   data/<lang>/vectors.i8    -> int8 matrix (count x dim, L2-normalized * 127)
//   data/<lang>/meta.json     -> { dim, count }
//   data/<lang>/secrets.json  -> ["word", ...]   (candidate secret words)
//
// A guess's rank is its position (1-based) when the whole vocabulary is sorted by
// similarity to the secret word — rank 1 is the secret itself.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const RANK_CACHE_MAX = 256; // cached rankings (one Int32Array per active secret)

/**
 * @type {Map<string, {
 *   vocab: string[], wordToId: Map<string, number>,
 *   vectors: Int8Array, dim: number, count: number,
 *   secrets: string[], rankCache: Map<string, Int32Array>
 * }>}
 */
const languages = new Map();

function normalize(word) {
  return String(word || "").trim().toLowerCase();
}

export function loadData() {
  languages.clear();
  if (!existsSync(DATA_DIR)) {
    console.warn(`[data] No data directory at ${DATA_DIR}. Run the pipeline first.`);
    return;
  }
  for (const lang of readdirSync(DATA_DIR)) {
    const dir = join(DATA_DIR, lang);
    const need = ["vocab.json", "vectors.i8", "meta.json", "secrets.json"];
    if (!need.every((f) => existsSync(join(dir, f)))) continue;

    const vocab = JSON.parse(readFileSync(join(dir, "vocab.json"), "utf8")).map(normalize);
    const secrets = JSON.parse(readFileSync(join(dir, "secrets.json"), "utf8")).map(normalize);
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    const buf = readFileSync(join(dir, "vectors.i8"));
    const vectors = new Int8Array(buf.buffer, buf.byteOffset, buf.length);

    const wordToId = new Map(vocab.map((w, i) => [w, i]));
    languages.set(lang, {
      vocab,
      wordToId,
      vectors,
      dim: meta.dim,
      count: meta.count,
      secrets,
      rankCache: new Map(),
    });
    console.log(`[data] Loaded "${lang}": ${vocab.length} words, ${secrets.length} secrets, ${(buf.length / 1e6).toFixed(1)}MB vectors`);
  }
}

export function availableLanguages() {
  return [...languages.keys()];
}
export function hasLanguage(lang) {
  return languages.has(lang);
}
export function maxRank(lang) {
  return languages.get(lang)?.count ?? 0;
}
export function puzzleCount(lang) {
  return languages.get(lang)?.secrets.length ?? 0;
}

/** Random secret for solo/multiplayer rounds. */
export function pickPuzzle(lang, seed) {
  const data = languages.get(lang);
  if (!data || data.secrets.length === 0) return null;
  const idx = seed === undefined ? 0 : Math.abs(seed) % data.secrets.length;
  return { word: data.secrets[idx] };
}

/** Deterministic "word of the day" — same date+lang always yields the same word. */
export function dailyPuzzle(lang, dateKey) {
  const data = languages.get(lang);
  if (!data || data.secrets.length === 0) return null;
  let h = 0;
  for (let i = 0; i < dateKey.length; i++) h = (h * 31 + dateKey.charCodeAt(i)) >>> 0;
  return { word: data.secrets[h % data.secrets.length] };
}

/** Compute (and cache) the full ranking of the vocabulary around a secret word.
 *  Returns { rankById: Int32Array (word id -> rank), order: Int32Array (rank-1 -> word id) }. */
function ensureRanks(data, secretWord) {
  const cached = data.rankCache.get(secretWord);
  if (cached) return cached;

  const secretId = data.wordToId.get(secretWord);
  if (secretId === undefined) return null;

  const { vectors, dim, count } = data;
  const base = secretId * dim;
  const sims = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    let s = 0;
    const b = i * dim;
    for (let d = 0; d < dim; d++) s += vectors[base + d] * vectors[b + d];
    sims[i] = s;
  }

  const sortedIds = Array.from({ length: count }, (_, i) => i).sort((a, b) => sims[b] - sims[a]);
  const order = Int32Array.from(sortedIds);
  const rankById = new Int32Array(count);
  for (let r = 0; r < count; r++) rankById[order[r]] = r + 1;

  const entry = { rankById, order };
  if (data.rankCache.size >= RANK_CACHE_MAX) {
    data.rankCache.delete(data.rankCache.keys().next().value); // evict oldest
  }
  data.rankCache.set(secretWord, entry);
  return entry;
}

// Two words are "near duplicates" if one is a spelling variant of the other —
// an inflection (hus/huset), plural (kat/katte), or compound (værelse/soveværelse).
function isNearDup(a, b) {
  if (a === b) return true;
  const s = a.length <= b.length ? a : b;
  const l = a.length <= b.length ? b : a;
  if (s.length >= 3 && l.includes(s)) return true; // one contains the other
  let p = 0;
  while (p < s.length && a[p] === b[p]) p++;
  return p >= 5; // long shared prefix (drøm/drømte)
}

/** Pick a single, useful hint word: clearly warmer than the player's best guess,
 *  and not a spelling variant of the secret or of anything already guessed. */
export function hintWord(lang, secretWord, guessed = []) {
  const data = languages.get(lang);
  if (!data) return null;
  const ranks = ensureRanks(data, secretWord);
  if (!ranks) return null;
  const { order, rankById } = ranks;
  const count = order.length;

  // Aim warmer than the current best guess so the hint is a real lead.
  let best = Infinity;
  for (const g of guessed) {
    const id = data.wordToId.get(g);
    if (id !== undefined && rankById[id] < best) best = rankById[id];
  }
  let target = Number.isFinite(best) ? Math.floor(best / 2) : 40;
  target = Math.max(12, Math.min(40, target)); // warm, but not a giveaway

  for (let off = 0; off < count; off++) {
    for (const j of [target - 1 + off, target - 1 - off]) {
      if (j < 1 || j >= count) continue;
      const w = data.vocab[order[j]];
      if (guessed.includes(w)) continue;
      if (isNearDup(w, secretWord)) continue;
      if (guessed.some((g) => isNearDup(w, g))) continue;
      return w;
    }
  }
  return null;
}

/**
 * Score a guess against a puzzle ({ word }).
 * @returns {{ status: 'ranked'|'unknown', rank?: number, word: string }}
 */
export function scoreGuess(lang, puzzle, rawGuess) {
  const word = normalize(rawGuess);
  const data = languages.get(lang);
  if (!word || !data) return { status: "unknown", word };
  const id = data.wordToId.get(word);
  if (id === undefined) return { status: "unknown", word };
  const ranks = ensureRanks(data, puzzle.word);
  if (!ranks) return { status: "unknown", word };
  return { status: "ranked", rank: ranks.rankById[id], word };
}
