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
// sound's gain. The stem's notes are rendered once into clips by the engine's
// OfflineAudioContext with the same envelope; the browser build's synthesized
// stand-ins and synth ambience bed are not ported. Every clip loads at start
// (onStart), all at once; a cue whose clip is still loading is silent (its
// caption still shows).
import { OfflineAudioContext, context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";
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

/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of new Set([...Object.values(SAMPLES), ...Object.values(AMBIENCE)])) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
  for (const f of SCALE) for (const k of [1, 2]) {
    renderNote(f * k).then((c) => { notes.set(f * k, c); }, (e: unknown) => console.warn(`note ${f * k}: ${String(e)}`));
  }
}
export function setOnCaption(cb: (type: string, detail: { combo?: number }) => void): void { onCaption = cb; }

/** Plays a logical event's sample and emits its caption. */
export function event(type: string, detail: { combo?: number } = {}): void {
  if (CAPTIONED.has(type) && onCaption) onCaption(type, detail);
  const file = SAMPLES[type];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  const bus: Bus = type === "click" ? "interface" : "effects";
  try { playClip(clip, { bus, gain: LEVEL.effects }); }
  catch { /* the mixer is full this frame: skip it */ }
}

// -- the music stem ---------------------------------------------------------------------
const SCALE = [220, 262, 294, 330, 392, 440];
const RATE = 11025;
const notes = new Map<number, AudioClip>();
/** One stem note: a sine rising to 1 in 8 ms and falling exponentially to 0.0001 by 0.9 s (js/audio.js env()). */
async function renderNote(freq: number): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(0.95 * RATE), RATE);
  const osc = off.createOscillator(); osc.frequency.value = freq;
  const g = off.createGain();
  g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(1, 0.008); g.gain.exponentialRampToValueAtTime(0.0001, 0.9);
  osc.connect(g).connect(off.destination); osc.start(); osc.stop(0.9);
  return createClip(await off.startRendering());
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

/** Each frame, once the mixer runs: the ambience once its clip is in, then the
 * stem's next notes by mixer time (a pair's second 0.22 s later, scheduled). */
export function update(): void {
  if (context.state !== "running") return; // starting sound still waits for the mixer
  try {
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
    try { playClip(clip, { bus: "music", gain: peak * LEVEL.music, when: now + 0.22 * i }); } catch { /* the mixer is full */ }
  }
  nextNote = now + 0.9 + r.next() * 0.9;
}
