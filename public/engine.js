// Client-side ranking engine — the same logic the Node server used (data.js),
// moved into the browser so the game needs no backend for scoring. Vectors are
// fetched once per language as a static asset and ranked on demand (int8 dot
// products), cached per secret word.

const langs = new Map(); // lang -> { vocab, wordToId, vectors, dim, count, secrets, rankCache }

function normalize(w) {
  return String(w || "").trim().toLowerCase();
}

export async function loadLanguage(lang) {
  if (langs.has(lang)) return;
  const base = `data/${lang}`;
  const [vocab, secrets, meta, vecBuf] = await Promise.all([
    fetch(`${base}/vocab.json`).then((r) => r.json()),
    fetch(`${base}/secrets.json`).then((r) => r.json()),
    fetch(`${base}/meta.json`).then((r) => r.json()),
    fetch(`${base}/vectors.i8`).then((r) => r.arrayBuffer()),
  ]);
  const words = vocab.map(normalize);
  langs.set(lang, {
    vocab: words,
    wordToId: new Map(words.map((w, i) => [w, i])),
    vectors: new Int8Array(vecBuf),
    dim: meta.dim,
    count: meta.count,
    secrets: secrets.map(normalize),
    rankCache: new Map(),
  });
}

export function maxRank(lang) {
  return langs.get(lang)?.count ?? 0;
}

export function dailyWord(lang, dateKey) {
  const d = langs.get(lang);
  if (!d || !d.secrets.length) return null;
  let h = 0;
  for (let i = 0; i < dateKey.length; i++) h = (h * 31 + dateKey.charCodeAt(i)) >>> 0;
  return d.secrets[h % d.secrets.length];
}

export function randomSecret(lang) {
  const d = langs.get(lang);
  if (!d || !d.secrets.length) return null;
  return d.secrets[Math.floor(Math.random() * d.secrets.length)];
}

function ensureRanks(d, secret) {
  const cached = d.rankCache.get(secret);
  if (cached) return cached;
  const secretId = d.wordToId.get(secret);
  if (secretId === undefined) return null;

  const { vectors, dim, count } = d;
  const base = secretId * dim;
  const sims = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    let s = 0;
    const b = i * dim;
    for (let k = 0; k < dim; k++) s += vectors[base + k] * vectors[b + k];
    sims[i] = s;
  }
  const order = Int32Array.from(Array.from({ length: count }, (_, i) => i).sort((a, b) => sims[b] - sims[a]));
  const rankById = new Int32Array(count);
  for (let r = 0; r < count; r++) rankById[order[r]] = r + 1;

  const entry = { rankById, order };
  if (d.rankCache.size >= 64) d.rankCache.delete(d.rankCache.keys().next().value);
  d.rankCache.set(secret, entry);
  return entry;
}

export function scoreGuess(lang, secret, rawGuess) {
  const word = normalize(rawGuess);
  const d = langs.get(lang);
  if (!word || !d) return { status: "unknown", word };
  const id = d.wordToId.get(word);
  if (id === undefined) return { status: "unknown", word };
  const ranks = ensureRanks(d, secret);
  if (!ranks) return { status: "unknown", word };
  return { status: "ranked", rank: ranks.rankById[id], word };
}

function isNearDup(a, b) {
  if (a === b) return true;
  const s = a.length <= b.length ? a : b;
  const l = a.length <= b.length ? b : a;
  if (s.length >= 3 && l.includes(s)) return true;
  let p = 0;
  while (p < s.length && a[p] === b[p]) p++;
  return p >= 5;
}

export function hintWord(lang, secret, guessed = []) {
  const d = langs.get(lang);
  if (!d) return null;
  const ranks = ensureRanks(d, secret);
  if (!ranks) return null;
  const { order, rankById } = ranks;
  const count = order.length;

  let best = Infinity;
  for (const g of guessed) {
    const id = d.wordToId.get(g);
    if (id !== undefined && rankById[id] < best) best = rankById[id];
  }
  let target = Number.isFinite(best) ? Math.floor(best / 2) : 40;
  target = Math.max(12, Math.min(40, target));

  for (let off = 0; off < count; off++) {
    for (const j of [target - 1 + off, target - 1 - off]) {
      if (j < 1 || j >= count) continue;
      const w = d.vocab[order[j]];
      if (guessed.includes(w)) continue;
      if (isNearDup(w, secret)) continue;
      if (guessed.some((x) => isNearDup(w, x))) continue;
      return w;
    }
  }
  return null;
}
