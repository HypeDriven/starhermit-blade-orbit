// The browser build's DOM shell (index.html + js/ui.js + css/main.css) as
// starhermit:ui, built every frame: the top bar (title, the UTC clock, the
// player chip with avatar, Help and Settings), the play HUD (Goal, Score,
// Combo, Misses and Time with Pause; Hint, Undo and THROW; the hint line),
// the rails (objective and stage; actions and status), the countdown
// numeral, the lesson banner, the caption strip and the toast, and the
// screens (title over its key art, the mode cards, the journey grid, the
// stage briefing, the leaderboard, results with the score table, pause, help
// with the controls list, settings). The browser's media queries are layouts
// picked by the window's logical size: wide (≥ 1024 px: both rails docked
// beside the playfield), short landscape (≤ 500 px tall: a narrow objective
// rail, the throw controls a column beside the wheel, the hint and the
// lesson banner at the side), and compact (no rails, the controls across the
// bottom). The wheel is framed into the playfield and what the HUD leaves of
// it (render.setPlayfield).
import { frame, openMenu, clipboard } from "starhermit:engine";
import { bindings } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { requestSignIn } from "starhermit:platform";
import { TextureLoader, type Texture } from "starhermit:scene";
import { JOURNEY } from "../js/content.js";
import { PALETTES } from "../js/migrate.js";
import { SIM_FPS } from "../js/rules.js";
import { t } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  achievementName, app, canAssist, closeOverlay, contentName, describeMechanics, doHint, doThrow, doUndo, hasResumableSnapshot,
  headlineForReason, hintText, leaveToTitle, nextStage, openDaily, openLeaderboard, openModes, pause, pickJourney, pickMode,
  progression, replayTutorials, resetProgress, restart, resume, resumeSnapshot, session, settings, showOverlay, showScreen,
  startSession, toast, totalOf, tutorialStepText, setupDuration, modeCards, type Content, type ScreenName,
} from "./main.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; W: number; H: number; wide: boolean; shortLand: boolean; portrait: boolean; narrow: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const wide = lw >= 1024;
  const shortLand = !wide && lw > lh && lh <= 500;
  return { lw, lh, sc, ox: sa.left / sc, oy: sa.top / sc, W: f.width / sc, H: f.height / sc, wide, shortLand, portrait: !wide && lh > lw, narrow: lw <= 560 };
}
const lastHeight = new Map<string, number>();
const REM = 16;

function textWidth(text: string, style: string | readonly string[], kind?: "button"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: typeof style === "string" ? style : [...style] }).width / ui.preferences().scale;
}
const buttonWidth = (text: string, style: readonly string[]): number => textWidth(text, style, "button") + 2;

interface Btn { id: string; text: string; style?: string[]; disabled?: boolean; act: () => void }
const PLAIN = ["btn"];
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = b.disabled ? { disabled: true } : {};
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = width - 36;
    const bold = style.includes("btn-primary") || style.includes("btn-throw");
    opts.content = () => { ui.paragraph(b.text, inner, bold ? { weight: "700", ...(style.includes("btn-big") ? { size: 20 } : {}) } : {}); };
  }
  if (ui.style(...style, s).id(b.id).button(b.text, opts)) b.act();
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, align: "start" | "center" | "end" = "start", gap = 12): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, buttonWidth(b.text, b.style ?? PLAIN));
    if (rows[rows.length - 1]!.length && used + gap + bw > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + bw;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, buttonWidth(b.text, b.style ?? PLAIN) > width ? width : null);
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls?: string | null, id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = cls ? [cls] : [];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: styles }).width / ui.preferences().scale <= width) u.label(text);
  else u.paragraph(text, width);
}
/** The panel footer (CSS justify-content: space-between): the first button at the start, the rest at the end. */
function footer(label: string, list: Btn[], width: number): void {
  const total = list.reduce((n, b) => n + buttonWidth(b.text, b.style ?? PLAIN), 0) + 12 * (list.length - 1);
  if (total > width) { flow(label, list, width, "center"); return; }
  ui.row(label, () => {
    button(list[0]!);
    ui.spacer();
    ui.row(`${label}-end`, () => { for (const b of list.slice(1)) button(b); }, { spacing: 12, align: "center" });
  }, { width, align: "center" });
}

// ------------------------------------------------------------------ glyphs
// The browser build's ★ ◆ ◈ ✓ 🏅 characters depend on the system's fonts
// here (a colour emoji draws as tofu): drawn shapes instead.
type Glyph = "star" | "diamond" | "throw" | "check" | "medal";
function star(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}
function glyph(kind: Glyph, size: number, color: string, label = ""): void {
  ui.widget(label, {
    role: label ? "image" : "none", size: { width: size, height: size },
    draw: (r) => {
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2, s = Math.min(r.width, r.height) / 2;
      if (kind === "star") draw.polygon(star(cx, cy, s), color);
      else if (kind === "diamond") draw.polygon([[cx, cy - s * 0.8], [cx + s * 0.8, cy], [cx, cy + s * 0.8], [cx - s * 0.8, cy]], color);
      else if (kind === "throw") {
        draw.polygon([[cx, cy - s], [cx + s, cy], [cx, cy + s], [cx - s, cy]], color);
        draw.polygon([[cx, cy - s * 0.62], [cx + s * 0.62, cy], [cx, cy + s * 0.62], [cx - s * 0.62, cy]], "#ff8c3a");
        draw.polygon([[cx, cy - s * 0.34], [cx + s * 0.34, cy], [cx, cy + s * 0.34], [cx - s * 0.34, cy]], color);
      } else if (kind === "check") {
        const w = Math.max(1.5, s * 0.28);
        draw.line(cx - s * 0.7, cy, cx - s * 0.2, cy + s * 0.55, color, w);
        draw.line(cx - s * 0.2, cy + s * 0.55, cx + s * 0.75, cy - s * 0.6, color, w);
      } else {
        draw.polygon([[cx - s * 0.55, cy - s], [cx - s * 0.1, cy - s], [cx + s * 0.1, cy - s * 0.2], [cx - s * 0.3, cy - s * 0.2]], "#c94f3a");
        draw.polygon([[cx + s * 0.55, cy - s], [cx + s * 0.1, cy - s], [cx - s * 0.1, cy - s * 0.2], [cx + s * 0.3, cy - s * 0.2]], "#3a6ec9");
        draw.polygon(star(cx, cy + s * 0.3, s * 0.68), color);
      }
    },
  });
}
const STAR = "#ffc46a";

// ------------------------------------------------------------------ art
let backdrop: Texture | null = null;
export function loadArt(): void {
  // Missing art never breaks the title: the plain scrim remains.
  new TextureLoader().loadAsync("assets/title-backdrop.webp").then((tex) => { backdrop = tex; }, () => undefined);
}
/** #screen-title's background: the key art (cover, centred) under a dark gradient. */
function drawBackdrop(): void {
  const f = frame();
  if (backdrop && backdrop.width > 0 && !ui.preferences().highContrast) {
    const k = Math.max(f.width / backdrop.width, f.height / backdrop.height);
    const w = backdrop.width * k, h = backdrop.height * k;
    draw.image(backdrop, (f.width - w) / 2, (f.height - h) / 2, w, h);
    draw.box(0, 0, f.width, f.height, { background: { type: "linear", angle: 180, stops: ["#100a06b8", "#100a06d9"] } });
  } else draw.box(0, 0, f.width, f.height, { background: ui.preferences().highContrast ? "#000000e6" : "#100a06" });
}

// ------------------------------------------------------------------ the frame
function firstLabel(name: ScreenName): string | null {
  switch (name) {
    case "title": return t("btn.play");
    case "modes": return modeCards()[0]?.name ?? t("btn.back");
    case "journey": return t("jcell.aria", { n: 1, name: contentName(JOURNEY[0] as Content) }) + ((progression.journeyStars[JOURNEY[0]!.id] ?? 0) ? t("jcell.stars", { s: progression.journeyStars[JOURNEY[0]!.id]! }) : "");
    case "setup": return t("btn.begin");
    case "results": return app.results?.nextStage && app.results.report.won ? t("btn.next") : t("btn.retry");
    case "pause": return t("btn.resumePlay");
    case "help": case "leaderboard": return t("btn.back");
    case "settings": return t("set.captions");
  }
}

let topH = 56;
let toastH = 40;
export function drawScreens(): void {
  const L = layoutNow();
  if (app.focusNext && app.screen && frame().frame - app.openedFrame >= 2) {
    const first = firstLabel(app.screen);
    if (first) ui.setFocus(first);
    app.focusNext = false;
  }
  if (app.screen === "title") drawBackdrop();
  const playing = !!session && !app.screen;
  if (playing) hud(L);
  else render.setPlayfield({ x: L.ox, y: L.oy + topH, w: L.lw, h: Math.max(1, L.lh - topH), W: L.W, H: L.H }, { top: 0, bottom: 0, left: 0, right: 0 });
  switch (app.screen) {
    case "title": titleScreen(L); break;
    case "modes": modesScreen(L); break;
    case "journey": journeyScreen(L); break;
    case "setup": setupScreen(L); break;
    case "leaderboard": leaderboardScreen(L); break;
    case "results": resultsScreen(L); break;
    case "pause": pauseScreen(L); break;
    case "help": helpScreen(L); break;
    case "settings": settingsScreen(L); break;
    default: break;
  }
  topbar(L);
  if (app.toast) {
    const w = Math.min(L.lw - 32, 560);
    ui.place("toast", { anchor: "top-start", x: (L.lw - w) / 2, y: Math.max(0, L.lh - 20 - toastH) }, () => {
      const r = ui.column("toast-box", () => {
        if (textWidth(app.toast!.text, "toast") + 34 <= w) ui.style("toast").label(app.toast!.text);
        else ui.style("toast").paragraph(app.toast!.text, w - 34);
      }, { align: "center" });
      toastH = r.height / L.sc;
    }, { width: w, align: "center" });
  }
}

// ------------------------------------------------------------------ top bar
function clockText(): string {
  return new Date().toISOString().slice(11, 19) + " UTC";
}
function topbar(L: Layout): void {
  const inner = L.lw - (L.narrow ? 24 : 32);
  const name = platform.displayName() ?? t("guest");
  const pic = platform.avatarCanvas();
  const btns: Btn[] = [
    { id: "btn-help-top", text: t("btn.help"), style: ["btn", "btn-ghost"], act: () => showOverlay("help") },
    { id: "btn-settings-top", text: t("btn.settings"), style: ["btn", "btn-ghost"], act: () => showOverlay("settings") },
  ];
  const compact = L.narrow;
  const bstyle = compact ? ["btn", "btn-ghost", "btn-small"] : ["btn", "btn-ghost"];
  for (const b of btns) b.style = bstyle;
  const brandW = textWidth("Blade Orbit", "game-title") + 12 + textWidth(clockText(), "server-clock");
  const chipW = textWidth(name, "profile-chip") + (pic ? 30 : 0);
  const btnsW = btns.reduce((n, b) => n + buttonWidth(b.text, b.style!) + 8, 0);
  const oneRow = brandW + chipW + btnsW + 24 <= inner;
  const brand = (): void => {
    ui.row("brand", () => {
      ui.style("game-title", compact ? { text: { size: 16 } } : null).label("Blade Orbit");
      ui.style("server-clock", compact ? { text: { size: 12 } } : null).id("server-clock").label(clockText());
    }, { spacing: 12, align: "center" });
  };
  const actions = (): void => {
    ui.row("top-actions", () => {
      ui.row("profile-chip", () => {
        if (pic) ui.widget("", { role: "none", size: { width: 24, height: 24 }, draw: (r) => { draw.image(pic, r.x, r.y, r.width, r.height); } });
        ui.style("profile-chip").id("profile-name").label(name);
      }, { spacing: 6, align: "center" });
      for (const b of btns) { if (ui.style(...b.style!).id(b.id).button(b.text)) { b.act(); } }
    }, { spacing: compact ? 4 : 8, align: "center" });
  };
  const top = ui.place("topbar", "top-start", () => {
    if (oneRow) ui.row("top-row", () => { brand(); ui.spacer(); actions(); }, { width: inner, spacing: 12, align: "center" });
    else {
      ui.column("top-col", () => {
        ui.row("top-row1", () => { brand(); }, { width: inner, align: "center" });
        ui.row("top-row2", () => { ui.spacer(); actions(); }, { width: inner, align: "center" });
      }, { spacing: 4, width: inner });
    }
  }, { style: "topbar", width: L.lw, ...(compact ? { padding: { top: 8, bottom: 8, start: 12, end: 12 } } : {}) });
  topH = top.height / L.sc;
}

// ------------------------------------------------------------------ HUD
function hud(L: Layout): void {
  const s = session!;
  const st = s.state;
  const c = s.content as Content;
  const left = !!settings.leftHanded;
  const railW = L.wide ? 240 : L.shortLand ? 150 : 0;
  const pfX = railW, pfW = L.lw - railW - (L.wide ? 240 : 0);
  const playY = topH;
  const pfH = L.lh - playY;

  // --- rails
  if (railW) {
    ui.place("rail-left", { anchor: "top-start", x: 0, y: playY }, () => {
      ui.style("rail-heading").label(t("rail.objective").toUpperCase());
      para(t("rail.objectiveV", { goal: st.goal, done: st.embedded, left: st.goal - st.embedded }), railW - (L.wide ? 32 : 16), "rail-objective", "rail-objective");
      ui.style("rail-heading", { margin: { top: 12 } }).label(t("rail.stage").toUpperCase());
      para(contentName(c), railW - (L.wide ? 32 : 16), "rail-dim", "rail-stage");
    }, { style: "rail", width: railW, height: pfH, spacing: 5, ...(L.shortLand ? { padding: 8, text: { size: 13.6 } } : {}) });
  }
  if (L.wide) {
    ui.place("rail-right", { anchor: "top-end", x: 0, y: playY }, () => {
      ui.style("rail-heading").label(t("rail.actions").toUpperCase());
      const acts: Btn[] = [];
      if (canAssist()) acts.push({ id: "rail-undo", text: t("rail.undo"), style: ["btn", "btn-small"], act: doUndo }, { id: "rail-hint", text: t("rail.hint"), style: ["btn", "btn-small"], act: doHint });
      if (c.kind === "practice") acts.push({ id: "rail-restart", text: t("rail.restart"), style: ["btn", "btn-small"], act: restart });
      acts.push({ id: "rail-pause", text: t("rail.pause"), style: ["btn", "btn-small"], act: () => pause() });
      ui.column("rail-actions", () => { for (const b of acts) button(b, 208); }, { spacing: 8 });
      ui.style("rail-heading", { margin: { top: 12 } }).label(t("rail.status").toUpperCase());
      para(t("rail.statusV", { score: totalOf(st), m: st.misses, max: st.missesAllowed }) + (st.comboStreak > 1 ? t("rail.combo", { n: st.comboStreak }) : ""), 208, "rail-dim", "rail-status");
    }, { style: "rail", width: 240, height: pfH, spacing: 5 });
  }

  // --- the top strip of stats and Pause (flex-wrap)
  const stats: [string, string, string, string][] = [
    ["hud-goal", t("hud.goal"), `${st.embedded} / ${st.goal}`, "hud-value"],
    ["hud-score", t("hud.score"), String(totalOf(st)), "hud-score"],
    ["hud-combo", t("hud.combo"), st.comboStreak > 1 ? `x${st.comboStreak}` : "—", "hud-value"],
    ["hud-misses", t("hud.misses"), `${st.misses} / ${st.missesAllowed}`, "hud-value"],
  ];
  if (st.timeLimitTicks) stats.push(["hud-timer", t("hud.time"), t("hud.timer", { n: Math.floor(Math.max(0, st.timeLimitTicks - st.tick) / SIM_FPS) }), "hud-value"]);
  const compact = L.portrait || L.narrow;
  const gap = compact ? 8.8 : 14.4;
  const blockW = (label: string, v: string, cls: string): number => Math.max(3.2 * REM, textWidth(label.toUpperCase(), "hud-label"), textWidth(v, cls));
  const pauseBtn: Btn = { id: "btn-pause", text: t("btn.pause"), style: ["btn", "btn-ghost"], act: () => pause() };
  const items = stats.map(([id, label, v, cls]) => ({ id, w: blockW(label, v, cls), build: () => {
    ui.column(id, () => {
      ui.style("hud-label").label(label.toUpperCase());
      ui.style(cls).id(`${id}-v`).label(v);
    }, { align: "center", spacing: 0, width: blockW(label, v, cls) });
  } }));
  items.push({ id: "btn-pause", w: buttonWidth(pauseBtn.text, pauseBtn.style!), build: () => button(pauseBtn) });
  const margin = 12;
  const stripMax = Math.min(pfW, L.lw) - margin * 2 - (compact ? 19.2 : 25.6);
  const rows: (typeof items)[] = [[]];
  let used = 0;
  for (const it of items) {
    if (rows[rows.length - 1]!.length && used + gap + it.w > stripMax) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + it.w;
    rows[rows.length - 1]!.push(it);
  }
  const strip = ui.place("hud-top", { anchor: "top-start", x: pfX + margin, y: playY + 8 }, () => {
    rows.forEach((row, ri) => ui.row(`hud-top-r${ri}`, () => { for (const it of row) it.build(); }, { spacing: gap, align: "center" }));
  }, { style: "hud-top", spacing: 4, ...(compact ? { padding: { top: 4.8, bottom: 4.8, start: 9.6, end: 9.6 } } : {}) });
  const stripBottom = (strip.y + strip.height) / L.sc - frame().safeArea.top / L.sc;

  // --- throw controls
  const acts: Btn[] = [];
  if (canAssist()) {
    acts.push({ id: "btn-hint", text: t("btn.hint"), style: ["btn", "btn-small"], act: doHint });
    acts.push({ id: "btn-undo", text: t("btn.undo"), style: ["btn", "btn-small"], act: doUndo });
  }
  const throwStyle = ["btn", "btn-throw", ...(L.shortLand ? ["btn-throw-compact"] : [])];
  const throwBtn = (): void => {
    const opts: ui.ButtonOptions = {
      disabled: st.status !== "active" || app.phase !== "active",
      content: () => {
        ui.row("btn-throw-face", () => {
          glyph("throw", L.shortLand ? 16 : 20, "#1a0d05");
          ui.label(t("btn.throw"), { weight: "800" });
        }, { spacing: 6, align: "center" });
      },
    };
    if (ui.style(...throwStyle).id("btn-throw").button(t("btn.throw"), opts)) { doThrow(); ui.setFocus(null); }
  };
  const small = (b: Btn): void => { if (ui.style(...b.style!).id(b.id).button(b.text)) { b.act(); ui.setFocus(null); } };
  const hint = hintText();
  let bottomH = 0, sideW = 0;
  if (L.shortLand) {
    // Controls and guidance sit beside the wheel, never over it.
    const col = ui.place("hud-actions", { anchor: left ? "start" : "end", x: left ? railW + 9.6 : 9.6, y: topH / 2 }, () => {
      for (const b of acts) small(b);
      throwBtn();
    }, { spacing: 8, align: "stretch" });
    sideW = col.width / L.sc + 9.6;
    if (hint) {
      ui.place("hint-line", { anchor: "bottom-start", x: pfX + 12, y: 6.4 }, () => {
        para(hint, Math.max(120, L.lw * 0.32), "hint-line", "hint-text");
      });
    }
  } else {
    const order = left ? [throwBtn, ...acts.slice().reverse().map((b) => () => small(b))] : [...acts.map((b) => () => small(b)), throwBtn];
    const r = ui.place("hud-actions", { anchor: "bottom-start", x: pfX, y: compact ? 8 : 12 }, () => {
      ui.row("hud-actions-row", () => { for (const fn of order) fn(); }, { spacing: 12, align: "end" });
      ui.column("hint-box", () => { para(hint, Math.min(pfW - 24, 520), "hint-line", "hint-text", true); }, { height: 22, align: "center", justify: "center" });
    }, { width: pfW, align: "center", spacing: 6.4 });
    bottomH = r.height / L.sc + (compact ? 8 : 12);
  }

  // --- countdown, lesson banner, captions
  if (app.countdown) {
    ui.place("countdown", { anchor: "top-start", x: pfX, y: playY }, () => {
      ui.style("countdown", L.shortLand || L.narrow ? "countdown-compact" : null).id("countdown").label(app.countdown!);
    }, { width: pfW, height: pfH, align: "center", justify: "center" });
  }
  const banner = app.tutorialStep != null ? tutorialStepText(c, app.tutorialStep) : "";
  let bannerW = 0;
  if (banner) {
    if (L.shortLand) {
      const w = Math.max(140, L.lw * 0.3);
      const r = ui.place("tutorial-banner", { anchor: "top-start", x: pfX + 9.6, y: stripBottom + 8 }, () => {
        para(banner, w - 24, null, "tutorial-text");
      }, { style: ["tutorial-banner", "tutorial-banner-compact"], width: w });
      bannerW = r.width / L.sc + 9.6;
    } else {
      const w = Math.min(34 * REM, pfW * 0.92);
      const inner = w - 35.2;
      const fits = textWidth(banner, "tutorial-banner") <= inner;
      ui.place("tutorial-banner", { anchor: "top-start", x: pfX + (pfW - (fits ? textWidth(banner, "tutorial-banner") + 35.2 : w)) / 2, y: Math.max(playY + 4.5 * REM, stripBottom + 8) }, () => {
        para(banner, inner, null, "tutorial-text", true);
      }, { style: "tutorial-banner", ...(fits ? {} : { width: w }) });
    }
  }
  if (app.caption) {
    const w = Math.min(pfW * 0.9, 520);
    ui.place("captions", { anchor: "bottom-start", x: pfX + (pfW - Math.min(w, textWidth(app.caption.text, "captions") + 26)) / 2, y: Math.max(6.5 * REM, bottomH + 8) }, () => {
      para(app.caption!.text, w - 26, "captions", "caption-text");
    }, { style: "captions" });
  }

  // --- the wheel's framing: the playfield (the browser build's canvas, between
  // the top bar and the rails) and the HUD bands over it
  render.setPlayfield({ x: L.ox + pfX, y: L.oy + playY, w: pfW, h: pfH, W: L.W, H: L.H }, {
    top: Math.min(0.45, Math.max(0, stripBottom - playY) / pfH),
    bottom: L.shortLand ? 0 : Math.min(0.4, bottomH / pfH),
    left: Math.min(0.5, ((L.shortLand && left ? sideW : 0) + (L.shortLand ? bannerW : 0)) / pfW),
    right: Math.min(0.5, (L.shortLand && !left ? sideW : 0) / pfW),
  });
}

// ------------------------------------------------------------------ screens
/** A screen (the browser's `.screen` over the window, under the top bar) with its panel centred, scrolling when taller than the room. */
function screen(key: string, L: Layout, maxW: number, build: (inner: number) => void, opts: { bg?: boolean; center?: boolean } = {}): void {
  const pad = L.narrow ? 12 : 16;
  const avail = Math.max(80, L.lh - topH - 8 - pad);
  const width = Math.max(200, Math.min(maxW, L.lw - pad * 2));
  const compact = L.portrait;
  const padX = compact ? 17.6 : 25.6;
  const inner = width - padX * 2;
  const h = lastHeight.get(key) ?? 0;
  ui.place(`scr-${key}`, { anchor: "top-start", x: 0, y: 0 }, () => {
    ui.column(`scr-${key}-pad`, () => {
      const body = (): void => {
        const r = ui.column(`${key}-panel`, () => build(inner), { style: compact ? ["panel", "panel-compact"] : "panel", width, spacing: 12, align: opts.center ? "center" : "start" });
        lastHeight.set(key, r.height / L.sc);
      };
      if (h > avail) ui.scrollArea(`${key}-scroll`, { width: Math.min(L.lw - 8, width + 16), height: avail }, () => {
        ui.column(`${key}-scroll-col`, body, { width: Math.min(L.lw - 8, width + 16) - 16, align: "center" });
      });
      else ui.column(`${key}-center`, body, { height: avail, width: L.lw, justify: "center", align: "center" });
    }, { padding: { top: topH + 8 }, width: L.lw, align: "center" });
  }, { style: opts.bg === false ? undefined : "screen", width: L.lw, height: L.lh });
}
const back = (): void => showScreen("title");
function h2(text: string, id: string): void { ui.style("panel-h2").id(id).heading(text); }

function titleScreen(L: Layout): void {
  screen("title", L, 30 * REM, (w) => {
    ui.style("title-big", L.narrow || L.shortLand ? "title-big-compact" : null).id("title-heading").heading("Blade Orbit");
    para(t("tagline"), w, "tagline", "tagline", true);
    const list: Btn[] = [{ id: "btn-play", text: t("btn.play"), style: ["btn", "btn-primary", "btn-big"], act: () => openModes() }];
    if (hasResumableSnapshot()) list.push({ id: "btn-resume", text: t("btn.resume"), act: resumeSnapshot });
    list.push(
      { id: "btn-daily", text: t("btn.daily"), act: openDaily },
      { id: "btn-leaderboard", text: t("btn.leaderboard"), act: openLeaderboard },
      { id: "btn-journey", text: t("btn.journey"), act: () => showScreen("journey") },
      { id: "btn-tutorial", text: t("btn.tutorial"), act: () => openModes("tutorial") },
      { id: "btn-title-settings", text: t("btn.settings"), act: () => showOverlay("settings") },
    );
    const link = platform.inviteLink();
    if (link) {
      list.push({
        id: "btn-invite", text: t("acct.invite"),
        act: () => { try { clipboard.writeText(link); toast(t("acct.inviteCopied")); } catch { toast(`${t("acct.inviteFailed")} ${link}`); } },
      });
    }
    if (!platform.signedIn()) list.push({ id: "btn-sign-in", text: t("acct.signIn"), act: () => { void requestSignIn().catch(() => undefined); } });
    ui.column("menu-stack", () => { for (const b of list) button(b, w); }, { spacing: 9.6, width: w });
    const done = Object.keys(progression.journeyStars).length;
    para(t("title.progress", { done, xp: progression.masteryXp, n: progression.sessionsPlayed }), w, "title-progress", "title-progress", true);
    if (app.signedOut) para(t("acct.signedOut"), w, "title-progress", "title-signed-out", true);
  }, { center: true, bg: false });
}

function cardGrid(label: string, inner: number, cards: { id: string; title: string; body: string; meta?: string; done?: boolean; act?: () => void }[]): void {
  const min = Math.min(15 * REM, inner);
  const gap = 12.8;
  const cols = Math.max(1, Math.floor((inner + gap) / (min + gap)));
  const cw = (inner - gap * (cols - 1)) / cols;
  ui.column(label, () => {
    for (let i = 0; i < cards.length; i += cols) {
      ui.row(`${label}-r${i}`, () => {
        for (const c of cards.slice(i, i + cols)) {
          const ci = cw - 32 - 2;
          const face = (): void => {
            ui.column(`${c.id}-face`, () => {
              ui.style("card-h3").label(c.title);
              ui.style("card-p").paragraph(c.body, ci);
              if (c.meta) {
                ui.row(`${c.id}-meta`, () => {
                  ui.style("card-meta").label(c.meta!.replace(/\s*✓$/, "").toUpperCase());
                  if (c.done) glyph("check", 12, "#c9b49a");
                }, { spacing: 4, align: "center" });
              }
            }, { spacing: 4.8, width: ci });
          };
          if (c.act) { if (ui.style("card", { width: cw }).id(c.id).button(c.title, { content: face })) c.act(); }
          else ui.column(c.id, face, { style: "card", width: cw });
        }
      }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, width: inner });
}

function modesScreen(L: Layout): void {
  const cards = modeCards();
  screen("modes", L, 52 * REM, (w) => {
    h2(t("modes.title"), "modes-heading");
    cardGrid("mode-list", w, cards.map((m) => ({ id: `mode-${m.id}`, title: m.name, body: m.description, meta: m.meta, done: m.done, act: () => pickMode(m.id) })));
    footer("modes-footer", [{ id: "btn-modes-back", text: t("btn.back"), style: ["btn", "btn-ghost"], act: back }], w);
  });
}

function journeyScreen(L: Layout): void {
  screen("journey", L, 52 * REM, (w) => {
    h2(t("journey.title"), "journey-heading");
    para(t("journey.sub"), w, "panel-sub", "journey-sub");
    const gap = 8;
    const min = 4.6 * REM;
    const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
    const cell = (w - gap * (cols - 1)) / cols;
    ui.column("journey-grid", () => {
      for (let i = 0; i < JOURNEY.length; i += cols) {
        ui.row(`jrow-${i}`, () => {
          JOURNEY.slice(i, i + cols).forEach((stage, k) => {
            const n = i + k + 1;
            const unlocked = n <= progression.journeyUnlocked;
            const stars = progression.journeyStars[stage.id] || 0;
            const mastery = !!(stage as Content).mastery;
            const label = unlocked
              ? t("jcell.aria", { n, name: contentName(stage as Content) }) + (stars ? t("jcell.stars", { s: stars }) : "")
              : t("jcell.locked", { n });
            const clicked = ui.style("journey-cell", mastery ? "journey-mastery" : null, { width: cell, height: cell }).id(`jcell-${n}`).button(label, {
              disabled: !unlocked,
              content: () => {
                ui.column(`jcell-${n}-face`, () => {
                  ui.label(String(n), { weight: "700" });
                  ui.row(`jcell-${n}-stars`, () => {
                    if (stars) for (let s = 0; s < stars; s++) glyph("star", 11, STAR);
                    else if (mastery) glyph("diamond", 11, STAR);
                    else ui.widget("", { role: "none", size: { width: 1, height: 11 } });
                  }, { spacing: 1, align: "center" });
                }, { align: "center", spacing: 2 });
              },
            });
            if (clicked && unlocked) pickJourney(stage.id);
          });
        }, { spacing: gap });
      }
    }, { spacing: gap, width: w });
    footer("journey-footer", [{ id: "btn-journey-back", text: t("btn.back"), style: ["btn", "btn-ghost"], act: back }], w);
  });
}

function setupScreen(L: Layout): void {
  const p = app.pending;
  if (!p) { showScreen("title"); return; }
  const c = p.content;
  screen("setup", L, 30 * REM, (w) => {
    h2(t("setup.title"), "setup-heading");
    ui.style("panel-h3").id("setup-name").label(contentName(c));
    para(describeMechanics(c), w, "panel-sub", "setup-mech");
    const blades = (c.preplaced || []).filter((x) => x.type === "blade").length;
    const markers = (c.preplaced || []).filter((x) => x.type === "marker").length;
    const rows: [string, string][] = [
      [t("setup.goal"), t("setup.goalV", { n: c.goal })],
      [t("setup.misses"), c.missesAllowed === 0 ? t("setup.noMisses") : String(c.missesAllowed)],
      [t("setup.hazards"), [blades && t(blades > 1 ? "setup.bladesN" : "setup.blades1", { n: blades }), markers && t(markers > 1 ? "setup.sigilsN" : "setup.sigils1", { n: markers })].filter(Boolean).join(", ") || t("setup.none")],
      [t("setup.par"), t("setup.parV", { n: c.par.score })],
      [t("setup.duration"), setupDuration(c)],
      [t("setup.players"), t("setup.playersV")],
    ];
    const dtW = Math.min(w * 0.45, Math.max(...rows.map(([k]) => textWidth(k, "setup-dt")), textWidth(t("setup.result"), "setup-dt")));
    const ddW = w - dtW - 16;
    ui.grid("setup-dl", () => {
      for (const [k, v] of rows) {
        para(k, dtW, "setup-dt");
        para(v, ddW, "setup-dd");
      }
      para(t("setup.result"), dtW, "setup-dt");
      ui.row("setup-flag-row", () => { ui.style(p.ranked ? "flag-ranked" : "flag-casual").id("setup-flag").label(p.ranked ? t("setup.ranked") : t("setup.casual")); });
    }, { columns: [{ width: dtW }, { fr: 1 }], gap: { row: 4.8, column: 16 }, width: w });
    footer("setup-footer", [
      { id: "btn-setup-back", text: t("btn.back"), style: ["btn", "btn-ghost"], act: back },
      { id: "btn-setup-start", text: t("btn.begin"), style: ["btn", "btn-primary"], act: () => startSession(c) },
    ], w);
  });
}

function leaderboardScreen(L: Layout): void {
  const v = app.lbView;
  screen("leaderboard", L, 30 * REM, (w) => {
    h2(t("lb.title"), "leaderboard-heading");
    if (v?.note) para(t(v.note), w, "panel-sub", "lb-note");
    if (v?.entries && v.entries.length) {
      const rankW = 52, scoreW = 80;
      ui.grid("lb-table", () => {
        for (const e of v.entries!) {
          const cls = e.mine ? "mine" : "cell";
          ui.style(cls).label(e.rank != null ? "#" + e.rank : "—");
          para(e.name, w - rankW - scoreW - 16, cls);
          ui.style(e.mine ? "mine" : "cell-num").label(String(e.score));
        }
      }, { columns: [{ width: rankW }, { fr: 1 }, { width: "auto", align: "end" }], gap: { row: 0, column: 8 }, width: w, rowStyle: "score-row" });
    }
    footer("lb-footer", [{ id: "btn-leaderboard-back", text: t("btn.back"), style: ["btn", "btn-ghost"], act: back }], w);
  });
}

function resultsScreen(L: Layout): void {
  const res = app.results;
  if (!res) { showScreen("title"); return; }
  const r = res.report;
  screen("results", L, 30 * REM, (w) => {
    h2(t("results.title"), "results-heading");
    para(r.won ? t("r.won") : headlineForReason(r.reason), w, r.won ? "results-won" : "results-lost", "results-headline");
    const rows: [string, string, number][] = [
      [t("r.embedded"), `${r.embedded} × 100`, r.components.hits],
      [t("r.precision"), "", r.components.precision],
      [t("r.combo"), t("r.bestCombo", { n: r.bestCombo }), r.components.combo],
      [t("r.timeBonus"), r.par.ticks ? t("r.par", { n: Math.round(r.par.ticks / SIM_FPS) }) : "", r.components.timeBonus],
      [t("r.missPen"), t(r.misses === 1 ? "r.miss1" : "r.missN", { n: r.misses }), r.components.missPenalty],
    ];
    const numW = 72;
    ui.grid("results-table", () => {
      for (const [label, note, value] of rows) {
        para(note ? `${label} (${note})` : label, w - numW - 8, "cell");
        ui.style("cell-num").label(value > 0 ? `+${value}` : String(value));
      }
      ui.gridRow("score-total").style("cell-total").label(t("r.total"));
      ui.style("cell-total-num").id("results-total").label(String(r.total));
    }, { columns: [{ fr: 1 }, { width: "auto", align: "end" }], gap: 0, width: w, rowStyle: "score-row" });
    para(t("r.stats", { t: (r.ticks / SIM_FPS).toFixed(1), n: r.embedded + r.misses }) + (r.invalid ? t("r.invalid", { n: r.invalid }) : ""), w, "results-dim", "results-stats");
    if (res.achievements.length) {
      // chips in rows that wrap
      const chips = res.achievements.map((k) => achievementName(k));
      const rowsC: string[][] = [[]];
      let used = 0;
      for (const c of chips) {
        const cwid = textWidth(c, "achievement-chip") + 26 + 18;
        if (rowsC[rowsC.length - 1]!.length && used + 6.4 + cwid > w) { rowsC.push([]); used = 0; }
        used += cwid + 6.4;
        rowsC[rowsC.length - 1]!.push(c);
      }
      ui.column("results-achievements", () => {
        rowsC.forEach((row, ri) => ui.row(`ach-r${ri}`, () => {
          row.forEach((c, ci) => ui.row(`ach-${ri}-${ci}`, () => { glyph("medal", 14, STAR); ui.label(c); }, { style: "achievement-chip", spacing: 4, align: "center" }));
        }, { spacing: 6.4 }));
      }, { spacing: 6.4 });
    }
    const best = res.isBest ? t("r.newBest") : res.best ? t("r.best", { n: res.best.total }) : "";
    para(best, w, "results-dim", "results-best");
    if (res.lb) {
      const lb = res.lb;
      para(lb.pending ? t("acct.lbPosting") : !lb.posted ? t("acct.lbNotPosted") : lb.rank ? t("acct.lbRank", { rank: lb.rank }) : t("acct.lbPosted"), w, "results-dim", "results-lb");
    }
    const list: Btn[] = [
      { id: "btn-results-menu", text: t("btn.menu"), style: ["btn", "btn-ghost"], act: leaveToTitle },
      { id: "btn-results-retry", text: t("btn.retry"), act: restart },
    ];
    if (r.won && res.nextStage) list.push({ id: "btn-results-next", text: t("btn.next"), style: ["btn", "btn-primary"], act: nextStage });
    footer("results-footer", list, w);
  });
}

function pauseScreen(L: Layout): void {
  screen("pause", L, 30 * REM, (w) => {
    h2(t("pause.title"), "pause-heading");
    ui.column("pause-stack", () => {
      button({ id: "btn-resume-play", text: t("btn.resumePlay"), style: ["btn", "btn-primary"], act: resume }, w);
      button({ id: "btn-pause-settings", text: t("btn.settings"), act: () => showOverlay("settings") }, w);
      button({ id: "btn-pause-help", text: t("btn.help"), act: () => showOverlay("help") }, w);
      button({ id: "btn-pause-restart", text: t("btn.restart"), act: restart }, w);
      button({ id: "btn-leave", text: t("btn.leave"), style: ["btn", "btn-danger"], act: leaveToTitle }, w);
    }, { spacing: 9.6, width: w });
  });
}

/** An action's keys as the Help list shows them (SPACE / ENTER / NUM ENTER, P, ESC…), localized. */
function keyName(action: string): string {
  const names: Record<string, string> = { Space: "SPACE", Enter: "ENTER", "Numpad Enter": "NUM ENTER", Escape: "ESC" };
  const keys = bindings(action).filter((b) => b.device === "keyboard").map((b) => names[b.label] ?? b.label.toUpperCase());
  return keys.map((x) => t("key." + x, null, x)).join(" / ") || "—";
}
/** An action's first gamepad button, by the face letters the browser build named (A throw · B back). */
function padName(action: string): string {
  const pad: Record<string, string> = { South: "A", East: "B", West: "X", North: "Y" };
  const b = bindings(action).find((x) => x.device === "gamepad");
  return b ? pad[b.code] ?? b.label : "—";
}

function helpScreen(L: Layout): void {
  screen("help", L, 52 * REM, (w) => {
    h2(t("help.title"), "help-heading");
    const cards = ["wheel", "gaps", "steel", "sigils", "precision", "clear"].map((k) => ({ id: `help-${k}`, title: t(`h.${k}`), body: t(`h.${k}.b`) }));
    cardGrid("help-cards", w, cards);
    ui.style("panel-h3").id("help-controls-h").heading(t("help.controls"));
    const controls: [string, string][] = [
      [keyName("throw") + t("ctl.tap"), t("ctl.throw")],
      [keyName("pause") + t("ctl.esc"), t("ctl.pause")],
      [keyName("undo"), t("ctl.undo")],
      [keyName("hint"), t("ctl.hint")],
      [keyName("restart"), t("ctl.restart")],
      ["TAB / SHIFT+TAB", t("ctl.nav")],
    ];
    ui.column("help-controls", () => {
      controls.forEach(([key, desc], i) => {
        const kw = Math.min(w * 0.55, textWidth(key, "kbd") + 18);
        ui.row(`ctl-${i}`, () => {
          if (textWidth(key, "kbd") + 18 <= kw) ui.style("kbd").label(key);
          else ui.style("kbd").paragraph(key, kw - 18);
          para(desc, w - kw - 10, null);
        }, { style: "controls-row", spacing: 10, align: "center" });
      });
      para(t("ctl.gamepad", { throw: padName("throw"), pause: padName("pause"), back: padName("back") }), w, null, "ctl-gamepad");
    }, { spacing: 6, width: w });
    footer("help-footer", [{ id: "btn-help-back", text: t("btn.back"), style: ["btn", "btn-ghost"], act: closeOverlay }], w);
  });
}

function settingsScreen(L: Layout): void {
  screen("settings", L, 52 * REM, (w) => {
    h2(t("set.title"), "settings-heading");
    const gap = 16;
    const cols = w >= 2 * 16 * REM + gap ? 2 : 1;
    const fw = (w - gap * (cols - 1)) / cols;
    const fi = fw - 34;
    const check = (key: string, label: string): void => {
      const cur = !!settings[key];
      const next = ui.id(`set-${key}`).checkbox(label, cur);
      if (next !== cur) platform.setSetting(key, next);
    };
    const fieldset = (id: string, legend: string, build: () => void): void => {
      ui.column(id, () => { ui.style("legend").label(legend); build(); }, { style: "fieldset", width: fw, spacing: 8 });
    };
    const sets: (() => void)[] = [
      () => fieldset("fs-audio", t("set.audio"), () => { check("captions", t("set.captions")); }),
      () => fieldset("fs-access", t("set.access"), () => {
        para(t("set.palette"), fi, null);
        const names = [t("pal.default"), t("pal.deut"), t("pal.prot"), t("pal.trit"), t("pal.mono")];
        const idx = Math.max(0, PALETTES.indexOf(String(settings.palette)));
        const next = ui.id("set-palette").select(t("set.palette"), idx, names);
        if (next !== idx) platform.setSetting("palette", PALETTES[next]!);
      }),
      () => fieldset("fs-controls", t("set.controls"), () => {
        check("leftHanded", t("set.left"));
        check("holdToAim", t("set.hold"));
        check("timingAssist", t("set.assist"));
        check("haptics", t("set.haptics"));
      }),
      () => fieldset("fs-data", t("set.data"), () => {
        if (app.confirmReset) {
          para(t("confirm.reset"), fi, null, "confirm-text");
          flow("confirm-row", [
            { id: "btn-reset-yes", text: t("btn.erase"), style: ["btn", "btn-small", "btn-danger"], act: resetProgress },
            { id: "btn-reset-no", text: t("btn.cancel"), style: ["btn", "btn-small"], act: () => { app.confirmReset = false; } },
          ], fi);
        } else {
          flow("data-row", [
            { id: "btn-replay-tutorials", text: t("btn.replayTut"), style: ["btn", "btn-small"], act: replayTutorials },
            { id: "btn-reset-progress", text: t("btn.reset"), style: ["btn", "btn-small", "btn-danger"], act: () => { app.confirmReset = true; } },
          ], fi);
        }
        para(t("set.dataNote"), fi, "fine-print", "data-note");
      }),
    ];
    ui.column("settings-body", () => {
      for (let i = 0; i < sets.length; i += cols) ui.row(`set-row-${i}`, () => { for (const f of sets.slice(i, i + cols)) f(); }, { spacing: gap, align: "stretch" });
    }, { spacing: gap, width: w });
    // Sound, graphics, language, key bindings, text size, contrast and reduced motion are the runtime's Options.
    button({ id: "btn-options", text: t("set.options"), act: () => openMenu() }, Math.min(w, buttonWidth(t("set.options"), PLAIN)));
    footer("settings-footer", [{ id: "btn-settings-back", text: t("btn.back"), style: ["btn", "btn-ghost"], act: closeOverlay }], w);
  });
}

