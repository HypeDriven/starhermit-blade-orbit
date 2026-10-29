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
| Platforms | StarHermit engine 1.27.0 script game: natively in the StarHermit client and in desktop and mobile browsers (portrait and landscape) through the engine's web runtime; keyboard, mouse, touch, gamepad |
| Rendering | `starhermit:scene` (three.js-like names) for the stage, `starhermit:ui` (immediate mode) for the shell, `starhermit:draw` for the key art and drawn glyphs |
| Hosting | One package (`starhermit.txt`): the engine loader `index.html` and `starhermit-files.json` written by `npm run package`; `score-script.js` is the platform script; `server.js` is a dev-only local server |

### File map

| Path | Owns |
|---|---|
| `starhermit.txt` | Manifest: `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.27.0`, `engine.minor=29`, capabilities `platform,storage,clipboard`, `control.*` and `engine.gamepad.*` for every action, `server=score-script.js`, `cover=cover.jpg` |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (`starhermit package --web .`); never edited by hand |
| `native/main.ts` | Entry module: phase machine on the runtime's fixed steps, throw / undo / hint, countdown pre-roll, results and progression, snapshots, input routing (actions, playfield presses), lifecycle |
| `native/screens.ts` | Top bar, HUD, rails, banner, captions, toast and every screen as `starhermit:ui`; layouts by window size; drawn glyphs (stars, diamonds, medal, check, throw icon) |
| `native/render.ts` | The stage on `starhermit:scene`: procedural wheel, blades, sigils, stage dressing, particles, embers, camera framing (view offset), the look per graphics level |
| `native/geometry.ts` | three.js `Shape` + `ExtrudeGeometry` for the blade profile (from the arrow-exodus port) |
| `native/quality.ts` | The old presets and budgets keyed by the runtime's quality tier and level |
| `native/audio.ts` | Clips on the runtime's buses, ambience loops, the rendered music stem, captions |
| `native/platform.ts` | The engine save (progress document), the `localStorage` shim for `js/session.js`, game settings and legacy migration, player chip, invite, leaderboard read and score posting |
| `native/i18n.ts`, `native/style.ts` | Locale from the runtime's interface language; style sheet registration and palette tokens |
| `js/rules.js` | Pure deterministic rules engine: rotation math, legality, `previewThrow`, `applyCommand`, scoring, hashes, serialization |
| `js/content.js` | Themes, stage generator, 40 Journey stages, 4 tutorials, daily seed, practice, 4 challenges, validators |
| `js/session.js` | `Session` (commands, undo, replay envelope, snapshots), `verifyReplay`, `store` (over `localStorage`), achievements |
| `js/migrate.js` | Save document, cross-device merge, the browser build's cloud save and settings keys |
| `js/i18n.js`, `js/account-strings.js` | String tables in nine locales (account lines folded in as `acct.*`), `t`, `setLocale` |
| `tools/ui-style.css` → `assets/ui-style.json` | The class-based style sheet and its `starhermit css` conversion (`npm run css`) |
| `tools/plan.mjs`, `tools/package-web.mjs`, `tools/css.mjs`, `tools/browser-play.mjs` | Play-script throw plans, packaging, CSS conversion, headless-Chrome play of the package |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a finished run's total and posts it to the `high-score` leaderboard (canonical copy in the games repo's `tools/score-script.js`) |
| `server.js` | Dev-only local server (static + replay-validated daily board); left out of the package |
| `sfx/` | 17 Opus clips, `manifest.txt` (canonical), `manifest.json` (generator input), `manifest.md` (generator output) |
| `assets/` | `title-backdrop.webp` (title key art), `ui-style.json`; `throwing-knife.glb` (hero prop model, not wired, left out of the package) |
| `cover.jpg`, `coverart.png`, `icon.png` | Store cover, cover source, icon |
| `tests/` | `rules.test.mjs`, `i18n.test.mjs`, `migrate.test.mjs` (node --test), `native.mjs` with `tests/native/*.play` |
| `package.json`, `tsconfig.json`, `.starhermitignore`, `LICENSE.md`, `knownissues.md` | Scripts, type check, package exclusions, PolyForm Noncommercial 1.0.0, review log |

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

Stars for a Journey win (`native/main.ts` `showResults`): 3 when `total >= par.score * 1.4`, 2 when `>= par.score`,
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
| Daily Challenge | Title or Play > Daily | `dailyContent(date)`: one seed per UTC day | No | Ranked (platform board, read-only) |
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

| Action (`control.*`) | Keyboard | Pointer / touch | Gamepad |
|---|---|---|---|
| throw | Space, Enter, Numpad Enter | Press or tap anywhere on the playfield, THROW button | South (A) |
| pause | P | Pause button | Start |
| back | Esc (pauses a round, resumes a paused one, closes Help/Settings, leaves results and screens) | Back buttons | East (B) |
| undo (practice, lessons) | U | Undo button, rail button | West (X) |
| hint (practice, lessons) | H | Hint button, rail button | North (Y) |
| restart (practice) | R | Rail button, Pause › Restart stage | Select |
| Navigate UI | Tab / Shift+Tab, arrows, Enter | Tap | D-pad, South |

Players rebind keys and pads in the runtime's Options (F1 natively; the runtime's menu in browsers); Help lists the
bound keys (`bindings()`) and gamepad buttons. Rules (`native/main.ts`): the throw action acts only while the round is
active and no screen is open (a focused menu button never throws); a playfield press acts on the press, not the
release (timing), and not over a HUD control; a pointer press right after a touch is skipped. A throw locks input for
8 fixed steps (0.14 s). Backgrounding the window (`onSuspend`) pauses and shows the pause panel. Every accepted throw
plays `throw` then `embed` or `miss-*`, vibrates 12 ms (embed) or 60 ms (miss) when haptics are on, and announces the
outcome with the board summary. Rejected throws announce "That throw was not allowed." Left-handed layout mirrors the
action row (and moves the short-landscape column to the left); "Timing assist" and "Hold-to-preview" both show the
contact reticle (green when clearance > 0.15, red when blocked, faint white otherwise).

## 7. Screens and UI flow

Phases (`app.phase` in `native/main.ts`): `boot -> title -> modes | journey -> setup -> countdown -> active <-> paused -> resolving ->
results`, then `results -> setup` (Next / Retry) or `-> title` (Menu). Screens (`ScreenName`): title, modes,
journey, setup, leaderboard, results, pause, help, settings; at most one is open, the HUD is drawn only while none is.
Help and Settings are overlays: opened from the top bar during a live round they pause it (`overlay-open`) and resume
on Back; from the pause panel they return to the pause panel. The top bar (title, UTC clock, player chip with avatar,
Help, Settings) is built last, over every screen; switching Help ⇄ Settings keeps the screen the first overlay was
opened from, and re-opening the open overlay does nothing. Screens sit below the top bar's measured height (two rows
when it does not fit) and scroll when taller than the room left. A screen focuses its first control two frames after
it opens.

- **Title**: key art backdrop (`assets/title-backdrop.webp`) under a dark scrim, Play (primary), Resume paused round
  (only when a snapshot for a rebuildable stage exists), Daily Challenge, Leaderboards, Journey, Learn to Play, Settings (also in the
  top bar), progress line.
- **Modes**: card grid (name, description, ranked/casual meta); the same screen lists practice difficulties, challenges
  and lessons.
- **Journey**: 40 square cells, locked ones dimmed and disabled, stars shown, mastery cells outlined in accent.
- **Setup (briefing)**: goal, misses allowed, hazards, par, expected duration, players, ranked flag; Back / Begin.
- **Play HUD**: top-left block (Goal, Score, Combo, Misses, Time when limited, Pause); bottom centre Hint / Undo /
  THROW; hint line; countdown overlay; tutorial banner; caption strip.
- **Pause**: Resume first, then Settings, Help, Restart stage, Leave round (danger colour).
- **Results**: headline (Wheel Cleared! / Out of Misses / Sigil Struck / Time Expired), five-row breakdown plus total,
  time and throw count, achievement chips, personal-best line, Menu / Retry / Next stage.
- **Leaderboards**: the StarHermit high-score board's top 20 (rank, nickname, score; the player's row highlighted);
  guests see "Sign in with StarHermit to see the leaderboards.".
- **Help**: six rule cards, the control list with the bound keys, and the gamepad line. **Settings**: captions, colour
  palette, left-handed layout, the two reticle assists, haptics, Replay tutorials, Reset all progress (an inline
  "Erase everything / Cancel" confirmation), and a button opening the runtime's Options (sound volumes, mute and voice
  limit, graphics level and frame-rate limit, language, controls, text size, high contrast, reduced motion).

Layouts (`native/screens.ts`, by the window's logical size, safe area excluded): >= 1024 px shows a 240 px objective
rail left and an actions/status rail right of the playfield; short landscape (height <= 500) keeps a 150 px objective
rail, puts the Hint/Undo/THROW column beside the wheel and the hint line and lesson banner at the side; otherwise the
rails are gone and the controls sit across the bottom. The scene fills the window and the camera's view offset frames
the wheel into the playfield (the old canvas area) less the HUD bands. Text wraps (measured with `ui.measureText`)
instead of being cut; the runtime's interface and text size apply over everything.

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
seeded canvas texture (growth rings, radial grain, carved notches, vignette; 1024 px with fine fibre scratches at
Detailed) in a varnished clearcoat material under a brass torus rim with 12 instanced rivets, a domed hub, a thick edge
and a stand; two carved posts with brass caps flank the stage. Blades are a bevelled, pointed steel extrusion with a
clearcoat, cylinder grip, brass guard and pommel (slight tilt); sigils are emissive hexagons with an over-bright halo
ring, so hazards differ by shape as well as colour and glow when bloom is on.

**Shape and type**: rounded 12 px panels, pill THROW button, serif-leaning UI face ("Iowan Old Style", Segoe UI,
system-ui) with tracked uppercase labels.

**Motion**: an interruptible 1.1 s intro swoop (cubic ease, no cumulative lerp), tiered event VFX (embed: 14 wood
chips + 0.012 shake; miss: 22-30 sparks in accent or sigil colour + 0.03 shake; win: five 26-spark bursts; lose: 0.045
shake), particles from a seeded pool (80/160/260 by tier) that never raycast. Reduced motion removes shake and the
swoop, shortens blade flight to 20 ms, slows particles to 40 %, shortens countdown steps to 500 ms and the results delay
to 250 ms, and disables CSS transitions. Ambient motion (drifting embers, accent-light shimmer) stops under reduced
motion.

**Graphics.** The renderer uses ACES filmic tone mapping, a hemisphere fill, a warm key directional light whose
shadow box is fitted around the wheel, stand and posts, a cool rim light from behind, and a flickering accent point
light (three.js r160's intensities and shadow values as the browser build had them; engine minor 28). Optional effects per graphics level: key-light shadows, reflections from
three.js's `RoomEnvironment` through `PMREMGenerator.fromScene` (each standard material carries the room as its
own envMap at its `envMapIntensity`, strongest on steel, as r160 scaled scene.environment), `renderer.ao` (GTAO), `renderer.bloom` (threshold 0.9: sigil halos, hot sparks,
bright steel), `renderer.grade` in display space (contrast 0.11, saturation 1.08, cool shadows / warm highlights,
vignette 0.26), `renderer.antialias` (FXAA / SMAA / MSAA), particles (burst pool 80 or 260 × the budget's multiplier,
one InstancedMesh whose particles shrink as they fade, plus additive embers behind the wheel at particles high) and
surface detail (Detailed: the budget's wood texture, also its bump map (scale 2.2) for the carved relief, worn
stage boards, the overhead spot, brass post bands and seeded crates; Plain: flat floor, at most 512 px wood).

**Graphics levels.** The runtime's Options › Graphics choose the level (Auto by default) and own render scale, the
pixel-ratio cap, adaptive resolution, the frame-rate limit and readout, and shadow-map size / MSAA samples. The game
reads `frame().quality` (low, balanced, high, ultra) and `frame().levelIndex` each frame and applies the matching look
(`native/quality.ts`), rebuilding the stage (and re-placing the embedded blades from the rules state) when the budget
changes; gameplay is identical on every level.

| Tier | Shadows | AO | Bloom / grade | AA | Reflections | Particles | Detail | Materials | Blades | Wheel segments | Face texture | Particle pool × | Embers | Bloom res |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Low | off | off | off | MSAA | off | low | plain | Lambert wood, Phong steel | one merged vertex-coloured mesh | 48 | 512 px | 0.6 | 0 | ½ |
| Balanced | 1024 | off | on | FXAA | on | high | detailed | Standard | merged | 64 | 512 px | 1 | 40 | ½ |
| High | 2048 | on | on | SMAA | on | high | detailed | clearcoat Physical | 4 lit parts | 96 | 1024 px | 1 | 70 | ¾ |
| Ultra | 4096 | high | on | MSAA | on | high | detailed | clearcoat Physical | 4 parts | 128 | 2048 px | 1.5 | 140 | full |

The pool and the embers grow with the level above the tier's first (1.64× a level, at most 2×).

**Visual assets the design calls for**: store cover (`coverart.png`), title backdrop (`assets/title-backdrop.webp`), a
hero throwing-knife model (`assets/throwing-knife.glb`), icon and favicon. See section 15.

## 9. Audio direction

Buses (`native/audio.ts`): the runtime's music, effects and interface buses (Options › Audio owns volumes, mute and
the voice limit); the old default levels (music 70 %, effects 90 %, ambience 50 %) are folded into each sound's gain.
The authored Opus clips load once the mixer runs (natively at once, in a browser after the first press); the browser
build's synthesised stand-ins are not ported (a live synthesis graph makes the web runtime drop clip loads). Ambience
is the theme's authored loop, faded in over 1.5 s under a round and out while paused; music is the quiet seeded
pentatonic stem (one or two sine notes every 0.9–1.8 s, louder with the tier), its 11 notes rendered once into clips
and scheduled by mixer time. Every audible event has a caption when captions are on.

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

Every player-facing string ships in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT: menus, mode
cards, briefing, HUD, rails, countdown, hints, announcements and the board summary, results, help cards and controls,
settings, captions, stage/tier/tutorial/challenge/achievement names, and the account lines. Tables live in
`js/i18n.js` (account lines from `js/account-strings.js` folded in as `acct.*`). Content keeps its English names as
data and is named through the tables at display time.

The locale is the runtime's interface language (`preferences().language`: the player's choice in Options › Language,
else the account's preferred language, else the device's), mapped to the nearest shipped locale (`native/i18n.ts`:
en-GB, es-ES and fr-CA by region); `ui.setLanguage` follows it. A change applies at once: every screen and the HUD are
rebuilt each frame from the tables, so the round state, pause and focus are untouched and a posted score is never
reposted.

## 11. Accessibility

- Keyboard and gamepad path: Tab / arrows / D-pad through every screen, the first control of each screen focused as it
  opens, Esc / B backs out of screens.
- Announcements (`ui.announce`): polite for the start, embeds with the board summary (blades, sigils, goal, misses),
  hints, undo and resume; assertive for misses, rejected throws and results.
- Captions for every sound cue; volumes, mute and the voice limit in the runtime's Options.
- Contrast and colour: the runtime's high contrast (tokens switched to black panels and white ink, the key art dropped),
  four colour-vision palettes (a game setting), hazards coded by shape (blade vs hexagon) and by sound; text size from
  the runtime.
- Reduced motion from the runtime's preference (see section 8); timing is unchanged.
- Targets 44 x 44 px minimum, left-handed layout, hold/timing reticle assists, haptics toggle, tutorial replay.

## 12. StarHermit integration

Manifest `starhermit.txt`: `name=Blade Orbit`, `launch=index.html`, `server=score-script.js`, `version=1.0.0`,
`ruleset=v1`, `cover=cover.jpg`, `engine.version=1.27.0`, `engine.minor=29`, capabilities `platform,storage,clipboard`.

| Feature | Status |
|---|---|
| Player | `player()`: the StarHermit client's or the browser page's signed-in player from the first frame; the top-bar chip shows the display name and the avatar (`avatar()`, cut to a circle), "Guest" otherwise. Signing in is the runtime's Account dialog (title menu **Sign in with StarHermit** → `requestSignIn()`); a session that ends shows "Signed out of StarHermit — progress stays on this device." |
| Save | The progress document `{ v: 1, progression, scores, achievements }` is the engine save (`saves`, schema 1): on the device at once and in the cloud slot debounced; `js/session.js`'s `store` writes it through a `localStorage` shim. The account's save replacing the device's is merged in (`onStatus`); conflicts resolve with the merged document (`onConflict`), keeping the better value of every field (furthest unlock, most stars, highest counters, best score per stage, every lesson, every achievement with its earliest time) |
| Old cloud save | The browser build's slot (`game:blade-orbit`, the JS SDK's zipped `save.json`, the same document) shows as foreign: its text is merged with this device's progress and saved over it once (`replaceForeign`) |
| Settings | The game's own settings (captions, palette, leftHanded, holdToAim, timingAssist, haptics) are `settings` (`game.<key>`, synced with the account). The browser build's per-player keys are migrated where the game still owns them and removed (`legacyKeys` / `removeLegacy`); volumes, graphics, reduced motion, contrast, text size and language are the runtime's |
| Device data | The paused-round snapshot and the last 40 replay envelopes stay in the device's `storage` |
| Invite | Signed in, the title menu shows **Invite a friend**, which copies `inviteLink()` and confirms with a toast (the link is shown if the clipboard is refused) |
| Controls | `control.throw`, `pause`, `back`, `undo`, `hint`, `restart` with `engine.gamepad.*` defaults; rebinding is the runtime's |
| Leaderboard read | The `high-score` board (`leaderboards.list` / `entries`), names from `profile()`; guests see the sign-in note |
| Leaderboard submit | Signed in, every finished Journey, Daily or Challenge run (won or lost; not Practice or Learn) posts its total through a practice session whose socket carries `{ type: 'result', scores: { 'high-score': n } }` to `score-script.js` (integer 0–1,000,000; negative totals post as 0). The results show "Posting score…", then "Leaderboard rank: #N" (or posted / not posted) |
| Time | No server-time API: the top-bar clock and the daily seed use the device's UTC date |
| Not used | Platform achievements (none declared; unlocks stay in the save), matchmaking, rooms, chat, replays, voice, friends filtering |

## 13. Technical architecture

- `rules` is pure; it runs identically on the engine, in the unit tests and in `server.js`. The engine client imports
  `js/rules.js`, `js/content.js`, `js/session.js`, `js/i18n.js` and `js/migrate.js` as ES modules, unchanged except for
  the string tables' locale switch.
- `session` is the only writer of rules state: it issues ids `<sessionId>:<seq>`, keeps the command log, undo snapshots,
  periodic hashes and builds the replay envelope `{schema 1, rulesVersion 1, content, seed, initialHash, timestampOffset,
  commands, hashes, result}`. `verifyReplay` re-creates the game, advances to each command's tick, re-applies it and
  compares the final hash, total and ticks.
- `native/main.ts` runs the simulation on the runtime's fixed steps (`setFixedRate(60)`): one tick a step while the
  round is active; the countdown (4 × 42 steps, 30 with reduced motion) is a negative cosmetic pre-roll that reaches tick
  0 exactly at GO; the resolve lock and the results' settle count steps too. `onRender`'s interpolation feeds the
  wheel's angle.
- `render` consumes snapshots only; `syncState` diff-adds (or, after an undo, removes) embedded blade views,
  `pushEvents` triggers VFX.
- Budgets: about 25 meshes for the stage plus 1 (merged) or 4 per blade and 2 per sigil; particles are one instanced
  mesh.

## 14. Testing and acceptance criteria

`npm test` runs the unit tests (`node --test`) and `tests/native.mjs`:

- `tests/rules.test.mjs` (19 tests): legal actions; deterministic rotation; every rejection reason; scoring
  components; the three loss reasons; serialization round-trip and version guard; replay determinism across all
  shipped stages; tamper detection; all content validates; generator determinism and difficulty scaling; daily
  stability per UTC day; practice validity; malformed-command fuzz; bot clearability; `compareResults` ordering;
  tightest-blocker selection; undo-after-rejection integrity.
- `tests/i18n.test.mjs`: nine locales with every key and matching placeholders, real translations, every key the
  engine client asks for, account lines, `setLocale`.
- `tests/migrate.test.mjs`: the browser build's cloud save text, the conflict merge (better value of every field),
  the settings keys kept and dropped.
- `tests/native.mjs`: the web index matches the files (`npm run package` ran last), `tsc`, `starhermit check .` with
  no warnings, and every `tests/native/*.play` as a signed-out `--render-check`: `learn-lesson` (lesson 1 cleared with
  planned throws, results expecting the exact planned score 984, the lesson then shown completed), `journey-stage`
  (stage 1 cleared for 1250 and three stars, Next stage, stage 2 unlocked), `practice-actions` (a deliberate miss, undo,
  hint, pause, resume, leave, a practice restart), `challenges` (Flawless Edge lost on one miss, Ember Sprint's time
  limit expiring), `screens` (Help with the bound keys, Settings with the reset confirmation, the guest's leaderboard
  note, the daily briefing). Throw timings come from `tools/plan.mjs` (the hint system's widest-gap ticks; one tick a
  frame in a render check).
- `npm run test:browser` (`tools/browser-play.mjs`) serves the package on loopback and plays it in headless Chrome at
  1366 x 768 (keys into Journey stage 1, Space throws, Esc pauses), 390 x 844 (taps throw) and 844 x 390, failing on
  console errors or warnings or the runtime's error screen; `~/games/tools/engine-web-smoke.mjs` checks the start.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `coverart.png` (1200x675, 302 KB) | Store cover: carved oak wheel, embedded knives, teal sigils, embers | FLUX.2 klein, seed 4801, cropped, 256-colour PNG | Generated in this pass (replaced placeholder) |
| `assets/title-backdrop.webp` (1536x864, 15 KB) | Title screen backdrop | FLUX.2 klein, seed 4802, webp q82 | Shipped, drawn under the title (`native/screens.ts`) |
| `assets/throwing-knife.glb` (975 KB, 1854 verts, 1024 px texture) | Hero throwing-knife prop | FLUX.2 klein seed 4803 product shot -> TRELLIS seed 7 | Kept in the repo, not wired, left out of the package |
| `icon.png` | Platform icon | Authored | Shipped |
| `sfx/*.opus` x 12 (throw, embed, clang, ward, win, lose, click, undo, pause, hint, tick, go) | Event cues | MOSS-SoundEffect v2, 100 steps | Shipped |
| `sfx/ambience-hearth.opus`, `ambience-wind.opus`, `ambience-chimes.opus` (12 s) | Theme ambience loops | MOSS-SoundEffect v2, 100 steps | Generated in this pass, wired |
| `sfx/achievement-chime.opus`, `sfx/combo-chime.opus` | Achievement and combo accents | MOSS-SoundEffect v2, 100 steps | Generated in this pass, wired |
| Wheel face, blades, sigils, stage dressing | In-game geometry and textures | Procedural (`native/render.ts`), seeded | Shipped |
| Character animation | - | - | Not applicable (no humanoid) |

## 16. Known limitations

- The daily seed and the top-bar clock use the device's UTC date (the engine has no server-time API); daily results
  are not submitted to a separate board.
- "Hold-to-preview reticle" and "Timing assist reticle" are two settings with the same effect.
- The browser build's Graphics panel per-category overrides are not offered; the runtime's levels replace them.
- The synthesised stand-in sounds (while a clip loads) and the synth ambience bed are not ported; a cue plays once its
  clip is in.
- Particles fade by shrinking (one instanced mesh) rather than by opacity.
- Guests' old browser `localStorage` progress cannot migrate; signed-in players' cloud saves do.
- Audio is unverified in automation (the checks play silently).
- Long play scripts can fail with "the play script did not finish" when the machine is heavily loaded (the render
  check bounds its wait loop by iterations).
- `compareResults` falls back to `localeCompare` for session ids (`knownissues.md`).
- The hero knife model is not used; the in-game blade is the procedural mesh.

## Design intent not yet implemented

1. Show a daily board (global top 50 and the player's rank) on the results screen and the briefing.
2. Load `assets/throwing-knife.glb` for the standby and embedded blades with the procedural mesh as fallback.
3. Add a friends-only filter to the leaderboard panel.
4. Give the two reticle settings distinct behaviour (hold-to-preview only while the pointer is down).

## Runtime-provided options

Sound (volumes, mute, voice limit), graphics (level, frame-rate limit), language, controls, text size, high contrast
and reduced motion are the StarHermit runtime's Options; the browser build's options panel, `ui-scale.js`,
`sh-language.js` and `browser-guard.js` are gone (the runtime's web page handles browser interference).
