# Wordo

A multiplayer semantic word-guessing game (Contexto/Semantle-style). Guess the
secret word — each guess is ranked **1 (exact)** up to ~40,000 (ice cold) by how
semantically close it is. Fewer guesses wins. Danish first; multi-language ready.

## How it works

1. **Pipeline** (`pipeline/generate.py`) loads a spaCy word-vector model and exports,
   per language, the vocabulary's vectors quantized to int8 (`vectors.i8`), the word
   list (`vocab.json`), and a pool of secret words (`secrets.json`, common nouns).
2. **Server** (`server/`) loads the vectors and computes a secret word's full ranking
   **on demand at runtime** (~15ms, then cached). This keeps the footprint small and
   FIXED (~7.5MB/lang) no matter how many secret words exist — currently 1500/lang.
3. **Client** (`public/`) is vanilla JS: live rank gradient, scoreboard, activity feed.

## Multiplayer

Players join a 4-character room and race to guess the **same** secret word. The
scoreboard shows each player's guess count and best rank (never their actual words,
so nobody can copy). First to rank 1 wins; others can keep playing. Anyone can start
a new round.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

Open two browser tabs, create a room in one, paste the room code into the other.

## Deploy online

Wordo needs a **persistent Node process** (WebSockets + in-memory rooms) — not a
static/serverless host. The client auto-uses `wss://` on HTTPS and the server reads
`PORT`, so no code changes are needed.

**Environment variables**
- `PORT` — set by the host (defaults to 3000).
- `TZ` — e.g. `Europe/Copenhagen`, so the daily word rolls over at local midnight.
- `WORDO_LEADERBOARD` — path on a **persistent disk** (e.g. `/var/data/leaderboard.json`)
  so streaks/leaderboard survive restarts. Without it, the board resets on redeploy.

**Render (easiest):** New → Blueprint → pick this repo (`render.yaml` is included).
It sets `TZ`, a 1 GB disk, and `WORDO_LEADERBOARD`, with a `/health` check. The disk
needs a paid plan; on the free plan remove the `disk` block (board resets, service sleeps).

**Railway / Fly / any VPS:** the included `Dockerfile` works everywhere. Mount a volume
and point `WORDO_LEADERBOARD` at it. On a VPS, put Caddy in front for automatic HTTPS.

```bash
docker build -t wordo .
docker run -p 3000:3000 -e TZ=Europe/Copenhagen \
  -v wordo-data:/var/data -e WORDO_LEADERBOARD=/var/data/leaderboard.json wordo
```

## Regenerate / add ranking data

The Python pipeline lives in `pipeline/` with its own venv (built on **python3.12** —
spaCy lacks wheels for newer Python).

```bash
# one-time setup
python3.12 -m venv pipeline/.venv
pipeline/.venv/bin/pip install spacy wordfreq
pipeline/.venv/bin/python -m spacy download da_core_news_lg
pipeline/.venv/bin/python -m spacy download en_core_web_lg

# generate Danish + English data
cd pipeline
.venv/bin/python generate.py --model da_core_news_lg --lang da --secrets words_da.txt --out ../data
.venv/bin/python generate.py --model en_core_web_lg --lang en --secrets words_en.txt --out ../data
```

Secret words = the curated `pipeline/words_<lang>.txt` (force-included) PLUS common
nouns auto-detected from the vocabulary via POS tagging, up to `--secrets-limit`
(default 1500). The guessable vocabulary is the top `--vocab-size` (default 25000)
most frequent words (`wordfreq`). Adding more secret words costs no extra storage —
the ranking is computed at runtime from the shared vectors.

## Adding another language

1. Download a spaCy model with vectors, e.g. `... -m spacy download de_core_news_lg`
2. Create `pipeline/words_de.txt` with secret words.
3. Generate: `.venv/bin/python generate.py --model de_core_news_lg --lang de --secrets words_de.txt --out ../data`

The server auto-discovers any language folder under `data/` and the client shows it
as a selectable language button. (`wordfreq` supports most common languages.)

## Layout

```
pipeline/   generate.py, word lists, .venv          (offline vector export)
data/<lang>/vocab.json, vectors.i8, meta.json, secrets.json   (generated; checked in)
server/     index.js (HTTP+WS), rooms.js (game state),
            data.js (runtime ranking), leaderboard.js (daily board + streaks)
public/     index.html, app.js, style.css
```
