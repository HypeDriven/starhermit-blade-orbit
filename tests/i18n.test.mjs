// Every client string in the nine locales: the string tables (js/i18n.js
// with the account lines of js/account-strings.js folded in) have every
// en-US key with the same placeholders, are really translated, and hold
// every key the engine client (native/*.ts) asks for. Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS, LOCALES, t, setLocale, getLang } from '../js/i18n.js';
import { JOURNEY, TUTORIALS, CHALLENGES } from '../js/content.js';
import { ACHIEVEMENTS } from '../js/session.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('nine locales, every key with its placeholders', () => {
  assert.deepEqual(LOCALES, ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']);
  const keys = Object.keys(STRINGS['en-US']);
  for (const loc of LOCALES) {
    for (const k of keys) {
      const v = STRINGS[loc][k];
      assert.ok(typeof v === 'string' && v.length, `${loc} ${k}`);
      const want = (STRINGS['en-US'][k].match(/\{\w+\}/g) || []).sort().join();
      assert.equal((v.match(/\{\w+\}/g) || []).sort().join(), want, `${loc} ${k} placeholders`);
    }
  }
  // translations are real: most UI strings differ from English outside en-GB
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = keys.filter((k) => STRINGS[loc][k] === STRINGS['en-US'][k]).length;
    assert.ok(same < keys.length * 0.15, `${loc}: ${same} untranslated`);
  }
});

test('content names, lessons, challenges and achievements are keyed', () => {
  const keys = Object.keys(STRINGS['en-US']);
  for (const c of TUTORIALS) for (const k of [`tut.${c.id}`, `tut.${c.id}.0`, `tut.${c.id}.1`]) assert.ok(keys.includes(k), k);
  for (const c of CHALLENGES) assert.ok(keys.includes(`ch.${c.id}`) && keys.includes(`chd.${c.id}`), c.id);
  for (let i = 0; i < 5; i++) assert.ok(keys.includes(`tier.${i}`));
  for (const a of ACHIEVEMENTS) assert.ok(keys.includes(`ach.${a.key}`), a.key);
  assert.equal(JOURNEY.length, 40);
});

test('every key the engine client asks for exists', () => {
  const keys = new Set(Object.keys(STRINGS['en-US']));
  const missing = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'native')).filter((n) => n.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(ROOT, 'native', f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)"\s*[,)]/g)) if (!keys.has(m[1])) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('the account lines are folded in, the leaderboard rank keeps its placeholder', () => {
  for (const loc of LOCALES) {
    for (const k of ['acct.signIn', 'acct.invite', 'acct.inviteCopied', 'acct.signedOut', 'acct.lbPosting', 'acct.lbRank', 'acct.lbPosted', 'acct.lbNotPosted']) assert.ok(STRINGS[loc][k], `${loc} ${k}`);
    assert.ok(STRINGS[loc]['acct.lbRank'].includes('{rank}'), loc);
  }
});

test('setLocale switches, falls back to en-US and tells listeners', () => {
  setLocale('de-DE');
  assert.equal(getLang(), 'de-DE');
  assert.equal(t('btn.play'), STRINGS['de-DE']['btn.play']);
  assert.equal(t('hint.wait', { s: '1.5' }), STRINGS['de-DE']['hint.wait'].replace('{s}', '1.5'));
  setLocale('xx-YY');
  assert.equal(getLang(), 'en-US');
  assert.equal(t('no.such.key', null, 'fallback'), 'fallback');
});
