# Blade Orbit — Game Design Document (running spec)

Blade Orbit is a one-button timing game: a carved timber wheel turns on a theatre stage, and you throw blades into it from
below, landing each one in a free gap without striking steel already in the wood or the glowing sigils that ward it.
This document describes the shipped game in the present tense. Anything the design wants but the code does not yet do is
listed once, at the end, under "Design intent not yet implemented".

## 1. Overview

| | |
|---|---|
| Pitch | Read the wheel, time the gap, strike true: embed every required blade before your misses run out. |
| Genre | Timing / rhythm target game, single input |
| Players | 1, with asynchronous ranked comparison on the daily board |
| Session | 20-90 s per stage; a Journey sitting is 5-10 min; a Daily is one attempt of about a minute |
| Platforms | Desktop and mobile browsers (portrait and landscape), keyboard, mouse, touch, gamepad |
| Rendering | Three.js (`vendor/three.module.js`) WebGL scene under a semantic HTML shell; the HTML is fully usable without the canvas |
| Hosting | Static distribution plus an optional authoritative Node script (`server.js`) for the daily board |

### File map

| Path | Owns |
|---|---|
| `index.html` | DOM shell: top bar, playfield with canvas + HUD, eight screens, live regions, settings form |
| `css/main.css` | Palette tokens, responsive layouts (wide, compact, portrait, landscape), reduced-motion and contrast variants |
| `js/main.js` | `Game` class: phase machine, fixed-step loop, input routing, progression, results, settings, quality fallback |
| `js/rules.js` | Pure deterministic rules engine: rotation math, legality, `previewThrow`, `applyCommand`, scoring, hashes, serialization |
| `js/content.js` | Themes, stage generator, 40 Journey stages, 4 tutorials, daily seed, practice, 4 challenges, validators |
| `js/session.js` | `Session` (commands, undo, replay envelope, snapshots), `verifyReplay`, `store` (localStorage), achievements |
| `js/render.js` | Three.js stage: procedural wheel, blades, sigils, particles, camera, quality tiers |
| `js/ui.js` | Screens, HUD, setup/results rendering, help cards, settings binding, accessibility mirrors |
| `js/audio.js` | WebAudio buses, authored Opus samples with synth fallback, ambience loops, generative music, captions |
| `js/platform.js` | StarHermit adapter: time sync, score submission, presence, telemetry; offline no-ops |
| `server.js` | Static server + `/api/v1/*`: time, daily id, replay-validated daily leaderboard, presence, telemetry sink |
| `sfx/` | 17 Opus clips, `manifest.txt` (canonical), `manifest.json` (generator input), `manifest.md` (generator output) |
| `assets/` | `title-backdrop.webp` (title key art), `throwing-knife.glb` (hero prop model, not yet wired) |
| `coverart.png`, `icon.png`, `favicon.svg` | Store cover (1200x675), 256 px icon, tab icon |
| `tests/rules.test.mjs`, `tests/e2e.mjs`, `tests/shot-late-tier.mjs` | 19 unit tests, 13-step browser playthrough, a screenshot helper |
| `starhermit.txt`, `package.json`, `LICENSE.md`, `knownissues.md` | Platform manifest, scripts, PolyForm Noncommercial 1.0.0, review log |
| `data/` | Runtime leaderboard store written by `server.js` (`scores.json`); git-ignored, never served |

## 2. Vision and design pillars

1. **One button, full attention.** The only play verb is THROW. Everything else (rotation profiles, hazards, wards,
   time limits) changes *when* the right moment is, never *what* you do. Rules in: speed surges, pulses, crowded rings,
   sigils. Rules out: aiming sticks, power meters, multiple blade types, drag gestures.
2. **The wheel tells the truth.** The rotation you see is exactly `rotationAt(profile, tick + alpha)` from the rules
   engine; the contact notch is always at six o'clock. Rules in: closed-form rotation, interpolated rendering, a reticle
   that is a pure function of `previewThrow`. Rules out: camera moves during play that shift the contact point, hidden
   randomness after the deal, cosmetic effects that occlude the notch.
3. **Precision is rewarded, panic is punished.** A wide, centred gap earns up to +100 precision and grows a combo;
   a rushed throw into steel costs 100 and a struck sigil costs 200 and can end a run. Rules in: per-throw precision,
   combo steps, a par-time bonus computed once at completion. Rules out: score for speed alone, penalties for waiting.
4. **Fair by construction.** Every stage is derived from a seed string, every daily is the same for everyone, and the
   server re-runs the replay before it ranks a score. Rules in: seeded generators, canonical hashes, replay envelopes,
   idempotent command ids. Rules out: client-trusted totals, hidden boosts, purchases.
5. **A stage, not a screen.** The playfield is a lit theatre stage with carved oak, brass rivets, embers and sparks; the
   UI is the programme around it. Rules in: one dominant key light, wood/metal materials, tiered VFX. Rules out:
   HUD chrome over the wheel, particles that intercept picking, post-processing the low tier cannot run.

## 3. Player experience

**Target player.** Someone with a spare minute who likes rhythm-timing games and score chasing; playable one-thumbed on a
phone, equally at home on a desktop with the space bar.

**First 60 seconds.** Title shows Play, Daily Challenge, Journey, Learn to Play. Play opens the mode list with one-line
descriptions and a ranked/casual tag. Journey stage 1 ("First Throws 1": 5 blades, 3 misses, an empty wheel) opens a
briefing that states goal, misses allowed, hazards, par, expected duration and whether the result is ranked. Begin runs a
3-2-1-GO countdown while the wheel already turns, then the round is live; the HUD reads Goal 0 / 5, Score, Combo, Misses
0 / 3 and a large THROW button. The first throw on an empty wheel always embeds (+200), the wood thunk and a caption
"Blade embedded" confirm it, and the standby blade reappears below. Learn to Play offers four lessons with a banner per
step that introduce throw, steel, sigils and scoring one at a time (`js/content.js` `TUTORIALS`). Help is one tap away
from every screen and pauses a live round.

**Session shape.** Briefing -> countdown -> 20-90 s of throws -> resolving beat (fanfare or fall) -> results with a five
row breakdown -> Next stage / Retry / Menu. Journey unlocks one stage per win; Daily is one ranked attempt per UTC day;
Practice offers undo, hint and restart for drilling a tier.

**Emotional beat.** The held breath before a narrow gap arrives, released by the thunk of an embed and the click of the
combo counter, or broken by the clang of steel.

## 4. Core loop and rules contract

All rules live in `js/rules.js`; nothing else mutates simulation state except through `applyCommand`.

### Entities and units

- Simulation runs at `SIM_FPS = 60` fixed ticks; time limits, par and hashes are in ticks. Scores are integers.
- Wheel rotation at a tick is closed form (`rotationAt`): `startAngle + baseSpeed * tick` plus a sinusoidal speed
  modulation integrated as `(oscAmp / w) * (1 - cos(w * tick))`, `w = 2pi / oscPeriod`, plus a triangle-wave
  modulation integrated by `triIntegral` (`triAmp`, `triPeriod`). No per-frame accumulation anywhere.
- Contact angle of a throw (`contactAngle`) is `-rotationAt(...)` normalised to [0, 2pi): the blade always lands at the
  notch, so the wheel's orientation decides which point of the wood it meets.
- Slots: `{angle, type: 'blade' | 'marker'}` from `content.preplaced` (degrees) plus every embedded blade. Footprints
  are `BLADE_HALF = 0.075`, `MARKER_HALF = 0.105`, `SAFETY = 0.012`; `SLOT_HALF = {blade: 0.087, marker: 0.117}`.
- A throw is blocked when `|angleDelta(contact, slot.angle)| < SLOT_HALF[slot.type] + BLADE_HALF`: 0.162 rad (9.3
  degrees) centre-to-centre for a blade, 0.192 rad (11.0 degrees) for a sigil. `previewThrow` picks the slot with the
  **minimum clearance** (not the nearest centre) as the blocker, so the recorded hazard never depends on array order.

### Legal actions and command validation

- `legalActions(state)` returns `[{type:'throw', tick}]` while `status === 'active'` and the time limit has not been
  reached, otherwise `[]`. Tutorials, hints and the e2e bot use this same API.
- `applyCommand(prev, cmd)` rejects, in order: `malformed-command` (no string id), `game-over`, `duplicate-command`
  (same id as the last applied command, idempotent), `unknown-action`, `bad-tick` (non-integer or negative),
  `future-tick` (`cmd.tick > state.tick`), `stale-tick` (more than 6 ticks behind). A throw issued after the time limit
  finalises the state as `lost / time-expired` instead of resolving.
- Rejected commands do not enter the replay log; `Session.throw` increments `invalidCount` and rolls back `commandSeq`.

### Resolution order (one throw)

1. `commandCount += 1`, `lastCommandId = cmd.id`.
2. `previewThrow(state, state.tick)`.
3. Embed: push `{angle, type:'blade', embedded:true}`, `embedded += 1`, `comboStreak += 1`, `bestCombo` updated;
   `hits += 100`; `precision += round(100 * min(1, clearance / 0.55))`; `combo += (comboStreak - 1) * 25`.
   If `embedded >= goal`: `timeBonus = min(1000, round((par.ticks - tick) / 60 * 50))` when `tick < par.ticks`, then
   status `won / goal-complete`.
4. Blocked: `misses += 1`, `comboStreak = 0`, `missPenalty -= 200` for a sigil or `100` for a blade. If
   `misses > missesAllowed`: status `lost`, reason `marker-struck` when the fatal throw hit a sigil, else
   `too-many-misses`.
5. Events (`embed`, `miss`, `win`, `lose`) are returned for audio/VFX and are not part of the state hash.

`advanceTick(state, n)` moves the clock; when a time limit exists and would be reached it clamps to the limit and
finalises `lost / time-expired`.

### Scoring formula and worked example

`total = hits + precision + combo + timeBonus + missPenalty` (`totalScore`). Lesson 1 ("The Throw": goal 2, par 1200
ticks, empty wheel, `baseSpeed 0.006`), played with the hint each time:

| Throw | Tick | Clearance | Hits | Precision | Combo | Time bonus | Running total |
|---|---|---|---|---|---|---|---|
| 1 | 0 | pi (empty wheel) | +100 | +100 | 0 | | 200 |
| 2 | 524 | 2.977 | +100 | +100 | +25 (streak 2) | +563 = round((1200 - 524) / 60 * 50) | **988** |

Stars for a Journey win (`js/main.js` `showResults`): 3 when `total >= par.score * 1.4`, 2 when `>= par.score`,
else 1. Mastery XP gains `10 * tier + 5 * stars`.

### Terminal states, ties, seeding, undo, hints

- Terminal: `won / goal-complete`; `lost / too-many-misses`, `lost / marker-struck`, `lost / time-expired`.
- `compareResults` (used by the server board): won first, then higher total, fewer invalid commands, fewer ticks, then
  `sessionId` string order.
- RNG: `makeRng(seedText)` = FNV-1a hash into mulberry32. Streams are named and separate: `stage:<seed>` for content,
  `<seed>:decor` and `<seed>:fx` for scenery and particles, `av:<tag>:<n>` for pitch variants, `music:blade-orbit`.
- Undo (`Session.undo`) is available only in Practice and Tutorial: it pops the pre-command snapshot, the command and the
  sequence number. Hint (`findBestThrowTick`) scans up to 1200 ticks ahead for the widest clearance and reports the wait.
- `hashState` hashes canonical JSON of the state minus `events`; `Session` records a hash at tick 0, every command that
  lands on a multiple of 120 ticks, and at terminal.

## 5. Modes and progression

| Mode | Entry | Content | Undo / hint | Rated |
|---|---|---|---|---|
| Journey | Title > Journey, or Play > Journey | 40 stages, 5 tiers x 8, stage 8 of each tier is a Mastery trial | No | Local stars |
| Daily Challenge | Title or Play > Daily | `dailyContent(date)`: one seed per UTC day | No | Ranked (server board) |
| Practice | Play > Practice > Easy/Normal/Hard/Expert/Master | `practiceContent`: tier 1-5, fresh random seed each time | Yes, plus Restart | No |
| Challenges | Play > Challenges | Flawless Edge, Ember Sprint, Thicket of Steel, Warden's Trial | No | No |
| Learn | Title > Learn to Play, or Play > Learn | 4 lessons with two-step banners | Yes | No |

**Generator** (`generateStage(seed, tier t, index i)`): goal `4 + t + (i % 3)`; misses 3 (t <= 2), 2 (t 3-4), 1
(t 5); `baseSpeed = +/-(0.004 + 0.0016 t + [0, 0.0012))` rad/tick (tier 1 is about 0.06 rev/s, tier 5 about 0.12);
tier 3+ adds oscillation (`oscAmp = base * [0.6, 1.4]`, period 300-600 ticks); tier 4+ adds a pulse (`triAmp = base *
[2, 5]`, period 500-900); preplaced blades `min(2 + t + (i % 2), 6)` from tier 2 (tier 1 gets one blade from index 5);
sigils `min(1 + floor((t + i) / 3), 3)` from tier 3; par score `goal * 150 + (t - 1) * 100`; par ticks at least 600.
Theme is chosen by a hash of the seed. Mastery stages add one blade to the goal and remove one allowed miss.

Journey tiers: First Throws (empty or near-empty wheel), Crowded Rings (4-6 hazard blades), Sigil Wards (sigils plus
surging speed), Pulse Timber (pulse drive, thin margins), Grand Mastery (one miss; stage 40 allows none, goal 11).

**Daily**: tier `2 + weekday % 4` (Sunday and Thursday tier 2, Monday/Friday 3, Tuesday/Saturday 4, Wednesday 5),
index = weekday, id `daily-YYYY-MM-DD`, theme hashed from the date. The title's attract scene shows today's daily.
`store.progression.dailyDone[id]` keeps the best total per day; seven distinct days unlock "Hearth Regular".

**Challenges** (`CHALLENGES`): Flawless Edge (5 blades, 0 misses, 2 hazard blades); Ember Sprint (6 blades, 3 misses,
60 s limit, HUD timer); Thicket of Steel (7 hazard blades, 5 to embed, 2 misses); Warden's Trial (4 sigils + 2 blades,
6 to embed, 2 misses).

**Unlocks and achievements**: a Journey win unlocks the next stage (`journeyUnlocked`), stars are kept per stage, and
the title line reads "Journey n/40 cleared - Mastery x XP - n sessions". Eight achievements (`ACHIEVEMENTS`) unlock
idempotently at results time: first_clear, tutorial_master, combo_five, streak_seven, mastery_tier5, journey_done,
throws_1000, flawless_win. Cosmetic themes are assigned by content; nothing is purchasable.

## 6. Controls and interaction

| Input | Desktop | Mobile / touch | Gamepad |
|---|---|---|---|
| Throw | Space, Enter, click on playfield, THROW button | Tap anywhere on the playfield or THROW | A (button 0) |
| Pause / resume | P, Esc, Pause button | Pause button | Start (9); B (1) resumes |
| Undo (practice, tutorial) | U, Undo button, rail button | Undo button | - |
| Hint (practice, tutorial) | H, Hint button, rail button | Hint button | - |
| Restart (practice) | R, rail button | Pause > Restart stage | - |
| Navigate UI | Tab / Shift+Tab, Enter | Tap | - |
| Back out of a screen | Esc | Back buttons | - |

Rules (`js/main.js` `bindInput`, `doThrow`): pointerdown on `#playfield-wrap` throws only while `phase === 'active'` and
the target is not a button/input; a throw locks input for `RESOLVE_LOCK_MS = 140` ms; key repeat is ignored; keys inside
form controls are not captured. Backgrounding the tab pauses and shows the pause panel. Every accepted throw plays
`throw` then `embed` or `miss-*`, vibrates 12 ms (embed) or 40-30-40 (miss) when haptics are on, and announces the
outcome to the live region. Rejected throws announce "That throw was not allowed." Left-handed layout mirrors the action
row; "Timing assist" and "Hold-to-preview" both show the contact reticle (green when clearance > 0.15, red when
blocked, faint white otherwise).

## 7. Screens and UI flow

Phases (`Game.phase`): `boot -> title -> modes | journey -> setup -> countdown -> active <-> paused -> resolving ->
results`, then `results -> setup` (Next / Retry) or `-> title` (Menu). Screens (`SCREENS` in `js/ui.js`): title, modes,
journey, setup, results, pause, help, settings; exactly one is visible, the HUD is visible only while no screen is.
Help and Settings are overlays: opened from the top bar during a live round they pause it (`overlay-open`) and resume
on Back; from the pause panel they return to the pause panel.

- **Title**: key art backdrop (`assets/title-backdrop.webp`) under a dark scrim, Play (primary), Resume paused round
  (only when a snapshot for a rebuildable stage exists), Daily Challenge, Journey, Learn to Play, progress line.
- **Modes**: card grid (name, description, ranked/casual meta); the same screen lists practice difficulties, challenges
  and lessons.
- **Journey**: 40 square cells, locked ones dimmed and disabled, stars shown, mastery cells outlined in accent.
- **Setup (briefing)**: goal, misses allowed, hazards, par, expected duration, players, ranked flag; Back / Begin.
- **Play HUD**: top-left block (Goal, Score, Combo, Misses, Time when limited, Pause); bottom centre Hint / Undo /
  THROW; hint line; countdown overlay; tutorial banner; caption strip.
- **Pause**: Resume first, then Settings, Help, Restart stage, Leave round (danger colour).
- **Results**: headline (Wheel Cleared! / Out of Misses / Sigil Struck / Time Expired), five-row breakdown plus total,
  time and throw count, achievement chips, personal-best line, Menu / Retry / Next stage.
- **Help**: six rule cards and the control list. **Settings**: audio sliders, captions, quality, reduced motion, high
  contrast, palette, text size, left-handed, reticle assists, haptics, replay tutorials, reset progress.

Layouts (`css/main.css`): >= 1024 px shows a 240 px objective rail left and an actions/status rail right of the
playfield; below that the rails collapse; landscape phones (height <= 500) keep a 150 px status rail; portrait phones
put the THROW button in the thumb zone with `safe-area-inset-bottom` padding. All screens pad by the safe-area insets
and scroll internally. Buttons are at least 44 x 44 CSS px. Nothing critical sits under browser chrome: the top bar
wraps below 560 px, and the e2e test asserts the THROW button size at 390 x 844.

## 8. Art direction

**Palette** (CSS tokens): background `#140b07`, panel `#221409`, panel-2 `#2e1c0e`, ink `#f4e8d8`, ink-dim `#c9b49a`,
accent `#ff8c3a`, accent-2 `#ffc46a`, good `#51c98a`, bad `#ff5151`, focus `#6ab8ff`. High contrast switches to pure
black panels and white ink; colour-vision palettes remap accent/good/bad (deuteranopia `#e0a13a/#3a9ee0/#e04a7a`,
protanopia `#d9b23a/#3aa8e0/#8a7ae0`, tritanopia `#e06a4a/#3ad0a0/#e04a4a`, mono greys).

**Scene themes** (`THEMES`, cosmetic only): Ember Oak (wood `#7a4a24`, ring `#c98d4e`, sigil `#37c4a8`, hearth),
Midnight Forge (`#3a3f52`, sigil `#ff6a8a`, wind), Jade Shrine (`#2e5544`, sigil `#ff5a4e`, chimes), Rose Quarry
(`#6e3a4a`, sigil `#5ad8ff`, hearth), Bone Desert (`#9a7a4e`, sigil `#4e9aff`, wind). Each theme sets sky, fog, floor,
key and fill light colours.

**Hero**: the wheel. `FRAMING` in `js/render.js`: camera at (0, 0.55, 6.4) looking at (0, 0.1, 0), fov 34, wheel
radius 1.5, blade orbit radius 1.08, throw origin (0, -2.6, 2.2), contact notch at -pi/2 (six o'clock). The face is a
seeded 512 px canvas texture (growth rings, radial grain, carved notches, vignette) under a brass torus rim with 12
instanced rivets, a hub, a thick edge and a stand; two carved posts flank the stage and up to six seeded crates dress the
floor on medium/high tiers. Blades are a tapered steel box, cylinder grip and brass guard (tip toward the hub, slight
tilt); sigils are emissive hexagons with a halo ring, so hazards differ by shape as well as colour.

**Shape and type**: rounded 12 px panels, pill THROW button, serif-leaning UI face ("Iowan Old Style", Segoe UI,
system-ui) with tracked uppercase labels.

**Motion**: an interruptible 1.1 s intro swoop (cubic ease, no cumulative lerp), tiered event VFX (embed: 14 wood
chips + 0.012 shake; miss: 22-30 sparks in accent or sigil colour + 0.03 shake; win: five 26-spark bursts; lose: 0.045
shake), particles from a seeded pool (80/160/260 by tier) that never raycast. Reduced motion removes shake and the
swoop, shortens blade flight to 20 ms, slows particles to 40 %, shortens countdown steps to 500 ms and the results delay
to 250 ms, and disables CSS transitions. Quality tiers set DPR cap (1 / 1.5 / 2), shadows, particle count and scenery
density; Auto picks by device memory and user agent and drops a tier after three 2 s windows under 42 fps.

**Visual assets the design calls for**: store cover (`coverart.png`), title backdrop (`assets/title-backdrop.webp`), a
hero throwing-knife model (`assets/throwing-knife.glb`), icon and favicon. See section 15.

## 9. Audio direction

Buses (`js/audio.js`): master -> music, effects, ambience, voice, each with a settings slider. Authored Opus clips are
lazy-fetched after the first user gesture and cached; until a clip decodes (or if it fails) the synthesised fallback for
that event plays, so no cue is ever silent. Pitch variants for synth cues are seeded (`av:` stream). Ambience is a
filtered noise bed with a slow LFO that cross-fades into the theme's authored loop over 1.5 s once it decodes; music is a
quiet seeded pentatonic arpeggio whose density scales with tier and keeps scheduling while the context is suspended.
Every audible event has a caption when captions are on.

SFX event table (source for `sfx/manifest.txt`):

| Event id | File | Sound | Used when |
|---|---|---|---|
| throw | blade-throw.opus | Quick whoosh of a spinning blade with a faint ring | Every accepted throw (`doThrow`) |
| embed | blade-embed.opus | Heavy wood thunk with a brief crunch | `embed` event |
| miss-blade | steel-clang.opus | Bright clang off steel, ringing decay | `miss` with `hit-blade` |
| miss-marker | sigil-ward.opus | Dull warded bonk, descending warble, magical hum | `miss` with `hit-marker` |
| win | stage-win.opus | Short brass and bell fanfare | Terminal `won` (`enterResolving`) |
| lose | stage-lose.opus | Descending soft mallet phrase | Terminal `lost` |
| click | ui-click.opus | Crisp wooden tap | Every button and card press |
| undo | ui-undo.opus | Soft rising wooden tick | Undo accepted |
| pause | ui-pause.opus | Single muted knock | Pause (any reason) |
| hint | ui-hint.opus | Two rising glass chimes | Hint accepted |
| tick | countdown-tick.opus | Sharp wood-block tick | Countdown 3, 2, 1 |
| go | countdown-go.opus | Bright bell strike with shimmer | Countdown GO; sim starts |
| ambience-hearth | ambience-hearth.opus | Crackling hearth, ember pops (12 s loop) | Ember Oak, Rose Quarry rounds |
| ambience-wind | ambience-wind.opus | Low wind through a stone forge (12 s loop) | Midnight Forge, Bone Desert rounds |
| ambience-chimes | ambience-chimes.opus | Distant wind chimes in a shrine garden (12 s loop) | Jade Shrine rounds |
| achievement | achievement-chime.opus | Sparkling celesta flourish | Results with at least one new achievement |
| combo | combo-chime.opus | Two-note rising metallic ping | Layered after `embed` at combo >= 3 |

## 10. Localization

The shipped build is English only: `<html lang="en">`, and every string is a literal in `index.html`, `js/ui.js`,
`js/main.js`, `js/content.js` (stage and tutorial text) and `js/audio.js` (captions). There is no locale detection and
no string table. The product requirement is en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT; layout
uses wrapping and fluid sizing rather than fixed widths (wrapping top bar, auto-fill card grids, `min()`-sized panels,
tabular numerals in the HUD), so the missing piece is the string table and selector. This is tracked in "Design intent not yet implemented".

## 11. Accessibility

- Keyboard-only path: skip link, Tab order through every screen, focus moved to the first enabled button of each screen
  (`focusFirst`) and to THROW when play starts; `:focus-visible` outline in `#6ab8ff`; Esc backs out of screens.
- Announcements: `#live-region` (polite) for objective, embeds, hints, resume, quality drops; `#alert-region` (assertive)
  for misses and rejected throws; `#board-mirror` summarises blades, sigils, goal and misses after every command; the
  countdown is `aria-live="assertive"`; the canvas is `aria-hidden`.
- Captions for every sound cue; four independent volume sliders.
- Contrast and colour: high-contrast mode, four colour-vision palettes, hazards coded by shape (blade vs hexagon) and
  by sound, text size 0.9-1.3x via `--text-scale`.
- Reduced motion from the setting or `prefers-reduced-motion` (see section 8); timing is unchanged.
- Targets 44 x 44 px minimum, left-handed layout, hold/timing reticle assists, haptics toggle, tutorial replay.

## 12. StarHermit integration

Manifest `starhermit.txt`: `name=Blade Orbit`, `launch=index.html`, `server=server.js`, `version=1.0.0`, `ruleset=v1`,
`cover=coverart.png`. Conventions follow https://wiki.starhermit.com/.

| Feature | Status |
|---|---|
| Launch token | `Platform.init` reads `#game_token=<jwt>` from the URL fragment (optional `&session_id=`, stripped after the read; query `?launch_token=` kept for local dev), decodes `sub` + `game_scope` (never hard-coded), sends it as `Authorization: Bearer` on every `/api` call, and re-mints it every 45 min via `POST /api/v1/games/{slug}/launch-token` (60 s retry on failure). Memory only; nothing is persisted |
| Identity | The top-bar chip shows the profile nickname from `GET /api/v1/users/{sub}/profile` (never `/api/v1/me`, never usernames; `Player <id8>` fallback); "Guest" remains the offline label |
| Platform leaderboard | Read-only via `GET /api/v1/games/{slug}` → `leaderboardId` → `GET /api/v1/leaderboards/{leaderboardId}/entries?page=&pageSize=`, with user ids resolved to nicknames through the profile helper; shown on the title-screen Leaderboards panel. Clients never submit to game leaderboards (wiki); no `leaderboardId` or no token → panel says boards are unavailable |
| Server time | `GET /api/v1/time` with round-trip-adjusted offset; drives the top-bar clock and the daily seed |
| Daily board | `POST /api/v1/scores` with the replay envelope; the server regenerates today's content, requires the submitted content to be canonically identical, re-runs `verifyReplay`, rejects implausible losing totals, ranks with `compareResults`, dedupes by session id. `GET /api/v1/scores/:id` returns the top 50 |
| Presence | `POST /api/v1/presence` every 45 s while a round is live |
| Telemetry | `POST /api/v1/telemetry` for whitelisted events (start, tutorial_step, round_end, retry, settings_change, error) with short string fields only |
| Offline | Every hosted call degrades to a local no-op; scores are kept locally and labelled casual |
| Not used | Friends filtering, cloud saves, platform achievements, rooms, WebSocket, chat, voice |

## 13. Technical architecture

- `rules` is pure and DOM-free; it runs identically in the browser, the unit tests and `server.js`.
- `session` is the only writer of rules state: it issues ids `<sessionId>:<seq>`, keeps the command log, undo snapshots,
  periodic hashes and builds the replay envelope `{schema 1, rulesVersion 1, content, seed, initialHash, timestampOffset,
  commands, hashes, result}`. `verifyReplay` re-creates the game, advances to each command's tick, re-applies it and
  compares the final hash, total and ticks.
- `main` runs a fixed-step accumulator (`TICK_MS = 1000 / 60`, max 8 steps per frame, 250 ms frame clamp) and passes
  `alpha` to the renderer; the countdown is a negative cosmetic pre-roll that reaches tick 0 exactly at GO.
- `render` consumes snapshots only; `syncState` diff-adds embedded blade views, `pushEvents` triggers VFX; WebGL
  context loss rebuilds the scene from retained content; missing WebGL shows `#canvas-fallback`.
- Persistence (`store`, localStorage): `blade-orbit:settings`, `:progression`, `:scores`, `:achievements`, `:snapshot`
  (paused round), `:replay:<contentId>:<sessionId>`. Snapshots are only offered when the stage can be rebuilt.
- Budgets: 60 fps target, low tier for mobile (DPR 1, no shadows, 80 particles). The base stage is about 20 draw calls
  plus three per blade and two per sigil; particles are individual meshes, so a win burst briefly adds up to 130.
- `tests/e2e.mjs` spawns `server.js` on an ephemeral (or `PORT`) port, launches headless Chrome via `playwright-core`,
  clicks the real buttons, reads `window.__game` only to time throws with the hint API and to read state, and fails on
  any page error or console error.

## 14. Testing and acceptance criteria

`npm test` (`tests/rules.test.mjs`, 19 tests): legal actions; deterministic rotation; every rejection reason; scoring
components; the three loss reasons; serialization round-trip and version guard; replay determinism across all shipped
stages; tamper detection; all content validates (Journey, tutorials, challenges, 14 upcoming dailies); generator
determinism and difficulty scaling; daily stability per UTC day; practice validity; malformed-command fuzz; bot
clearability of generated stages at every tier; `compareResults` ordering; tightest-blocker selection; undo-after-
rejection integrity.

`tests/e2e.mjs` (13 steps): title loads; Journey grid has 40 cells with 1 unlocked; briefing; countdown to active with
HUD visible; rules-timed throws to a terminal state; results breakdown rows; persisted progression and unlock; next
stage, pause snapshot, resume; practice undo and hint; settings apply reduced motion, palette, contrast; tutorial banner;
390 x 844 portrait with a >= 44 px THROW button; daily submission appears on the server board. Passes with "E2E PASS —
no page errors".

QA bar (checkable): every implemented feature reachable by clicking visible UI; zero console errors or warnings from the
game's own code; no text cut off at 1280 x 800 or 390 x 844; a first-time player sees instructions (briefing, tutorial
banners, help cards) before the first mechanic; `node --check` clean on all JS; `tools`/`tests`/dotfiles never served.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `coverart.png` (1200x675, 302 KB) | Store cover: carved oak wheel, embedded knives, teal sigils, embers | FLUX.2 klein, seed 4801, cropped, 256-colour PNG | Generated in this pass (replaced placeholder) |
| `assets/title-backdrop.webp` (1536x864, 15 KB) | Title screen backdrop | FLUX.2 klein, seed 4802, webp q82 | Generated in this pass, wired in `css/main.css` |
| `assets/throwing-knife.glb` (975 KB, 1854 verts, 1024 px texture) | Hero throwing-knife prop | FLUX.2 klein seed 4803 product shot -> TRELLIS seed 7 | Generated in this pass, shipped, not yet wired (no GLTFLoader in `vendor/`) |
| `icon.png`, `favicon.svg` | Platform icon, tab icon | Authored | Shipped |
| `sfx/*.opus` x 12 (throw, embed, clang, ward, win, lose, click, undo, pause, hint, tick, go) | Event cues | MOSS-SoundEffect v2, 100 steps | Shipped |
| `sfx/ambience-hearth.opus`, `ambience-wind.opus`, `ambience-chimes.opus` (12 s) | Theme ambience loops | MOSS-SoundEffect v2, 100 steps | Generated in this pass, wired |
| `sfx/achievement-chime.opus`, `sfx/combo-chime.opus` | Achievement and combo accents | MOSS-SoundEffect v2, 100 steps | Generated in this pass, wired |
| Wheel face, blades, sigils, stage dressing | In-game geometry and textures | Procedural (`js/render.js`), seeded | Shipped |
| Character animation | - | - | Not applicable (no humanoid) |

## 16. Known limitations

- No localization layer; English literals throughout (section 10).
- The platform leaderboard shows the ranked top 20 on the title-screen panel, but the player's own rank is not
  highlighted there and the daily board on the results screen still only announces submission success or failure.
- Offline play shows "Guest" in the top-bar chip; the account nickname appears only when launched with a token.
- "Hold-to-preview reticle" and "Timing assist reticle" are two settings with the same effect.
- The voice bus has a slider but no content plays through it.
- Audio is unverified in automation (headless Chrome has no output device); only construction is exercised.
- `compareResults` falls back to `localeCompare` for session ids; ids are ASCII base36 so collations agree, but the
  comparator is locale-dependent in principle (`knownissues.md`).
- The server regenerates the daily per request from wall-clock UTC; there is no mechanism to exclude a defective day
  from ranking, and rollover is not tested.
- The hero knife model is shipped but the in-game blade is still the procedural box mesh.

## Design intent not yet implemented

1. Ship string tables and a locale selector for en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
2. Show the daily board (global top 50 and the player's rank) on the results screen and the briefing, and highlight the player's own row on the platform leaderboard panel.
3. Load `assets/throwing-knife.glb` for the standby and embedded blades with the procedural mesh as fallback.
4. Label ranked submissions with the display name server-side and add a friends-only filter to the leaderboard panel.
5. Give the two reticle settings distinct behaviour (hold-to-preview only while the pointer is down).
