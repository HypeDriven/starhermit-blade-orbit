// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, the event table of sfx/manifest.json) per logical event,
// the theme's authored ambience loop (hearth, wind or chimes) faded in under
// a round, and the quiet generative music stem — a seeded pentatonic sine
// arpeggio, one or two notes every 0.9–1.8 s, louder with the stage's tier.
// Every captioned event also emits a caption (setOnCaption).
//
// The browser build's four buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): music → "music", effects and
// ambience → "effects", the UI click → "interface". The old default bus
// levels (music 70 %, effects 90 %, ambience 50 %) are folded into each
// sound's gain. The stem's notes are rendered once into clips (createClip)
// with the same envelope; the synthesized stand-ins the browser build played
// while a sample loaded, and its synth ambience bed, are not ported: the
// engine's browser runtime drops clip loads and plays while a synthesis graph
// changes (the arrow-exodus port's finding). Clips load once the mixer runs
// (natively at once, in a browser after the first press).
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";
import { makeRng } from "../js/rules.js";

const LEVEL = { music: 0.7, effects: 0.9, ambience: 0.5 };
/** Logical event → authored sample basename (sfx/<name>.opus, see sfx/manifest.json). */
const SAMPLES: Record<string, string> = {
  throw: "blade-throw", embed: "blade-embed", "miss-blade": "steel-clang", "miss-marker": "sigil-ward",
  win: "stage-win", lose: "stage-lose", click: "ui-click", undo: "ui-undo", pause: "ui-pause", hint: "ui-hint",
  tick: "countdown-tick", go: "countdown-go", achievement: "achievement-chime", combo: "combo-chime",
};
/** Theme ambience kind → authored loop. */
const AMBIENCE: Record<string, string> = { hearth: "ambience-hearth", wind: "ambience-wind", chimes: "ambience-chimes" };
const CAPTIONED = new Set(["throw", "embed", "miss-blade", "miss-marker", "win", "lose", "tick", "go", "achievement", "combo"]);

const clips = new Map<string, AudioClip>();
let onCaption: ((type: string, detail: { combo?: number }) => void) | null = null;
let wantClips = false;

function load(name: string): void {
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
}
/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }
export function setOnCaption(cb: (type: string, detail: { combo?: number }) => void): void { onCaption = cb; }

/** Plays a logical event's sample and emits its caption. */
export function event(type: string, detail: { combo?: number } = {}): void {
  if (CAPTIONED.has(type) && onCaption) onCaption(type, detail);
  const file = SAMPLES[type];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  const bus: Bus = type === "click" ? "interface" : "effects";
  try { playClip(clip, { bus, gain: LEVEL.effects }); }
  catch { clips.delete(file!); load(file!); } // a clip the mixer lost: load it again
}

// -- the music stem ---------------------------------------------------------------------
const SCALE = [220, 262, 294, 330, 392, 440];
const RATE = 22050;
const notes = new Map<number, AudioClip>();
/** One stem note: a sine rising to 1 in 8 ms and falling exponentially to 0.0001 by 0.9 s (js/audio.js env()). */
function noteClip(freq: number): AudioClip {
  const dur = 0.95;
  const n = Math.round(dur * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = t < 0.008 ? 0.0001 * Math.pow(1 / 0.0001, t / 0.008) : t < 0.9 ? Math.pow(0.0001, (t - 0.008) / 0.892) : 0;
    out[i] = Math.sin(2 * Math.PI * freq * t) * env;
  }
  return createClip([out], RATE);
}
const musicRng = makeRng("music:blade-orbit");
let musicOn = false;
let intensity = 0;
let nextNote = 0;
let paused = false;

/** The stem plays under a round; `level` 0–1 (the stage's tier / 6, 0.2 without one). */
export function startMusic(level: number): void { musicOn = true; intensity = level; nextNote = 0; }
export function stopMusic(): void { musicOn = false; }

// -- ambience -----------------------------------------------------------------------------
let ambienceKind: string | null = null;
let ambience: Sound | null = null;
export function startAmbience(kind: string): void {
  if (ambienceKind === kind && ambience) return;
  stopAmbience();
  ambienceKind = kind;
}
export function stopAmbience(): void {
  ambienceKind = null;
  if (ambience) { try { ambience.stop(); } catch { /* gone */ } }
  ambience = null;
}
/** Pause: the stem holds and the ambience fades out (the browser build suspended its context). */
export function setPaused(on: boolean): void {
  paused = on;
  if (!ambience) return;
  try { ambience.fade(on ? 0 : 0.6 * LEVEL.ambience, 0.3); } catch { ambience = null; }
}

/** Each frame: the clips once the mixer runs, one rendered note a frame, the
 * ambience once its clip is in, then the stem's next notes by mixer time. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const name of new Set([...Object.values(SAMPLES), ...Object.values(AMBIENCE)])) load(name);
    return;
  }
  try {
    for (const f of SCALE) for (const k of [1, 2]) {
      if (!notes.has(f * k)) { notes.set(f * k, noteClip(f * k)); return; }
    }
    if (ambienceKind && !ambience) {
      const clip = clips.get(AMBIENCE[ambienceKind] ?? "");
      if (clip) {
        ambience = playClip(clip, { bus: "effects", gain: 0.0001, loop: true });
        ambience.fade(paused ? 0 : 0.6 * LEVEL.ambience, 1.5);
      }
    }
  } catch (e) { console.warn(`audio: ${String(e)}`); return; }
  if (!musicOn || paused) return;
  const now = context.currentTime;
  if (now < nextNote) return;
  const r = musicRng;
  const count = 1 + (r.next() < 0.3 + intensity * 0.4 ? 1 : 0);
  const peak = 0.05 + intensity * 0.03;
  for (let i = 0; i < count; i++) {
    const f = SCALE[r.int(SCALE.length)]! * (r.next() < 0.2 ? 2 : 1);
    const clip = notes.get(f);
    if (!clip) continue;
    if (i === 0) { try { playClip(clip, { bus: "music", gain: peak * LEVEL.music }); } catch { /* the mixer is full */ } }
    else pending.push({ at: now + 0.22 * i, clip, gain: peak * LEVEL.music });
  }
  nextNote = now + 0.9 + r.next() * 0.9;
}
// Second notes of a pair, 0.22 s after the first.
const pending: { at: number; clip: AudioClip; gain: number }[] = [];
/** Each frame, after update(): the pair's later notes when their time comes. */
export function flushPending(): void {
  if (!pending.length || context.state !== "running") return;
  const now = context.currentTime;
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i]!;
    if (now < p.at) continue;
    pending.splice(i, 1);
    try { playClip(p.clip, { bus: "music", gain: p.gain }); } catch { /* full */ }
  }
}
