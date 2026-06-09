#!/usr/bin/env python
"""Export compact word-vector data for Wordo.

Instead of precomputing a full ranking per secret word (which grows huge with the
word count), we export the vocabulary's vectors ONCE per language, quantized to
int8. The server computes a secret word's ranking on demand at runtime and caches
it. This keeps the on-disk/RAM footprint small and FIXED no matter how many
secret words exist — so we can have thousands of words with no extra cost.

Outputs, per language, into <out>/<lang>/:
  vocab.json    -> ["word", ...]            (index = word id; guessable vocabulary)
  vectors.i8    -> binary int8 matrix       (count x dim, row-major, L2-normalized*127)
  meta.json     -> { "dim": 300, "count": N }
  secrets.json  -> ["word", ...]            (candidate secret words; common nouns)

Usage:
  python generate.py --model da_core_news_lg --lang da \
      --secrets words_da.txt --out ../data
"""
import argparse
import json
import os

import numpy as np
import spacy
from wordfreq import top_n_list


def build_vocab(nlp, lang, max_size):
    """Most frequent words (via wordfreq) that have a vector. Returns (words, unit_matrix)."""
    vectors = nlp.vocab.vectors
    data = vectors.data
    words, rows, seen = [], [], set()
    for w in top_n_list(lang, max_size * 3):
        wl = w.lower()
        if wl in seen or len(wl) < 2 or not wl.isalpha():
            continue
        row = vectors.key2row.get(nlp.vocab.strings[wl])
        if row is None:
            continue
        seen.add(wl)
        words.append(wl)
        rows.append(row)
        if len(words) >= max_size:
            break

    mat = data[np.array(rows)].astype(np.float32)
    norms = np.linalg.norm(mat, axis=1)
    keep = norms > 0
    words = [w for w, k in zip(words, keep) if k]
    mat = mat[keep]
    norms = norms[keep]
    return words, mat / norms[:, None]


def pick_secrets(nlp, words, curated_path, limit):
    """Secret pool: curated words first, then common nouns (POS-tagged), capped at `limit`."""
    word_set = set(words)
    secrets, seen = [], set()

    # Curated words that exist in the vocab.
    if curated_path and os.path.exists(curated_path):
        with open(curated_path, encoding="utf-8") as f:
            for line in f:
                w = line.strip().lower()
                if w and not w.startswith("#") and w in word_set and w not in seen:
                    seen.add(w)
                    secrets.append(w)

    # Common nouns from the vocab (already frequency-ordered), via POS tagging.
    for w, doc in zip(words, nlp.pipe(words, batch_size=2000)):
        if len(secrets) >= limit:
            break
        if w in seen:
            continue
        if len(doc) == 1 and doc[0].pos_ == "NOUN":
            seen.add(w)
            secrets.append(w)

    return secrets[:limit]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--lang", required=True)
    ap.add_argument("--secrets", help="curated word list (force-included as secrets)")
    ap.add_argument("--out", default="../data")
    ap.add_argument("--vocab-size", type=int, default=25000)
    ap.add_argument("--secrets-limit", type=int, default=1500)
    args = ap.parse_args()

    print(f"Loading model {args.model} ...", flush=True)
    nlp = spacy.load(args.model)  # full pipeline — POS tagging needed for secrets

    print("Building vocabulary ...", flush=True)
    words, matn = build_vocab(nlp, args.lang, args.vocab_size)
    dim = int(matn.shape[1])
    print(f"  {len(words)} words, dim {dim}", flush=True)

    print("Selecting secret words (common nouns) ...", flush=True)
    secrets = pick_secrets(nlp, words, args.secrets, args.secrets_limit)
    print(f"  {len(secrets)} secret words", flush=True)

    # Quantize unit vectors to int8 (order-preserving for cosine ranking).
    q = np.clip(np.round(matn * 127.0), -127, 127).astype(np.int8)

    out_dir = os.path.join(args.out, args.lang)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "vocab.json"), "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)
    with open(os.path.join(out_dir, "vectors.i8"), "wb") as f:
        f.write(q.tobytes())
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({"dim": dim, "count": len(words)}, f)
    with open(os.path.join(out_dir, "secrets.json"), "w", encoding="utf-8") as f:
        json.dump(secrets, f, ensure_ascii=False)

    # Remove the old (huge) precomputed-ranking file if present.
    old = os.path.join(out_dir, "puzzles.json")
    if os.path.exists(old):
        os.remove(old)

    size_mb = os.path.getsize(os.path.join(out_dir, "vectors.i8")) / 1e6
    print(f"\nWrote {len(words)} vectors ({size_mb:.1f} MB) and {len(secrets)} secrets to {out_dir}", flush=True)


if __name__ == "__main__":
    main()
