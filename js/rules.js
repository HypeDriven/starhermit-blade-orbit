/**
 * Blade Orbit — rules engine.
 * Pure, deterministic, DOM-free. Runs in the browser and in Node (tests + server).
 *
 * Conventions:
 *  - All simulation state lives in a JSON-serializable `state` object.
 *  - Angles are radians (floats, deterministic given the same tick/profile).
 *  - Scores are integers. Simulation uses a fixed tick of 1/60 s.
 *  - Only `applyCommand` may advance state; it returns a NEW state object.
 */

export const RULES_VERSION = 1;
export const SIM_FPS = 60; // fixed simulation step
export const TAU = Math.PI * 2;

/** Angular half-width (radians) occupied by an embedded blade. */
export const BLADE_HALF = 0.075;
/** Angular half-width occupied by a protected marker (sigil). */
export const MARKER_HALF = 0.105;
/** Extra safety margin added around every occupied slot. */
export const SAFETY = 0.012;

export const SLOT_HALF = { blade: BLADE_HALF + SAFETY, marker: MARKER_HALF + SAFETY };

// ---------------------------------------------------------------------------
// Deterministic random / hashing
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash of a string. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A named seeded random stream (rules / decoration / av streams stay separate). */
export function makeRng(seedText) {
  const next = mulberry32(hashString(String(seedText)));
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (a, b) => a + next() * (b - a),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

/** Canonical JSON (sorted keys) → stable state hash. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export function hashState(state) {
  return hashString(canonicalJson(stripVolatile(state))).toString(16).padStart(8, '0');
}

function stripVolatile(state) {
  const { events, ...rest } = state;
  return rest;
}

// ---------------------------------------------------------------------------
// Rotation profile — deterministic closed-form rotation angle per tick
// ---------------------------------------------------------------------------

/**
 * profile = {
 *   startAngle,           // radians at tick 0
 *   baseSpeed,            // radians per tick (sign = direction)
 *   oscAmp, oscPeriod,    // sinusoidal speed modulation (integrated closed form)
 *   triAmp, triPeriod     // triangle-wave modulation for "pulse" stages
 * }
 */
export function rotationAt(profile, tick) {
  const p = profile;
  let angle = p.startAngle + p.baseSpeed * tick;
  if (p.oscAmp && p.oscPeriod) {
    const w = TAU / p.oscPeriod;
    angle += (p.oscAmp / w) * (1 - Math.cos(w * tick));
  }
  if (p.triAmp && p.triPeriod) {
    angle += p.triAmp * triIntegral(tick / p.triPeriod);
  }
  return angle;
}

/** Integral of a triangle wave of period 1 and amplitude 1, starting at 0 rising. */
function triIntegral(x) {
  const m = ((x % 1) + 1) % 1;
  const whole = Math.floor(x);
  // triangle value: rises 0→1 on [0,.5), falls 1→0 on [.5,1)
  let part;
  if (m < 0.5) part = m * m;                    // ∫0..m 2t dt
  else part = 0.25 + (m - 0.5) - (m - 0.5) * (m - 0.5); // area of rising half + ∫ falling
  return whole * 0.5 + part;
}

/** Shortest signed angular distance from a to b, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

/**
 * content = {
 *   id, version, kind, seed, name,
 *   goal,                // blades that must be embedded
 *   missesAllowed,
 *   rotation,            // rotation profile (see above)
 *   preplaced,           // [{deg, type:'blade'|'marker'}]
 *   par: {score, ticks},
 *   mechanics: [], theme, timeLimitTicks (0 = none)
 * }
 */
export function createGame(content) {
  const slots = (content.preplaced || []).map((p) => ({
    angle: normAngle((p.deg * Math.PI) / 180),
    type: p.type,
  }));
  const state = {
    v: RULES_VERSION,
    contentId: content.id,
    contentVersion: content.version,
    kind: content.kind,
    seed: content.seed,
    tick: 0,
    status: 'active', // 'active' | 'won' | 'lost'
    terminalReason: null,
    rotation: { ...content.rotation },
    slots, // occupied angular slots (preplaced + embedded)
    embedded: 0,
    goal: content.goal,
    misses: 0,
    missesAllowed: content.missesAllowed,
    timeLimitTicks: content.timeLimitTicks || 0,
    comboStreak: 0,
    bestCombo: 0,
    score: { hits: 0, precision: 0, combo: 0, timeBonus: 0, missPenalty: 0 },
    par: content.par || { score: 0, ticks: 0 },
    commandCount: 0,
    invalidCount: 0,
    lastCommandId: null,
    events: [], // events produced by the most recent command (volatile, not hashed)
  };
  return state;
}

function normAngle(a) {
  return ((a % TAU) + TAU) % TAU;
}

export function totalScore(state) {
  const s = state.score;
  return s.hits + s.precision + s.combo + s.timeBonus + s.missPenalty;
}

/** Contact angle if a blade is thrown at `tick`: the target point is at angle 0 world-space. */
export function contactAngle(state, tick) {
  return normAngle(-rotationAt(state.rotation, tick));
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

/**
 * Returns the list of legal actions. Tutorials and hints use this same API.
 * A throw is always expressible while active; legality of the *outcome*
 * (embed vs. blocked) is deterministic given the tick.
 */
export function legalActions(state) {
  if (state.status !== 'active') return [];
  if (state.timeLimitTicks && state.tick >= state.timeLimitTicks) return [];
  return [{ type: 'throw', tick: state.tick }];
}

/**
 * Preview the outcome of a throw at `tick` without mutating state.
 * Returns { outcome:'embed'|'hit-blade'|'hit-marker', contact, clearance, blocker }.
 * Used by hint systems, keyboard aim preview, and validation.
 */
export function previewThrow(state, tick) {
  const contact = contactAngle(state, tick);
  let best = null;
  for (const slot of state.slots) {
    const d = Math.abs(angleDelta(contact, slot.angle));
    const blocked = d < SLOT_HALF[slot.type] + BLADE_HALF;
    const clearance = d - (SLOT_HALF[slot.type] + BLADE_HALF);
    if (!best || d < best.d) best = { d, slot, blocked, clearance };
    if (blocked) {
      return {
        outcome: slot.type === 'marker' ? 'hit-marker' : 'hit-blade',
        contact, clearance: Math.max(0, clearance), blocker: { ...slot },
      };
    }
  }
  const clearance = best ? Math.max(0, best.clearance) : Math.PI;
  return { outcome: 'embed', contact, clearance, blocker: null };
}

/** Max useful clearance for precision scoring (half of largest possible gap arc). */
const MAX_CLEARANCE = 0.55;

/** Find the best throw tick within `horizon` ticks ahead (hint system). */
export function findBestThrowTick(state, horizon = 1200) {
  let bestTick = state.tick;
  let bestClear = -1;
  for (let t = state.tick; t < state.tick + horizon; t++) {
    const p = previewThrow(state, t);
    if (p.outcome === 'embed' && p.clearance > bestClear) {
      bestClear = p.clearance;
      bestTick = t;
    }
  }
  return { tick: bestTick, ticksAway: bestTick - state.tick, clearance: bestClear };
}

// ---------------------------------------------------------------------------
// Command application — the ONLY way to mutate rules state
// ---------------------------------------------------------------------------

/**
 * cmd = { id: string, type: 'throw', tick?: number }
 * Tick is quantized server-side: the command always resolves at the state's
 * current tick; a client-supplied tick outside the window is rejected so
 * replays stay authoritative. Returns { state, events, error }.
 */
export function applyCommand(prev, cmd) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.id !== 'string' || !cmd.id) {
    return { state: prev, events: [], error: 'malformed-command' };
  }
  if (prev.status !== 'active') {
    return { state: prev, events: [], error: 'game-over' };
  }
  if (cmd.id === prev.lastCommandId) {
    return { state: prev, events: [], error: 'duplicate-command' }; // idempotent reject
  }
  if (cmd.type !== 'throw') {
    return { state: prev, events: [], error: 'unknown-action' };
  }
  if (cmd.tick !== undefined) {
    if (!Number.isInteger(cmd.tick) || cmd.tick < 0) {
      return { state: prev, events: [], error: 'bad-tick' };
    }
    if (cmd.tick > prev.tick) {
      return { state: prev, events: [], error: 'future-tick' };
    }
    if (prev.tick - cmd.tick > 6) {
      return { state: prev, events: [], error: 'stale-tick' };
    }
  }
  if (prev.timeLimitTicks && prev.tick >= prev.timeLimitTicks) {
    const state = finalize(cloneState(prev), 'lost', 'time-expired', cmd.id);
    return { state, events: [{ type: 'lose', reason: 'time-expired' }], error: null };
  }

  const state = cloneState(prev);
  state.commandCount += 1;
  state.lastCommandId = cmd.id;

  const result = previewThrow(state, state.tick);
  const events = [];

  if (result.outcome === 'embed') {
    state.slots.push({ angle: result.contact, type: 'blade', embedded: true });
    state.embedded += 1;
    state.comboStreak += 1;
    state.bestCombo = Math.max(state.bestCombo, state.comboStreak);

    const precisionPts = Math.round(
      100 * Math.min(1, result.clearance / MAX_CLEARANCE)
    );
    const comboBonus = (state.comboStreak - 1) * 25;
    state.score.hits += 100;
    state.score.precision += precisionPts;
    state.score.combo += comboBonus;

    events.push({
      type: 'embed',
      angle: result.contact,
      clearance: result.clearance,
      precision: precisionPts,
      combo: state.comboStreak,
    });
    if (state.embedded >= state.goal) {
      // time bonus computed once, at the moment of completion
      if (state.par.ticks > 0 && state.tick < state.par.ticks) {
        state.score.timeBonus = Math.min(
          1000,
          Math.round(((state.par.ticks - state.tick) / SIM_FPS) * 50)
        );
      }
      finalizeInPlace(state, 'won', 'goal-complete');
      events.push({ type: 'win', reason: 'goal-complete' });
    }
  } else {
    state.misses += 1;
    state.comboStreak = 0;
    state.score.missPenalty -= result.outcome === 'hit-marker' ? 200 : 100;
    events.push({
      type: 'miss',
      blockedBy: result.outcome,
      angle: result.contact,
      blocker: result.blocker,
    });
    if (state.misses > state.missesAllowed) {
      finalizeInPlace(state, 'lost', result.outcome === 'hit-marker' ? 'marker-struck' : 'too-many-misses');
      events.push({ type: 'lose', reason: state.terminalReason });
    }
  }

  state.events = events;
  return { state, events, error: null };
}

/** Advance the simulation clock. No-op for terminal states. */
export function advanceTick(prev, ticks = 1) {
  if (prev.status === 'active' && prev.timeLimitTicks && prev.tick + ticks >= prev.timeLimitTicks) {
    const state = cloneState(prev);
    state.tick = prev.timeLimitTicks;
    finalizeInPlace(state, 'lost', 'time-expired');
    state.events = [{ type: 'lose', reason: 'time-expired' }];
    return state;
  }
  if (prev.status !== 'active') return prev;
  const state = cloneState(prev);
  state.tick += ticks;
  state.events = [];
  return state;
}

function cloneState(state) {
  return { ...state, rotation: { ...state.rotation }, slots: state.slots.map((s) => ({ ...s })), score: { ...state.score }, par: { ...state.par }, events: [] };
}

function finalizeInPlace(state, status, reason) {
  state.status = status;
  state.terminalReason = reason;
}

function finalize(state, status, reason, cmdId) {
  state.commandCount += 1;
  if (cmdId) state.lastCommandId = cmdId;
  finalizeInPlace(state, status, reason);
  state.events = [];
  return state;
}

// ---------------------------------------------------------------------------
// Result comparison (ties) & scoring report
// ---------------------------------------------------------------------------

/**
 * Tie order: objective completion, fewer invalid actions, lower elapsed ticks,
 * then stable session identifier.
 */
export function compareResults(a, b) {
  if (a.won !== b.won) return a.won ? -1 : 1;
  if (a.total !== b.total) return b.total - a.total;
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.ticks !== b.ticks) return a.ticks - b.ticks;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}

export function scoreReport(state) {
  return {
    won: state.status === 'won',
    reason: state.terminalReason,
    total: totalScore(state),
    components: { ...state.score },
    embedded: state.embedded,
    goal: state.goal,
    misses: state.misses,
    invalid: state.invalidCount,
    ticks: state.tick,
    bestCombo: state.bestCombo,
    par: { ...state.par },
  };
}

// ---------------------------------------------------------------------------
// Serialization & migration
// ---------------------------------------------------------------------------

export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(json) {
  let state;
  try {
    state = JSON.parse(json);
  } catch {
    return { state: null, error: 'bad-json' };
  }
  if (!state || typeof state !== 'object') return { state: null, error: 'bad-shape' };
  if (state.v === undefined || state.v > RULES_VERSION) {
    return { state: null, error: 'unsupported-version' };
  }
  // Migration path: currently only v1 exists; fill defaults defensively.
  state.events = [];
  state.invalidCount = state.invalidCount || 0;
  return { state, error: null };
}
