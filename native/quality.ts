// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU it
// was given) keyed by the runtime's quality tier (frame().quality), with the
// spark pool and the embers scaled within the tier by the level
// (frame().levelIndex), as the browser build scaled them by its hardware
// level. The runtime owns the rest of what the old Graphics panel did: Auto
// and the level choice, render scale and the pixel-ratio cap, adaptive
// resolution, the frame-rate limit and readout, and the shadow-map size and
// MSAA samples it holds to the level. The per-category overrides of the old
// panel are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** "lambert" (Lambert wood and steel), "standard" (PBR) or "physical" (clearcoat varnish). */
  material: "lambert" | "standard" | "physical";
  /** Each blade one vertex-coloured mesh (one draw) instead of four lit parts. */
  mergedBlades: boolean;
  /** Wheel face / edge / rim / hub segment counts (rim tube ×1.25). */
  segments: number;
  /** Carved wheel-face texture size in px. */
  texture: number;
  /** Multiplier on the spark/chip pool. */
  particles: number;
  /** Drifting embers behind the wheel (particles high). */
  embers: number;
  /** Bloom resolution as a fraction of the frame. */
  bloomRes: number;
}
export interface Look {
  preset: Preset;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  particles: "low" | "high";
  /** Stage boards, posts' brass bands, crates, the overhead spot, the bump-mapped face. */
  detailed: boolean;
  budget: Budget;
}

const TABLE: Record<Preset, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particles: "low", detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "high", detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", mergedBlades: true, segments: 48, texture: 512, particles: 0.6, embers: 0, bloomRes: 0.5 },
  balanced: { material: "standard", mergedBlades: true, segments: 64, texture: 512, particles: 1, embers: 40, bloomRes: 0.5 },
  high: { material: "physical", mergedBlades: false, segments: 96, texture: 1024, particles: 1, embers: 70, bloomRes: 0.75 },
  ultra: { material: "physical", mergedBlades: false, segments: 128, texture: 2048, particles: 1.5, embers: 140, bloomRes: 1 },
};
export const PARTICLE_CAP = { low: 80, high: 260 };
export const EMBER_MAX = 280;
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: the pools grow with the
  // level above the tier's first, at most twice the tier's budget.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.particles = Math.round(b.particles * k * 100) / 100;
  b.embers = Math.min(EMBER_MAX, Math.round(b.embers * k));
  return { preset, ...TABLE[preset], budget: b };
}

/** Live spark cap for a look. */
export function particleCap(look: Look): number {
  return Math.max(16, Math.round(PARTICLE_CAP[look.particles] * look.budget.particles));
}
