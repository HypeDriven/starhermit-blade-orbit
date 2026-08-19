/**
 * Blade Orbit — bootstrap + orchestration.
 * Owns the app state machine (boot → title → mode-select → preparing →
 * countdown → active ↔ paused → resolving → results → progression),
 * the fixed-step simulation loop, and all input routing.
 */

import { SIM_FPS } from './rules.js';
import {
  JOURNEY, TUTORIALS, CHALLENGES, THEMES, dailyContent, practiceContent,
  themeById, validateAllContent,
} from './content.js';
import { Session, store, evaluateAchievements, ACHIEVEMENTS } from './session.js';
import { createRenderer, pickAutoTier } from './render.js';
import { createUI } from './ui.js';
import { AudioEngine } from './audio.js';
import { Platform } from './platform.js';

const TICK_MS = 1000 / SIM_FPS;
const RESOLVE_LOCK_MS = 140;   // shortest non-interruptible resolution window
const RESULTS_DELAY_MS = 1000; // cosmetic settle before results screen

class Game {
  constructor() {
    this.phase = 'boot'; // boot|title|modes|journey|setup|countdown|active|paused|resolving|results
    this.session = null;
    this.pendingContent = null;
    this.pendingRanked = false;
    this.settings = store.getSettings();
    this.progression = store.getProgression();
    this.platform = new Platform();
    this.inputLocked = false;
    this.accumulator = 0;
    this.lastFrame = 0;
    this.idleTick = 0; // cosmetic spin for menus/countdown
    this.lowFpsCount = 0;
    this.gamepadPrev = {};
    this.returnScreen = 'title';

    this.audio = new AudioEngine(this.settings, (text) => this.ui?.caption(text));

    this.ui = createUI({
      action: (a, data) => this.onAction(a, data),
      sound: (name) => { this.audio.start(); this.audio.event(name); },
      getSettings: () => this.settings,
      settingChanged: (k, v) => this.onSettingChanged(k, v),
    });

    this.canvas = document.getElementById('game-canvas');
    this.renderer = null;
    try {
      this.renderer = createRenderer(this.canvas, {
        onContextLost: () => this.onContextLost(),
        onFps: (fps) => this.onFps(fps),
      });
    } catch {
      document.getElementById('canvas-fallback').hidden = false;
    }
  }

  async boot() {
    // content sanity pass (offline validators)
    const report = validateAllContent();
    if (!report.ok) console.warn('Content validation failures:', report.failures);

    await this.platform.init();
    this.ui.applySettingsToDom(this.settings);
    this.ui.buildHelp();
    this.ui.setProfileChip('Guest');

    // clock display (platform-synchronized where hosted)
    setInterval(() => {
      const d = this.platform.serverNow();
      this.ui.setServerClock(d.toISOString().slice(11, 19) + ' UTC');
    }, 1000);

    // attract-mode backdrop behind the title
    if (this.renderer) {
      const demo = dailyContent(this.platform.serverNow());
      this.applyQuality();
      this.renderer.setReducedMotion(this.settings.reducedMotion);
      this.renderer.loadContent(demo, demo.theme);
      this.renderer.setReticleMode('hidden');
    }

    this.buildMenus();
    this.ui.showScreen('title');
    this.ui.updateTitle(this.progression, !!store.loadSnapshot());
    this.phase = 'title';
    this.bindInput();
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // --- menus ----------------------------------------------------------------

  buildMenus() {
    const daily = dailyContent(this.platform.serverNow());
    const modes = [
      { id: 'journey', name: 'Journey', description: 'Forty staged trials across five tiers. Mastery every eighth.', meta: `${this.progression.journeyUnlocked - 1}/40 unlocked` },
      { id: 'daily', name: 'Daily Challenge', description: `One shared seed for everyone today: ${daily.id}. Ranked board.`, meta: 'ranked' },
      { id: 'practice', name: 'Practice', description: 'Selectable difficulty, undo and hints, never rated.', meta: 'casual' },
      { id: 'challenge', name: 'Challenges', description: 'Constrained trials: flawless runs, sprints, thickets of steel.', meta: 'casual' },
      { id: 'tutorial', name: 'Learn', description: 'Four short interactive lessons, one rule at a time.', meta: 'tutorial' },
    ];
    this.ui.buildModeList(modes);
    this.ui.buildJourneyGrid(JOURNEY, this.progression);
    this.daily = daily;
  }

  modesFor(id) {
    switch (id) {
      case 'journey': this.ui.buildJourneyGrid(JOURNEY, this.progression); this.ui.showScreen('journey'); break;
      case 'daily': this.prepareContent(this.daily, { ranked: true }); break;
      case 'practice': this.showPracticeSetup(); break;
      case 'challenge': this.showChallengePick(); break;
      case 'tutorial': this.showTutorialPick(); break;
      default: break;
    }
  }

  showPracticeSetup() {
    const modes = ['easy', 'normal', 'hard', 'expert', 'master'].map((d) => ({
      id: `practice:${d}`, name: `Practice — ${d[0].toUpperCase()}${d.slice(1)}`,
      description: { easy: 'Slow wheel, open ring, 3 misses.', normal: 'Steady spin, a few hazards.', hard: 'Sigils and surging speed.', expert: 'Pulsing wheel, thin margins.', master: 'One miss. No mercy.' }[d],
      meta: 'casual · undo + hints',
    }));
    this.ui.buildModeList(modes);
    this.ui.showScreen('modes');
  }

  showChallengePick() {
    const modes = CHALLENGES.map((c) => ({ id: `challenge:${c.id}`, name: c.name, description: c.description, meta: 'challenge · casual' }));
    this.ui.buildModeList(modes);
    this.ui.showScreen('modes');
  }

  showTutorialPick() {
    const modes = TUTORIALS.map((t, i) => ({
      id: `tutorial:${t.id}`, name: t.name,
      description: t.steps[0],
      meta: this.progression.tutorialsDone[t.id] ? 'completed ✓' : `lesson ${i + 1} of 4`,
    }));
    this.ui.buildModeList(modes);
    this.ui.showScreen('modes');
  }

  prepareContent(content, { ranked = false } = {}) {
    this.pendingContent = content;
    this.pendingRanked = ranked;
    const secs = Math.round(content.par.ticks / SIM_FPS);
    this.ui.showSetup(content, {
      ranked,
      duration: content.timeLimitTicks
        ? `${Math.round(content.timeLimitTicks / SIM_FPS)}s limit`
        : secs < 90 ? `about ${secs}s` : `about ${Math.round(secs / 60)} min`,
    });
  }

  // --- session lifecycle ----------------------------------------------------

  startSession(content) {
    const allowUndo = content.kind === 'practice' || content.kind === 'tutorial';
    this.session = new Session(content, { allowUndo });
    this.progression.sessionsPlayed += 1;
    store.saveProgression(this.progression);
    this.platform.track('start', { mode: content.kind, tier: String(content.tier || 0) });
    this.platform.startPresence();

    if (this.renderer) {
      this.renderer.loadContent(content, content.theme);
      this.renderer.setReducedMotion(this.settings.reducedMotion);
      this.renderer.setReticleMode('hidden');
    }
    this.audio.startAmbience(themeById(content.theme).ambience);
    this.audio.startMusic(content.tier ? Math.min(1, content.tier / 6) : 0.2);

    this.ui.setPlayingChrome(true);
    this.ui.showScreen(null);
    this.ui.buildRailActions(this.railActions(content));
    this.ui.updateHud(this.session.state, content, this.hudFlags());
    this.ui.updateBoardMirror(this.session.state);
    this.ui.announce(`${content.name}. Embed ${content.goal} blades. ${content.missesAllowed} misses allowed.`);

    // tutorial steps as banner
    if (content.kind === 'tutorial') {
      this.tutorialStep = 0;
      this.ui.showTutorialBanner(content.steps[0]);
      this.platform.track('tutorial_step', { mode: content.id });
    }

    this.phase = 'countdown';
    this.runCountdown();
  }

  railActions(content) {
    const acts = [];
    if (content.kind === 'practice' || content.kind === 'tutorial') {
      acts.push({ label: 'Undo (U)', action: 'undo' }, { label: 'Hint (H)', action: 'hint' });
    }
    if (content.kind === 'practice') acts.push({ label: 'Restart (R)', action: 'restart' });
    acts.push({ label: 'Pause (P)', action: 'pause' });
    return acts;
  }

  hudFlags() {
    const kind = this.session?.content.kind;
    return { canUndo: kind === 'practice' || kind === 'tutorial', canHint: kind === 'practice' || kind === 'tutorial' };
  }

  runCountdown() {
    const steps = ['3', '2', '1', 'GO'];
    let i = 0;
    const step = () => {
      if (this.phase !== 'countdown') return;
      if (i < steps.length) {
        this.ui.showCountdown(steps[i]);
        this.audio.event(i === steps.length - 1 ? 'go' : 'tick');
        i++;
        setTimeout(step, this.settings.reducedMotion ? 500 : 700);
      } else {
        this.ui.showCountdown(null);
        if (this.session?.content.kind === 'tutorial') {
          this.ui.showTutorialBanner(this.session.content.steps[1] || null);
        }
        this.phase = 'active';
        this.accumulator = 0;
      }
    };
    step();
  }

  doThrow() {
    if (this.phase !== 'active' || this.inputLocked || !this.session) return;
    this.audio.start(); // ensure context after gesture
    this.inputLocked = true;
    setTimeout(() => { this.inputLocked = false; }, RESOLVE_LOCK_MS);

    this.renderer?.interruptSwoop();
    const { applied, events, error } = this.session.throw();
    if (!applied) {
      if (error !== 'duplicate-command') this.ui.announceAlert('That throw was not allowed.');
      return;
    }
    this.audio.event('throw');
    if (this.settings.haptics && navigator.vibrate) navigator.vibrate(12);

    for (const ev of events) {
      if (ev.type === 'embed') {
        this.audio.event('embed', { combo: ev.combo });
        this.ui.announce(`Embedded. ${ev.precision} precision points${ev.combo > 1 ? `, combo x${ev.combo}` : ''}.`);
      } else if (ev.type === 'miss') {
        this.audio.event(ev.blockedBy === 'hit-marker' ? 'miss-marker' : 'miss-blade');
        if (this.settings.haptics && navigator.vibrate) navigator.vibrate([40, 30, 40]);
        this.ui.announceAlert(ev.blockedBy === 'hit-marker'
          ? 'Miss — you struck a warded sigil!'
          : 'Miss — your blade struck steel.');
        this.ui.setHintLine('');
      }
    }
    this.renderer?.pushEvents(events);
    this.renderer?.syncState(this.session.state);
    this.ui.updateHud(this.session.state, this.session.content, this.hudFlags());
    this.ui.updateBoardMirror(this.session.state);

    if (this.session.state.status !== 'active') this.enterResolving(events);
  }

  enterResolving(events) {
    this.phase = 'resolving';
    const won = this.session.state.status === 'won';
    this.audio.event(won ? 'win' : 'lose');
    setTimeout(() => this.showResults(), this.settings.reducedMotion ? 250 : RESULTS_DELAY_MS);
  }

  showResults() {
    if (!this.session) return;
    this.phase = 'results';
    const report = this.session.report();
    const content = this.session.content;

    // progression
    this.progression.totalThrows += report.embedded + report.misses;
    this.progression.totalEmbeds += report.embedded;
    let nextStage = null;
    if (report.won) {
      if (content.kind === 'tutorial') this.progression.tutorialsDone[content.id] = true;
      if (content.kind === 'journey') {
        const n = JOURNEY.indexOf(content) + 1;
        const stars = report.total >= content.par.score * 1.4 ? 3 : report.total >= content.par.score ? 2 : 1;
        this.progression.journeyStars[content.id] = Math.max(this.progression.journeyStars[content.id] || 0, stars);
        this.progression.journeyUnlocked = Math.max(this.progression.journeyUnlocked, Math.min(41, n + 1));
        this.progression.masteryXp += 10 * (content.tier || 1) + stars * 5;
        nextStage = n < 40 ? JOURNEY[n] : null;
      }
      if (content.kind === 'daily') this.progression.dailyDone[content.id] = report.total;
    }
    store.saveProgression(this.progression);

    const isBest = store.recordScore(content.id, report);
    const best = store.getScores()[content.id];
    const achievements = evaluateAchievements(this.session, this.progression);
    store.saveReplay(`${content.id}:${this.session.sessionId}`, this.session.replayEnvelope());
    store.clearSnapshot();

    this.platform.track('round_end', { mode: content.kind, result: report.won ? 'won' : 'lost' });
    this.platform.stopPresence();
    this.audio.stopMusic();

    // ranked submission with replay envelope (daily board)
    if (this.pendingRanked && content.kind === 'daily') {
      this.platform.submitScore(this.session.replayEnvelope()).then((res) => {
        if (!res.ok) this.ui.announce(`Score recorded locally (${res.reason}); board unavailable.`);
      });
    }

    this.ui.showResults(report, { achievements, isBest, nextStage, best });
    this.ui.updateTitle(this.progression, false);
  }

  pause(reason = 'user') {
    if (this.phase !== 'active' && this.phase !== 'countdown') return;
    this.pausedFrom = this.phase;
    this.phase = 'paused';
    if (this.session) store.saveSnapshot(this.session.content.id, this.session.snapshotJson());
    this.audio.event('pause');
    this.audio.suspend();
    if (reason === 'user') this.ui.showScreen('pause');
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.audio.resume();
    this.ui.showScreen(null);
    this.ui.setPlayingChrome(true);
    this.phase = this.pausedFrom === 'countdown' ? 'countdown' : 'active';
    if (this.phase === 'countdown') this.runCountdown();
    this.accumulator = 0;
  }

  leaveToTitle() {
    this.session = null;
    this.phase = 'title';
    this.audio.stopMusic();
    this.audio.stopAmbience();
    this.platform.stopPresence();
    this.ui.showTutorialBanner(null);
    this.buildMenus();
    this.ui.showScreen('title');
    this.ui.updateTitle(this.progression, !!store.loadSnapshot());
    if (this.renderer) {
      const demo = dailyContent(this.platform.serverNow());
      this.renderer.loadContent(demo, demo.theme);
      this.renderer.setReticleMode('hidden');
    }
  }

  // --- input ----------------------------------------------------------------

  bindInput() {
    // pointer: tap anywhere on the playfield throws (explicit layer only)
    const wrap = document.getElementById('playfield-wrap');
    wrap.addEventListener('pointerdown', (e) => {
      this.audio.start();
      if (e.target.closest('button, a, input, select')) return;
      if (this.phase === 'active') { e.preventDefault(); this.doThrow(); }
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.audio.start();
      const inControl = !!e.target.closest?.('button, input, select, textarea, a');
      const key = e.key.toLowerCase();
      if ((key === ' ' || key === 'enter') && !inControl && this.phase === 'active') {
        e.preventDefault();
        this.doThrow();
      } else if (key === 'p') {
        this.phase === 'paused' ? this.resume() : this.pause();
      } else if (key === 'escape') {
        if (this.phase === 'paused') this.resume();
        else if (this.phase === 'active') this.pause();
        else if (this.ui.currentScreen && this.ui.currentScreen !== 'title') this.ui.showScreen('title');
      } else if (key === 'u' && this.phase === 'active') this.onAction('undo');
      else if (key === 'h' && this.phase === 'active') this.onAction('hint');
      else if (key === 'r' && this.phase === 'active' && this.session?.content.kind === 'practice') this.onAction('restart');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause('hidden');
    });
    window.addEventListener('resize', () => this.renderer?.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer?.resize(), 60));
    // react to any layout change (rails, drawers, safe areas, zoom) without losing input
    new ResizeObserver(() => this.renderer?.resize()).observe(document.getElementById('playfield-wrap'));
  }

  pollGamepad() {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    for (const pad of pads) {
      if (!pad) continue;
      const pressed = (i) => !!pad.buttons[i]?.pressed;
      const rose = (name, now) => {
        const was = this.gamepadPrev[pad.index + name] || false;
        this.gamepadPrev[pad.index + name] = now;
        return now && !was;
      };
      if (rose('a', pressed(0)) && this.phase === 'active') this.doThrow();
      if (rose('start', pressed(9))) this.phase === 'paused' ? this.resume() : this.pause();
      if (rose('b', pressed(1)) && this.phase === 'paused') this.resume();
    }
  }

  // --- actions from UI --------------------------------------------------------

  onAction(action, data) {
    switch (action) {
      case 'play': this.ui.showScreen('modes'); this.buildMenus(); break;
      case 'mode-picked': {
        const [kind, arg] = data.split(':');
        if (arg === undefined) { this.modesFor(data); break; }
        if (kind === 'practice') this.prepareContent(practiceContent(arg));
        else if (kind === 'challenge') {
          const ch = CHALLENGES.find((c) => c.id === arg);
          if (ch) this.prepareContent(ch.build());
        } else if (kind === 'tutorial') {
          const t = TUTORIALS.find((x) => x.id === arg);
          if (t) this.prepareContent(t);
        }
        break;
      }
      case 'journey-picked': {
        const stage = JOURNEY.find((s) => s.id === data);
        if (stage) this.prepareContent(stage);
        break;
      }
      case 'daily': this.prepareContent(this.daily, { ranked: true }); break;
      case 'tutorial': this.showTutorialPick(); break;
      case 'setup-start': if (this.pendingContent) this.startSession(this.pendingContent); break;
      case 'setup-back': this.ui.showScreen('title'); break;
      case 'throw': this.doThrow(); break;
      case 'pause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'leave': this.leaveToTitle(); break;
      case 'restart':
        if (this.session) { const c = this.session.content; this.startSession(c); }
        break;
      case 'retry':
        if (this.session) this.startSession(this.session.content);
        break;
      case 'next-stage': {
        const n = JOURNEY.indexOf(this.session?.content) + 1;
        if (n > 0 && n < JOURNEY.length) this.prepareContent(JOURNEY[n]);
        break;
      }
      case 'results-menu': this.leaveToTitle(); break;
      case 'resume-snapshot': this.resumeSnapshot(); break;
      case 'undo': {
        if (!this.session) break;
        const r = this.session.undo();
        if (r.ok) {
          this.audio.event('undo');
          if (this.renderer) {
            this.renderer.loadContent(this.session.content, this.session.content.theme);
            this.renderer.setReducedMotion(this.settings.reducedMotion);
            this.renderer.syncState(this.session.state);
          }
          this.ui.updateHud(this.session.state, this.session.content, this.hudFlags());
          this.ui.updateBoardMirror(this.session.state);
          this.ui.announce('Undone.');
        } else this.ui.announce('Nothing to undo.');
        break;
      }
      case 'hint': {
        if (!this.session) break;
        const h = this.session.hint();
        if (!h) break;
        this.audio.event('hint');
        const text = h.ticksAway <= 1 ? 'Throw now!' : `Wait ${(h.ticksAway / SIM_FPS).toFixed(1)}s for a wide gap…`;
        this.ui.setHintLine(text);
        this.ui.announce(text);
        break;
      }
      case 'replay-tutorials':
        this.progression.tutorialsDone = {};
        store.saveProgression(this.progression);
        this.showTutorialPick();
        break;
      case 'reset-progress':
        localStorage.clear();
        this.progression = store.getProgression();
        this.buildMenus();
        this.ui.updateTitle(this.progression, false);
        this.ui.announce('All progress erased.');
        break;
      case 'settings-closed': break;
      case 'title-shown': break;
      default: break;
    }
  }

  resumeSnapshot() {
    const snap = store.loadSnapshot();
    if (!snap) return;
    const content = this.findContentById(snap.contentId);
    if (!content) { store.clearSnapshot(); return; }
    const session = Session.restore(content, snap.json);
    if (!session) { store.clearSnapshot(); return; }
    this.session = session;
    this.pendingContent = content;
    if (this.renderer) {
      this.renderer.loadContent(content, content.theme);
      this.renderer.setReducedMotion(this.settings.reducedMotion);
      this.renderer.syncState(session.state);
    }
    this.audio.startAmbience(themeById(content.theme).ambience);
    this.ui.setPlayingChrome(true);
    this.ui.showScreen(null);
    this.ui.buildRailActions(this.railActions(content));
    this.ui.updateHud(session.state, content, this.hudFlags());
    this.phase = 'active';
    this.ui.announce('Round resumed from where you left off.');
  }

  findContentById(id) {
    return JOURNEY.find((s) => s.id === id)
      || TUTORIALS.find((s) => s.id === id)
      || CHALLENGES.map((c) => c.build()).find((s) => s.id === id)
      || (this.daily && this.daily.id === id ? this.daily : null);
  }

  // --- settings ---------------------------------------------------------------

  onSettingChanged(key, value) {
    this.settings = { ...this.settings, [key]: value };
    if (key === 'textScale' || key === 'text-scale') this.settings.textScale = parseFloat(value);
    store.saveSettings(this.settings);
    this.ui.applySettingsToDom(this.settings);
    this.audio.settings = this.settings;
    this.audio.applyVolumes();
    if (key === 'quality') this.applyQuality();
    if (key === 'reducedMotion') this.renderer?.setReducedMotion(!!value);
    this.platform.track('settings_change', { category: key });
  }

  applyQuality() {
    if (!this.renderer) return;
    const q = this.settings.quality === 'auto' ? pickAutoTier() : this.settings.quality;
    this.renderer.setQuality(q);
  }

  onFps(fps) {
    // dynamic render-scale drop before ever touching the simulation rate
    if (this.settings.quality !== 'auto') return;
    if (fps < 42) {
      this.lowFpsCount++;
      if (this.lowFpsCount >= 3) {
        this.lowFpsCount = 0;
        this.renderer.setQuality(fps < 28 ? 'low' : 'medium');
        this.ui.announce('Graphics quality lowered to keep the game smooth.');
      }
    } else this.lowFpsCount = 0;
  }

  onContextLost() {
    // rebuild GPU resources from retained CPU descriptors
    try {
      const content = this.session?.content || this.daily;
      this.renderer.dispose();
      this.renderer = createRenderer(this.canvas, {
        onContextLost: () => this.onContextLost(),
        onFps: (fps) => this.onFps(fps),
      });
      this.applyQuality();
      this.renderer.setReducedMotion(this.settings.reducedMotion);
      this.renderer.loadContent(content, content.theme);
      if (this.session) this.renderer.syncState(this.session.state);
    } catch {
      document.getElementById('canvas-fallback').hidden = false;
    }
  }

  // --- main loop: fixed-step sim + interpolated render -------------------------

  frame(now) {
    if (this._disposed) return;
    requestAnimationFrame((t) => this.frame(t));
    const dtMs = Math.min(250, now - this.lastFrame);
    this.lastFrame = now;

    this.pollGamepad();

    const simRunning = this.phase === 'active' || this.phase === 'countdown';
    if (simRunning && this.session) {
      this.accumulator += dtMs;
      let steps = 0;
      while (this.accumulator >= TICK_MS && steps < 8) {
        this.accumulator -= TICK_MS;
        steps++;
      }
      if (steps > 0) {
        const events = this.session.tick(steps);
        if (events.length) { // terminal transition (time limit)
          this.renderer?.pushEvents(events);
          this.enterResolving(events);
        }
        if (this.phase === 'active') {
          this.ui.updateHud(this.session.state, this.session.content, this.hudFlags());
        }
      }
      // timing assist / hold-to-aim reticle
      if (this.phase === 'active' && this.renderer && (this.settings.timingAssist || this.settings.holdToAim)) {
        const p = this.session.previewNow();
        this.renderer.setReticleMode(
          p.outcome !== 'embed' ? 'bad' : p.clearance > 0.15 ? 'good' : 'idle'
        );
      }
      const alpha = this.accumulator / TICK_MS;
      this.renderer?.update(dtMs, this.session.state, alpha);
    } else if (this.renderer && this.session && (this.phase === 'paused' || this.phase === 'resolving' || this.phase === 'results')) {
      // frozen sim, cosmetic settle only
      this.renderer.update(dtMs, this.session.state, 0);
    } else if (this.renderer && !this.session && !document.hidden) {
      // attract mode behind menus: cosmetic idle spin, no sim state
      this.idleTick += dtMs / TICK_MS;
      this.renderer.update(dtMs, { rotation: this.daily.rotation, tick: this.idleTick, slots: [], status: 'active' }, 0);
    }
  }
}

// --- boot ---------------------------------------------------------------------

const game = new Game();
window.__game = game; // debug/e2e handle
game.boot().catch((err) => {
  console.error('Boot failed:', err);
  const fb = document.getElementById('canvas-fallback');
  fb.hidden = false;
  fb.querySelector('p').textContent = 'The game failed to start: ' + err.message;
});

export { game };
