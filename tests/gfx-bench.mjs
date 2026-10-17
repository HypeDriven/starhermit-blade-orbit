// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts Practice — Easy from the visible menus and keeps throwing blades with the Throw button at the
// hinted moment (spinning target, blades sticking, sparks), retrying from the results screen.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForFunction(() => window.__game?.phase === 'title', null, { timeout: 15000 });
  await page.click('#btn-title-settings');
  await page.waitForSelector('#screen-settings:not([hidden])');
  await page.selectOption('#set-quality', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#btn-settings-back');
  await page.waitForSelector('#screen-title:not([hidden])');
}

export async function start(page, { mobile }) {
  const tap = (sel) => (mobile ? page.tap(sel) : page.click(sel));
  await tap('#btn-play');
  await page.locator('.card', { hasText: 'Practice' }).first().click();
  await page.locator('.card', { hasText: 'Practice — Easy' }).click();
  await tap('#btn-setup-start');
  await page.waitForFunction(() => window.__game.phase === 'active', null, { timeout: 8000 });
  let stopped = false;
  page.once('close', () => { stopped = true; });
  (async () => {
    while (!stopped) {
      try {
        const st = await page.evaluate(() => {
          const g = window.__game;
          if (!document.getElementById('screen-results').hidden) return { results: true };
          if (g.phase !== 'active' || !g.session) return null;
          const h = g.session.hint();
          return { wait: h ? h.ticksAway : 0 };
        });
        if (st?.results) { await tap('#btn-results-retry'); await tap('#btn-setup-start'); }
        else if (st) {
          if (st.wait > 1) await new Promise((r) => setTimeout(r, Math.min(1500, (st.wait / 60) * 1000)));
          await tap('#btn-throw');
        }
      } catch { /* screen changing */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  await page.waitForTimeout(500);
}
