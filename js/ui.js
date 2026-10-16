/**
 * Blade Orbit — ui module.
 * Semantic DOM shell: screens, HUD, settings, help, announcements,
 * accessibility mirrors, focus management. UI state is fully separate
 * from simulation state.
 */

import { THEMES } from './content.js';
import { ACHIEVEMENTS } from './session.js';
import { SIM_FPS } from './rules.js';
import { CATEGORIES, PRESETS, presetTier, normalizePreset } from './gfx.js';
import { gfxText } from './gfx-i18n.js';
import { t, getLang } from './i18n.js';

const $ = (id) => document.getElementById(id);

const SCREENS = ['title', 'modes', 'journey', 'setup', 'results', 'pause', 'help', 'settings', 'leaderboard'];

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
    // Screens sit under the (clickable) top bar: pad them by its real height, which doubles when it
    // wraps on phones. Layout px — the top bar and the screen layer share the same zoom.
    const bar = $('topbar');
    if (bar && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', bar.offsetHeight + 'px')).observe(bar);
    }
  }

  // --- static wiring --------------------------------------------------------

  wireStatic() {
    const on = (id, fn) => $(id).addEventListener('click', () => { this.h.sound('click'); fn(); });
    on('btn-play', () => this.h.action('play'));
    on('btn-resume', () => this.h.action('resume-snapshot'));
    on('btn-daily', () => this.h.action('daily'));
    on('btn-leaderboard', () => this.h.action('leaderboard'));
    on('btn-leaderboard-back', () => this.showScreen('title'));
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
    on('btn-title-settings', () => this.showOverlay('settings'));
    on('btn-help-back', () => this.closeOverlay());
    on('btn-settings-back', () => { this.h.action('settings-closed'); this.closeOverlay(); });
    on('btn-throw', () => this.h.action('throw'));
    on('btn-undo', () => this.h.action('undo'));
    on('btn-hint', () => this.h.action('hint'));
    on('btn-replay-tutorials', () => this.h.action('replay-tutorials'));
    on('btn-reset-progress', () => {
      if (confirm(t('confirm.reset'))) {
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
    this.bindGraphics();
    bindCheck('set-reduced-motion', 'reducedMotion');
    bindCheck('set-high-contrast', 'highContrast');
    bindSelect('set-palette', 'palette');
    bindSelect('set-text-scale', 'textScale');
    bindCheck('set-left-handed', 'leftHanded');
    bindCheck('set-hold-aim', 'holdToAim');
    bindCheck('set-timing-assist', 'timingAssist');
    bindCheck('set-haptics', 'haptics');
  }

  // --- graphics settings ----------------------------------------------------

  /** Build and wire the Graphics section (preset, render scale, per-category overrides, toggles). */
  bindGraphics() {
    this.relabelGraphics(false);
    const t = this.gfxT;
    const host = $('gfx-categories');
    host.textContent = '';
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      const label = document.createElement('label');
      const name = document.createElement('span');
      name.dataset.gfxCatName = cat;
      name.textContent = t(cat);
      const sel = document.createElement('select');
      sel.id = `gfx-${cat}`;
      sel.dataset.gfxCat = cat;
      for (const v of ['preset', ...tiers]) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v === 'preset' ? t('fromPreset', { tier: '' }) : t(v);
        o.dataset.gfxTier = v;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        const g = { ...(this.h.getSettings().graphics || {}) };
        if (sel.value === 'preset') delete g[cat];
        else g[cat] = sel.value;
        this.h.settingChanged('graphics', g);
      });
      label.append(name, sel);
      host.append(label);
    }

    $('set-quality').addEventListener('change', (e) => this.h.settingChanged('quality', e.target.value));
    const scale = $('gfx-render-scale');
    scale.addEventListener('input', () => {
      $('gfx-render-scale-value').textContent = `${scale.value}%`;
      this.h.settingChanged('graphics', { ...(this.h.getSettings().graphics || {}), render_scale: Number(scale.value) / 100 });
    });
    for (const [id, key] of [['gfx-adaptive', 'adaptive'], ['gfx-show-fps', 'show_fps']]) {
      $(id).addEventListener('change', (e) => {
        this.h.settingChanged('graphics', { ...(this.h.getSettings().graphics || {}), [key]: e.target.checked });
      });
    }
    this.refreshGraphics();
  }

  /** Re-label the Graphics section in the current game language (live language switching). */
  relabelGraphics(refresh = true) {
    const gt = (this.gfxT = gfxText(getLang()));
    $('gfx-section').lang = gt.locale;
    for (const el of document.querySelectorAll('#gfx-section [data-gfx-text]')) el.textContent = gt(el.dataset.gfxText);
    for (const el of document.querySelectorAll('#gfx-section [data-gfx-cat-name]')) el.textContent = gt(el.dataset.gfxCatName);
    for (const o of document.querySelectorAll('#gfx-section option[data-gfx-tier]')) {
      if (o.dataset.gfxTier !== 'preset') o.textContent = gt(o.dataset.gfxTier);
    }
    if (refresh) this.refreshGraphics();
  }

  /** Reflect saved graphics settings and the renderer's live info into the controls. */
  refreshGraphics() {
    const t = this.gfxT;
    if (!t) return;
    const s = this.h.getSettings();
    const g = s.graphics || {};
    const info = this.h.graphicsInfo?.(t.words) || null;
    const detected = info?.detected || 'balanced';
    const preset = normalizePreset(s.quality);
    const active = PRESETS.includes(preset) ? preset : detected;
    const q = $('set-quality');
    q.value = preset;
    for (const o of q.options) o.textContent = o.value === 'auto' ? t('auto', { tier: t(detected) }) : t(o.value);
    for (const cat of Object.keys(CATEGORIES)) {
      const sel = $(`gfx-${cat}`);
      sel.value = CATEGORIES[cat].includes(g[cat]) ? g[cat] : 'preset';
      sel.options[0].textContent = t('fromPreset', { tier: t(presetTier(active, cat)) });
    }
    const pct = Math.round(Math.min(2, Math.max(0.5, Number(g.render_scale) || 1)) * 100);
    $('gfx-render-scale').value = String(pct);
    $('gfx-render-scale-value').textContent = `${pct}%`;
    $('gfx-adaptive').checked = g.adaptive !== false;
    $('gfx-show-fps').checked = !!g.show_fps;
    $('gfx-summary').textContent = info ? `${info.gpu || t('unknownGpu')} · ${info.summary}` : '';
    $('gfx-post-note').hidden = !info?.postFailed;
    $('gfx-post-note').textContent = t('postFailed');
    document.body.dataset.gfxPreset = info?.resolved?.preset || active;
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
    if (name === 'settings') this.refreshGraphics();
    if (name === 'title') this.h.action('title-shown');
  }

  showOverlay(name) {
    // The top bar stays clickable over every screen: re-opening the open overlay is a no-op and
    // switching Help <-> Settings keeps the screen the first overlay was opened from.
    if (this.currentScreen === name) return;
    if (this.currentScreen !== 'help' && this.currentScreen !== 'settings') this.screenBeforeOverlay = this.currentScreen;
    // Help/Settings can be opened from the top bar mid-round: the sim must not
    // keep running (and burning a time limit) behind the overlay.
    this.h.action('overlay-open');
    this.showScreen(name);
  }

  closeOverlay() {
    this.showScreen(this.screenBeforeOverlay);
    this.h.action('overlay-close');
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
      t('title.progress', { done, xp: progression.masteryXp, n: progression.sessionsPlayed });
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
          ? t('jcell.aria', { n, name: stage.name }) + (stars ? t('jcell.stars', { s: stars }) : '')
          : t('jcell.locked', { n }));
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

  showSetup(content, { ranked, duration, extra, rerender }) {
    const host = $('setup-details');
    const missText = content.missesAllowed === 0 ? t('setup.noMisses') : `${content.missesAllowed}`;
    host.innerHTML = `
      <h3></h3>
      <p class="panel-sub"></p>
      <dl>
        <dt>${t('setup.goal')}</dt><dd data-f="goal"></dd>
        <dt>${t('setup.misses')}</dt><dd data-f="misses"></dd>
        <dt>${t('setup.hazards')}</dt><dd data-f="hazards"></dd>
        <dt>${t('setup.par')}</dt><dd data-f="par"></dd>
        <dt>${t('setup.duration')}</dt><dd data-f="duration"></dd>
        <dt>${t('setup.players')}</dt><dd>${t('setup.playersV')}</dd>
        <dt>${t('setup.result')}</dt><dd><span class="ranked-flag ${ranked ? 'ranked' : 'casual'}">${ranked ? t('setup.ranked') : t('setup.casual')}</span></dd>
        ${extra || ''}
      </dl>`;
    host.querySelector('h3').textContent = contentName(content);
    host.querySelector('.panel-sub').textContent = describeMechanics(content);
    host.querySelector('[data-f="goal"]').textContent = t('setup.goalV', { n: content.goal });
    host.querySelector('[data-f="misses"]').textContent = missText;
    const blades = (content.preplaced || []).filter((p) => p.type === 'blade').length;
    const markers = (content.preplaced || []).filter((p) => p.type === 'marker').length;
    host.querySelector('[data-f="hazards"]').textContent =
      [blades && t(blades > 1 ? 'setup.bladesN' : 'setup.blades1', { n: blades }),
       markers && t(markers > 1 ? 'setup.sigilsN' : 'setup.sigils1', { n: markers })].filter(Boolean).join(', ') || t('setup.none');
    host.querySelector('[data-f="par"]').textContent = t('setup.parV', { n: content.par.score });
    host.querySelector('[data-f="duration"]').textContent = duration;
    if (!rerender) this.showScreen('setup');
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
      $('hud-timer').textContent = t('hud.timer', { n: Math.floor(left / SIM_FPS) });
    } else {
      $('hud-timer-block').hidden = true;
    }
    $('btn-undo').hidden = !canUndo;
    $('btn-hint').hidden = !canHint;
    $('btn-throw').disabled = state.status !== 'active';
    // rails
    $('rail-objective').textContent = t('rail.objectiveV', { goal: state.goal, done: state.embedded, left: state.goal - state.embedded });
    $('rail-stage').textContent = contentName(content);
    $('rail-status').textContent =
      t('rail.statusV', { score: totalOf(state), m: state.misses, max: state.missesAllowed }) +
      (state.comboStreak > 1 ? t('rail.combo', { n: state.comboStreak }) : '');
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

  /** Short confirmation toast (account actions). */
  toast(text) {
    let el = $('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.hidden = false;
    // screens pad their bottom by the toast so their buttons can always be scrolled clear of it
    const root = document.documentElement.style;
    root.setProperty('--toast-h', (el.offsetHeight + 12) + 'px');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; root.setProperty('--toast-h', '0px'); }, 2600);
  }

  /** Profile chip avatar (object URL) — hidden when null. */
  setProfileAvatar(url) {
    const img = $('profile-avatar');
    if (!img) return;
    if (url) { img.src = url; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
  }

  caption(text) {
    const el = $('captions');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  // --- results --------------------------------------------------------------

  showResults(report, opts) {
    this.lastResults = [report, opts];
    const { achievements, isBest, nextStage, best } = opts;
    const won = report.won;
    const headline = $('results-headline');
    headline.textContent = won ? t('r.won') : headlineForReason(report.reason);
    headline.className = `results-headline ${won ? 'won' : 'lost'}`;

    const tbody = $('results-table').querySelector('tbody');
    tbody.replaceChildren();
    const rows = [
      [t('r.embedded'), `${report.embedded} × 100`, report.components.hits],
      [t('r.precision'), '', report.components.precision],
      [t('r.combo'), t('r.bestCombo', { n: report.bestCombo }), report.components.combo],
      [t('r.timeBonus'), report.par.ticks ? t('r.par', { n: Math.round(report.par.ticks / SIM_FPS) }) : '', report.components.timeBonus],
      [t('r.missPen'), t(report.misses === 1 ? 'r.miss1' : 'r.missN', { n: report.misses }), report.components.missPenalty],
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
    tr.innerHTML = '<td></td><td></td>';
    tr.children[0].textContent = t('r.total');
    tr.children[1].textContent = String(report.total);
    tbody.appendChild(tr);

    $('results-stats').textContent =
      t('r.stats', { t: (report.ticks / SIM_FPS).toFixed(1), n: report.embedded + report.misses }) +
      (report.invalid ? t('r.invalid', { n: report.invalid }) : '');
    $('results-best').textContent = isBest
      ? t('r.newBest')
      : best ? t('r.best', { n: best.total }) : '';

    const achHost = $('results-achievements');
    achHost.replaceChildren();
    for (const key of achievements || []) {
      const def = ACHIEVEMENTS.find((a) => a.key === key);
      const chip = document.createElement('span');
      chip.className = 'achievement-chip';
      chip.textContent = `🏅 ${def ? t('ach.' + key, null, def.name) : key}`;
      achHost.appendChild(chip);
    }

    $('btn-results-next').hidden = !(won && nextStage);
    if (opts.rerender) return;
    this.showScreen('results');
    this.announce(t('r.announce', { h: headline.textContent, n: report.total }));
  }

  // --- help -----------------------------------------------------------------

  buildHelp(keys = null) {
    const cards = [
    ].concat(['wheel', 'gaps', 'steel', 'sigils', 'precision', 'clear'].map((k) => ({ title: t(`h.${k}`), body: t(`h.${k}.b`) })));
    this.helpKeys = keys;
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
    const keyName = (s) => String(s).split(' / ').map((x) => t('key.' + x, null, x)).join(' / ');
    const k = (a, fallback) => keyName((keys && keys[a]) || fallback);
    const controls = [
      [k('throw', 'SPACE / ENTER') + t('ctl.tap'), t('ctl.throw')],
      [k('pause', 'P') + t('ctl.esc'), t('ctl.pause')],
      [k('undo', 'U'), t('ctl.undo')],
      [k('hint', 'H'), t('ctl.hint')],
      [k('restart', 'R'), t('ctl.restart')],
      ['TAB / SHIFT+TAB', t('ctl.nav')],
      [t('ctl.gamepad'), ''],
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
      t('mirror.text', {
        blades: t(blades === 1 ? 'mirror.blade1' : 'mirror.bladeN', { n: blades }),
        sigils: t(markers === 1 ? 'mirror.sigil1' : 'mirror.sigilN', { n: markers }),
        e: state.embedded, g: state.goal, m: state.misses, mx: state.missesAllowed,
      });
  }

  setServerClock(text) { $('server-clock').textContent = text; }
  setProfileChip(name) { $('profile-chip').textContent = name; }

  // Platform leaderboard panel. entries: [{ rank, name, score }] with names
  // already resolved to profile nicknames; `note` covers loading/empty/
  // offline states.
  renderLeaderboard(entries, note) {
    const body = $('leaderboard-body');
    body.innerHTML = '';
    if (note) {
      const p = document.createElement('p');
      p.className = 'panel-sub';
      p.textContent = note;
      body.appendChild(p);
    }
    if (entries && entries.length) {
      const table = document.createElement('table');
      table.className = 'results-table';
      const tbody = document.createElement('tbody');
      entries.forEach((e) => {
        const tr = document.createElement('tr');
        const rank = document.createElement('td');
        rank.textContent = e.rank != null ? '#' + e.rank : '—';
        const name = document.createElement('td');
        name.textContent = e.name;
        const score = document.createElement('td');
        score.textContent = String(e.score);
        tr.appendChild(rank); tr.appendChild(name); tr.appendChild(score);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);
    }
  }
}

const CHALLENGE_KEYS = { 'Flawless Edge': 'ch-perfect', 'Ember Sprint': 'ch-speed', 'Thicket of Steel': 'ch-dense', 'Warden\'s Trial': 'ch-warded' };

/** Display name of a stage in the current language (content keeps its English name as data). */
export function contentName(c) {
  if (!c) return '';
  if (c.kind === 'journey' && c.tier) {
    const n = Number(String(c.id).replace(/^journey-/, ''));
    const i = Number.isFinite(n) ? ((n - 1) % 8) + 1 : '';
    return t(c.mastery ? 'stage.mastery' : 'stage.name', { tier: t(`tier.${c.tier - 1}`), n: i });
  }
  if (c.kind === 'tutorial') return t(`tut.${c.id}`, null, c.name);
  if (c.kind === 'daily') return t('daily.name', { date: String(c.id).replace(/^daily-/, '') });
  if (c.kind === 'practice') {
    const m = /^Practice — (\w+)/.exec(c.name || '');
    if (m) return t('prac.name', { d: t(`diff.${m[1].toLowerCase()}`) });
  }
  if (c.kind === 'challenge' && CHALLENGE_KEYS[c.name]) return t(`ch.${CHALLENGE_KEYS[c.name]}`, null, c.name);
  return c.name;
}

/** Tutorial banner step `i` in the current language. */
export function tutorialStepText(c, i) {
  const en = c && c.steps ? c.steps[i] : null;
  if (!en) return '';
  return t(`tut.${c.id}.${i}`, null, en);
}

function totalOf(state) {
  const s = state.score;
  return s.hits + s.precision + s.combo + s.timeBonus + s.missPenalty;
}

function headlineForReason(reason) {
  switch (reason) {
    case 'marker-struck': return t('r.marker');
    case 'too-many-misses': return t('r.misses');
    case 'time-expired': return t('r.time');
    default: return t('r.over');
  }
}

function describeMechanics(content) {
  const parts = [];
  if ((content.preplaced || []).some((p) => p.type === 'blade')) parts.push(t('mech.blades'));
  if ((content.preplaced || []).some((p) => p.type === 'marker')) parts.push(t('mech.sigils'));
  if (content.rotation.oscAmp) parts.push(t('mech.osc'));
  if (content.rotation.triAmp) parts.push(t('mech.pulse'));
  if (content.timeLimitTicks) parts.push(t('mech.time', { n: Math.round(content.timeLimitTicks / SIM_FPS) }));
  return parts.length ? t('mech.watch', { list: parts.join('; ') }) : t('mech.clean');
}

export { THEMES };
