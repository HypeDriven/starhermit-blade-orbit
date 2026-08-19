/**
 * Blade Orbit — rules, content, and replay tests (node:test).
 * Covers: legal actions, invalid-action reasons, scoring components,
 * terminal states, serialization/migration, deterministic replay (property),
 * content validation for all shipped stages, and malformed-command fuzzing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyCommand, advanceTick, legalActions, previewThrow,
  findBestThrowTick, hashState, serialize, deserialize, totalScore,
  compareResults, scoreReport, rotationAt, makeRng, SIM_FPS,
} from '../js/rules.js';
import {
  JOURNEY, TUTORIALS, CHALLENGES, THEMES, dailyContent, practiceContent,
  validateContent, validateAllContent, generateStage,
} from '../js/content.js';
import { verifyReplay, REPLAY_SCHEMA } from '../js/session.js';

const SIMPLE = {
  id: 'test', version: 1, kind: 'practice', seed: 'test', name: 'Test',
  goal: 2, missesAllowed: 1,
  rotation: { startAngle: 0, baseSpeed: 0.01, oscAmp: 0, oscPeriod: 0, triAmp: 0, triPeriod: 0 },
  preplaced: [], par: { score: 200, ticks: 600 }, mechanics: ['throw'],
  theme: THEMES[0].id, timeLimitTicks: 0,
};

let cmdSeq = 0;
const cmd = (tick) => ({ id: `t${++cmdSeq}`, type: 'throw', tick });

// --- legal actions -----------------------------------------------------------

test('legal actions: throw while active, none after terminal', () => {
  let s = createGame(SIMPLE);
  assert.deepEqual(legalActions(s).map((a) => a.type), ['throw']);
  // win the game with clean, well-spaced throws
  for (let i = 0; i < 2; i++) {
    const best = findBestThrowTick(s);
    s = advanceTick(s, best.tick - s.tick);
    const r = applyCommand(s, cmd(s.tick));
    assert.equal(r.error, null);
    s = r.state;
  }
  assert.equal(s.status, 'won');
  assert.equal(legalActions(s).length, 0);
});

test('deterministic rotation function', () => {
  const p = { startAngle: 0.5, baseSpeed: 0.01, oscAmp: 0.004, oscPeriod: 300, triAmp: 0.02, triPeriod: 700 };
  assert.equal(rotationAt(p, 12345), rotationAt(p, 12345));
  assert.notEqual(rotationAt(p, 100), rotationAt(p, 101));
});

// --- invalid action reasons ----------------------------------------------------

test('invalid commands are rejected with reasons', () => {
  let s = createGame(SIMPLE);
  assert.equal(applyCommand(s, null).error, 'malformed-command');
  assert.equal(applyCommand(s, { type: 'throw' }).error, 'malformed-command');
  assert.equal(applyCommand(s, { id: 'x', type: 'poke' }).error, 'unknown-action');
  assert.equal(applyCommand(s, { id: 'x', type: 'throw', tick: -3 }).error, 'bad-tick');
  assert.equal(applyCommand(s, { id: 'x', type: 'throw', tick: 99 }).error, 'future-tick');
  // state must be unchanged after rejects
  assert.equal(s.commandCount, 0);
  const c = cmd(s.tick);
  let r = applyCommand(s, c);
  assert.equal(r.error, null);
  assert.equal(applyCommand(r.state, c).error, 'duplicate-command'); // idempotent
  let later = advanceTick(r.state, 10);
  assert.equal(applyCommand(later, { id: 'later', type: 'throw', tick: 0 }).error, 'stale-tick');
});

// --- scoring components ----------------------------------------------------------

test('scoring: hits, precision, combo, miss penalty, time bonus', () => {
  let s = createGame({ ...SIMPLE, goal: 3, missesAllowed: 5 });
  // open wheel: everything embeds; first throw at tick 0 → contact angle 0
  let r = applyCommand(s, cmd(0));
  s = r.state;
  assert.equal(s.score.hits, 100);
  assert.equal(s.score.precision, 100); // empty wheel → max clearance
  assert.equal(s.score.combo, 0);
  // throw immediately again → strikes the blade just placed (wheel moved only 0.01 rad)
  s = advanceTick(s, 1);
  r = applyCommand(s, cmd(s.tick));
  s = r.state;
  assert.equal(s.misses, 1);
  assert.equal(s.score.missPenalty, -100);
  assert.equal(s.comboStreak, 0);
  // wait for a clean gap, then build a combo
  for (let i = 0; i < 2; i++) {
    const best = findBestThrowTick(s);
    s = advanceTick(s, best.tick - s.tick);
    r = applyCommand(s, cmd(s.tick));
    assert.equal(r.events[0].type, 'embed');
    s = r.state;
  }
  assert.equal(s.status, 'won');
  assert.equal(s.score.combo, 25); // streak of 2 → one combo step
  assert.ok(s.score.timeBonus > 0); // finished well under par
  assert.equal(totalScore(s), s.score.hits + s.score.precision + s.score.combo + s.score.timeBonus + s.score.missPenalty);
});

// --- terminal states --------------------------------------------------------------

test('terminal: too many misses loses', () => {
  let s = createGame({ ...SIMPLE, missesAllowed: 0 });
  // place a blade, then immediately hit it
  let r = applyCommand(s, cmd(0));
  s = r.state;
  s = advanceTick(s, 1);
  r = applyCommand(s, cmd(s.tick));
  s = r.state;
  assert.equal(s.status, 'lost');
  assert.equal(s.terminalReason, 'too-many-misses');
  assert.equal(applyCommand(s, cmd(s.tick)).error, 'game-over');
});

test('terminal: marker struck with no misses left gives marker reason', () => {
  const c = { ...SIMPLE, missesAllowed: 0, preplaced: [{ deg: 180, type: 'marker' }] };
  let s = createGame(c);
  // find a tick where contact lands on the marker (contact = -rotation)
  // rotation = 0.01t → contact hits PI at t ≈ 314
  const t = Math.round(Math.PI / 0.01);
  s = advanceTick(s, t);
  const r = applyCommand(s, cmd(s.tick));
  assert.equal(r.events[0].blockedBy, 'hit-marker');
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.terminalReason, 'marker-struck');
});

test('terminal: time limit expiry', () => {
  const c = { ...SIMPLE, timeLimitTicks: 100 };
  let s = createGame(c);
  s = advanceTick(s, 100);
  assert.equal(s.status, 'lost');
  assert.equal(s.terminalReason, 'time-expired');
});

// --- serialization & migration ------------------------------------------------------

test('serialization round-trips; version guarded', () => {
  let s = createGame(SIMPLE);
  s = applyCommand(s, cmd(0)).state;
  const { state: back, error } = deserialize(serialize(s));
  assert.equal(error, null);
  assert.equal(hashState(back), hashState(s));
  assert.equal(deserialize('{nope').error, 'bad-json');
  assert.equal(deserialize('{"v":99}').error, 'unsupported-version');
});

// --- deterministic replay (property) ---------------------------------------------------

/** Bot: always throw at the best upcoming tick. Deterministic. */
function playToEnd(content, maxTicks = 60000) {
  let state = createGame(content);
  const commands = [];
  const hashes = [{ tick: 0, hash: hashState(state) }];
  let n = 0;
  while (state.status === 'active' && state.tick < maxTicks) {
    if (!legalActions(state).length) { state = advanceTick(state, 1); continue; }
    const best = findBestThrowTick(state);
    if (best.clearance <= 0) { state = advanceTick(state, 120); continue; } // no clean gap yet
    state = advanceTick(state, Math.max(0, best.tick - state.tick));
    const c = { id: `b${++n}`, type: 'throw', tick: state.tick };
    const r = applyCommand(state, c);
    assert.equal(r.error, null);
    commands.push(c);
    state = r.state;
  }
  hashes.push({ tick: state.tick, hash: hashState(state) });
  return {
    envelope: {
      schema: REPLAY_SCHEMA, rulesVersion: 1, content, seed: content.seed,
      initialHash: hashes[0].hash, timestampOffset: 0, commands, hashes,
      result: { ...scoreReport(state), sessionId: 'bot' },
    },
    finalHash: hashState(state),
    state,
  };
}

test('replay: same seed + commands → identical state hashes (property over stages)', () => {
  const samples = [JOURNEY[0], JOURNEY[11], JOURNEY[23], JOURNEY[39], TUTORIALS[2], dailyContent()];
  for (const content of samples) {
    const a = playToEnd(content);
    const b = playToEnd(content);
    assert.equal(a.finalHash, b.finalHash, `hash mismatch for ${content.id}`);
    const check = verifyReplay(a.envelope);
    assert.ok(check.ok, `replay failed for ${content.id}: ${check.mismatches}`);
    assert.equal(check.report.total, a.envelope.result.total);
    // bot must actually clear every validated stage (proves reachability)
    assert.equal(a.state.status, 'won', `bot failed to clear ${content.id}`);
  }
});

test('replay: tampered commands are detected', () => {
  const { envelope } = playToEnd(JOURNEY[5]);
  const tampered = structuredClone(envelope);
  tampered.commands[0] = { ...tampered.commands[0], tick: tampered.commands[0].tick + 30 };
  const check = verifyReplay(tampered);
  assert.equal(check.ok, false);
});

// --- content validation --------------------------------------------------------------

test('all shipped content passes offline validators', () => {
  const report = validateAllContent();
  assert.ok(report.ok, JSON.stringify(report.failures, null, 2));
  assert.equal(JOURNEY.length, 40);
  assert.equal(TUTORIALS.length, 4);
  assert.ok(CHALLENGES.length >= 4);
  assert.equal(THEMES.length, 5);
});

test('generator is deterministic and difficulty scales', () => {
  const a = generateStage('seed-x', 3, 2);
  const b = generateStage('seed-x', 3, 2);
  assert.deepEqual(a, b);
  const easy = generateStage('seed-x', 1, 0);
  const hard = generateStage('seed-x', 5, 7);
  assert.ok(hard.preplaced.length >= easy.preplaced.length);
  assert.ok(Math.abs(hard.rotation.baseSpeed) > Math.abs(easy.rotation.baseSpeed));
});

test('daily content is stable per UTC day and differs across days', () => {
  const d1 = dailyContent(new Date('2026-08-18T10:00:00Z'));
  const d2 = dailyContent(new Date('2026-08-18T23:59:00Z'));
  const d3 = dailyContent(new Date('2026-08-19T00:00:00Z'));
  assert.equal(d1.id, d2.id);
  assert.deepEqual(d1, d2);
  assert.notEqual(d1.id, d3.id);
});

test('practice content validates at every difficulty', () => {
  for (const d of ['easy', 'normal', 'hard', 'expert', 'master']) {
    const c = practiceContent(d, `fixed-${d}`);
    const v = validateContent(c);
    assert.ok(v.ok, `${d}: ${v.errors}`);
  }
});

// --- fuzzing --------------------------------------------------------------------------

test('fuzz: malformed commands never hang, crash, or corrupt state', () => {
  const rng = makeRng('fuzz');
  for (const content of [SIMPLE, JOURNEY[17], JOURNEY[33]]) {
    let state = createGame(content);
    for (let i = 0; i < 500; i++) {
      const weird = [
        null, undefined, {}, { id: i }, { id: String(i), type: 'throw', tick: rng.int(10000) - 5000 },
        { id: String(i), type: 'throw', tick: state.tick },
        { id: String(i), type: ['x'], tick: {} },
        { id: '', type: 'throw' }, 'throw', 42, [],
      ][rng.int(9)];
      const before = hashState(state);
      const { state: next, error } = applyCommand(state, weird);
      if (error) {
        assert.equal(next, state);
        assert.equal(hashState(state), before);
      } else {
        state = next;
        assert.ok(Number.isFinite(totalScore(state)));
        assert.ok(state.embedded <= state.goal);
      }
      if (state.status !== 'active') break;
      if (i % 3 === 0) state = advanceTick(state, rng.int(10));
    }
  }
});

test('fuzz: generated content at all tiers is valid and bot-clearable', () => {
  const rng = makeRng('content-fuzz');
  for (let i = 0; i < 20; i++) {
    const c = generateStage(`fuzz-${rng.int(1e9)}`, 1 + rng.int(5), rng.int(8));
    const v = validateContent(c);
    assert.ok(v.ok, `${c.id}: ${v.errors}`);
    const { state } = playToEnd(c);
    assert.equal(state.status, 'won', `bot failed on ${c.id}`);
  }
});

// --- result comparison (tie order) -------------------------------------------------------

test('compareResults: completion, invalids, ticks, session id', () => {
  const base = { won: true, total: 500, invalid: 0, ticks: 900, sessionId: 'a' };
  assert.ok(compareResults(base, { ...base, won: false }) < 0);
  assert.ok(compareResults(base, { ...base, total: 600 }) > 0);
  assert.ok(compareResults(base, { ...base, invalid: 1 }) < 0);
  assert.ok(compareResults(base, { ...base, ticks: 950 }) < 0);
  assert.ok(compareResults(base, { ...base, sessionId: 'b' }) < 0);
  assert.equal(compareResults(base, { ...base }), 0);
});
