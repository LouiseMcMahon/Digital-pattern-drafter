// End-to-end smoke test of the real page: build, serve, fit a 6'2" woman in a real browser, check the
// page reports every measurement within 0.5 cm (R1) and nothing errors. `npm run build && npm run e2e`.
// Set CHROMIUM_PATH to use a specific browser; otherwise Playwright's managed Chromium
// (`npx playwright-core install chromium`).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

const fail = (msg) => { console.error('E2E FAIL: ' + msg); stop(); process.exit(1); };
mkdirSync('e2e-out', { recursive: true });

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 59) fail('preview server did not start');
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1250 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Ready'), null, { timeout: 60000 });

  await page.selectOption('#fixture', 'tall188Average');
  await page.click('#fit');
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Fitted'), null, { timeout: 300000 });

  // Every filled-in row must show a difference within 0.5 cm (the page marks those 'ok').
  const rows = await page.$$eval('#table tbody tr', (trs) => trs.map((tr) => ({
    name: tr.children[0].textContent,
    target: tr.querySelector('input')?.value,
    got: tr.children[2].textContent,
    diff: tr.children[3].textContent,
    ok: tr.children[3].className === 'ok',
  })));
  const filled = rows.filter((r) => r.target !== '');
  if (filled.length < 34) fail(`expected 34 measurements filled in, found ${filled.length}`);
  const bad = filled.filter((r) => !r.ok);
  if (bad.length) fail('measurements off by more than 0.5 cm: ' + bad.map((r) => `${r.name} target ${r.target} got ${r.got} (${r.diff})`).join('; '));

  // The 3D canvas actually drew a body. The renderer keeps its drawing buffer, so the canvas can be read
  // back; a blank scene is a flat 0xf4f4f4 background and has (almost) no pixels that differ from it.
  await page.evaluate(() => window.setView('front'));
  await page.waitForTimeout(500);
  await page.locator('#three').screenshot({ path: 'e2e-out/front.png' });
  const drawn = await page.evaluate(() => {
    const c = document.querySelector('#three canvas');
    const copy = document.createElement('canvas');
    copy.width = c.width; copy.height = c.height;
    const g = copy.getContext('2d');
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, copy.width, copy.height).data;
    let body = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) {
      total++;
      if (d[i + 3] > 0 && Math.abs(d[i] - 244) + Math.abs(d[i + 1] - 244) + Math.abs(d[i + 2] - 244) > 30) body++;
    }
    return { body, total };
  });
  // A standing body fills a few percent of the frame; demand at least 1% so a blank or failed render cannot pass.
  if (!(drawn.body > 0.01 * drawn.total)) fail(`the 3D view looks blank (${drawn.body} of ${drawn.total} pixels differ from the background)`);
  await page.screenshot({ path: 'e2e-out/page.png' });

  // Failure path: if the fitting worker cannot load the body model, the page must say so and recover,
  // not hang on "Fitting..." with the button disabled. The page fetches the body once itself; make the
  // worker's own fetch fail.
  const failing = await browser.newPage();
  let bodyFetches = 0;
  await failing.route('**/body/body.bin', (route) => (++bodyFetches === 1 ? route.continue() : route.abort()));
  await failing.goto(`http://localhost:${PORT}/`);
  await failing.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Ready'), null, { timeout: 60000 });
  await failing.selectOption('#fixture', 'tall188Average');
  await failing.click('#fit');
  await failing.waitForFunction(() => document.getElementById('status')?.textContent?.includes('The fit failed'), null, { timeout: 60000 })
    .catch(() => fail('a failed fit left the page stuck instead of reporting the error'));
  if (await failing.$eval('#fit', (b) => b.disabled)) fail('the Fit button stayed disabled after a failed fit');
  await failing.close();
  if (errors.length) fail('page errors: ' + errors.join(' | '));
  console.log(`E2E OK: ${filled.length} measurements within 0.5 cm in the browser, a failed fit reports and recovers; body covers ${(100 * drawn.body / drawn.total).toFixed(1)}% of the 3D view (screenshots in e2e-out/)`);
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  await browser?.close();
  stop();
}
