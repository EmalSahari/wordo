// Daily leaderboard via Supabase's REST API (PostgREST) — no SDK/bundler needed.
// Gracefully no-ops if config.js isn't filled in, so the game works offline too.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const enabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export function boardEnabled() {
  return enabled;
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Submit today's result. One row per (lang, day, client) — duplicates ignored. */
export async function submitScore({ lang, day, clientId, name, guesses, ms, gaveUp }) {
  if (!enabled) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/daily_scores`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
      body: JSON.stringify({
        lang,
        day,
        client_id: clientId,
        name: (name || "Anonymous").slice(0, 24),
        guesses,
        ms: ms || 0,
        gave_up: !!gaveUp,
      }),
    });
  } catch (e) {
    console.warn("[board] submit failed", e);
  }
}

/** Today's board (solvers only) + the player's own rank. */
export async function getBoard({ lang, day, clientId, limit = 20 }) {
  if (!enabled) return { lang, day, total: 0, top: [], you: null };
  try {
    const q =
      `${SUPABASE_URL}/rest/v1/daily_scores?lang=eq.${lang}&day=eq.${day}` +
      `&gave_up=eq.false&order=guesses.asc,ms.asc&select=name,guesses,client_id`;
    const res = await fetch(q, { headers: headers() });
    const rows = await res.json();
    const youIdx = rows.findIndex((e) => e.client_id === clientId);
    return {
      lang,
      day,
      total: rows.length,
      top: rows.slice(0, limit).map((e, i) => ({
        rank: i + 1,
        name: e.name,
        guesses: e.guesses,
        you: e.client_id === clientId,
      })),
      you: youIdx >= 0 ? { rank: youIdx + 1, guesses: rows[youIdx].guesses } : null,
    };
  } catch (e) {
    console.warn("[board] read failed", e);
    return { lang, day, total: 0, top: [], you: null };
  }
}
