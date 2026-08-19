/**
 * Blade Orbit — content module.
 * Versioned content schema, procedural-but-deterministic stage generator,
 * tutorials, daily challenge, practice configs, challenge modes, themes,
 * and offline validators.
 */

import { makeRng, angleDelta, SLOT_HALF, TAU, SIM_FPS } from './rules.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Themes (5 visual themes — cosmetic only, never affect rules)
// ---------------------------------------------------------------------------

export const THEMES = [
  {
    id: 'ember-oak', name: 'Ember Oak',
    wood: '#7a4a24', woodDark: '#4a2a12', ring: '#c98d4e', rim: '#8a6a3a',
    metal: '#c8ccd4', handle: '#5a2e1a', accent: '#ff8c3a', marker: '#37c4a8',
    sky: '#1a0f0a', floor: '#241108', fog: '#170b06', key: '#ffd9b0', fill: '#5a4a7a',
    ambience: 'hearth',
  },
  {
    id: 'midnight-forge', name: 'Midnight Forge',
    wood: '#3a3f52', woodDark: '#23263a', ring: '#7f88ad', rim: '#9aa2bd',
    metal: '#d5dbe8', handle: '#2b2f45', accent: '#6aa8ff', marker: '#ff6a8a',
    sky: '#0a0c16', floor: '#11142a', fog: '#090b14', key: '#cfe0ff', fill: '#3a2f5a',
    ambience: 'wind',
  },
  {
    id: 'jade-shrine', name: 'Jade Shrine',
    wood: '#2e5544', woodDark: '#1b3529', ring: '#8fc9a3', rim: '#b7a45f',
    metal: '#e2e8dd', handle: '#402e20', accent: '#ffd35a', marker: '#ff5a4e',
    sky: '#07130e', floor: '#0d1f16', fog: '#060f0b', key: '#fff3cf', fill: '#2f5a50',
    ambience: 'chimes',
  },
  {
    id: 'rose-quarry', name: 'Rose Quarry',
    wood: '#6e3a4a', woodDark: '#452231', ring: '#d68ea4', rim: '#a98a7a',
    metal: '#e8d8dc', handle: '#3a2030', accent: '#ffb35a', marker: '#5ad8ff',
    sky: '#160a10', floor: '#22101a', fog: '#120810', key: '#ffdfe8', fill: '#5a3a5f',
    ambience: 'hearth',
  },
  {
    id: 'bone-desert', name: 'Bone Desert',
    wood: '#9a7a4e', woodDark: '#5f4626', ring: '#e0c08a', rim: '#8a7a5a',
    metal: '#f0ead8', handle: '#4e3a20', accent: '#ff5a3a', marker: '#4e9aff',
    sky: '#171208', floor: '#241c0e', fog: '#141006', key: '#fff0d0', fill: '#6a5a3a',
    ambience: 'wind',
  },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// ---------------------------------------------------------------------------
// Stage generator — deterministic from seed string
// ---------------------------------------------------------------------------

/**
 * Generates a legal stage. Difficulty derives from rotation complexity,
 * preplaced density, marker presence, and goal size — in that order.
 */
export function generateStage(seedText, tier, indexInTier) {
  const rng = makeRng(`stage:${seedText}`);
  const t = Math.min(5, Math.max(1, tier));

  const goal = 4 + t + (indexInTier % 3); // 5..11 blades
  const missesAllowed = t <= 2 ? 3 : t <= 4 ? 2 : 1;

  // Rotation: speed scales gently; higher tiers add oscillation and pulse.
  const dir = rng.next() < 0.5 ? 1 : -1;
  const baseSpeed = dir * (0.004 + t * 0.0016 + rng.range(0, 0.0012)); // rad/tick
  const rotation = {
    startAngle: rng.range(0, TAU),
    baseSpeed,
    oscAmp: 0,
    oscPeriod: 0,
    triAmp: 0,
    triPeriod: 0,
  };
  if (t >= 3) {
    rotation.oscAmp = baseSpeed * rng.range(0.6, 1.4);
    rotation.oscPeriod = Math.round(rng.range(300, 600));
  }
  if (t >= 4) {
    rotation.triAmp = baseSpeed * rng.range(2, 5);
    rotation.triPeriod = Math.round(rng.range(500, 900));
  }

  // Preplaced obstacles with enforced separation.
  const preplaced = [];
  const bladeCount = t >= 2 ? Math.min(2 + t + (indexInTier % 2), 6) : indexInTier >= 5 ? 1 : 0;
  const markerCount = t >= 3 ? Math.min(1 + Math.floor((t + indexInTier) / 3), 3) : 0;
  placeSlots(rng, preplaced, bladeCount, 'blade');
  placeSlots(rng, preplaced, markerCount, 'marker');

  const estTicks = Math.round((goal * 95 * (1 + t * 0.15)) / Math.abs(baseSpeed) ** 0.25 / 6);
  return {
    id: `gen-${seedText}`,
    version: CONTENT_VERSION,
    kind: 'journey',
    seed: seedText,
    name: `Trial of ${seedText}`,
    goal,
    missesAllowed,
    rotation,
    preplaced,
    par: {
      score: goal * 150 + (t - 1) * 100,
      ticks: Math.max(600, estTicks),
    },
    mechanics: mechanicsForTier(t),
    theme: THEMES[(hashIndex(seedText)) % THEMES.length].id,
    timeLimitTicks: 0,
    tutorialFlags: [],
  };
}

function hashIndex(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function placeSlots(rng, out, count, type) {
  let guard = 500;
  while (count > 0 && guard-- > 0) {
    const deg = rng.range(0, 360);
    const rad = (deg * Math.PI) / 180;
    const minSep = SLOT_HALF[type] + SLOT_HALF.blade + 0.35; // generous gaps keep goals reachable
    const ok = out.every((p) => Math.abs(angleDelta(rad, (p.deg * Math.PI) / 180)) > minSep);
    if (ok) {
      out.push({ deg: Math.round(deg * 10) / 10, type });
      count--;
    }
  }
}

function mechanicsForTier(t) {
  const m = ['throw'];
  if (t >= 2) m.push('crowded-ring');
  if (t >= 3) m.push('markers', 'oscillation');
  if (t >= 4) m.push('pulse');
  if (t >= 5) m.push('mastery');
  return m;
}

// ---------------------------------------------------------------------------
// Journey — 40 authored (generator-pinned) stages, 5 tiers × 8 stages
// ---------------------------------------------------------------------------

const TIER_NAMES = ['First Throws', 'Crowded Rings', 'Sigil Wards', 'Pulse Timber', 'Grand Mastery'];

export const JOURNEY = [];
for (let tier = 1; tier <= 5; tier++) {
  for (let i = 0; i < 8; i++) {
    const stage = generateStage(`journey-t${tier}-s${i}`, tier, i);
    const mastery = i === 7;
    stage.id = `journey-${(tier - 1) * 8 + i + 1}`;
    stage.kind = 'journey';
    stage.name = `${TIER_NAMES[tier - 1]} ${i + 1}${mastery ? ' — Mastery' : ''}`;
    stage.tier = tier;
    stage.mastery = mastery;
    if (mastery) {
      stage.missesAllowed = Math.max(0, stage.missesAllowed - 1);
      stage.goal += 1;
    }
    JOURNEY.push(stage);
  }
}

// ---------------------------------------------------------------------------
// Tutorials — one rule at a time; each requires the player to act
// ---------------------------------------------------------------------------

export const TUTORIALS = [
  {
    id: 'tut-throw', kind: 'tutorial', version: CONTENT_VERSION, seed: 'tut-throw',
    name: 'Lesson 1 — The Throw',
    goal: 2, missesAllowed: 5,
    rotation: { startAngle: 0, baseSpeed: 0.006, oscAmp: 0, oscPeriod: 0, triAmp: 0, triPeriod: 0 },
    preplaced: [], par: { score: 200, ticks: 1200 }, mechanics: ['throw'],
    theme: 'ember-oak', timeLimitTicks: 0,
    tutorialFlags: ['tap-to-throw'],
    steps: [
      'The timber wheel turns. Your blade waits below.',
      'Tap, click, or press SPACE to throw. Embed 2 blades to finish.',
    ],
  },
  {
    id: 'tut-spacing', kind: 'tutorial', version: CONTENT_VERSION, seed: 'tut-spacing',
    name: 'Lesson 2 — Mind the Steel',
    goal: 3, missesAllowed: 3,
    rotation: { startAngle: 0, baseSpeed: 0.007, oscAmp: 0, oscPeriod: 0, triAmp: 0, triPeriod: 0 },
    preplaced: [{ deg: 40, type: 'blade' }, { deg: 200, type: 'blade' }],
    par: { score: 350, ticks: 1500 }, mechanics: ['throw', 'crowded-ring'],
    theme: 'ember-oak', timeLimitTicks: 0,
    tutorialFlags: ['avoid-blades'],
    steps: [
      'Blades already in the wood are hazards. Striking one counts as a miss.',
      'Watch the gap swing past the top, then throw. Embed 3 blades.',
    ],
  },
  {
    id: 'tut-markers', kind: 'tutorial', version: CONTENT_VERSION, seed: 'tut-markers',
    name: 'Lesson 3 — Warded Sigils',
    goal: 3, missesAllowed: 2,
    rotation: { startAngle: 0, baseSpeed: 0.0065, oscAmp: 0.005, oscPeriod: 480, triAmp: 0, triPeriod: 0 },
    preplaced: [{ deg: 90, type: 'marker' }, { deg: 270, type: 'marker' }],
    par: { score: 400, ticks: 1600 }, mechanics: ['throw', 'markers'],
    theme: 'jade-shrine', timeLimitTicks: 0,
    tutorialFlags: ['avoid-markers'],
    steps: [
      'Glowing sigils are protected. Striking one costs double — and the wheel now surges and slows.',
      'Time the lull. Embed 3 blades with only 2 misses to spare.',
    ],
  },
  {
    id: 'tut-mastery', kind: 'tutorial', version: CONTENT_VERSION, seed: 'tut-mastery',
    name: 'Lesson 4 — Combos & Precision',
    goal: 4, missesAllowed: 2,
    rotation: { startAngle: 0, baseSpeed: 0.007, oscAmp: 0.004, oscPeriod: 400, triAmp: 0, triPeriod: 0 },
    preplaced: [{ deg: 120, type: 'blade' }, { deg: 300, type: 'blade' }],
    par: { score: 600, ticks: 1500 }, mechanics: ['throw', 'combo'],
    theme: 'midnight-forge', timeLimitTicks: 0,
    tutorialFlags: ['scoring'],
    steps: [
      'Wide, clean gaps earn precision points. Consecutive hits build a combo bonus.',
      'Embed 4 blades. Aim for the centre of each gap.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Daily challenge — one shared seed and ruleset per UTC day
// ---------------------------------------------------------------------------

export function dailyContent(date = new Date()) {
  const iso = date.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  const weekday = date.getUTCDay();
  const tier = 2 + (weekday % 4); // Sun=2 … Wed=5, cycles deterministically
  const stage = generateStage(`daily-${iso}`, tier, weekday);
  stage.id = `daily-${iso}`;
  stage.kind = 'daily';
  stage.name = `Daily — ${iso}`;
  stage.theme = THEMES[hashIndex(iso) % THEMES.length].id;
  return stage;
}

// ---------------------------------------------------------------------------
// Practice — selectable difficulty, unrated
// ---------------------------------------------------------------------------

export function practiceContent(difficulty = 'easy', seed = null) {
  const tiers = { easy: 1, normal: 2, hard: 3, expert: 4, master: 5 };
  const tier = tiers[difficulty] || 1;
  const s = seed || `practice-${difficulty}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const stage = generateStage(s, tier, tier);
  stage.id = `practice-${s}`;
  stage.kind = 'practice';
  stage.name = `Practice — ${difficulty[0].toUpperCase()}${difficulty.slice(1)}`;
  stage.theme = 'ember-oak';
  return stage;
}

// ---------------------------------------------------------------------------
// Challenge modes — constrained goals
// ---------------------------------------------------------------------------

export const CHALLENGES = [
  {
    id: 'ch-perfect', name: 'Flawless Edge',
    description: 'No misses allowed. One slip ends the run.',
    build() {
      const s = generateStage('challenge-flawless', 3, 2);
      s.missesAllowed = 0;
      s.goal = 5;
      s.preplaced = s.preplaced.filter((p) => p.type === 'blade').slice(0, 2);
      return finalizeChallenge(s, 'Flawless Edge', 'ember-oak');
    },
  },
  {
    id: 'ch-speed', name: 'Ember Sprint',
    description: 'Clear 6 blades before the coals die — a hard time limit.',
    build() {
      const s = generateStage('challenge-sprint', 2, 3);
      s.goal = 6;
      s.missesAllowed = 3;
      s.timeLimitTicks = 60 * SIM_FPS; // 60 seconds
      return finalizeChallenge(s, 'Ember Sprint', 'rose-quarry');
    },
  },
  {
    id: 'ch-dense', name: 'Thicket of Steel',
    description: 'A ring already crowded with blades. Find the narrow gaps.',
    build() {
      const s = generateStage('challenge-dense', 4, 5);
      const rng = makeRng('challenge-dense-extra');
      s.preplaced = [];
      placeSlots(rng, s.preplaced, 7, 'blade');
      s.goal = 5;
      s.missesAllowed = 2;
      return finalizeChallenge(s, 'Thicket of Steel', 'midnight-forge');
    },
  },
  {
    id: 'ch-warded', name: 'Warden\'s Trial',
    description: 'Four sigils guard the wheel. Precision or nothing.',
    build() {
      const s = generateStage('challenge-warded', 4, 1);
      const rng = makeRng('challenge-warded-extra');
      s.preplaced = [];
      placeSlots(rng, s.preplaced, 2, 'blade');
      placeSlots(rng, s.preplaced, 4, 'marker');
      s.goal = 6;
      s.missesAllowed = 2;
      return finalizeChallenge(s, 'Warden\'s Trial', 'jade-shrine');
    },
  },
];

function finalizeChallenge(s, name, theme) {
  s.kind = 'challenge';
  s.id = `challenge-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  s.name = name;
  s.theme = theme;
  return s;
}

// ---------------------------------------------------------------------------
// Offline validators — legality, reachability, bounded duration, no soft lock
// ---------------------------------------------------------------------------

export function validateContent(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return { ok: false, errors: ['not-an-object'] };
  for (const field of ['id', 'seed', 'kind', 'name']) {
    if (typeof c[field] !== 'string' || !c[field]) errors.push(`missing-${field}`);
  }
  if (!Number.isInteger(c.version) || c.version < 1) errors.push('bad-version');
  if (!Number.isInteger(c.goal) || c.goal < 1 || c.goal > 30) errors.push('bad-goal');
  if (!Number.isInteger(c.missesAllowed) || c.missesAllowed < 0) errors.push('bad-misses');
  const r = c.rotation || {};
  if (typeof r.baseSpeed !== 'number' || !isFinite(r.baseSpeed) || r.baseSpeed === 0) {
    errors.push('bad-baseSpeed');
  }
  if (Math.abs(r.baseSpeed || 0) > 0.05) errors.push('speed-unbounded');

  // Preplaced legality: in range, no overlapping slots.
  const occ = [];
  for (const p of c.preplaced || []) {
    if (typeof p.deg !== 'number' || p.deg < 0 || p.deg >= 360) errors.push('preplaced-out-of-range');
    if (p.type !== 'blade' && p.type !== 'marker') errors.push('preplaced-bad-type');
    const rad = (p.deg * Math.PI) / 180;
    for (const q of occ) {
      const need = SLOT_HALF[p.type] + SLOT_HALF[q.type];
      if (Math.abs(angleDelta(rad, q.rad)) < need) errors.push('preplaced-overlap');
    }
    occ.push({ rad, type: p.type });
  }

  // Reachability: total occupied arc must leave room for every goal blade.
  const occupiedArc = occ.reduce((sum, s) => sum + 2 * SLOT_HALF[s.type], 0);
  const neededArc = c.goal * 2 * (SLOT_HALF.blade + 0.01);
  if (occupiedArc + neededArc > TAU * 0.92) errors.push('goal-unreachable');

  // Bounded duration: par must exist and be sane.
  if (!c.par || c.par.ticks < 60 || c.par.ticks > SIM_FPS * 600) errors.push('bad-par');
  if (c.timeLimitTicks && (c.timeLimitTicks < SIM_FPS * 10 || c.timeLimitTicks > SIM_FPS * 600)) {
    errors.push('bad-time-limit');
  }
  if (!themeById(c.theme)) errors.push('bad-theme');
  return { ok: errors.length === 0, errors };
}

/** Validate every shipped stage; used by tests and by the bootstrap sanity pass. */
export function validateAllContent() {
  const report = [];
  const seen = new Set();
  const check = (c) => {
    if (seen.has(c.id)) report.push({ id: c.id, ok: false, errors: ['duplicate-id'] });
    seen.add(c.id);
    const v = validateContent(c);
    if (!v.ok) report.push({ id: c.id, ok: false, errors: v.errors });
  };
  JOURNEY.forEach(check);
  TUTORIALS.forEach(check);
  CHALLENGES.forEach((ch) => check(ch.build()));
  const now = new Date();
  for (let d = 0; d < 14; d++) {
    check(dailyContent(new Date(now.getTime() + d * 86400000)));
  }
  return { ok: report.length === 0, failures: report };
}
