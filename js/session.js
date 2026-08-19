/**
 * Blade Orbit — session module.
 * Owns command issuance, snapshots, undo (practice), replay envelopes,
 * and local persistence. No module except this one touches rules state.
 */

import {
  createGame, applyCommand, advanceTick, serialize, deserialize,
  hashState, scoreReport, findBestThrowTick, previewThrow, RULES_VERSION,
} from './rules.js';

export const REPLAY_SCHEMA = 1;

const LS_KEYS = {
  settings: 'blade-orbit:settings',
  progression: 'blade-orbit:progression',
  scores: 'blade-orbit:scores',
  achievements: 'blade-orbit:achievements',
  snapshot: 'blade-orbit:snapshot',
  replay: (id) => `blade-orbit:replay:${id}`,
};

// ---------------------------------------------------------------------------
// Session controller
// ---------------------------------------------------------------------------

export class Session {
  constructor(content, { allowUndo = false } = {}) {
    this.content = content;
    this.state = createGame(content);
    this.allowUndo = allowUndo;
    this.commandSeq = 0;
    this.commands = []; // ordered command log (replay)
    this.snapshots = []; // undo stack (state before each command)
    this.hashes = [{ tick: 0, hash: hashState(this.state) }];
    this.sessionId = makeSessionId();
    this.startedAt = Date.now();
  }

  /** Issue a validated command. Returns {applied, events, error}. */
  throw() {
    const cmd = { id: `${this.sessionId}:${++this.commandSeq}`, type: 'throw', tick: this.state.tick };
    if (this.allowUndo) this.snapshots.push(serialize(this.state));
    const { state, events, error } = applyCommand(this.state, cmd);
    if (error) {
      this.state = { ...this.state, invalidCount: this.state.invalidCount + 1 };
      return { applied: false, events: [], error };
    }
    this.state = state;
    this.commands.push(cmd);
    if (this.state.tick % 120 === 0 || this.state.status !== 'active') {
      this.hashes.push({ tick: this.state.tick, hash: hashState(this.state) });
    }
    return { applied: true, events, error: null };
  }

  /** Advance the simulation clock by whole ticks. */
  tick(n = 1) {
    const before = this.state.status;
    this.state = advanceTick(this.state, n);
    if (before === 'active' && this.state.status !== 'active') {
      return this.state.events;
    }
    return [];
  }

  /** Practice-only undo: restores the state before the last command. */
  undo() {
    if (!this.allowUndo || this.snapshots.length === 0) return { ok: false, error: 'undo-unavailable' };
    const { state, error } = deserialize(this.snapshots.pop());
    if (error || !state) return { ok: false, error: 'undo-corrupt' };
    this.state = state;
    this.commands.pop();
    this.commandSeq -= 1;
    this.hashes.push({ tick: state.tick, hash: hashState(state) });
    return { ok: true };
  }

  hint() {
    if (this.state.status !== 'active') return null;
    return findBestThrowTick(this.state);
  }

  previewNow() {
    return previewThrow(this.state, this.state.tick);
  }

  report() {
    return { ...scoreReport(this.state), sessionId: this.sessionId };
  }

  /** Replay envelope: schema, versions, seed, initial hash, commands, periodic hashes, result. */
  replayEnvelope() {
    return {
      schema: REPLAY_SCHEMA,
      rulesVersion: RULES_VERSION,
      content: this.content,
      seed: this.content.seed,
      initialHash: this.hashes[0].hash,
      timestampOffset: Date.now() - this.startedAt,
      commands: this.commands,
      hashes: this.hashes,
      result: this.report(),
    };
  }

  snapshotJson() {
    return serialize(this.state);
  }

  static restore(content, snapshotJson) {
    const { state, error } = deserialize(snapshotJson);
    if (error || !state || state.contentId !== content.id) return null;
    const s = new Session(content, { allowUndo: true });
    s.state = state;
    return s;
  }
}

export function makeSessionId() {
  return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * Deterministic replay verification: re-run the envelope and confirm every
 * recorded hash plus the terminal result. Returns {ok, mismatches[]}.
 */
export function verifyReplay(envelope) {
  const mismatches = [];
  if (!envelope || envelope.schema !== REPLAY_SCHEMA) {
    return { ok: false, mismatches: ['bad-schema'] };
  }
  let state = createGame(envelope.content);
  if (hashState(state) !== envelope.initialHash) mismatches.push('initial-hash');
  for (const cmd of envelope.commands || []) {
    // re-create the authoritative clock position the command was issued at
    if (Number.isInteger(cmd.tick) && cmd.tick > state.tick) {
      state = advanceTick(state, cmd.tick - state.tick);
    }
    const { state: next, error } = applyCommand(state, cmd);
    if (error) mismatches.push(`command-${cmd.id}:${error}`);
    state = next;
  }
  const finalHash = hashState(state);
  const lastRecorded = (envelope.hashes || [])[envelope.hashes.length - 1];
  if (lastRecorded && lastRecorded.hash !== finalHash) mismatches.push('final-hash');
  const report = scoreReport(state);
  if (envelope.result && report.total !== envelope.result.total) mismatches.push('score');
  if (envelope.result && report.ticks !== envelope.result.ticks) mismatches.push('ticks');
  return { ok: mismatches.length === 0, mismatches, report };
}

// ---------------------------------------------------------------------------
// Local persistence (per-game settings, progression, scores, achievements)
// ---------------------------------------------------------------------------

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked — non-fatal */ }
}

export const store = {
  getSettings() {
    return {
      music: 0.7, effects: 0.9, ambience: 0.5, voice: 0.8,
      quality: 'auto', reducedMotion: false, highContrast: false,
      palette: 'default', textScale: 1, leftHanded: false,
      holdToAim: false, timingAssist: false, haptics: true,
      captions: true, camera: 'default',
      ...load(LS_KEYS.settings, {}),
    };
  },
  saveSettings(s) { save(LS_KEYS.settings, s); },

  getProgression() {
    return {
      journeyUnlocked: 1, journeyStars: {}, tutorialsDone: {},
      masteryXp: 0, totalThrows: 0, totalEmbeds: 0, sessionsPlayed: 0,
      dailyDone: {}, cosmetics: ['ember-oak'],
      ...load(LS_KEYS.progression, {}),
    };
  },
  saveProgression(p) { save(LS_KEYS.progression, p); },

  getScores() { return load(LS_KEYS.scores, {}); },
  recordScore(contentId, entry) {
    const scores = load(LS_KEYS.scores, {});
    const prev = scores[contentId];
    if (!prev || entry.total > prev.total) {
      scores[contentId] = entry;
      save(LS_KEYS.scores, scores);
      return true; // new best
    }
    return false;
  },

  getAchievements() { return load(LS_KEYS.achievements, {}); },
  unlockAchievement(key) {
    const a = load(LS_KEYS.achievements, {});
    if (a[key]) return false; // idempotent
    a[key] = Date.now();
    save(LS_KEYS.achievements, a);
    return true;
  },

  saveSnapshot(contentId, json) { save(LS_KEYS.snapshot, { contentId, json }); },
  loadSnapshot() { return load(LS_KEYS.snapshot, null); },
  clearSnapshot() { save(LS_KEYS.snapshot, null); },

  saveReplay(id, envelope) { save(LS_KEYS.replay(id), envelope); },
  loadReplay(id) { return load(LS_KEYS.replay(id), null); },
};

// ---------------------------------------------------------------------------
// Achievements — stable lowercase ids, idempotent unlocks
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { key: 'first_clear', name: 'First Blood of Oak', description: 'Complete your first stage.' },
  { key: 'tutorial_master', name: 'Quick Study', description: 'Finish all four lessons.' },
  { key: 'combo_five', name: 'Five in Flight', description: 'Land a 5-throw combo streak.' },
  { key: 'streak_seven', name: 'Hearth Regular', description: 'Play on 7 different days.' },
  { key: 'mastery_tier5', name: 'Grand Mastery', description: 'Clear a Tier-5 mastery stage.' },
  { key: 'journey_done', name: 'Wheel Conqueror', description: 'Complete all 40 journey stages.' },
  { key: 'throws_1000', name: 'Thousand Throws', description: 'Throw 1000 blades in total.' },
  { key: 'flawless_win', name: 'Untouched', description: 'Win a stage with zero misses.' },
];

export function evaluateAchievements(session, progression) {
  const unlocked = [];
  const got = (key, cond) => {
    if (cond && store.unlockAchievement(key)) unlocked.push(key);
  };
  const report = session.report();
  got('first_clear', report.won);
  got('combo_five', session.state.bestCombo >= 5);
  got('flawless_win', report.won && report.misses === 0);
  got('tutorial_master', TUTORIAL_KEYS.every((k) => progression.tutorialsDone[k]));
  got('mastery_tier5', report.won && session.content.mastery && session.content.tier === 5);
  got('journey_done', progression.journeyUnlocked > 40);
  got('throws_1000', progression.totalThrows >= 1000);
  got('streak_seven', Object.keys(progression.dailyDone).length >= 7);
  return unlocked;
}

const TUTORIAL_KEYS = ['tut-throw', 'tut-spacing', 'tut-markers', 'tut-mastery'];
