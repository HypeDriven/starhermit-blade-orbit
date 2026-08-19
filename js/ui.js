/**
 * Blade Orbit — ui module.
 * Semantic DOM shell: screens, HUD, settings, help, announcements,
 * accessibility mirrors, focus management. UI state is fully separate
 * from simulation state.
 */

import { THEMES } from './content.js';
import { ACHIEVEMENTS } from './session.js';
import { SIM_FPS } from './rules.js';

const $ = (id) => document.getElementById(id);

const SCREENS = ['title', 'modes', 'journey', 'setup', 'results', 'pause', 'help', 'settings'];

export function createUI(handlers) {
  return new UI(handlers);
}

class UI {
  constructor(handlers) {
    this.h = handlers;
    this.currentScreen = null;
    this.screenBeforeOverlay = 'title';
    this.lastFocus = null;
    this.captionTimer = null;
    this.wireStatic();
  }

  // --- static wiring --------------------------------------------------------

  wireStatic() {
    const on = (id, fn) => $(id).addEventListener('click', () => { this.h.sound('click'); fn(); });
    on('btn-play', () => this.h.action('play'));
    on('btn-resume', () => this.h.action('resume-snapshot'));
    on('btn-daily', () => this.h.action('daily'));
    on('btn-journey', () => this.showScreen('journey'));
    on('btn-tutorial', () => this.h.action('tutorial'));
    on('btn-modes-back', () => this.showScreen('title'));
    on('btn-journey-back', () => this.showScreen('title'));
    on('btn-setup-back', () => this.h.action('setup-back'));
    on('btn-setup-start', () => this.h.action('setup-start'));
    on('btn-results-menu', () => this.h.action('results-menu'));
    on('btn-results-retry', () => this.h.action('retry'));
    on('btn-results-next', () => this.h.action('next-stage'));
    on('btn-pause', () => this.h.action('pause'));
    on('btn-resume-play', () => this.h.action('resume'));
    on('btn-pause-settings', () => this.showOverlay('settings'));
    on('btn-pause-help', () => this.showOverlay('help'));
    on('btn-pause-restart', () => this.h.action('restart'));
    on('btn-leave', () => this.h.action('leave'));
    on('btn-help-top', () => this.showOverlay('help'));
    on('btn-settings-top', () => this.showOverlay('settings'));
    on('btn-help-back', () => this.closeOverlay());
    on('btn-settings-back', () => { this.h.action('settings-closed'); this.closeOverlay(); });
    on('btn-throw', () => this.h.action('throw'));
    on('btn-undo', () => this.h.action('undo'));
    on('btn-hint', () => this.h.action('hint'));
    on('btn-replay-tutorials', () => this.h.action('replay-tutorials'));
    on('btn-reset-progress', () => {
      if (confirm('Erase all journey progress, scores, and achievements on this device?')) {
        this.h.action('reset-progress');
      }
    });
    this.bindSettings();
  }

  bindSettings() {
    const s = this.h.getSettings();
    const bindRange = (id, key) => {
      const el = $(id);
      el.value = s[key];
      el.addEventListener('input', () => this.h.settingChanged(key, parseFloat(el.value)));
    };
    const bindCheck = (id, key) => {
      const el = $(id);
      el.checked = !!s[key];
      el.addEventListener('change', () => this.h.settingChanged(key, el.checked));
    };
    const bindSelect = (id, key) => {
      const el = $(id);
      el.value = String(s[key]);
      el.addEventListener('change', () => this.h.settingChanged(key, el.value));
    };
    bindRange('set-music', 'music');
    bindRange('set-effects', 'effects');
    bindRange('set-ambience', 'ambience');
    bindRange('set-voice', 'voice');
    bindCheck('set-captions', 'captions');
    bindSelect('set-quality', 'quality');
    bindCheck('set-reduced-motion', 'reducedMotion');
    bindCheck('set-high-contrast', 'highContrast');
    bindSelect('set-palette', 'palette');
    bindSelect('set-text-scale', 'textScale');
    bindCheck('set-left-handed', 'leftHanded');
    bindCheck('set-hold-aim', 'holdToAim');
    bindCheck('set-timing-assist', 'timingAssist');
    bindCheck('set-haptics', 'haptics');
  }

  applySettingsToDom(s) {
    document.body.dataset.palette = s.palette;
    document.body.dataset.contrast = s.highContrast ? 'high' : 'normal';
    document.body.dataset.motion = s.reducedMotion ? 'reduced' : 'full';
    document.body.dataset.leftHanded = String(!!s.leftHanded);
    document.documentElement.style.setProperty('--text-scale', s.textScale);
  }

  // --- screens --------------------------------------------------------------

  showScreen(name) {
    this.currentScreen = name;
    for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
    $('hud').hidden = name !== null;
    const playing = name === null;
    $('rail-left').hidden = !playing;
    $('rail-right').hidden = !playing;
    this.focusFirst(name ? `screen-${name}` : 'btn-throw');
    if (name === 'title') this.h.action('title-shown');
  }

  showOverlay(name) {
    this.screenBeforeOverlay = this.currentScreen;
    this.showScreen(name);
  }

  closeOverlay() {
    this.showScreen(this.screenBeforeOverlay);
  }

  focusFirst(containerId) {
    const c = $(containerId);
    if (!c) return;
    const target = c.querySelector('button:not([disabled]):not([hidden])') || c;
    requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }

  setPlayingChrome(playing) {
    $('hud').hidden = !playing;
    $('rail-left').hidden = !playing;
    $('rail-right').hidden = !playing;
  }

  // --- title / modes / journey ----------------------------------------------

  updateTitle(progression, hasSnapshot) {
    $('btn-resume').hidden = !hasSnapshot;
    const done = Object.keys(progression.journeyStars).length;
    $('title-progress').textContent =
      `Journey ${done}/40 cleared · Mastery ${progression.masteryXp} XP · ${progression.sessionsPlayed} sessions`;
  }

  buildModeList(modes) {
    const host = $('mode-list');
    host.replaceChildren();
    for (const m of modes) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.innerHTML = `<h3></h3><p></p><p class="card-meta"></p>`;
      card.querySelector('h3').textContent = m.name;
      card.querySelector('p').textContent = m.description;
      card.querySelector('.card-meta').textContent = m.meta;
      card.addEventListener('click', () => { this.h.sound('click'); this.h.action('mode-picked', m.id); });
      host.appendChild(card);
    }
  }

  buildJourneyGrid(stages, progression) {
    const host = $('journey-grid');
    host.replaceChildren();
    stages.forEach((stage, i) => {
      const n = i + 1;
      const unlocked = n <= progression.journeyUnlocked;
      const stars = progression.journeyStars[stage.id] || 0;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'journey-cell' + (stage.mastery ? ' mastery' : '') + (unlocked ? '' : ' locked');
      cell.disabled = !unlocked;
      cell.setAttribute('aria-label',
        unlocked
          ? `Stage ${n}: ${stage.name}${stars ? `, ${stars} stars` : ''}`
          : `Stage ${n} locked`);
      const num = document.createElement('span');
      num.textContent = n;
      const starSpan = document.createElement('span');
      starSpan.className = 'stars';
      starSpan.textContent = stars ? '★'.repeat(stars) : stage.mastery ? '◆' : '';
      cell.append(num, starSpan);
      if (unlocked) {
        cell.addEventListener('click', () => { this.h.sound('click'); this.h.action('journey-picked', stage.id); });
      }
      host.appendChild(cell);
    });
  }

  showSetup(content, { ranked, duration, extra }) {
    const host = $('setup-details');
    const missText = content.missesAllowed === 0 ? 'none — one slip ends it' : `${content.missesAllowed}`;
    host.innerHTML = `
      <h3></h3>
      <p class="panel-sub"></p>
      <dl>
        <dt>Goal</dt><dd data-f="goal"></dd>
        <dt>Misses allowed</dt><dd data-f="misses"></dd>
        <dt>Hazards</dt><dd data-f="hazards"></dd>
        <dt>Par</dt><dd data-f="par"></dd>
        <dt>Expected duration</dt><dd data-f="duration"></dd>
        <dt>Players</dt><dd>1 (asynchronous score comparison)</dd>
        <dt>Result</dt><dd><span class="ranked-flag ${ranked ? 'ranked' : 'casual'}">${ranked ? 'Ranked (daily board)' : 'Casual / unrated'}</span></dd>
        ${extra || ''}
      </dl>`;
    host.querySelector('h3').textContent = content.name;
    host.querySelector('.panel-sub').textContent = describeMechanics(content);
    host.querySelector('[data-f="goal"]').textContent = `Embed ${content.goal} blades`;
    host.querySelector('[data-f="misses"]').textContent = missText;
    const blades = (content.preplaced || []).filter((p) => p.type === 'blade').length;
    const markers = (content.preplaced || []).filter((p) => p.type === 'marker').length;
    host.querySelector('[data-f="hazards"]').textContent =
      [blades && `${blades} embedded blade${blades > 1 ? 's' : ''}`,
       markers && `${markers} warded sigil${markers > 1 ? 's' : ''}`].filter(Boolean).join(', ') || 'None';
    host.querySelector('[data-f="par"]').textContent = `${content.par.score} pts`;
    host.querySelector('[data-f="duration"]').textContent = duration;
    this.showScreen('setup');
  }

  // --- HUD ------------------------------------------------------------------

  updateHud(state, content, { canUndo, canHint }) {
    $('hud-goal').textContent = `${state.embedded} / ${state.goal}`;
    $('hud-score').textContent = String(totalOf(state));
    $('hud-combo').textContent = state.comboStreak > 1 ? `x${state.comboStreak}` : '—';
    $('hud-misses').textContent = `${state.misses} / ${state.missesAllowed}`;
    if (state.timeLimitTicks) {
      $('hud-timer-block').hidden = false;
      const left = Math.max(0, state.timeLimitTicks - state.tick);
      $('hud-timer').textContent = `${Math.floor(left / SIM_FPS)}s`;
    } else {
      $('hud-timer-block').hidden = true;
    }
    $('btn-undo').hidden = !canUndo;
    $('btn-hint').hidden = !canHint;
    $('btn-throw').disabled = state.status !== 'active';
    // rails
    $('rail-objective').textContent = `Embed ${state.goal} blades — ${state.embedded} placed, ${state.goal - state.embedded} to go.`;
    $('rail-stage').textContent = content.name;
    $('rail-status').textContent =
      `Score ${totalOf(state)} · misses ${state.misses}/${state.missesAllowed}` +
      (state.comboStreak > 1 ? ` · combo x${state.comboStreak}` : '');
  }

  buildRailActions(actions) {
    const host = $('rail-actions');
    host.replaceChildren();
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-small';
      b.textContent = a.label;
      b.addEventListener('click', () => this.h.action(a.action));
      host.appendChild(b);
    }
  }

  setHintLine(text) { $('hint-line').textContent = text || ''; }

  showCountdown(text) {
    const el = $('countdown');
    if (text === null) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
  }

  showTutorialBanner(text) {
    const el = $('tutorial-banner');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
  }

  caption(text) {
    const el = $('captions');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  // --- results --------------------------------------------------------------

  showResults(report, { achievements, isBest, nextStage, best }) {
    const won = report.won;
    const headline = $('results-headline');
    headline.textContent = won ? 'Wheel Cleared!' : headlineForReason(report.reason);
    headline.className = `results-headline ${won ? 'won' : 'lost'}`;

    const tbody = $('results-table').querySelector('tbody');
    tbody.replaceChildren();
    const rows = [
      ['Blades embedded', `${report.embedded} × 100`, report.components.hits],
      ['Spacing precision', '', report.components.precision],
      ['Combo bonuses', `best x${report.bestCombo}`, report.components.combo],
      ['Time bonus', report.par.ticks ? `par ${Math.round(report.par.ticks / SIM_FPS)}s` : '', report.components.timeBonus],
      ['Miss penalties', `${report.misses} miss${report.misses === 1 ? '' : 'es'}`, report.components.missPenalty],
    ];
    for (const [label, note, value] of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td></td>`;
      tr.children[0].textContent = note ? `${label} (${note})` : label;
      tr.children[1].textContent = value > 0 ? `+${value}` : String(value);
      tbody.appendChild(tr);
    }
    const tr = document.createElement('tr');
    tr.className = 'total';
    tr.innerHTML = '<td>Total</td><td></td>';
    tr.children[1].textContent = String(report.total);
    tbody.appendChild(tr);

    $('results-stats').textContent =
      `Time ${(report.ticks / SIM_FPS).toFixed(1)}s · throws ${report.embedded + report.misses}` +
      (report.invalid ? ` · invalid ${report.invalid}` : '');
    $('results-best').textContent = isBest
      ? 'New personal best for this stage!'
      : best ? `Personal best: ${best.total}` : '';

    const achHost = $('results-achievements');
    achHost.replaceChildren();
    for (const key of achievements || []) {
      const def = ACHIEVEMENTS.find((a) => a.key === key);
      const chip = document.createElement('span');
      chip.className = 'achievement-chip';
      chip.textContent = `🏅 ${def ? def.name : key}`;
      achHost.appendChild(chip);
    }

    $('btn-results-next').hidden = !(won && nextStage);
    this.showScreen('results');
    this.announce(headline.textContent + `. Total score ${report.total}.`);
  }

  // --- help -----------------------------------------------------------------

  buildHelp() {
    const cards = [
      { title: 'The wheel turns', body: 'The timber target spins and surges. The marked notch at six o\'clock is where your blade lands.' },
      { title: 'Throw into gaps', body: 'Tap, click, or press SPACE to throw. The blade sticks where the wheel is at that instant.' },
      { title: 'Steel is a hazard', body: 'Hitting a blade already in the wood — yours or one placed before — counts as a miss.' },
      { title: 'Sigils are warded', body: 'Hexagonal glowing sigils are protected. Striking one costs double and ends flawless runs.' },
      { title: 'Precision pays', body: 'Wide, centered gaps earn up to +100 precision points per blade. Consecutive hits build combo bonuses.' },
      { title: 'Clear the count', body: 'Embed every required blade before your misses run out. Beat par score for three stars.' },
    ];
    const host = $('help-cards');
    host.replaceChildren();
    for (const c of cards) {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = '<h3></h3><p></p>';
      el.querySelector('h3').textContent = c.title;
      el.querySelector('p').textContent = c.body;
      host.appendChild(el);
    }
    const controls = [
      ['SPACE / ENTER / tap', 'Throw blade'],
      ['P or ESC', 'Pause / resume'],
      ['U', 'Undo (practice & tutorials)'],
      ['H', 'Hint (practice & tutorials)'],
      ['R', 'Restart stage (practice)'],
      ['TAB / SHIFT+TAB', 'Navigate controls'],
      ['Gamepad: A throw · Start pause · B back', ''],
    ];
    const list = $('help-controls');
    list.replaceChildren();
    for (const [key, desc] of controls) {
      const li = document.createElement('li');
      li.innerHTML = '<kbd></kbd> ';
      li.querySelector('kbd').textContent = key;
      li.append(desc);
      list.appendChild(li);
    }
  }

  // --- accessibility mirrors --------------------------------------------------

  announce(text) { $('live-region').textContent = text; }
  announceAlert(text) { $('alert-region').textContent = text; }

  /** Concise navigable model of the board — not every decorative object. */
  updateBoardMirror(state) {
    const blades = state.slots.filter((s) => s.type === 'blade').length;
    const markers = state.slots.filter((s) => s.type === 'marker').length;
    $('board-mirror').textContent =
      `Wheel rotating. ${blades} blade${blades === 1 ? '' : 's'} in the wood, ${markers} warded sigil${markers === 1 ? '' : 's'}. ` +
      `${state.embedded} of ${state.goal} goal blades embedded. ${state.misses} of ${state.missesAllowed} misses used.`;
  }

  setServerClock(text) { $('server-clock').textContent = text; }
  setProfileChip(name) { $('profile-chip').textContent = name; }
}

function totalOf(state) {
  const s = state.score;
  return s.hits + s.precision + s.combo + s.timeBonus + s.missPenalty;
}

function headlineForReason(reason) {
  switch (reason) {
    case 'marker-struck': return 'Sigil Struck — Run Ended';
    case 'too-many-misses': return 'Out of Misses';
    case 'time-expired': return 'Time Expired';
    default: return 'Round Over';
  }
}

function describeMechanics(content) {
  const parts = [];
  if ((content.preplaced || []).some((p) => p.type === 'blade')) parts.push('hazard blades crowd the ring');
  if ((content.preplaced || []).some((p) => p.type === 'marker')) parts.push('warded sigils protect arcs');
  if (content.rotation.oscAmp) parts.push('the wheel surges and lulls');
  if (content.rotation.triAmp) parts.push('a pulse drives the spin');
  if (content.timeLimitTicks) parts.push(`a ${Math.round(content.timeLimitTicks / SIM_FPS)}s time limit presses you`);
  return parts.length ? `Watch out: ${parts.join('; ')}.` : 'A clean wheel — learn the timing.';
}

export { THEMES };
