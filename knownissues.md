# Known Issues — Blade Orbit

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on local5090 (HauhauCS Q3_K_P, 32k ctx),
alongside the game's own unit tests and end-to-end suite.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 17/17 pass, 0 fail |
| `node --check` on all modules | clean (`js/*.js`, `server.js`, `tests/*.mjs`) |
| `tests/e2e.mjs` (headless Chrome, `BASE_URL=http://localhost:39301`) | PASS — 14/14 steps, "E2E PASS — no page errors" |

## Confirmed defects

Defects below were each verified by reading the source, and defects 1 and 2 were additionally
reproduced against a running copy of `server.js`.

### 1. Daily leaderboard accepts a forged content definition — any score can be manufactured

- **File:** `server.js:80-93` (`/api/v1/scores` handler), with `js/session.js:128-151` (`verifyReplay`)
- **Trigger:** `POST /api/v1/scores` with a replay envelope whose `content.id` and `seed` equal
  today's daily values, but whose remaining content fields describe a much easier wheel.
- **Behaviour:** The handler checks only `envelope.content.id !== expected.id || envelope.seed !== expected.seed`
  (line 84) and then `validateContent(envelope.content)` (line 87), which only proves the *client-supplied*
  content is internally legal. `verifyReplay` then builds the game from that same client-supplied content
  (`createGame(envelope.content)`, `js/session.js:133`). The published daily content is never compared
  field-by-field against the submitted one, so `goal`, `missesAllowed`, `rotation`, `preplaced`, `par`
  and `timeLimitTicks` are entirely attacker-controlled. The replay then verifies honestly against the
  fake board and the resulting score is recorded on the real daily board.
- **Expected:** spec.md §5 "Determinism, replay, and security" — the server owns the deal and the result;
  a competitive claim must be replayed against the *server's* copy of the daily content, not the client's.
- **Evidence:** submitting a forged envelope (same `id`/`seed` as `daily-2026-08-20`, `goal: 25`,
  `preplaced: []`, `rotation.baseSpeed: 0.0005`, `par.score: 999999`) against a copy of the server:

  ```
  validateContent(forged): {"ok":true,"errors":[]}
  forged result: {"won":true,"total":10268,"components":{"hits":2500,"precision":268,"combo":7500,...},"embedded":25}
  SERVER RESPONSE 200 {"ok":true,"rank":1}
  ```

  Legitimate entries produced by the game's own e2e run on the same board score 1787-1791; the forged
  entry took rank 1 with 10268.

### 2. Remote crash: `POST /api/v1/scores` without a `result` field kills the server process

- **File:** `server.js:97` (`sessionId: envelope.result.sessionId`)
- **Trigger:** any well-formed score submission that omits the `result` key.
- **Behaviour:** nothing between parsing (line 77) and line 97 validates `envelope.result`.
  `verifyReplay` deliberately tolerates a missing `result` — `js/session.js:148-149` guard both
  comparisons with `if (envelope.result && ...)` — so `check.ok` can be `true` with `result` absent.
  Line 97 then dereferences `undefined`. The throw happens inside the `async` `http.createServer`
  callback, so it becomes an unhandled rejection and Node exits. There is no `try/catch` around the
  handler and no `process.on('uncaughtException')`.
- **Expected:** malformed input should return `400`, not terminate the service. spec.md §5 requires the
  server to be the authoritative, resilient side of the contract.
- **Evidence:** server log after one such request:

  ```
  server.js:97
        sessionId: envelope.result.sessionId,
                                   ^
  TypeError: Cannot read properties of undefined (reading 'sessionId')
      at Server.<anonymous> (.../server.js:97:34)
  ```

  The process exited; subsequent `GET /api/v1/time` returned no response (curl code 000).

### 3. `previewThrow` reports the clearance of the *nearest* slot, not the *tightest* one

- **File:** `js/rules.js:204-221` (`previewThrow`), specifically line 211
- **Trigger:** a throw whose contact angle lies between a blade and a marker, where the marker is
  angularly further away but has a larger half-width.
- **Behaviour:** the loop tracks `best` by smallest centre-to-centre distance `d`
  (`if (!best || d < best.d)`), but the value it later returns is `clearance = d - (SLOT_HALF[slot.type] + BLADE_HALF)`.
  `SLOT_HALF` is type-dependent — `blade: 0.087`, `marker: 0.117` (`js/rules.js:17-23`) — so the
  minimum-`d` slot is not necessarily the minimum-clearance slot. Worked example: marker at `d = 0.20`
  has clearance `0.20 - 0.117 - 0.075 = 0.008`; blade at `d = 0.19` has clearance
  `0.19 - 0.087 - 0.075 = 0.028`. The code selects the blade and reports `0.028`, overstating the real
  gap by 3.5x.
- **Expected:** spec.md §2 "Scoring and victory" — score "spacing precision". The precision component
  (`js/rules.js:292-294`, `Math.round(100 * Math.min(1, clearance / MAX_CLEARANCE))`) is therefore
  awarded on the wrong measurement, and `findBestThrowTick` (`js/rules.js:227-238`), which the hint
  system ranks by `p.clearance`, can recommend a tick that is not the safest one.
- **Evidence:** the code at line 211 compares `d`, while line 215/219 return a `clearance` derived from
  a type-dependent half-width. Blocking detection itself is unaffected because it returns early per slot
  (lines 212-217), so this shows up only as a scoring/hint inaccuracy, never as a wrong hit/miss verdict.

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

### 2. `envelope.content.version` is recorded without being checked

- **File:** `server.js:103` (`contentVersion: envelope.content.version`)
- **Concern:** the value written to the leaderboard is the client's, and `validateContent` only requires
  it to be an integer >= 1 (`js/content.js:343`). Board rows can therefore carry a content version that
  was never published.
- **Why unconfirmed:** nothing in the shipped code reads `contentVersion` back, so there is no
  demonstrable behavioural consequence today.

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

Running the shipped `tests/e2e.mjs` and the exploit reproductions created an untracked `data/`
directory (the leaderboard store, `data/scores.json`) inside this game folder. It is runtime state, not
a source change; it is being cleaned up centrally. The forged-content and crash reproductions were run
against a **copy** of the game in a scratch directory, so no forged entry was written to this folder's
board — only the game's own e2e submission is present here.
