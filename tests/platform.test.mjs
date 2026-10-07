// StarHermit adapter tests: the SDK runs in a sandbox with a stubbed fetch
// and launch fragment; js/platform.js (Platform) drives it. Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Platform } from '../js/platform.js';
import { ACCOUNT_STRINGS, GFX_STRINGS } from '../js/gfx-i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'blade-orbit';
const USER = 'a1b2c3d4-0000-4000-8000-000000000001';
const b64url = (s) => Buffer.from(s).toString('base64url');
const jwt = (claims) => `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(claims))}.sig`;
const plain = (v) => JSON.parse(JSON.stringify(v));

function boot({ hash = '' } = {}) {
  const calls = [];
  const cloud = { bytes: null };
  const kv = { music: 0.2 };
  const ctx = {
    URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, Blob, Response, console,
    setTimeout: (fn, ms) => (ms > 5000 ? 0 : setTimeout(fn, ms)),
    clearTimeout: (id) => { if (id) clearTimeout(id); },
    location: { hash, search: '', pathname: '/', hostname: 'localhost', origin: 'http://localhost', href: `http://localhost/${hash}` },
    history: { state: null, replaceState(_s, _t, url) { ctx.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } },
  };
  ctx.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    const u = decodeURIComponent(url);
    if (u.endsWith(`/api/v1/users/${USER}/profile`)) return Response.json({ nickname: 'Thrower' });
    if (u.endsWith(`/cloud-saves/game:${SLUG}`)) {
      if (method === 'PUT') { cloud.bytes = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return new Response(null, { status: 204 }); }
      return cloud.bytes ? new Response(cloud.bytes) : new Response('', { status: 404 });
    }
    if (u.endsWith(`/games/${SLUG}/settings`)) {
      if (method === 'PATCH') Object.assign(kv, JSON.parse(init.body).settings);
      return Response.json({ settings: kv });
    }
    if (u === '/api/v1/time') return Response.json({ now: Date.now() + 60000 });
    if (u.endsWith(`/games/${SLUG}/controls`)) return Response.json({ actions: [{ action: 'hint', codes: ['KeyJ'] }] });
    if (u.endsWith(`/games/${SLUG}/leaderboards`)) return Response.json([{ id: 'lb1', key: 'daily' }]);
    if (u.includes('/leaderboards/lb1/entries')) return Response.json({ items: [{ rank: 1, score: 900, userId: USER }], total: 1 });
    return new Response('', { status: 404 });
  };
  ctx.self = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'starhermit-sdk.js'), 'utf8'), ctx, { filename: 'starhermit-sdk.js' });
  ctx.StarHermit.init();
  return { ctx, calls, cloud, kv, SH: ctx.StarHermit, P: new Platform(ctx.StarHermit) };
}

const KEYS = { hint: ['KeyH'], undo: ['KeyU'] };

test('standalone: no token, no StarHermit requests', async () => {
  const { P, calls } = boot();
  assert.equal(P.tokenHosted, false);
  const realFetch = globalThis.fetch;
  const own = [];
  globalThis.fetch = async (url) => { own.push(url); return new Response('', { status: 404 }); };
  try { await P.init(); } finally { globalThis.fetch = realFetch; } // no server-time request standalone
  assert.deepEqual(own, []);
  assert.equal(P.clockOffsetMs, 0);
  assert.equal(await P.fetchProfile(), null);
  assert.equal(await P.profileFor('abcdef123456'), 'Player abcdef12');
  assert.equal(await P.avatarUrl(), null);
  assert.equal(await P.loadAccount(KEYS), null);
  assert.equal(P.saveCloud({ v: 1 }), false);
  assert.equal(P.mirrorSettings({ music: 1 }), null);
  assert.equal((await P.fetchLeaderboard()).ok, false);
  assert.equal(P.inviteLink(), null);
  assert.equal(P.canSignIn(), false);
  assert.deepEqual(await P.submitScore(1234), { posted: false, rank: null });
  assert.equal(calls.length, 0);
});

test('launch token: identity, cloud save game:<slug>, settings, bindings, board', async () => {
  const token = jwt({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 });
  const { P, ctx, calls, cloud, kv } = boot({ hash: `#game_token=${token}&session_id=s1` });
  assert.equal(P.tokenHosted, true);
  assert.equal(P.scope, SLUG);
  assert.equal(P.userId, USER);
  assert.equal(P.token, token);
  assert.equal(ctx.location.hash, '', 'launch fragment stripped');
  assert.equal((await P.fetchProfile()).displayName, 'Thrower');
  const realFetch = globalThis.fetch;
  globalThis.fetch = ctx.fetch; // signed in: GET /api/v1/time with the Bearer token
  try { await P.init(); } finally { globalThis.fetch = realFetch; }
  assert.ok(P.clockOffsetMs > 50000);

  const acc = await P.loadAccount(KEYS);
  assert.equal(acc.remote, null);
  assert.deepEqual(plain(acc.settings), { music: 0.2 });
  assert.deepEqual(plain(acc.bindings), { hint: ['KeyJ'], undo: ['KeyU'] });

  await P.mirrorSettings({ music: 0.2, captions: false });
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.url.endsWith(`/api/v1/games/${SLUG}/settings`));
  assert.deepEqual(patch.body, { settings: { captions: false } });
  assert.equal(kv.captions, false);

  const doc = { v: 1, progression: { journeyUnlocked: 4 }, scores: {}, achievements: {} };
  assert.equal(P.saveCloud(doc), true);
  assert.equal(await P.flushCloud(), true);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(decodeURIComponent(put.url), `/api/v1/me/cloud-saves/game:${SLUG}`);
  const again = boot({ hash: `#game_token=${token}` });
  again.cloud.bytes = cloud.bytes;
  assert.deepEqual(plain((await again.P.loadAccount(KEYS)).remote), doc);

  const board = await P.fetchLeaderboard();
  assert.equal(board.ok, true);
  assert.deepEqual(plain(board.entries), [{ rank: 1, score: 900, userId: USER, name: 'Thrower' }]);

  assert.ok(calls.every((c) => c.auth === `Bearer ${token}`));
  assert.ok(!calls.some((c) => /\/api\/v1\/me(\/|$)/.test(c.url) && !c.url.includes('cloud-saves')), 'never /api/v1/me');
  assert.match(P.inviteLink(), new RegExp(`/game-invite/${USER}/${SLUG}$`));
});

test('sign-out on refused renewal stops cloud writes', async () => {
  const token = jwt({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 });
  const { P, SH } = boot({ hash: `#game_token=${token}` });
  await P.loadAccount(KEYS);
  const seen = [];
  P.onAuth((a) => seen.push(a.signedIn));
  SH.signOut('expired');
  assert.deepEqual(seen, [false]);
  assert.equal(P.tokenHosted, false);
  assert.equal(P.saveCloud({ v: 1 }), false);
  assert.equal(P.inviteLink(), null);
});

test('account strings exist in every required locale', () => {
  for (const loc of Object.keys(GFX_STRINGS))
    for (const k of Object.keys(ACCOUNT_STRINGS['en-US'])) assert.ok(ACCOUNT_STRINGS[loc]?.[k], `${loc}.${k}`);
  assert.equal(Object.keys(ACCOUNT_STRINGS).length, 9);
});

test('launch token: submitScore posts high-score and reads the rank', async () => {
  const { P, SH } = boot({ hash: '#game_token=' + jwt({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 }) });
  const sent = [];
  SH.submitScores = async (s) => { sent.push(plain(s)); return Object.keys(s); };
  SH.leaderboard = async (key) => ({ items: key === 'high-score' ? [{ userId: 'x', rank: 1 }, { userId: USER, rank: 2 }] : [] });
  assert.deepEqual(await P.submitScore(812.4), { posted: true, rank: 2 });
  assert.deepEqual(sent, [{ 'high-score': 812 }]);
  SH.submitScores = async () => [];
  assert.deepEqual(await P.submitScore(5), { posted: false, rank: null });
});

test('leaderboard line strings exist in every locale', () => {
  for (const [loc, t] of Object.entries(ACCOUNT_STRINGS)) {
    for (const k of ['lbPosting', 'lbRank', 'lbPosted', 'lbNotPosted']) assert.ok(t[k], loc + ' ' + k);
    assert.ok(t.lbRank.includes('{rank}'), loc);
  }
});
