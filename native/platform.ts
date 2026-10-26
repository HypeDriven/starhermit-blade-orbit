// The game's data and the StarHermit platform, on the runtime's modules:
// - progress (journey unlocks and stars, best score per stage, lessons,
//   dailies, lifetime counters, achievements) is the game's save
//   (starhermit:storage `saves`): the browser build's cloud document
//   { v: 1, progression, scores, achievements } unchanged, on the device and
//   in the player's cloud slot, two devices' copies merged on a conflict
//   (js/migrate.js mergeDocs → js/session.js mergeCloudDocs). The slot the
//   browser build wrote (the JS SDK's zipped save.json, the same document)
//   shows as foreign and is merged in and replaced once;
// - js/session.js's `store` keeps reading and writing `localStorage`: here a
//   shim whose cloud keys are that document (a write saves it) and whose
//   other keys (the paused-round snapshot, replay envelopes) are the
//   device's starhermit:storage, as the browser build kept them;
// - the game's own settings (captions, colour palette, left-handed layout,
//   the two reticles, haptics) are `settings` (game.<key>, synced with the
//   account); the browser build's settings keys are migrated and removed;
// - the player chip (name and avatar), the invite link, the leaderboard
//   screen's rows and posting a finished run's total to the high-score board
//   through score-script.js (a practice session whose socket carries
//   { type: 'result', scores }, as the JS SDK's submitScores did).
import type { JsonValue } from "starhermit:engine";
import { OffscreenCanvas } from "starhermit:canvas";
import { avatar, connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, profile, sessions, type Leaderboard } from "starhermit:platform";
import { saves, settings as store, storage } from "starhermit:storage";
import * as M from "../js/migrate.js";

type Doc = { v: number; progression: Record<string, unknown>; scores: Record<string, unknown>; achievements: Record<string, unknown> };
type Part = "progression" | "scores" | "achievements";

// --- progress and the localStorage shim ---------------------------------------------
const PREFIX = "blade-orbit:";
const CLOUD: Record<string, Part> = { "blade-orbit:progression": "progression", "blade-orbit:scores": "scores", "blade-orbit:achievements": "achievements" };
const REPLAY = "blade-orbit:replay:";
const REPLAY_INDEX = "blade-orbit:replays";
/** Replay envelopes kept on the device (the browser build kept every one; the device store has a key limit). */
const REPLAY_MAX = 40;

let doc: Doc = M.normalize({ v: 1 }) as Doc;
let lastSavedAt = 0;
const listeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { listeners.add(fn); }
function merged(): void { for (const fn of listeners) fn(); }

function persist(): void {
  try { saves.save(doc as unknown as JsonValue, { schema: 1 }); }
  catch (e) { console.warn(`save: ${String(e)}`); }
}
function replayIndex(): string[] {
  try { const v = JSON.parse(storage.getText(REPLAY_INDEX) ?? "[]"); return Array.isArray(v) ? v.filter((k) => typeof k === "string") : []; }
  catch { return []; }
}
const shim = {
  getItem(key: string): string | null {
    const part = CLOUD[key];
    if (part) return JSON.stringify(doc[part]);
    try { return storage.getText(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    const part = CLOUD[key];
    if (part) {
      try { doc[part] = JSON.parse(value) ?? {}; } catch { return; }
      persist();
      return;
    }
    try {
      storage.set(key, String(value));
      if (key.startsWith(REPLAY)) {
        const idx = replayIndex().filter((k) => k !== key);
        idx.push(key);
        while (idx.length > REPLAY_MAX) storage.remove(idx.shift()!);
        storage.set(REPLAY_INDEX, JSON.stringify(idx));
      }
    } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
  },
  removeItem(key: string): void {
    const part = CLOUD[key];
    if (part) { doc[part] = {}; persist(); return; }
    try { storage.remove(key); } catch { /* gone */ }
  },
  /** Reset all progress: the document emptied and saved, the device's keys removed. */
  clear(): void {
    doc = M.normalize({ v: 1 }) as Doc;
    persist();
    try { for (const k of storage.keys()) if (k.startsWith(PREFIX)) storage.remove(k); } catch { /* best effort */ }
  },
};
(globalThis as unknown as { localStorage: typeof shim }).localStorage = shim;
/** Settings → Reset all progress (the browser build's localStorage.clear()). */
export function resetAll(): void { shim.clear(); }

/** Takes a document in (merged with what this device has); whether it changed. */
function adopt(other: Doc | null): boolean {
  if (!other) return false;
  const before = JSON.stringify(doc);
  const next = M.mergeDocs(other, doc) as Doc;
  if (JSON.stringify(next) === before) return false;
  doc = next;
  return true;
}

saves.onConflict((local, remote) => ({
  merged: M.mergeDocs(M.docFromSave(remote.data), M.docFromSave(local?.data)) as unknown as JsonValue,
}));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(M.docFromSave(cur.data) as Doc | null)) { persist(); merged(); }
  }
});

/** The browser build's cloud save: merged with this device's progress, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const changed = adopt(M.docFromBrowserSave(old.text) as Doc | null);
  try { saves.save(doc as unknown as JsonValue, { schema: 1, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
  if (changed) merged();
}

/** For the title's account line: offline (a guest) | saving | synced | error. */
export function syncState(): "offline" | "saving" | "synced" | "error" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "uploading" || st === "foreign" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the game's settings -----------------------------------------------------------------
export interface Settings { captions: boolean; palette: string; leftHanded: boolean; holdToAim: boolean; timingAssist: boolean; haptics: boolean; [key: string]: unknown }
export const settings: Settings = { ...M.DEFAULT_SETTINGS };
const settingsListeners = new Set<() => void>();
export function onSettingsChange(fn: () => void): void { settingsListeners.add(fn); }
function settingsChanged(): void { for (const fn of settingsListeners) fn(); }
function readSetting(key: string): void {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return; }
  const ok = M.migrateSetting(key, v);
  if (ok !== undefined) settings[key] = ok;
}
function initSettings(): void {
  for (const k of M.GAME_SETTING_KEYS) readSetting(k);
  store.onChange((key) => {
    if (!M.GAME_SETTING_KEYS.includes(key)) return;
    readSetting(key);
    settingsChanged();
  });
  store.onLegacy(importLegacy);
  importLegacy();
  settingsChanged();
}
/** Changes one of the game's settings (device and account). */
export function setSetting(key: string, value: boolean | string): void {
  settings[key] = value;
  try { store.set(key, value); } catch (e) { console.warn(`setting ${key}: ${String(e)}`); }
  settingsChanged();
}
// The browser build's per-player settings: kept where the game still has the
// setting (unless this game set it since), then removed from the account.
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  let changed = false;
  for (const key of keys) {
    if (!M.BROWSER_SETTING_KEYS.includes(key)) continue;
    const v = M.migrateSetting(key, store.legacy(key));
    if (v !== undefined && store.get(key) === undefined) {
      try { store.set(key, v as JsonValue); settings[key] = v; changed = true; } catch { /* keep the device's */ }
    }
    store.removeLegacy(key);
  }
  if (changed) settingsChanged();
}

/** Reads the device's save and the game's settings (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  const d = M.docFromSave(cur?.data) as Doc | null;
  if (d) doc = d;
  else if (!cur) persist();
  if (saves.state() === "foreign") migrateForeign();
  initSettings();
  refreshPlayer();
}

// --- the player -----------------------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function userId(): string | null { return player()?.userId ?? null; }
export function displayName(): string | null { return player()?.displayName ?? null; }
let avatarImage: OffscreenCanvas | null = null;
/** The player's avatar cut to a circle (48 px), or null. */
export function avatarCanvas(): OffscreenCanvas | null { return avatarImage; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  avatarImage = null;
  board = null;
  const me = player();
  if (!me) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
  avatar(me.userId).then((bmp) => {
    if (!bmp || player()?.userId !== me.userId) return;
    const c = new OffscreenCanvas(48, 48);
    const g = c.getContext("2d");
    g.beginPath();
    g.arc(24, 24, 24, 0, Math.PI * 2);
    g.clip();
    g.drawImage(bmp, 0, 0, 48, 48);
    bmp.close();
    avatarImage = c;
  }, () => { /* no avatar */ });
}
onPlayerChange(() => refreshPlayer());

// --- the StarHermit leaderboards -------------------------------------------------------------
let board: Leaderboard | null = null;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface BoardRow { rank: number | null; name: string; score: number; mine: boolean }
/** The leaderboard screen's rows (the first 20, names from the players' profiles); ok false when there is no board. */
export async function fetchLeaderboard(): Promise<{ ok: boolean; entries: BoardRow[] }> {
  const me = player();
  if (!me) return { ok: false, entries: [] };
  try {
    const b = await highScoreBoard();
    if (!b) return { ok: false, entries: [] };
    const page = await leaderboards.entries(b.id, { pageSize: 20 });
    const entries = await Promise.all(page.items.map(async (e) => {
      let name = e.username || "Player " + e.userId.slice(0, 8);
      if (e.userId === me.userId) name = me.displayName;
      else { try { name = (await profile(e.userId)).displayName; } catch { /* the username */ } }
      return { rank: e.rank ?? null, name, score: Math.floor(Number(e.score) || 0), mine: e.userId === me.userId };
    }));
    return { ok: true, entries };
  } catch { return { ok: false, entries: [] }; }
}

/** Signed in only: post a finished run's total through score-script.js; { posted, rank }. Never rejects. */
export async function postLeaderboard(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
