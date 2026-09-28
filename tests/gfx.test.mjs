/**
 * Blade Orbit — graphics quality model tests (pure; no three.js, no DOM).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, CATEGORIES, detectPreset, resolve, presetTier, choosePreset, normalizePreset, describe,
} from '../js/gfx.js';
import { GFX_STRINGS, pickLocale, gfxText } from '../js/gfx-i18n.js';

test('detectPreset: software renderers get low, discrete GPUs high, others balanced', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2 Pro'), 'high');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon RX 6800 XT)'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 650'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('detectPreset: touch devices are capped at balanced', () => {
  assert.equal(detectPreset('Apple M1', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
});

test('resolve: auto uses the detected preset; explicit preset wins', () => {
  const a = resolve({}, 'low');
  assert.equal(a.preset, 'low');
  assert.equal(a.auto, true);
  assert.equal(a.post, false, 'Low renders without a post chain');
  const h = resolve({ preset: 'high' }, 'low');
  assert.equal(h.preset, 'high');
  assert.equal(h.auto, false);
  assert.equal(h.shadows, presetTier('high', 'shadows'));
  assert.equal(h.post, true);
});

test('resolve: category overrides apply; invalid values fall back to the preset', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'bogus' }, 'high');
  assert.equal(r.bloom, 'on');
  assert.equal(r.shadows, presetTier('low', 'shadows'));
  assert.equal(r.post, true, 'bloom override turns the post chain on');
});

test('resolve: render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).renderScale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).renderScale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  assert.equal(resolve({ preset: 'high' }).adaptive, true);
  assert.equal(resolve({ preset: 'high', adaptive: false, show_fps: true }).showFps, true);
});

test('choosePreset clears category overrides but keeps scale and toggles', () => {
  const saved = { preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.5, adaptive: false };
  const next = choosePreset(saved, 'high');
  assert.equal(next.preset, 'high');
  for (const cat of Object.keys(CATEGORIES)) assert.equal(next[cat], undefined);
  assert.equal(next.render_scale, 1.5);
  assert.equal(next.adaptive, false);
  assert.equal(resolve(next).bloom, presetTier('high', 'bloom'));
});

test('every preset defines every category with an allowed tier', () => {
  for (const p of PRESETS) {
    for (const [cat, tiers] of Object.entries(CATEGORIES)) assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
  }
});

test('normalizePreset maps legacy quality values', () => {
  assert.equal(normalizePreset('medium'), 'balanced');
  assert.equal(normalizePreset('high'), 'high');
  assert.equal(normalizePreset('auto'), 'auto');
  assert.equal(normalizePreset(undefined), 'auto');
});

test('describe summarizes cost and pixels', () => {
  const s = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('graphics strings exist in every locale for every key', () => {
  const keys = Object.keys(GFX_STRINGS['en-US']);
  for (const loc of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    for (const k of keys) assert.ok(GFX_STRINGS[loc]?.[k], `${loc}.${k}`);
  }
  assert.equal(pickLocale(['de']), 'de-DE');
  assert.equal(pickLocale(['es-MX']), 'es-419');
  assert.equal(pickLocale(['es-ES']), 'es-ES');
  assert.equal(pickLocale(['fr-CA']), 'fr-CA');
  assert.equal(pickLocale(['ja-JP']), 'en-US');
  assert.equal(gfxText('en-GB')('grade'), 'Colour grade');
  assert.equal(gfxText('en-US')('auto', { tier: 'Low' }), 'Auto (detected: Low)');
});
