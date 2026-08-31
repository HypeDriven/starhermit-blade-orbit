/**
 * Blade Orbit — authoritative StarHermit Game Script.
 * Dependency-free Node server: serves the distribution, exposes
 * /api/v1/time (clock sync), /api/v1/scores (replay-validated daily board),
 * and /api/v1/telemetry (anonymous funnel sink). Ordinary practice runs
 * fully local and offline; this script only validates competitive claims.
 *
 * Declared in starhermit.txt as `server=server.js`. No secrets, no containers.
 */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dailyContent, validateContent } from './js/content.js';
import { verifyReplay } from './js/session.js';
import { compareResults } from './js/rules.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8080;
const DATA_DIR = join(ROOT, 'data');
const SCORES_FILE = join(DATA_DIR, 'scores.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.opus': 'audio/ogg',
};

// --- tiny persistent leaderboard store --------------------------------------

let scores = {};
async function loadScores() {
  try { scores = JSON.parse(await readFile(SCORES_FILE, 'utf8')); } catch { scores = {}; }
}
async function saveScores() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SCORES_FILE, JSON.stringify(scores));
}

// --- rate limiting (per-IP token bucket) -------------------------------------

const buckets = new Map();
function rateLimited(ip, cost = 1, perMinute = 60) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.start > 60000) { b = { start: now, used: 0 }; buckets.set(ip, b); }
  b.used += cost;
  return b.used > perMinute;
}

// --- routes --------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress || 'anon';

  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/api/v1/time') {
    return json(200, { now: Date.now() });
  }

  if (url.pathname === '/api/v1/daily') {
    const d = dailyContent(new Date());
    return json(200, { id: d.id, version: d.version, seed: d.seed, ruleset: 'v1' });
  }

  if (url.pathname === '/api/v1/scores' && req.method === 'POST') {
    if (rateLimited(ip, 1, 20)) return json(429, { error: 'rate-limited' });
    const body = await readBody(req, 256 * 1024);
    if (!body) return json(413, { error: 'payload-too-large' });
    let envelope;
    try { envelope = JSON.parse(body); } catch { return json(400, { error: 'bad-json' }); }

    // Validate: content identity, freshness, replay determinism, plausibility.
    if (!envelope.content || envelope.content.kind !== 'daily') {
      return json(400, { error: 'only-daily-ranked' });
    }
    const expected = dailyContent(new Date());
    if (envelope.content.id !== expected.id || envelope.seed !== expected.seed) {
      return json(400, { error: 'stale-or-wrong-seed' });
    }
    const v = validateContent(envelope.content);
    if (!v.ok) return json(400, { error: 'invalid-content' });
    const check = verifyReplay(envelope);
    if (!check.ok) return json(400, { error: 'replay-mismatch', detail: check.mismatches });
    if (!check.report.won && check.report.total > expected.par.score) {
      return json(400, { error: 'implausible' });
    }

    const board = scores[expected.id] || (scores[expected.id] = []);
    const entry = {
      sessionId: envelope.result.sessionId,
      total: check.report.total,
      won: check.report.won,
      invalid: check.report.invalid,
      ticks: check.report.ticks,
      ruleset: 'v1',
      contentVersion: envelope.content.version,
      seed: envelope.seed,
      at: Date.now(),
    };
    if (board.some((e) => e.sessionId === entry.sessionId)) {
      return json(200, { ok: true, duplicate: true }); // idempotent
    }
    board.push(entry);
    board.sort(compareResults);
    await saveScores();
    return json(200, { ok: true, rank: board.indexOf(entry) + 1 });
  }

  if (url.pathname.startsWith('/api/v1/scores/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/v1/scores/'.length));
    const board = (scores[id] || []).slice(0, 50);
    return json(200, { entries: board, label: 'ranked' });
  }

  if (url.pathname === '/api/v1/presence' && req.method === 'POST') {
    return json(200, { ok: true });
  }

  if (url.pathname === '/api/v1/telemetry' && req.method === 'POST') {
    if (rateLimited(ip, 1, 120)) return json(429, { error: 'rate-limited' });
    return json(204, {});
  }

  // static files (distribution only; no source maps, no secrets)
  if (req.method !== 'GET') return json(405, { error: 'method' });
  let path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  if (path === '/' || path === '\\') path = '/index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) return json(403, { error: 'forbidden' });
  if (path.startsWith('/data/')) return json(403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=86400, immutable',
    });
    res.end(data);
  } catch {
    json(404, { error: 'not-found' });
  }
});

function readBody(req, limit) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

await loadScores();
server.listen(PORT, () => {
  console.log(`Blade Orbit authoritative script listening on :${PORT}`);
});
