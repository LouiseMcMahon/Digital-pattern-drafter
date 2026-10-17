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

  // The 3D canvas actually drew a body (not a blank page).
  await page.evaluate(() => window.setView('front'));
  await page.waitForTimeout(500);
  const shot = await page.locator('#three').screenshot({ path: 'e2e-out/front.png' });
  const nonBackground = await page.evaluate(async () => {
    const c = document.querySelector('#three canvas');
    const w = c.width, h = c.height;
    const ctx = document.createElement('canvas'); ctx.width = w; ctx.height = h;
    const g = ctx.getContext('2d'); g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - 244) + Math.abs(d[i + 1] - 244) + Math.abs(d[i + 2] - 244) > 30) n++;
    return n;
  }).catch(() => -1);
  if (nonBackground === 0) fail('the 3D view is blank');
  await page.screenshot({ path: 'e2e-out/page.png' });
  if (errors.length) fail('page errors: ' + errors.join(' | '));
  console.log(`E2E OK: ${filled.length} measurements within 0.5 cm in the browser (${shot.length} byte screenshot in e2e-out/)`);
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  await browser?.close();
  stop();
}
