// The engine client's save document and the browser build's leftovers
// (js/migrate.js): the foreign cloud save's text, two devices' documents
// merged on a conflict, the browser build's settings keys. Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/migrate.js';

const mine = { v: 1, progression: { journeyUnlocked: 6, journeyStars: { 'journey-1': 3 }, tutorialsDone: { 'tut-throw': true }, masteryXp: 40, sessionsPlayed: 3 },
  scores: { 'journey-1': { total: 900 } }, achievements: { first_clear: 200 } };
const theirs = { v: 1, progression: { journeyUnlocked: 3, journeyStars: { 'journey-1': 1, 'journey-2': 2 }, tutorialsDone: { 'tut-spacing': true }, masteryXp: 70, sessionsPlayed: 9 },
  scores: { 'journey-1': { total: 500 }, 'journey-2': { total: 650 } }, achievements: { first_clear: 100, combo_five: 300 } };

test('the browser build\'s cloud save text is the same document', () => {
  assert.deepEqual(M.docFromBrowserSave(JSON.stringify(mine)), mine);
  // the browser build exported null for parts it never wrote
  assert.deepEqual(M.docFromBrowserSave(JSON.stringify({ v: 1, progression: null, scores: null, achievements: { a: 1 } })),
    { v: 1, progression: {}, scores: {}, achievements: { a: 1 } });
  assert.equal(M.docFromBrowserSave('not json'), null);
  assert.equal(M.docFromBrowserSave(JSON.stringify({ v: 2 })), null);
  assert.equal(M.docFromBrowserSave(null), null);
  assert.equal(M.docFromSave([1, 2]), null);
});

test('a conflict keeps the better value of every field', () => {
  const m = M.mergeDocs(theirs, mine);
  assert.equal(m.progression.journeyUnlocked, 6);
  assert.deepEqual(m.progression.journeyStars, { 'journey-1': 3, 'journey-2': 2 });
  assert.deepEqual(m.progression.tutorialsDone, { 'tut-throw': true, 'tut-spacing': true });
  assert.equal(m.progression.masteryXp, 70);
  assert.equal(m.progression.sessionsPlayed, 9);
  assert.equal(m.scores['journey-1'].total, 900);
  assert.equal(m.scores['journey-2'].total, 650);
  assert.deepEqual(m.achievements, { first_clear: 100, combo_five: 300 });
  // either side missing: the other, normalized
  assert.deepEqual(M.mergeDocs(null, mine), mine);
  assert.deepEqual(M.mergeDocs(theirs, null), theirs);
  assert.deepEqual(M.mergeDocs(null, null), { v: 1, progression: {}, scores: {}, achievements: {} });
});

test('merging is idempotent and order-independent for the counters', () => {
  const a = M.mergeDocs(theirs, mine), b = M.mergeDocs(mine, theirs);
  assert.deepEqual(a.progression.journeyStars, b.progression.journeyStars);
  assert.deepEqual(a.achievements, b.achievements);
  assert.deepEqual(M.mergeDocs(a, a), a);
});

test('the browser build\'s settings: the game\'s own kept, the runtime\'s dropped', () => {
  assert.equal(M.migrateSetting('captions', false), false);
  assert.equal(M.migrateSetting('palette', 'tritanopia'), 'tritanopia');
  assert.equal(M.migrateSetting('palette', 'neon'), undefined);
  assert.equal(M.migrateSetting('leftHanded', true), true);
  assert.equal(M.migrateSetting('holdToAim', 'yes'), undefined);
  for (const k of ['music', 'effects', 'ambience', 'voice', 'quality', 'graphics', 'reducedMotion', 'highContrast', 'textScale', 'camera', 'ui.language']) {
    assert.ok(M.BROWSER_SETTING_KEYS.includes(k), k);
    assert.equal(M.migrateSetting(k, 1), undefined, k);
  }
  for (const k of M.GAME_SETTING_KEYS) assert.ok(k in M.DEFAULT_SETTINGS, k);
});
