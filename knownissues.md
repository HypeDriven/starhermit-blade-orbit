# Known Issues — Blade Orbit

## Review pass 2026-09-07 (Opus 5) — fixed

| Area | Defect | Fix |
| --- | --- | --- |
| Rules | `previewThrow` returned the **first** blocking slot in array order, so when a blade and a sigil both overlapped the contact the recorded hazard (and its −100 vs −200 penalty and loss reason) depended on slot ordering | the blocking slot is now the one with the minimum clearance (`js/rules.js`); covered by a new unit test |
| Session | a rejected throw pushed an undo snapshot before validation, so a later `undo()` popped a *previous* legitimate command off the replay log | the snapshot is pushed only after the command applies and `commandSeq` is rolled back on rejection (`js/session.js`); new unit test |
| Session | `Session.restore` always allowed undo, regardless of mode | resumed sessions use the same practice/tutorial rule as `startSession` |
| Loop | the simulation clock ran during the 3·2·1·GO countdown, spending ~2.8 s of every time limit and par-time bonus before the player could act | the countdown is now a cosmetic negative pre-roll; the sim starts at GO (`js/main.js`) |
| UI | Help/Settings opened from the top bar mid-round left the round running (and the timer draining) behind the overlay | overlays auto-pause a live round and resume on close (`js/ui.js`, `js/main.js`) |
| UI | backgrounding the tab paused the round without any visible explanation — the game looked frozen | a hidden tab now surfaces the pause panel |
| UI | "Resume paused round" was offered for snapshots whose stage cannot be rebuilt (e.g. randomly seeded practice), and clicking it did nothing | the title only offers resumable snapshots; the stale case clears the snapshot and announces it |
| Audio | the generative music stem stopped scheduling the first time the context was suspended (pause / hidden tab) and never came back | the stem re-schedules while suspended |
| Boot | a second `<link rel="icon">` data URI overrode the shipped `favicon.svg`; `<meta charset>` was not the first head element | duplicate icon removed, charset moved first |
| Server | the per-IP rate-limit map was never pruned (slow unbounded growth); `/api/v1/scores/<id>` answered any method | expired buckets are dropped past 1000 entries; the read route is `GET`-only |
| Repo | `LICENSE.md` was missing; the runtime `data/` leaderboard store was not ignored | PolyForm Noncommercial 1.0.0 added; `data/` added to `.gitignore` |

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on local5090 (HauhauCS Q3_K_P, 32k ctx),
alongside the game's own unit tests and end-to-end suite.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 17/17 pass, 0 fail |
| `node --check` on all modules | clean (`js/*.js`, `server.js`, `tests/*.mjs`) |
| `tests/e2e.mjs` (headless Chrome) | PASS — 14/14 steps, "E2E PASS — no page errors" — self-hosts the game: spawns `server.js` on an ephemeral port and serves the distribution through it (no pre-started server required) |

## Confirmed defects — RESOLVED

All three confirmed defects below were reproduced against the fixed source (the server fixes were
verified against `server.js` running on a scratch port; the rules fix was verified with a direct
`previewThrow` check on the worked example). Each entry is removed from the open list; there are **no
open confirmed defects**.

### 1. Daily leaderboard accepts a forged content definition — RESOLVED

**Fix (server.js):** the `/api/v1/scores` handler now compares the submitted `envelope.content`
against the server's own `dailyContent(new Date())` via `canonicalJson` (added to the rules import) and
returns `400 {error:'stale-or-wrong-seed'}` on any mismatch. The server owns the deal: a competitive
claim must supply exactly the board the server generated, so goal, missesAllowed, rotation, preplaced,
par and timeLimitTicks can no longer be attacker-controlled. `verifyReplay` still runs against the
server-verified content.

**Verification:** a forged envelope (same id/seed as today's daily, `goal:25`, `preplaced:[]`,
`par.score:999999`) now returns `400 {"error":"stale-or-wrong-seed"}` instead of `200 {"ok":true,"rank":1}`.
Legitimate submissions are unaffected — the game's own e2e daily run lands on the board (`entries:1`) and
passes.

### 2. Remote crash: `POST /api/v1/scores` without a `result` field — RESOLVED

**Fix (server.js):** the handler now rejects a submission whose `result` is missing or malformed before
any replay/dereference — `if (!envelope.result || typeof envelope.result !== 'object' ||
typeof envelope.result.sessionId !== 'string' || !envelope.result.sessionId) return json(400,...)`.

**Verification:** a well-formed score submission omitting `result` now returns `400 {"error":"bad-result"}`;
a follow-up `GET /api/v1/time` still returns `200`, confirming the process no longer crashes.

### 3. `previewThrow` reports the clearance of the *nearest* slot, not the *tightest* one — RESOLVED

**Fix (js/rules.js):** the `best` slot in `previewThrow` is now tracked by smallest clearance
(`if (!best || clearance < best.clearance)`) instead of smallest centre-to-centre distance, so the
reported/`findBestThrowTick`-ranked clearance is the binding (minimum-clearance) gap across all slots
regardless of type-dependent `SLOT_HALF`.

**Verification:** on the worked example (marker `d=0.2007`/clearance `0.0087`, blade `d=0.1902`/clearance
`0.0282`) `previewThrow` now reports `0.0087` (the tightest, marker gap) rather than the previous
`0.0282`. Existing scoring/hint tests (empty-wheel precision, `findBestThrowTick` embed search) still pass.

## Suspected — not confirmed

### 1. `compareResults` tie-break uses `localeCompare` for the final key

- **File:** `js/rules.js:384`
- **Concern:** `String(a.sessionId).localeCompare(String(b.sessionId))` is locale- and ICU-dependent.
  spec.md §2 asks for a "stable session identifier" tie-break, and the server sorts the persisted
  leaderboard with this comparator (`server.js:111`), so two hosts with different default locales could
  order identical data differently.
- **Why unconfirmed:** session ids generated by `makeSessionId` (`js/session.js:120-122`) are
  `s` + base36, i.e. ASCII lowercase alphanumerics, for which every common ICU collation agrees with
  code-unit order. Reproducing a divergence would need a session id from another source.

### 2. `envelope.content.version` is recorded without being checked — RESOLVED (covered)

- **File:** `server.js` (`contentVersion: envelope.content.version`)
- **Concern:** the value written to the leaderboard was the client's, and `validateContent` only required
  it to be an integer >= 1 (`js/content.js:343`), so board rows could carry a content version that was
  never published.
- **Resolution:** the Defect 1 fix now requires the whole `envelope.content` (including `version`) to
  be `canonicalJson`-identical to the server's own `dailyContent`. `contentVersion` written to the
  leaderboard is therefore always the server-published version; the concern is closed by the same change.

## Checked, no defects found

- `js/rules.js:1-200` — RNG (`mulberry32`, `hashString`), `canonicalJson`, `rotationAt`/`triIntegral`
  antiderivative, `angleDelta` normalisation, `createGame`, `legalActions`, `contactAngle`. The
  oscillation and triangle-wave integrals are the correct closed forms for `tick >= 0`.
- `js/rules.js:250-290` — `applyCommand` guards: malformed command, terminal state, duplicate command id,
  unknown action, non-integer/negative tick, future tick, stale tick (> 6 ticks), and time-limit expiry.
- `js/rules.js:379-385` — `compareResults` including `total` before `invalid` is deliberate and is
  asserted by `tests/rules.test.mjs:286-293`; the doc comment above it just omits the score key.
- `js/rules.js:407-426` — serialize/deserialize round-trip, `bad-json` / `bad-shape` /
  `unsupported-version` rejection, defensive defaults on migration.
- `server.js:131-147` — static file serving: path is normalised, leading `../` stripped, resolved path
  re-checked against `ROOT`, and `/data/` explicitly refused.
- `server.js:44-50, 73` — per-IP token-bucket rate limiting on the scores route.

## Not tested

- Real-device/mobile input and WebGL rendering quality: the e2e suite exercises a 390x844 portrait
  viewport in headless Chrome with SwiftShader only.
- Audio output (`js/audio.js`): headless Chrome has no audio device, so only construction is exercised.
- Multi-day daily rollover and the "content defective → exclude from ranking" path in spec.md §2:
  `server.js` recomputes `dailyContent(new Date())` per request and has no exclusion mechanism, but
  exercising a rollover needs a controllable clock, which the server does not expose.

## Runtime artefacts

`tests/e2e.mjs` now self-hosts the game (it spawns `server.js` on an ephemeral port), and the daily
submission step writes an untracked `data/` directory (`data/scores.json`, the leaderboard store) inside
this game folder. That is runtime state, not a source change; it is removed after verification (the
board is regenerated per UTC day and never shipped). The forged-content / crash reproductions in the
Resolved entries above were run against the fixed source on scratch ports, and no forged entry was
written to this folder's board — only the game's own e2e submission is ever present here.
