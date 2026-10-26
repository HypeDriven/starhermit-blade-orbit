/**
 * Blade Orbit — the engine client's save document and what the browser build
 * (starhermit-sdk.js) left in the player's account (pure: no storage).
 *  - The engine save (starhermit:storage `saves`) is the browser build's cloud
 *    document unchanged: { v: 1, progression, scores, achievements }
 *    (store.exportCloud in js/session.js), merged across devices by
 *    mergeCloudDocs (furthest unlock, most stars, best score per stage, every
 *    lesson and achievement with its earliest unlock).
 *  - The browser build's cloud save (slot game:<slug>) holds the SDK's zipped
 *    save.json: that same document as JSON. The engine shows it as a foreign
 *    save; docFromBrowserSave reads its text, it is merged with this device's
 *    progress and replaces the slot once.
 *  - The per-player settings keys (the SDK's PATCH of the settings object):
 *    the game's own options (captions, colour palette, left-handed layout,
 *    the reticles, haptics) carry over as game settings; volumes, graphics,
 *    reduced motion, contrast, text size and the language are the runtime's
 *    Options now and are dropped.
 */

import { mergeCloudDocs } from './session.js';

const bool = (v) => typeof v === 'boolean';
export const PALETTES = ['default', 'deuteranopia', 'protanopia', 'tritanopia', 'mono'];

/** Settings the game still owns (game.<key> in the runtime's settings), with their checks. */
const GAME_SETTINGS = {
  captions: bool,
  palette: (v) => PALETTES.includes(v),
  leftHanded: bool,
  holdToAim: bool,
  timingAssist: bool,
  haptics: bool,
};
export const GAME_SETTING_KEYS = Object.keys(GAME_SETTINGS);
export const DEFAULT_SETTINGS = { captions: true, palette: 'default', leftHanded: false, holdToAim: false, timingAssist: false, haptics: true };
/** Every key the browser build kept in the account's per-player settings. */
export const BROWSER_SETTING_KEYS = ['music', 'effects', 'ambience', 'voice', 'quality', 'graphics', 'reducedMotion',
  'highContrast', 'palette', 'textScale', 'leftHanded', 'holdToAim', 'timingAssist', 'haptics', 'captions', 'camera', 'ui.language'];

function isDoc(doc) {
  return !!(doc && typeof doc === 'object' && !Array.isArray(doc) && doc.v === 1);
}

/** The progress document in an engine save, or null. */
export function docFromSave(data) {
  return isDoc(data) ? normalize(data) : null;
}

/** The progress document in the browser build's cloud save text, or null. */
export function docFromBrowserSave(text) {
  if (typeof text !== 'string') return null;
  try { return docFromSave(JSON.parse(text)); } catch { return null; }
}

/** A document with every part present (objects where the browser build may have left null). */
export function normalize(doc) {
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { v: 1, progression: obj(doc.progression), scores: obj(doc.scores), achievements: obj(doc.achievements) };
}

/** Two documents merged (either may be null), keeping the better value of every field. */
export function mergeDocs(remote, local) {
  if (!remote && !local) return normalize({ v: 1 });
  if (!remote) return normalize(local);
  if (!local) return normalize(remote);
  return normalize(mergeCloudDocs(local, remote));
}

/** A browser-build setting's value as the engine client keeps it, or undefined (dropped). */
export function migrateSetting(key, value) {
  const check = GAME_SETTINGS[key];
  return check && check(value) ? value : undefined;
}
