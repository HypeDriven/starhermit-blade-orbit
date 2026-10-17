/**
 * Blade Orbit — graphics quality model: presets, per-category overrides, GPU
 * detection and a cost summary. Pure (no three.js, no DOM) so the settings
 * panel, the renderer and the unit tests agree on what a setting means.
 */

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  particles: ['low', 'high'],
  detail: ['plain', 'detailed'],
};

// Each preset: a device-pixel-ratio cap, a render scale (multiplies it) and a tier per category.
const TABLE = {
  low: { dprCap: 1, scale: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', particles: 'low', detail: 'plain' },
  balanced: { dprCap: 1.5, scale: 1, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  high: { dprCap: 2, scale: 1, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  ultra: { dprCap: 2, scale: 1.25, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export const PARTICLE_CAP = { low: 80, high: 260 };

// StarHermit hardware level (0–20, gpu-level.js) at which Auto starts choosing each preset.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

// Per-preset asset and effect budgets, each tuned to hold 60 FPS on the weakest GPU Auto gives the
// preset (Low: level 0 phones / Intel UHD; Balanced: level 4 Iris Xe; High: level 10 GTX 1070;
// Ultra: level 17 RTX 4080). Gameplay is identical on every preset.
//   material     — 'lambert' (Lambert wood, Phong steel), 'standard' (PBR) or 'physical' (clearcoat
//                  varnish on the wheel face, rim, hub and blades)
//   mergedBlades — each blade is one mesh with vertex-coloured steel, handle and guard (1 draw instead
//                  of 4, also in the shadow pass); High/Ultra keep four separately lit parts
//   segments     — wheel face / edge / rim / hub segment counts (rim tube ×1.25)
//   texture      — carved wheel-face texture size in px (Surface detail adds the bump map)
//   particles    — multiplier on the spark/chip pool (Particles low 80 / high 260), scaled by level
//   embers       — drifting embers behind the wheel (Particles: high)
//   bloomRes     — bloom resolution as a fraction of the canvas
export const BUDGETS = {
  low: { material: 'lambert', mergedBlades: true, segments: 48, texture: 512, particles: 0.6, embers: 0, bloomRes: 0.5 },
  balanced: { material: 'standard', mergedBlades: true, segments: 64, texture: 512, particles: 1, embers: 40, bloomRes: 0.5 },
  high: { material: 'physical', mergedBlades: false, segments: 96, texture: 1024, particles: 1, embers: 70, bloomRes: 0.75 },
  ultra: { material: 'physical', mergedBlades: false, segments: 128, texture: 2048, particles: 1.5, embers: 140, bloomRes: 1 },
};

const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for a renderer string (+ optional detectSystem() fields such as mobile). */
export function detectLevel(gpu, system = {}) {
  const G = gpuApi();
  return G ? G.detectLevel({ webgl: true, webgl2: true, ...system, gpu: String(gpu || '') }) : 0;
}

/** Auto preset for a hardware level: Low 0, Balanced 4, High 10, Ultra 17. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (hardware level → preset); touch devices are capped at Balanced. */
export function detectPreset(gpu, mobile = false) {
  return presetForLevel(detectLevel(gpu, { mobile: !!mobile }));
}

/** The preset's budget; particle pool and embers scale by the level within the preset (≤ 2×). */
export function budget(preset, level) {
  const b = BUDGETS[preset] || BUDGETS.balanced;
  const G = gpuApi(), floor = LEVELS[preset] ?? 0;
  const k = G ? Math.min(2, G.scaleBudget(1, Number.isFinite(level) ? level : floor, floor)) : 1;
  return { ...b, particles: Math.round(b.particles * k * 100) / 100, embers: Math.round(b.embers * k) };
}

/** Live particle cap for the resolved settings. */
export function particleCap(r) {
  return Math.max(16, Math.round(PARTICLE_CAP[r.particles] * (r.budget ? r.budget.particles : 1)));
}

/** Map a legacy `quality` value (auto/low/medium/high) or preset name to a preset or 'auto'. */
export function normalizePreset(v) {
  if (v === 'medium') return 'balanced';
  return PRESETS.includes(v) ? v : 'auto';
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const renderScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, dprCap: row.dprCap, renderScale, scale: row.scale * renderScale };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.budget = budget(preset, level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

/** Saved settings after choosing a preset: category overrides are cleared, other fields kept. */
export function choosePreset(saved, preset) {
  const out = { ...(saved || {}), preset: PRESETS.includes(preset) ? preset : 'auto' };
  for (const cat of Object.keys(CATEGORIES)) delete out[cat];
  return out;
}

const EN = {
  noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
  bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing',
};

/** One-line cost summary; `words` localizes the phrases (English by default). */
export function describe(r, pixels, words = EN) {
  const w = { ...EN, ...words };
  const parts = [
    r.shadows === 'off' ? w.noShadows : `${SHADOW_MAP[r.shadows]}² ${w.shadows}`,
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoHigh : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.reflections : null,
    r.antialias === 'off' ? w.noAA : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
