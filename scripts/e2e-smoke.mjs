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

  // Seam drawing: with the mode on, three clicks down the front of the torso make one seam with a length.
  await page.check('#draw');
  const box = await page.locator('#three canvas').boundingBox();
  for (const dy of [-300, -150, -40]) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + dy);
  await page.locator('#three').screenshot({ path: 'e2e-out/seam.png' });
  const seamText = await page.$eval('#seams', (e) => e.textContent);
  const seamLen = /Seam 1 \(drawing\): 3 points, ([0-9.]+) cm/.exec(seamText);
  if (!seamLen || !(parseFloat(seamLen[1]) > 20)) fail(`three clicks on the body did not make a seam of plausible length: "${seamText}"`);

  // Snapping and dragging: a click a few pixels from the neck point lands on it; dragging that point to near the
  // bust apex snaps there and does not turn the view; shift-click deletes a point.
  await page.click('#seam-clear');
  await page.evaluate(() => window.setView('front'));
  await page.waitForTimeout(300);
  const at = (name) => page.evaluate((n) => window.screenOf(n), name);
  const snapNote = () => page.$eval('#snap', (e) => e.textContent);
  const neck = await at('neck point L');
  const apex = await at('bust apex L');
  const shoulder = await at('shoulder point L');
  if (!neck || !apex || !shoulder) fail('the page did not offer neck, bust apex and shoulder point landmarks');
  await page.mouse.click(neck.x + 3, neck.y + 3);
  if (!(await snapNote()).includes('neck point L')) fail(`a click near the neck point did not snap to it: "${await snapNote()}"`);
  await page.mouse.click(shoulder.x + 3, shoulder.y + 3);
  if (!(await snapNote()).includes('shoulder point L')) fail(`a click near the shoulder point did not snap to it: "${await snapNote()}"`);
  const before = await page.evaluate(() => window.seamState());
  if (before.length !== 1 || before[0].points.length !== 2) fail('expected one seam with two points before dragging');
  await page.mouse.move(shoulder.x, shoulder.y);
  await page.mouse.down();
  await page.mouse.move(apex.x + 60, apex.y - 40, { steps: 4 });
  await page.mouse.move(apex.x + 3, apex.y + 3, { steps: 4 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.seamState());
  const moved = Math.hypot(...after[0].points[1].map((v, i) => v - before[0].points[1][i]));
  if (!(moved > 5)) fail(`dragging the second point did not move it (moved ${moved.toFixed(2)} cm)`);
  if (!(await snapNote()).includes('bust apex L')) fail(`dragging near the bust apex did not snap to it: "${await snapNote()}"`);
  const same = Math.hypot(...after[0].points[0].map((v, i) => v - before[0].points[0][i]));
  if (same > 1e-9) fail('dragging one point moved another');
  const apexAfter = await at('bust apex L');
  if (Math.hypot(apexAfter.x - apex.x, apexAfter.y - apex.y) > 0.5) fail('dragging a seam point turned the view');
  await page.keyboard.down('Shift');
  await page.mouse.click(neck.x + 1, neck.y + 1);
  await page.keyboard.up('Shift');
  const deleted = await page.evaluate(() => window.seamState());
  if (deleted[0].points.length !== 1) fail('shift-click on a point did not delete it');
  await page.locator('#three').screenshot({ path: 'e2e-out/snap-drag.png' });

  // Panels: close a loop of seams round the front of the torso, click inside it, and get a flat panel of a
  // plausible size (the body's front torso is about 40 cm wide and 55 cm tall).
  await page.click('#seam-clear');
  await page.evaluate(() => window.setView('front'));
  await page.waitForTimeout(300);
  const axL = await at('axilla L');
  const axR = await at('axilla R');
  const neckL = await at('neck point L');
  const neckR = await at('neck point R');
  await page.mouse.click(neckL.x + 1, neckL.y + 1);
  await page.mouse.click(...(({ x, y }) => [x + 1, y + 1])(await at('shoulder point L')));
  await page.mouse.click(axL.x + 1, axL.y + 1);
  await page.mouse.click(axL.x - 6, axL.y + 170);
  await page.mouse.click((axL.x + axR.x) / 2, axL.y + 185);
  await page.mouse.click(axR.x + 6, axR.y + 170);
  await page.mouse.click(axR.x + 1, axR.y + 1);
  await page.mouse.click(...(({ x, y }) => [x + 1, y + 1])(await at('shoulder point R')));
  await page.mouse.click(neckR.x + 1, neckR.y + 1);
  await page.mouse.click((neckL.x + neckR.x) / 2, (neckL.y + neckR.y) / 2 + 14);
  await page.click('#seam-close');
  await page.click('#panel-pick');
  await page.mouse.click((axL.x + axR.x) / 2, axL.y + 60);
  await page.waitForFunction(() => document.getElementById('panels')?.textContent?.includes('cm flat'), null, { timeout: 60000 })
    .catch(async () => fail(`no panel was made from the closed seams: "${await page.$eval('#panels', (e) => e.textContent)}"`));
  const panelText = await page.$eval('#panels', (e) => e.textContent);
  const dims = /([0-9.]+) x ([0-9.]+) cm flat, ([0-9]+) cm² on the body; edge length error ([0-9.]+)%/.exec(panelText);
  if (!dims || !(dims[1] > 30 && dims[1] < 55 && dims[2] > 45 && dims[2] < 70 && dims[4] < 15)) fail(`the front torso panel has an implausible size or distortion: "${panelText}"`);
  if (await page.$eval('#flat', (e) => getComputedStyle(e).display) === 'none') fail('the flat panel was not drawn');
  await page.locator('#flat').screenshot({ path: 'e2e-out/panel-flat.png' });
  await page.uncheck('#draw');

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
