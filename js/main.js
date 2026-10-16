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
import { createRenderer } from './render.js';
import { normalizePreset, CATEGORIES } from './gfx.js';
import { createUI, contentName, tutorialStepText } from './ui.js';
import { AudioEngine } from './audio.js';
import { Platform } from './platform.js';
import { accountText } from './gfx-i18n.js';
import { t, getLang, onLanguage } from './i18n.js';

// Keyboard actions by KeyboardEvent.code (control.* in starhermit.txt);
// a signed-in player's StarHermit overrides replace these at boot.
const KEY_DEFAULTS = {
  throw: ['Space', 'Enter', 'NumpadEnter'], pause: ['KeyP'], back: ['Escape'],
  undo: ['KeyU'], hint: ['KeyH'], restart: ['KeyR'],
};
// Account / leaderboard lines follow the game language (Settings → Language).
const acct = () => accountText(getLang());

const TICK_MS = 1000 / SIM_FPS;
const RESOLVE_LOCK_MS = 140;   // shortest non-interruptible resolution window
const RESULTS_DELAY_MS = 1000; // cosmetic settle before results screen

class Game {
  constructor() {
    this.phase = 'boot'; // boot|title|modes|journey|setup|countdown|active|paused|resolving|results
    this.session = null;
    this.pendingContent = null;
    this.settings = store.getSettings();
    this.settings.quality = normalizePreset(this.settings.quality); // legacy 'medium' → 'balanced'
    this.settings.graphics = { ...(this.settings.graphics || {}) };
    this.progression = store.getProgression();
    this.platform = new Platform();
    this.keyBindings = structuredClone(KEY_DEFAULTS);
    this.signedOutNotice = false;
    this.inputLocked = false;
    this.overlayPaused = false; // set when Help/Settings auto-paused a live round
    this.accumulator = 0;
    this.lastFrame = 0;
    this.idleTick = 0; // cosmetic spin for menus/countdown
    this.gamepadPrev = {};
    this.returnScreen = 'title';

    this.audio = new AudioEngine(this.settings, (text) => this.ui?.caption(text));

    this.ui = createUI({
      action: (a, data) => this.onAction(a, data),
      sound: (name) => { this.audio.start(); this.audio.event(name); },
      getSettings: () => this.settings,
      settingChanged: (k, v) => this.onSettingChanged(k, v),
      graphicsInfo: (words) => this.renderer?.graphicsInfo(words) || null,
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
    await this.initAccount();
    this.ui.applySettingsToDom(this.settings);
    this.ui.buildHelp(this.keyLabels());
    this.ui.setProfileChip(t('guest'));
    // Hosted: the account nickname and avatar replace the guest chip when they resolve.
    this.platform.fetchProfile().then((p) => {
      if (p) { this.profileName = p.displayName; this.ui.setProfileChip(p.displayName); }
    });
    this.platform.avatarUrl().then((url) => this.ui.setProfileAvatar(url));

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

    this.ui.refreshGraphics();
    this.buildMenus();
    this.ui.showScreen('title');
    this.ui.updateTitle(this.progression, this.hasResumableSnapshot());
    this.phase = 'title';
    this.bindInput();
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // --- StarHermit account ----------------------------------------------------

  /** Remote-first progress, platform settings, key bindings, account buttons. */
  async initAccount() {
    const P = this.platform;
    store.onPersist = (key) => {
      if (store.isCloudKey(key)) P.saveCloud(store.exportCloud());
      else if (store.isSettingsKey(key)) P.mirrorSettings(this.settings);
    };
    P.onAuth((a) => {
      if (!a.signedIn) {
        this.signedOutNotice = true;
        this.profileName = null;
        this.ui.setProfileChip(t('guest'));
        this.ui.setProfileAvatar(null);
        this.ui.toast(acct().signedOut);
      }
      this.refreshAccountButtons();
    });
    document.getElementById('btn-sign-in').addEventListener('click', () => P.signIn());
    document.getElementById('btn-invite').addEventListener('click', () => this.copyInvite());
    this.refreshAccountButtons();
    const acc = await P.loadAccount(KEY_DEFAULTS).catch(() => null);
    if (!acc) return;
    if (acc.remote && store.importCloud(acc.remote)) this.progression = store.getProgression();
    else P.saveCloud(store.exportCloud()); // seed the slot from this device
    for (const k of Object.keys(store.getSettings())) if (k in acc.settings) this.settings[k] = acc.settings[k];
    store.saveSettings(this.settings); // platform values win; seeds keys it lacks
    this.audio.settings = this.settings;
    this.audio.applyVolumes();
    this.keyBindings = acc.bindings;
    // Another device saved first: merge its copy (better values win) and save again.
    P.onSaveConflict((remote) => {
      if (!store.mergeCloud(remote)) return;
      this.progression = store.getProgression();
      P.saveCloud(store.exportCloud());
      if (this.phase === 'title' || this.phase === 'boot') {
        this.buildMenus();
        this.ui.updateTitle(this.progression, this.hasResumableSnapshot());
      }
    });
    window.addEventListener('pagehide', () => P.flushCloud());
    document.addEventListener('visibilitychange', () => { if (document.hidden) P.flushCloud(); });
  }

  refreshAccountButtons() {
    const si = document.getElementById('btn-sign-in');
    const inv = document.getElementById('btn-invite');
    si.textContent = acct().signIn;
    si.hidden = !this.platform.canSignIn();
    inv.textContent = acct().invite;
    inv.hidden = !this.platform.tokenHosted;
  }

  async copyInvite() {
    const link = this.platform.inviteLink();
    if (!link) return;
    try { await navigator.clipboard.writeText(link); this.ui.toast(acct().inviteCopied); }
    catch { this.ui.toast(`${acct().inviteFailed} ${link}`); }
  }

  actionFor(code) {
    for (const [a, codes] of Object.entries(this.keyBindings)) if (codes.includes(code)) return a;
    return null;
  }

  /** Display labels of the effective bindings for the Help controls list. */
  keyLabels() {
    const name = (c) => ({ Space: 'SPACE', Enter: 'ENTER', NumpadEnter: 'NUM ENTER', Escape: 'ESC' }[c] || c.replace(/^Key/, '').replace(/^Digit/, ''));
    const out = {};
    for (const [a, codes] of Object.entries(this.keyBindings)) out[a] = codes.map(name).join(' / ');
    return out;
  }

  // --- menus ----------------------------------------------------------------

  buildMenus() {
    const daily = dailyContent(this.platform.serverNow());
    const modes = [
      { id: 'journey', name: t('mode.journey'), description: t('mode.journey.d'), meta: t('mode.journey.m', { n: this.progression.journeyUnlocked - 1 }) },
      { id: 'daily', name: t('mode.daily'), description: t('mode.daily.d', { id: daily.id }), meta: t('mode.ranked') },
      { id: 'practice', name: t('mode.practice'), description: t('mode.practice.d'), meta: t('mode.casual') },
      { id: 'challenge', name: t('mode.challenge'), description: t('mode.challenge.d'), meta: t('mode.casual') },
      { id: 'tutorial', name: t('mode.tutorial'), description: t('mode.tutorial.d'), meta: t('mode.tutorial.m') },
    ];
    this.modeList = 'menus';
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

  showPracticeSetup(rerender = false) {
    const modes = ['easy', 'normal', 'hard', 'expert', 'master'].map((d) => ({
      id: `practice:${d}`, name: t('prac.name', { d: t(`diff.${d}`) }),
      description: t(`prac.${d}.d`),
      meta: t('prac.meta'),
    }));
    this.modeList = 'practice';
    this.ui.buildModeList(modes);
    if (!rerender) this.ui.showScreen('modes');
  }

  showChallengePick(rerender = false) {
    const modes = CHALLENGES.map((c) => ({ id: `challenge:${c.id}`, name: t(`ch.${c.id}`, null, c.name), description: t(`chd.${c.id}`, null, c.description), meta: t('ch.meta') }));
    this.modeList = 'challenge';
    this.ui.buildModeList(modes);
    if (!rerender) this.ui.showScreen('modes');
  }

  showTutorialPick(rerender = false) {
    const modes = TUTORIALS.map((c, i) => ({
      id: `tutorial:${c.id}`, name: contentName(c),
      description: tutorialStepText(c, 0),
      meta: this.progression.tutorialsDone[c.id] ? t('tut.done') : t('tut.lesson', { n: i + 1 }),
    }));
    this.modeList = 'tutorial';
    this.ui.buildModeList(modes);
    if (!rerender) this.ui.showScreen('modes');
  }

  prepareContent(content, { ranked = false, rerender = false } = {}) {
    this.pendingContent = content;
    this.pendingRanked = ranked;
    const secs = Math.round(content.par.ticks / SIM_FPS);
    this.ui.showSetup(content, {
      ranked, rerender,
      duration: content.timeLimitTicks
        ? t('dur.limit', { n: Math.round(content.timeLimitTicks / SIM_FPS) })
        : secs < 90 ? t('dur.secs', { n: secs }) : t('dur.mins', { n: Math.round(secs / 60) }),
    });
  }

  // --- session lifecycle ----------------------------------------------------

  startSession(content) {
    const allowUndo = content.kind === 'practice' || content.kind === 'tutorial';
    this.session = new Session(content, { allowUndo });
    this.progression.sessionsPlayed += 1;
    store.saveProgression(this.progression);

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
    this.ui.announce(t('an.start', { name: contentName(content), goal: content.goal, m: content.missesAllowed }));
    this.hintTicks = null;

    // tutorial steps as banner
    this.tutorialStep = null;
    if (content.kind === 'tutorial') {
      this.tutorialStep = 0;
      this.ui.showTutorialBanner(tutorialStepText(content, 0));
    }

    this.phase = 'countdown';
    this.runCountdown();
  }

  railActions(content) {
    const acts = [];
    if (content.kind === 'practice' || content.kind === 'tutorial') {
      acts.push({ label: t('rail.undo'), action: 'undo' }, { label: t('rail.hint'), action: 'hint' });
    }
    if (content.kind === 'practice') acts.push({ label: t('rail.restart'), action: 'restart' });
    acts.push({ label: t('rail.pause'), action: 'pause' });
    return acts;
  }

  hudFlags() {
    const kind = this.session?.content.kind;
    return { canUndo: kind === 'practice' || kind === 'tutorial', canHint: kind === 'practice' || kind === 'tutorial' };
  }

  runCountdown() {
    const steps = ['3', '2', '1', 'GO'];
    let i = 0;
    // The wheel keeps turning through "3 · 2 · 1 · GO", but the simulation clock
    // only starts at GO: the countdown must not eat a stage's time limit or its
    // par-time bonus. Pre-roll ticks are negative and reach 0 exactly at GO.
    const stepMs = this.settings.reducedMotion ? 500 : 700;
    this.countdownTick = -(steps.length * stepMs) / TICK_MS;
    const step = () => {
      if (this.phase !== 'countdown') return;
      if (i < steps.length) {
        this.ui.showCountdown(steps[i] === 'GO' ? t('count.go') : steps[i]);
        this.audio.event(i === steps.length - 1 ? 'go' : 'tick');
        i++;
        setTimeout(step, stepMs);
      } else {
        this.ui.showCountdown(null);
        if (this.session?.content.kind === 'tutorial') {
          this.tutorialStep = 1;
          this.ui.showTutorialBanner(tutorialStepText(this.session.content, 1) || null);
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
      if (error !== 'duplicate-command') this.ui.announceAlert(t('an.notAllowed'));
      return;
    }
    this.audio.event('throw');
    if (this.settings.haptics && navigator.vibrate) navigator.vibrate(12);

    for (const ev of events) {
      if (ev.type === 'embed') {
        this.audio.event('embed', { combo: ev.combo });
        if (ev.combo >= 3) this.audio.event('combo', { combo: ev.combo });
        this.ui.announce(ev.combo > 1 ? t('an.embeddedCombo', { p: ev.precision, c: ev.combo }) : t('an.embedded', { p: ev.precision }));
      } else if (ev.type === 'miss') {
        this.audio.event(ev.blockedBy === 'hit-marker' ? 'miss-marker' : 'miss-blade');
        if (this.settings.haptics && navigator.vibrate) navigator.vibrate([40, 30, 40]);
        this.ui.announceAlert(ev.blockedBy === 'hit-marker'
          ? t('an.missMarker')
          : t('an.missBlade'));
        this.hintTicks = null;
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

    this.audio.stopMusic();

    if (achievements.length) this.audio.event('achievement');
    this.ui.showResults(report, { achievements, isBest, nextStage, best });
    this.postToLeaderboard(content.kind, report.total);
    this.ui.updateTitle(this.progression, false);
  }

  /** Signed in only: post a ranked run (not practice or lessons) and show the board rank. */
  postToLeaderboard(kind, total) {
    const line = document.getElementById('results-lb');
    if (!line) return;
    const seq = (this.lbSeq = (this.lbSeq || 0) + 1);
    this.lbResult = null;
    if (!this.platform.tokenHosted || kind === 'practice' || kind === 'tutorial') { line.hidden = true; return; }
    line.hidden = false;
    this.lbResult = { pending: true };
    this.renderLbLine();
    this.platform.submitScore(total).then((r) => {
      if (seq !== this.lbSeq) return;
      this.lbResult = r;
      this.renderLbLine();
    });
  }

  /** Results-screen leaderboard line from the stored outcome (re-rendered on a language change, never reposted). */
  renderLbLine() {
    const line = document.getElementById('results-lb');
    const r = this.lbResult;
    if (!line || !r) return;
    const A = acct();
    line.textContent = r.pending ? A.lbPosting : !r.posted ? A.lbNotPosted
      : r.rank ? A.lbRank.replace('{rank}', r.rank) : A.lbPosted;
  }

  pause(reason = 'user') {
    if (this.phase !== 'active' && this.phase !== 'countdown') return;
    this.pausedFrom = this.phase;
    this.phase = 'paused';
    if (this.session) store.saveSnapshot(this.session.content.id, this.session.snapshotJson());
    this.audio.event('pause');
    this.audio.suspend();
    // 'overlay' keeps Help/Settings on screen; every other reason (including a
    // hidden tab) must surface the pause panel so the frozen round is explained.
    if (reason !== 'overlay') this.ui.showScreen('pause');
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.overlayPaused = false;
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
    this.tutorialStep = null;
    this.hintTicks = null;
    this.audio.stopMusic();
    this.audio.stopAmbience();
    this.ui.showTutorialBanner(null);
    this.ui.refreshGraphics();
    this.buildMenus();
    this.ui.showScreen('title');
    this.ui.updateTitle(this.progression, this.hasResumableSnapshot());
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
      const act = this.actionFor(e.code);
      if (act === 'throw' && !inControl && this.phase === 'active') {
        e.preventDefault();
        this.doThrow();
      } else if (act === 'pause') {
        this.phase === 'paused' ? this.resume() : this.pause();
      } else if (act === 'back') {
        if (this.phase === 'paused') this.resume();
        else if (this.phase === 'active') this.pause();
        else if (this.ui.currentScreen && this.ui.currentScreen !== 'title') this.ui.showScreen('title');
      } else if (act === 'undo' && this.phase === 'active') this.onAction('undo');
      else if (act === 'hint' && this.phase === 'active') this.onAction('hint');
      else if (act === 'restart' && this.phase === 'active' && this.session?.content.kind === 'practice') this.onAction('restart');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause('hidden');
    });
    window.addEventListener('resize', () => this.renderer?.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer?.resize(), 60));
    // react to any layout change (rails, drawers, safe areas, zoom) without losing input
    new ResizeObserver(() => this.renderer?.resize()).observe(document.getElementById('playfield-wrap'));
    // HUD bands appear/disappear without a resize; re-fit the wheel when they do.
    const hudObserver = new MutationObserver(() => this.renderer?.resize());
    for (const id of ['hud', 'hud-actions', 'tutorial-banner', 'btn-hint', 'btn-undo']) {
      const el = document.getElementById(id);
      if (el) hudObserver.observe(el, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    }
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
      case 'leaderboard': {
        this.ui.showScreen('leaderboard');
        this.lbView = { entries: null, note: 'lb.loading' };
        this.ui.renderLeaderboard(null, t('lb.loading'));
        this.platform.fetchLeaderboard().then((res) => {
          this.lbView = res.ok ? { entries: res.entries, note: '' }
            : { entries: [], note: this.platform.tokenHosted ? 'lb.notYet' : 'lb.notHosted' };
          this.ui.renderLeaderboard(this.lbView.entries, this.lbView.note ? t(this.lbView.note) : '');
        });
        break;
      }
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
          this.ui.announce(t('an.undone'));
        } else this.ui.announce(t('an.nothingUndo'));
        break;
      }
      case 'hint': {
        if (!this.session) break;
        const h = this.session.hint();
        if (!h) break;
        this.audio.event('hint');
        this.hintTicks = h.ticksAway;
        const text = this.hintText();
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
        this.ui.announce(t('an.erased'));
        break;
      case 'overlay-open':
        if (this.phase === 'active' || this.phase === 'countdown') {
          this.overlayPaused = true;
          this.pause('overlay');
        }
        break;
      case 'overlay-close':
        if (this.overlayPaused) { this.overlayPaused = false; this.resume(); }
        break;
      case 'settings-closed': break;
      case 'title-shown': break;
      default: break;
    }
  }

  hintText() {
    const n = this.hintTicks;
    if (n == null) return '';
    return n <= 1 ? t('hint.now') : t('hint.wait', { s: (n / SIM_FPS).toFixed(1) });
  }

  /**
   * Settings → Language (or the platform's preferred language) changed: re-render every
   * visible string in place — menus, briefing, HUD, rails, results, help, account
   * buttons — without restarting the round, moving focus or reposting a score.
   */
  onLanguageChange() {
    if (this.phase === 'boot') return;
    const screen = this.ui.currentScreen;
    this.ui.buildHelp(this.keyLabels());
    this.ui.relabelGraphics();
    this.refreshAccountButtons();
    this.ui.setProfileChip(this.profileName || t('guest'));
    const list = this.modeList;
    this.buildMenus();
    if (list === 'practice') this.showPracticeSetup(true);
    else if (list === 'challenge') this.showChallengePick(true);
    else if (list === 'tutorial') this.showTutorialPick(true);
    this.ui.updateTitle(this.progression, this.hasResumableSnapshot());
    if (screen === 'setup' && this.pendingContent) this.prepareContent(this.pendingContent, { ranked: this.pendingRanked, rerender: true });
    if (this.ui.lastResults && this.phase === 'results') {
      this.ui.showResults(this.ui.lastResults[0], { ...this.ui.lastResults[1], rerender: true });
      this.renderLbLine();
    }
    if (this.lbView) this.ui.renderLeaderboard(this.lbView.entries, this.lbView.note ? t(this.lbView.note) : '');
    if (this.session && this.phase !== 'results') {
      const c = this.session.content;
      this.ui.buildRailActions(this.railActions(c));
      this.ui.updateHud(this.session.state, c, this.hudFlags());
      this.ui.updateBoardMirror(this.session.state);
      if (this.tutorialStep != null && c.kind === 'tutorial') this.ui.showTutorialBanner(tutorialStepText(c, this.tutorialStep) || null);
      this.ui.setHintLine(this.hintText());
    }
  }

  /** A snapshot is only offered when its stage can still be reconstructed. */
  hasResumableSnapshot() {
    const snap = store.loadSnapshot();
    return !!(snap && this.findContentById(snap.contentId));
  }

  resumeSnapshot() {
    const snap = store.loadSnapshot();
    const content = snap ? this.findContentById(snap.contentId) : null;
    const session = content ? Session.restore(content, snap.json) : null;
    if (!session) {
      // Never leave the player pressing a button that silently does nothing.
      store.clearSnapshot();
      this.ui.updateTitle(this.progression, false);
      this.ui.announceAlert(t('an.cantRestore'));
      return;
    }
    this.session = session;
    this.pendingContent = content;
    if (this.renderer) {
      this.renderer.loadContent(content, content.theme);
      this.renderer.setReducedMotion(this.settings.reducedMotion);
      this.renderer.syncState(session.state);
    }
    this.audio.startAmbience(themeById(content.theme).ambience);
    this.audio.startMusic(content.tier ? Math.min(1, content.tier / 6) : 0.2);
    this.ui.setPlayingChrome(true);
    this.ui.showScreen(null);
    this.ui.buildRailActions(this.railActions(content));
    this.tutorialStep = null;
    this.hintTicks = null;
    this.ui.updateHud(session.state, content, this.hudFlags());
    this.ui.updateBoardMirror(session.state);
    this.phase = 'active';
    this.ui.announce(t('an.resumed'));
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
    if (key === 'quality') {
      // Choosing a preset clears per-category overrides (render scale and toggles stay).
      const g = { ...(this.settings.graphics || {}) };
      for (const cat of Object.keys(CATEGORIES)) delete g[cat];
      this.settings.graphics = g;
      store.saveSettings(this.settings);
    }
    if (key === 'quality' || key === 'graphics') {
      this.applyQuality();
      this.ui.refreshGraphics();
    }
    if (key === 'reducedMotion') this.renderer?.setReducedMotion(!!value);
  }

  applyQuality() {
    if (!this.renderer) return;
    this.renderer.setGraphics({ ...this.settings.graphics, preset: normalizePreset(this.settings.quality) });
  }

  onFps() {
    // Frame-rate adaptation lives in the renderer (adaptive resolution); nothing to do here.
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

    if (this.phase === 'countdown' && this.session) {
      // Cosmetic pre-roll: the wheel spins toward tick 0 without advancing the sim.
      this.countdownTick = Math.min(0, (this.countdownTick || 0) + dtMs / TICK_MS);
      this.renderer?.update(dtMs, { ...this.session.state, tick: this.countdownTick }, 0);
      return;
    }

    const simRunning = this.phase === 'active';
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
onLanguage(() => game.onLanguageChange());
game.boot().catch((err) => {
  console.error('Boot failed:', err);
  const fb = document.getElementById('canvas-fallback');
  fb.hidden = false;
  fb.querySelector('p').textContent = t('boot.failed', { m: err.message });
});

export { game };
