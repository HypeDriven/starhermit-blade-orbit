// Prints the play-script lines that clear a stage: each throw at the tick of
// the widest gap ahead (the hint system's findBestThrowTick), as waits and
// Space presses. The round clock is the runtime's fixed steps, one tick a
// frame in a render check: after the click that starts the round (Begin),
// the countdown runs 4 × 42 ticks and the wheel's tick 0 comes 164 frames
// after the click step (measured: the click's own frames, the round start
// in the frame's UI pass), and a key press acts at the start of its first
// frame (at the tick the previous frames reached); each `key Space 2` takes
// two frames. The planned score is the one the run gets, so a script can
// expect it.
//   node tools/plan.mjs <content id> [--miss N]
// --miss N throws the N-th blade (from 1) where it strikes the nearest
// hazard instead (a deliberate miss, for undo / miss checks).
import { createGame, applyCommand, advanceTick, findBestThrowTick, previewThrow } from '../js/rules.js';
import { JOURNEY, TUTORIALS, CHALLENGES } from '../js/content.js';

const id = process.argv[2] || 'tut-throw';
const missAt = Number((process.argv.indexOf('--miss') > 0 && process.argv[process.argv.indexOf('--miss') + 1]) || 0);
const all = [...JOURNEY, ...TUTORIALS, ...CHALLENGES.map((c) => c.build())];
const content = all.find((c) => c.id === id);
if (!content) { console.error(`no stage ${id}`); process.exit(1); }

const COUNTDOWN = 4 * 42 - 4;
const LOCK = 9; // the 0.14 s resolve lock (8 steps) and one to spare
let s = createGame(content);
const lines = [];
let last = null; // tick of the previous throw
let n = 0;
while (s.status === 'active' && n < 40) {
  n++;
  let tick;
  if (n === missAt) {
    tick = s.tick + LOCK;
    while (previewThrow(s, tick).outcome === 'embed' && tick < s.tick + 2000) tick++;
  } else {
    // the widest gap at least the lock away
    const ahead = advanceTick(s, last == null ? 5 : LOCK);
    tick = findBestThrowTick(ahead, 900).tick;
  }
  const wait = last == null ? COUNTDOWN + tick : tick - last - 2;
  lines.push(`frames ${wait}`, 'key Space 2');
  if (tick > s.tick) s = advanceTick(s, tick - s.tick);
  const r = applyCommand(s, { id: `p${n}`, type: 'throw', tick: s.tick });
  s = r.state;
  last = tick;
  lines.push(`# throw ${n} at tick ${tick}: ${r.events.map((e) => e.type).join(', ')}`);
}
console.log(`# ${id}: ${s.status} (${s.terminalReason}), score ${s.score.hits + s.score.precision + s.score.combo + s.score.timeBonus + s.score.missPenalty}`);
console.log(lines.join('\n'));
