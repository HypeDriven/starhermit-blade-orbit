// Blade Orbit on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules, content and session are the browser
// build's unchanged js/rules.js, js/content.js and js/session.js; this module
// is what js/main.js did around them — the app state machine (title →
// modes → setup → countdown → active ⇄ paused → resolving → results →
// progression, with help, settings and the leaderboard as overlays), the
// throw with its resolve lock, undo and hints, the countdown pre-roll,
// results, progression and achievements, snapshots of a paused round, input
// routing (actions, playfield presses) and the lifecycle — with the screens
// and HUD drawn by screens.ts (starhermit:ui) and the stage by render.ts
// (starhermit:scene).
//
// The simulation clock is the runtime's fixed steps (60 a second, the rules'
// SIM_FPS): a tick every step, only while the round is active, so pausing, a
// hidden window and a slow frame never move the wheel. The countdown's
// pre-roll, the resolve lock and the results' settle are counted in the same
// steps, so play scripts replay exactly.
import { frame, onFixedUpdate, onQuit, onRender, onStart, onSuspend, onUpdate, onPreferencesChange, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onPlayerChange, onSessionEnded } from "starhermit:platform";
import { SIM_FPS } from "../js/rules.js";
import { CHALLENGES, JOURNEY, TUTORIALS, dailyContent, practiceContent, themeById } from "../js/content.js";
import { ACHIEVEMENTS, Session, evaluateAchievements, store } from "../js/session.js";
import * as audio from "./audio.ts";
import { t } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens, loadArt } from "./screens.ts";
import { applyPalette, initStyles } from "./style.ts";

export type Content = ReturnType<typeof dailyContent> & { steps?: string[]; tier?: number; mastery?: boolean; description?: string };
export type Report = ReturnType<Session["report"]>;
export type Progression = ReturnType<typeof store.getProgression>;
export type ScreenName = "title" | "modes" | "journey" | "setup" | "results" | "pause" | "help" | "settings" | "leaderboard";
export type Phase = "boot" | "title" | "countdown" | "active" | "paused" | "resolving" | "results";
export interface ModeCard { id: string; name: string; description: string; meta: string; done?: boolean }
export interface ResultsView {
  report: Report; content: Content; achievements: string[]; isBest: boolean; nextStage: Content | null;
  best: { total: number } | null; lb: { pending?: boolean; posted?: boolean; rank?: number | null } | null;
}

const RESOLVE_LOCK_STEPS = Math.round(0.14 * SIM_FPS); // shortest non-interruptible resolution window
const RESULTS_DELAY_STEPS = SIM_FPS; // cosmetic settle before results screen (0.25 s with reduced motion)
const COUNTDOWN = ["3", "2", "1", "GO"];

export const app = {
  phase: "boot" as Phase,
  /** The open screen; null while playing (the HUD shows). */
  screen: "title" as ScreenName | null,
  /** Frame the screen opened on (the action that opened it must not also close it). */
  openedFrame: 0,
  focusNext: false,
  screenBeforeOverlay: "title" as ScreenName | null,
  overlayPaused: false,
  pausedFrom: "active" as Phase,
  modeList: "menus" as "menus" | "practice" | "challenge" | "tutorial",
  pending: null as { content: Content; ranked: boolean } | null,
  daily: dailyContent(new Date()) as Content,
  results: null as ResultsView | null,
  lbView: null as { entries: platform.BoardRow[] | null; note: string } | null,
  /** The countdown's numeral, or null. */
  countdown: null as string | null,
  tutorialStep: null as number | null,
  hintTicks: null as number | null,
  toast: null as { text: string; until: number } | null,
  caption: null as { text: string; until: number } | null,
  confirmReset: false,
  signedOut: false,
};
export let session: Session | null = null;
export let progression: Progression = store.getProgression();
export const settings = platform.settings;
const now = (): number => frame().time;

// ------------------------------------------------------------------ helpers
const CHALLENGE_KEYS: Record<string, string> = { "Flawless Edge": "ch-perfect", "Ember Sprint": "ch-speed", "Thicket of Steel": "ch-dense", "Warden's Trial": "ch-warded" };
/** Display name of a stage in the current language (content keeps its English name as data). */
export function contentName(c: Content | null | undefined): string {
  if (!c) return "";
  if (c.kind === "journey" && c.tier) {
    const n = Number(String(c.id).replace(/^journey-/, ""));
    const i = Number.isFinite(n) ? ((n - 1) % 8) + 1 : "";
    return t(c.mastery ? "stage.mastery" : "stage.name", { tier: t(`tier.${c.tier - 1}`), n: i });
  }
  if (c.kind === "tutorial") return t(`tut.${c.id}`, null, c.name);
  if (c.kind === "daily") return t("daily.name", { date: String(c.id).replace(/^daily-/, "") });
  if (c.kind === "practice") {
    const m = /^Practice — (\w+)/.exec(c.name || "");
    if (m) return t("prac.name", { d: t(`diff.${m[1]!.toLowerCase()}`) });
  }
  if (c.kind === "challenge" && CHALLENGE_KEYS[c.name]) return t(`ch.${CHALLENGE_KEYS[c.name]}`, null, c.name);
  return c.name;
}
/** Tutorial banner step `i` in the current language. */
export function tutorialStepText(c: Content | null | undefined, i: number): string {
  const en = c && c.steps ? c.steps[i] : null;
  if (!en) return "";
  return t(`tut.${c!.id}.${i}`, null, en);
}
export function describeMechanics(c: Content): string {
  const parts: string[] = [];
  if ((c.preplaced || []).some((p) => p.type === "blade")) parts.push(t("mech.blades"));
  if ((c.preplaced || []).some((p) => p.type === "marker")) parts.push(t("mech.sigils"));
  if (c.rotation.oscAmp) parts.push(t("mech.osc"));
  if (c.rotation.triAmp) parts.push(t("mech.pulse"));
  if (c.timeLimitTicks) parts.push(t("mech.time", { n: Math.round(c.timeLimitTicks / SIM_FPS) }));
  return parts.length ? t("mech.watch", { list: parts.join("; ") }) : t("mech.clean");
}
export function setupDuration(c: Content): string {
  const secs = Math.round(c.par.ticks / SIM_FPS);
  return c.timeLimitTicks ? t("dur.limit", { n: Math.round(c.timeLimitTicks / SIM_FPS) })
    : secs < 90 ? t("dur.secs", { n: secs }) : t("dur.mins", { n: Math.round(secs / 60) });
}
export function headlineForReason(reason: string | null): string {
  switch (reason) {
    case "marker-struck": return t("r.marker");
    case "too-many-misses": return t("r.misses");
    case "time-expired": return t("r.time");
    default: return t("r.over");
  }
}
export function achievementName(key: string): string {
  const def = ACHIEVEMENTS.find((a) => a.key === key);
  return def ? t("ach." + key, null, def.name) : key;
}
export function hintText(): string {
  const n = app.hintTicks;
  if (n == null) return "";
  return n <= 1 ? t("hint.now") : t("hint.wait", { s: (n / SIM_FPS).toFixed(1) });
}
export function canAssist(): boolean {
  const kind = session?.content.kind;
  return kind === "practice" || kind === "tutorial";
}
export function totalOf(state: Session["state"]): number {
  const s = state.score;
  return s.hits + s.precision + s.combo + s.timeBonus + s.missPenalty;
}
export function announce(msg: string, assertive = false): void {
  if (msg) ui.announce(msg, { politeness: assertive ? "assertive" : "polite" });
}
export function toast(text: string): void { app.toast = { text, until: now() + 2.6 }; }
function haptic(ms: number): void { if (settings.haptics) vibrate(ms); }
/** The concise board model the browser build's screen-reader mirror held. */
function mirror(state: Session["state"]): string {
  const blades = state.slots.filter((s: { type: string }) => s.type === "blade").length;
  const markers = state.slots.filter((s: { type: string }) => s.type === "marker").length;
  return t("mirror.text", {
    blades: t(blades === 1 ? "mirror.blade1" : "mirror.bladeN", { n: blades }),
    sigils: t(markers === 1 ? "mirror.sigil1" : "mirror.sigilN", { n: markers }),
    e: state.embedded, g: state.goal, m: state.misses, mx: state.missesAllowed,
  });
}
audio.setOnCaption((type, detail) => {
  if (!settings.captions) return;
  const text = type === "embed" && (detail.combo ?? 0) >= 3 ? t("cap.embedCombo", { n: detail.combo! }) : t(`cap.${type}`);
  app.caption = { text, until: now() + 1.6 };
});

// ------------------------------------------------------------------ screens
export function showScreen(name: ScreenName | null): void {
  app.screen = name;
  app.openedFrame = frame().frame;
  app.focusNext = !!name;
  app.confirmReset = false;
  if (!name) ui.setFocus(null);
  if (name === "title") refreshTitle();
}
/** Help / Settings over any screen; a live round pauses behind them (its time limit must not drain). */
export function showOverlay(name: "help" | "settings"): void {
  if (app.screen === name) return;
  if (app.screen !== "help" && app.screen !== "settings") app.screenBeforeOverlay = app.screen;
  if (app.phase === "active" || app.phase === "countdown") {
    app.overlayPaused = true;
    pause("overlay");
  }
  showScreen(name);
}
export function closeOverlay(): void {
  showScreen(app.screenBeforeOverlay);
  if (app.overlayPaused) { app.overlayPaused = false; resume(); }
}
function refreshTitle(): void {
  app.daily = dailyContent(new Date());
  if (!session) render.loadContent(app.daily, { swoop: false });
}
/** A snapshot is only offered when its stage can still be reconstructed. */
export function hasResumableSnapshot(): boolean {
  const snap = store.loadSnapshot();
  return !!(snap && findContentById(snap.contentId));
}
function findContentById(id: string): Content | null {
  return (JOURNEY.find((s) => s.id === id)
    || TUTORIALS.find((s) => s.id === id)
    || CHALLENGES.map((c) => c.build()).find((s) => s.id === id)
    || (app.daily && app.daily.id === id ? app.daily : null)) as Content | null;
}

/** The mode list on the modes screen (main menu, practice difficulties, challenges, lessons). */
export function modeCards(): ModeCard[] {
  switch (app.modeList) {
    case "practice":
      return ["easy", "normal", "hard", "expert", "master"].map((d) => ({
        id: `practice:${d}`, name: t("prac.name", { d: t(`diff.${d}`) }), description: t(`prac.${d}.d`), meta: t("prac.meta"),
      }));
    case "challenge":
      return CHALLENGES.map((c) => ({ id: `challenge:${c.id}`, name: t(`ch.${c.id}`, null, c.name), description: t(`chd.${c.id}`, null, c.description), meta: t("ch.meta") }));
    case "tutorial":
      return TUTORIALS.map((c, i) => ({
        id: `tutorial:${c.id}`, name: contentName(c as Content), description: tutorialStepText(c as Content, 0),
        meta: progression.tutorialsDone[c.id] ? t("tut.done") : t("tut.lesson", { n: i + 1 }), done: !!progression.tutorialsDone[c.id],
      }));
    default: {
      const daily = app.daily;
      return [
        { id: "journey", name: t("mode.journey"), description: t("mode.journey.d"), meta: t("mode.journey.m", { n: progression.journeyUnlocked - 1 }) },
        { id: "daily", name: t("mode.daily"), description: t("mode.daily.d", { id: daily.id }), meta: t("mode.ranked") },
        { id: "practice", name: t("mode.practice"), description: t("mode.practice.d"), meta: t("mode.casual") },
        { id: "challenge", name: t("mode.challenge"), description: t("mode.challenge.d"), meta: t("mode.casual") },
        { id: "tutorial", name: t("mode.tutorial"), description: t("mode.tutorial.d"), meta: t("mode.tutorial.m") },
      ];
    }
  }
}
export function openModes(list: typeof app.modeList = "menus"): void {
  app.modeList = list;
  app.daily = dailyContent(new Date());
  showScreen("modes");
}
export function pickMode(id: string): void {
  const [kind, arg] = id.split(":");
  if (arg === undefined) {
    switch (id) {
      case "journey": showScreen("journey"); break;
      case "daily": prepareContent(app.daily, true); break;
      case "practice": openModes("practice"); break;
      case "challenge": openModes("challenge"); break;
      case "tutorial": openModes("tutorial"); break;
    }
    return;
  }
  if (kind === "practice") prepareContent(practiceContent(arg) as Content);
  else if (kind === "challenge") {
    const ch = CHALLENGES.find((c) => c.id === arg);
    if (ch) prepareContent(ch.build() as Content);
  } else if (kind === "tutorial") {
    const tut = TUTORIALS.find((x) => x.id === arg);
    if (tut) prepareContent(tut as Content);
  }
}
export function pickJourney(id: string): void {
  const stage = JOURNEY.find((s) => s.id === id);
  if (stage) prepareContent(stage as Content);
}
export function openDaily(): void { app.daily = dailyContent(new Date()); prepareContent(app.daily, true); }
export function prepareContent(content: Content, ranked = false): void {
  app.pending = { content, ranked };
  showScreen("setup");
}

export function openLeaderboard(): void {
  showScreen("leaderboard");
  app.lbView = { entries: null, note: "lb.loading" };
  if (!platform.signedIn()) { app.lbView = { entries: [], note: "lb.signIn" }; return; }
  void platform.fetchLeaderboard().then((res) => {
    app.lbView = res.ok ? { entries: res.entries, note: res.entries.length ? "" : "lb.notYet" } : { entries: [], note: "lb.notYet" };
  });
}

// ------------------------------------------------------------------ session lifecycle
let countdown = { elapsed: 0, total: 0, step: 0, index: -1 };
let resolveLeft = 0;
let lockLeft = 0;
let idleTick = 0;

export function startSession(content: Content): void {
  const allowUndo = content.kind === "practice" || content.kind === "tutorial";
  session = new Session(content, { allowUndo });
  progression.sessionsPlayed += 1;
  store.saveProgression(progression);
  render.loadContent(content);
  render.setReticleMode("hidden");
  audio.startAmbience(themeById(content.theme).ambience);
  audio.startMusic(content.tier ? Math.min(1, content.tier / 6) : 0.2);
  audio.setPaused(false);
  app.results = null;
  app.screenBeforeOverlay = null;
  app.overlayPaused = false;
  showScreen(null);
  announce(t("an.start", { name: contentName(content), goal: content.goal, m: content.missesAllowed }));
  app.hintTicks = null;
  // tutorial steps as banner
  app.tutorialStep = content.kind === "tutorial" ? 0 : null;
  app.phase = "countdown";
  runCountdown();
}

/** The wheel keeps turning through "3 · 2 · 1 · GO", but the simulation clock
 * only starts at GO: the countdown must not eat a stage's time limit or its
 * par-time bonus. Pre-roll ticks are negative and reach 0 exactly at GO. */
function runCountdown(): void {
  const step = Math.round(((preferences().reducedMotion ? 500 : 700) / 1000) * SIM_FPS);
  countdown = { elapsed: 0, total: step * COUNTDOWN.length, step, index: -1 };
  countdownStep();
}
function countdownStep(): void {
  const i = Math.floor(countdown.elapsed / countdown.step);
  if (i === countdown.index) return;
  countdown.index = i;
  if (i < COUNTDOWN.length) {
    app.countdown = COUNTDOWN[i] === "GO" ? t("count.go") : COUNTDOWN[i]!;
    audio.event(i === COUNTDOWN.length - 1 ? "go" : "tick");
    return;
  }
  app.countdown = null;
  if (session?.content.kind === "tutorial") app.tutorialStep = 1;
  app.phase = "active";
}
export function countdownTick(): number { return -(countdown.total - countdown.elapsed); }

export function doThrow(): void {
  if (app.phase !== "active" || lockLeft > 0 || !session) return;
  lockLeft = RESOLVE_LOCK_STEPS;
  render.interruptSwoop();
  const { applied, events, error } = session.throw();
  if (!applied) {
    if (error !== "duplicate-command") announce(t("an.notAllowed"), true);
    return;
  }
  audio.event("throw");
  haptic(12);
  let polite = "";
  for (const ev of events) {
    if (ev.type === "embed") {
      audio.event("embed", { combo: ev.combo });
      if (ev.combo >= 3) audio.event("combo", { combo: ev.combo });
      polite = (ev.combo ?? 1) > 1 ? t("an.embeddedCombo", { p: ev.precision ?? 0, c: ev.combo ?? 1 }) : t("an.embedded", { p: ev.precision ?? 0 });
    } else if (ev.type === "miss") {
      audio.event(ev.blockedBy === "hit-marker" ? "miss-marker" : "miss-blade");
      haptic(60);
      announce(ev.blockedBy === "hit-marker" ? t("an.missMarker") : t("an.missBlade"), true);
      app.hintTicks = null;
    }
  }
  render.pushEvents(events);
  render.syncState(session.state);
  announce([polite, mirror(session.state)].filter(Boolean).join(" "));
  if (session.state.status !== "active") enterResolving();
}

function enterResolving(): void {
  app.phase = "resolving";
  render.setReticleMode("hidden");
  audio.event(session!.state.status === "won" ? "win" : "lose");
  resolveLeft = preferences().reducedMotion ? Math.round(SIM_FPS / 4) : RESULTS_DELAY_STEPS;
}

function showResults(): void {
  if (!session) return;
  app.phase = "results";
  const report = session.report();
  const content = session.content as Content;
  // progression
  progression.totalThrows += report.embedded + report.misses;
  progression.totalEmbeds += report.embedded;
  let nextStage: Content | null = null;
  if (report.won) {
    if (content.kind === "tutorial") progression.tutorialsDone[content.id] = true;
    if (content.kind === "journey") {
      const n = JOURNEY.findIndex((s) => s.id === content.id) + 1;
      const stars = report.total >= content.par.score * 1.4 ? 3 : report.total >= content.par.score ? 2 : 1;
      progression.journeyStars[content.id] = Math.max(progression.journeyStars[content.id] || 0, stars);
      progression.journeyUnlocked = Math.max(progression.journeyUnlocked, Math.min(41, n + 1));
      progression.masteryXp += 10 * (content.tier || 1) + stars * 5;
      nextStage = n < 40 ? (JOURNEY[n] as Content) : null;
    }
    if (content.kind === "daily") progression.dailyDone[content.id] = report.total;
  }
  store.saveProgression(progression);
  const isBest = store.recordScore(content.id, report);
  const best = store.getScores()[content.id] ?? null;
  const achievements = evaluateAchievements(session, progression);
  store.saveReplay(`${content.id}:${session.sessionId}`, session.replayEnvelope());
  store.clearSnapshot();
  audio.stopMusic();
  if (achievements.length) audio.event("achievement");
  app.results = { report, content, achievements, isBest, nextStage, best, lb: null };
  postToLeaderboard(content.kind, report.total);
  showScreen("results");
  announce(t("r.announce", { h: report.won ? t("r.won") : headlineForReason(report.reason), n: report.total }), true);
}

/** Signed in only: post a ranked run (not practice or lessons) and show the board rank. */
function postToLeaderboard(kind: string, total: number): void {
  const res = app.results!;
  if (!platform.signedIn() || kind === "practice" || kind === "tutorial") return;
  res.lb = { pending: true };
  void platform.postLeaderboard(total).then((r) => { res.lb = r; });
}

export function pause(reason: "user" | "overlay" | "hidden" = "user"): void {
  if (app.phase !== "active" && app.phase !== "countdown") return;
  app.pausedFrom = app.phase;
  app.phase = "paused";
  if (session) store.saveSnapshot(session.content.id, session.snapshotJson());
  audio.event("pause");
  audio.setPaused(true);
  // 'overlay' keeps Help/Settings on screen; every other reason (including a
  // hidden window) must surface the pause panel so the frozen round is explained.
  if (reason !== "overlay") showScreen("pause");
}
export function resume(): void {
  if (app.phase !== "paused") return;
  app.overlayPaused = false;
  audio.setPaused(false);
  showScreen(null);
  app.phase = app.pausedFrom === "countdown" ? "countdown" : "active";
  if (app.phase === "countdown") runCountdown();
}
export function leaveToTitle(): void {
  session = null;
  app.phase = "title";
  app.tutorialStep = null;
  app.hintTicks = null;
  app.countdown = null;
  app.results = null;
  audio.stopMusic();
  audio.stopAmbience();
  audio.setPaused(false);
  render.setReticleMode("hidden");
  showScreen("title");
}
export function restart(): void { if (session) startSession(session.content as Content); }
export function nextStage(): void {
  const n = JOURNEY.findIndex((s) => s.id === session?.content.id) + 1;
  if (n > 0 && n < JOURNEY.length) prepareContent(JOURNEY[n] as Content);
}
export function resumeSnapshot(): void {
  const snap = store.loadSnapshot();
  const content = snap ? findContentById(snap.contentId) : null;
  const restored = content ? Session.restore(content, snap.json) : null;
  if (!restored || !content) {
    // Never leave the player pressing a button that silently does nothing.
    store.clearSnapshot();
    announce(t("an.cantRestore"), true);
    toast(t("an.cantRestore"));
    return;
  }
  session = restored;
  app.pending = { content, ranked: content.kind === "daily" };
  render.loadContent(content);
  render.syncState(restored.state);
  audio.startAmbience(themeById(content.theme).ambience);
  audio.startMusic(content.tier ? Math.min(1, content.tier / 6) : 0.2);
  audio.setPaused(false);
  app.tutorialStep = null;
  app.hintTicks = null;
  app.results = null;
  showScreen(null);
  app.phase = "active";
  announce(t("an.resumed"));
}

export function doUndo(): void {
  if (!session || app.phase !== "active") return;
  const r = session.undo();
  if (r.ok) {
    audio.event("undo");
    render.syncState(session.state);
    announce(t("an.undone"));
  } else announce(t("an.nothingUndo"));
}
export function doHint(): void {
  if (!session || app.phase !== "active") return;
  const h = session.hint();
  if (!h) return;
  audio.event("hint");
  app.hintTicks = h.ticksAway;
  announce(hintText());
}
export function replayTutorials(): void {
  progression.tutorialsDone = {};
  store.saveProgression(progression);
  openModes("tutorial");
}
export function resetProgress(): void {
  platform.resetAll();
  progression = store.getProgression();
  app.confirmReset = false;
  announce(t("an.erased"));
  toast(t("an.erased"));
}

// ------------------------------------------------------------------ input
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const fresh = frame().frame !== app.openedFrame;
  switch (e.action) {
    case "throw":
      // Only while playing with no screen open, so it never fires from a focused menu button.
      if (app.phase === "active" && !app.screen) { if (ui.focused()) ui.setFocus(null); doThrow(); }
      break;
    case "pause":
      if (app.phase === "paused") { if (fresh) { if (app.screen === "help" || app.screen === "settings") closeOverlay(); else resume(); } }
      else pause();
      break;
    case "back":
      if (!fresh) break;
      if (app.phase === "paused") { if (app.screen === "help" || app.screen === "settings") closeOverlay(); else resume(); }
      else if (app.phase === "active" || app.phase === "countdown") pause();
      else if (app.screen === "help" || app.screen === "settings") closeOverlay();
      else if (app.screen === "results") leaveToTitle();
      else if (app.screen && app.screen !== "title") showScreen("title");
      break;
    case "undo":
      if (app.phase === "active" && canAssist()) doUndo();
      break;
    case "hint":
      if (app.phase === "active" && canAssist()) doHint();
      break;
    case "restart":
      if (app.phase === "active" && session?.content.kind === "practice") restart();
      break;
  }
});

// Pointer: a press anywhere on the playfield (not on the HUD's controls)
// throws. Touch and the mouse can both report one press: a pointer press
// right after a touch is skipped.
let lastTouch = -1e9;
function playfieldPress(): void {
  if (app.phase !== "active" || app.screen || ui.pointerOver()) return;
  doThrow();
}
onPointerButton((e) => {
  if (e.button !== 0 || !e.pressed || now() - lastTouch < 0.6) return;
  playfieldPress();
});
onTouch((e) => {
  if (!e.primary) return;
  lastTouch = now();
  if (e.phase === "start") playfieldPress();
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const key = `${f.quality}:${f.levelIndex}`;
  if (key === lookKey) return;
  lookKey = key;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}

onStart(() => {
  setFixedRate(SIM_FPS);
  initStyles();
  platform.initPlatform();
  progression = store.getProgression();
  applyPalette(settings.palette, preferences().highContrast);
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  loadArt();
  app.phase = "title";
  showScreen("title");
});
onPreferencesChange((p) => { render.setReducedMotion(p.reducedMotion); applyPalette(settings.palette, p.highContrast); });
platform.onSettingsChange(() => applyPalette(settings.palette, preferences().highContrast));
platform.onProgressMerged(() => { progression = store.getProgression(); });
onSessionEnded(() => { app.signedOut = true; toast(t("acct.signedOut")); });
onPlayerChange((p) => { if (p) app.signedOut = false; });
onSuspend(() => {
  // Backgrounding pauses the round (with its snapshot) and surfaces the pause panel.
  pause("hidden");
  platform.flush();
});
onQuit(() => { if (session && (app.phase === "active" || app.phase === "countdown" || app.phase === "paused")) store.saveSnapshot(session.content.id, session.snapshotJson()); });

onFixedUpdate(() => {
  if (lockLeft > 0) lockLeft--;
  if (app.phase === "countdown" && session) {
    countdown.elapsed = Math.min(countdown.total, countdown.elapsed + 1);
    countdownStep();
  } else if (app.phase === "active" && session) {
    const events = session.tick(1);
    if (events.length) { // terminal transition (time limit)
      render.pushEvents(events);
      enterResolving();
    }
  } else if (app.phase === "resolving") {
    if (--resolveLeft <= 0) showResults();
  }
  if (!session) idleTick++;
});
let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  audio.update();
  audio.flushPending();
  const t0 = now();
  if (app.toast && t0 > app.toast.until) app.toast = null;
  if (app.caption && t0 > app.caption.until) app.caption = null;
});
onRender((alpha) => {
  const s = session;
  // timing assist / hold-to-preview reticle
  if (s && app.phase === "active") {
    if (settings.timingAssist || settings.holdToAim) {
      const p = s.previewNow();
      render.setReticleMode(p.outcome !== "embed" ? "bad" : p.clearance > 0.15 ? "good" : "idle");
    } else render.setReticleMode("hidden");
  }
  drawScreens();
  if (s && app.phase === "countdown") {
    // Cosmetic pre-roll: the wheel spins toward tick 0 without advancing the sim.
    render.update(frameDt, { ...s.state, tick: countdownTick() }, alpha);
  } else if (s && app.phase === "active") {
    render.update(frameDt, s.state, alpha);
  } else if (s) {
    // frozen sim, cosmetic settle only
    render.update(frameDt, s.state, 0);
  } else {
    // attract mode behind menus: cosmetic idle spin, no sim state
    render.update(frameDt, { rotation: app.daily.rotation, tick: idleTick, slots: [] }, alpha);
  }
});
