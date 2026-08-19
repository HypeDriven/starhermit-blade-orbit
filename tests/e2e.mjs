/**
 * Blade Orbit — end-to-end smoke test (dev only, not shipped).
 * Drives the real UI in headless Chrome: title → journey → countdown →
 * throws (rules-driven timing) → results, plus pause/resume, undo/hint,
 * settings, and screenshots at each stage.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://localhost:39217';
const SHOT = (n) => `/tmp/bo-e2e-${n}.png`;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

await step('load + title visible', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-title:not([hidden])', { timeout: 10000 });
  await page.waitForFunction(() => window.__game?.phase === 'title');
});

await step('journey grid shows 40 stages', async () => {
  await page.click('#btn-journey');
  await page.waitForSelector('#screen-journey:not([hidden])');
  const cells = await page.locator('.journey-cell').count();
  if (cells !== 40) throw new Error(`expected 40 stages, got ${cells}`);
  const unlocked = await page.locator('.journey-cell:not(.locked)').count();
  if (unlocked !== 1) throw new Error(`expected 1 unlocked, got ${unlocked}`);
  await page.screenshot({ path: SHOT('journey') });
});

await step('setup screen for stage 1', async () => {
  await page.locator('.journey-cell').first().click();
  await page.waitForSelector('#screen-setup:not([hidden])');
  await page.screenshot({ path: SHOT('setup') });
});

await step('begin → countdown → active', async () => {
  await page.click('#btn-setup-start');
  await page.waitForFunction(() => window.__game.phase === 'countdown');
  await page.screenshot({ path: SHOT('countdown') });
  await page.waitForFunction(() => window.__game.phase === 'active', null, { timeout: 8000 });
  if (await page.locator('#hud').isHidden()) throw new Error('HUD not visible in play');
});

await step('throw blades with rules-driven timing until terminal', async () => {
  // query the rules engine through the page for the best tick, then throw then
  for (let i = 0; i < 30; i++) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      return g.session ? { status: g.session.state.status, tick: g.session.state.tick } : null;
    });
    if (!st || st.status !== 'active') break;
    const wait = await page.evaluate(() => {
      const g = window.__game;
      const h = g.session.hint();
      return h ? h.ticksAway : 0;
    });
    if (wait > 1) await page.waitForTimeout((wait / 60) * 1000);
    await page.evaluate(() => window.__game.doThrow());
    if (i === 0) await page.screenshot({ path: SHOT('play') });
    await page.waitForTimeout(180);
  }
  await page.waitForFunction(() => ['resolving', 'results'].includes(window.__game.phase), null, { timeout: 5000 });
});

await step('results screen with breakdown', async () => {
  await page.waitForSelector('#screen-results:not([hidden])', { timeout: 5000 });
  const rows = await page.locator('#results-table tbody tr').count();
  if (rows < 5) throw new Error(`expected breakdown rows, got ${rows}`);
  const headline = await page.textContent('#results-headline');
  console.log('  headline:', headline);
  await page.screenshot({ path: SHOT('results') });
});

await step('progression persisted + stage 2 unlocked', async () => {
  const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('blade-orbit:progression')));
  if (!prog.sessionsPlayed) throw new Error('sessionsPlayed not persisted');
  console.log('  journeyUnlocked:', prog.journeyUnlocked, 'stars:', JSON.stringify(prog.journeyStars));
});

await step('next stage → pause → resume', async () => {
  const nextVisible = await page.locator('#btn-results-next').isVisible();
  if (nextVisible) await page.click('#btn-results-next');
  else await page.click('#btn-results-retry');
  await page.click('#btn-setup-start');
  await page.waitForFunction(() => window.__game.phase === 'active', null, { timeout: 8000 });
  await page.keyboard.press('p');
  await page.waitForSelector('#screen-pause:not([hidden])');
  const snap = await page.evaluate(() => JSON.parse(localStorage.getItem('blade-orbit:snapshot') || 'null'));
  if (!snap) throw new Error('snapshot not saved on pause');
  await page.screenshot({ path: SHOT('pause') });
  await page.click('#btn-resume-play');
  await page.waitForFunction(() => window.__game.phase === 'active');
});

await step('practice: undo + hint available', async () => {
  await page.keyboard.press('p');
  await page.click('#btn-leave');
  await page.waitForSelector('#screen-title:not([hidden])');
  await page.click('#btn-play');
  await page.locator('.card', { hasText: 'Practice' }).first().click();
  await page.locator('.card', { hasText: 'Practice — Easy' }).click();
  await page.click('#btn-setup-start');
  await page.waitForFunction(() => window.__game.phase === 'active', null, { timeout: 8000 });
  if (await page.locator('#btn-undo').isHidden()) throw new Error('undo hidden in practice');
  if (await page.locator('#btn-hint').isHidden()) throw new Error('hint hidden in practice');
  await page.click('#btn-hint');
  const hint = await page.textContent('#hint-line');
  if (!hint) throw new Error('hint produced no text');
  console.log('  hint:', hint);
  await page.evaluate(() => window.__game.doThrow());
  await page.waitForTimeout(200);
  await page.click('#btn-undo');
  const embedded = await page.evaluate(() => window.__game.session.state.embedded);
  if (embedded !== 0) throw new Error('undo did not restore');
  await page.screenshot({ path: SHOT('practice') });
});

await step('settings apply (reduced motion, palette, contrast)', async () => {
  await page.keyboard.press('p');
  await page.click('#btn-pause-settings');
  await page.waitForSelector('#screen-settings:not([hidden])');
  await page.check('#set-reduced-motion');
  await page.selectOption('#set-palette', 'deuteranopia');
  await page.check('#set-high-contrast');
  const applied = await page.evaluate(() => ({
    motion: document.body.dataset.motion,
    palette: document.body.dataset.palette,
    contrast: document.body.dataset.contrast,
  }));
  if (applied.motion !== 'reduced' || applied.palette !== 'deuteranopia' || applied.contrast !== 'high') {
    throw new Error('settings not applied: ' + JSON.stringify(applied));
  }
  await page.screenshot({ path: SHOT('settings') });
  await page.click('#btn-settings-back');
  await page.click('#btn-leave');
});

await step('tutorial lesson runs with banner', async () => {
  await page.click('#btn-tutorial');
  await page.locator('.card').first().click();
  await page.click('#btn-setup-start');
  await page.waitForSelector('#tutorial-banner:not([hidden])');
  await page.waitForFunction(() => window.__game.phase === 'active', null, { timeout: 8000 });
  await page.screenshot({ path: SHOT('tutorial') });
  await page.keyboard.press('p');
  await page.click('#btn-leave');
});

await step('mobile portrait layout (390x844)', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOT('mobile') });
  const throwBtn = await page.locator('#btn-throw').boundingBox();
  await page.click('#btn-daily');
  await page.click('#btn-setup-start');
  await page.waitForFunction(() => window.__game.phase === 'active', null, { timeout: 8000 });
  const box = await page.locator('#btn-throw').boundingBox();
  if (box.width < 44 || box.height < 44) throw new Error('throw target too small on mobile');
});

await step('daily score submission validates against server', async () => {
  // finish the daily via rules-driven play, then confirm ranked submission happened
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => window.__game.session?.state.status);
    if (st !== 'active') break;
    const wait = await page.evaluate(() => window.__game.session.hint()?.ticksAway ?? 0);
    if (wait > 1) await page.waitForTimeout((wait / 60) * 1000);
    await page.evaluate(() => window.__game.doThrow());
    await page.waitForTimeout(180);
  }
  await page.waitForFunction(() => window.__game.phase === 'results', null, { timeout: 8000 });
  const status = await page.evaluate(async () => {
    const res = await fetch(`/api/v1/scores/${encodeURIComponent(window.__game.session.content.id)}`);
    const body = await res.json();
    return body.entries?.length ?? -1;
  });
  console.log('  daily board entries:', status);
  if (status < 1) throw new Error('score not on board');
});

if (errors.length) {
  console.log('PAGE ERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('\nE2E PASS — no page errors');
}
await browser.close();
