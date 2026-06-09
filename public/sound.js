// Synthesized sound effects via the Web Audio API — no asset files, works offline.

let ctx = null;
let enabled = localStorage.getItem("wordo_sound") !== "off"; // default on

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** Resume the audio context from within a user gesture so later async sounds play. */
export function prime() {
  if (enabled) ac();
}

export function soundEnabled() {
  return enabled;
}
export function setSoundEnabled(on) {
  enabled = on;
  localStorage.setItem("wordo_sound", on ? "on" : "off");
  if (on) ac();
}

function tone({ freq, dur = 0.18, type = "sine", gain = 0.16, when = 0, glideTo = null }) {
  const c = ac();
  if (!c || !enabled) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// A guess: pitch reflects warmth — hot guesses sing high & bright, cold ones are low & dull.
export function playGuess(rank, maxRank) {
  if (!enabled) return;
  const t = Math.min(1, Math.log(Math.max(1, rank)) / Math.log(maxRank)); // 0 hot .. 1 cold
  const freq = 680 - t * 470; // ~680Hz (hot) -> ~210Hz (cold)
  tone({ freq, type: t < 0.45 ? "triangle" : "sine", dur: 0.15, gain: 0.15 });
}

export function playWin() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    tone({ freq: f, when: i * 0.1, dur: 0.32, type: "triangle", gain: 0.18 })
  );
}

export function playHint() {
  tone({ freq: 988, dur: 0.1, type: "sine", gain: 0.12 });
  tone({ freq: 1318.5, when: 0.08, dur: 0.2, type: "sine", gain: 0.12 });
}

export function playReveal() {
  // give up — a gentle descending sigh
  [392, 311, 247].forEach((f, i) => tone({ freq: f, when: i * 0.14, dur: 0.3, type: "sine", gain: 0.15 }));
}

export function playError() {
  tone({ freq: 200, glideTo: 120, dur: 0.16, type: "square", gain: 0.07 });
}

export function playClick() {
  tone({ freq: 420, dur: 0.05, type: "sine", gain: 0.08 });
}
