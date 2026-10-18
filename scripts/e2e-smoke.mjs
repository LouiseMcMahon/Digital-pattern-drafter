// End-to-end smoke test of the real page: build, serve, fit a 6'2" woman in a real browser, check the
// page reports every measurement within 0.5 cm (R1) and nothing errors. `npm run build && npm run e2e`.
// Set CHROMIUM_PATH to use a specific browser; otherwise Playwright's managed Chromium
// (`npx playwright-core install chromium`); if that is not installed, an installed Chrome or Edge is used.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = 4179;
// Run vite's own script with this node: spawning `npx` fails on Windows (it is a .cmd file).
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
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
  const options = { executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
  const useInstalled = !options.executablePath && !existsSync(chromium.executablePath()); // no managed Chromium: use Chrome, then Edge
  try {
    browser = await chromium.launch(useInstalled ? { ...options, channel: 'chrome' } : options);
  } catch (chromeError) {
    if (!useInstalled) throw chromeError;
    try { browser = await chromium.launch({ ...options, channel: 'msedge' }); } catch { throw chromeError; } // report Chrome's error, the first choice
  }
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
  const dims = /([0-9.]+) x ([0-9.]+) cm flat, ([0-9]+) cm² on the body/.exec(panelText);
  if (!dims || !(dims[1] > 30 && dims[1] < 55 && dims[2] > 45 && dims[2] < 70)) fail(`the front torso panel has an implausible size: "${panelText}"`);
  // A front torso goes over the bust: it cannot lie flat without stretching, and the page must say so (R7), not hide it.
  if (!/cannot lie flat/.test(panelText) || !/dart or more seam lines/.test(panelText)) fail(`a piece over the bust was not reported as unable to lie flat: "${panelText}"`);
  if (await page.$eval('#flat', (e) => getComputedStyle(e).display) === 'none') fail('the flat panel was not drawn');
  await page.locator('#flat').screenshot({ path: 'e2e-out/panel-flat.png' });

  // Mirroring: draw half a bodice (centre front, round the neck and armhole, down to the centre waist), mirror it,
  // and the panel inside comes out symmetric (the front torso is the same on both sides).
  await page.click('#seam-clear');
  await page.click('#panel-clear');
  await page.evaluate(() => {
    const lm = Object.fromEntries(window.landmarkPoints().map((l) => [l.name, l.point]));
    const front = (x, y) => [x, y, 999];
    window.seamFromPoints([front(0, 150), lm['neck point L'], lm['shoulder point L'], front(17.5, 141), front(15, 131), front(13, 100), front(0, 100)], false);
  });
  await page.click('#seam-mirror');
  const outline = await page.evaluate(() => window.panelAt([0, 120, 999]));
  await page.waitForFunction(() => document.getElementById('panels')?.textContent?.includes('cm flat'), null, { timeout: 60000 })
    .catch(async () => fail(`mirrored half-seams did not enclose a panel: "${await page.$eval('#panels', (e) => e.textContent)}"`));
  const xs = outline.map((p) => p[0]);
  const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
  const mirrored = outline.map(([x, y]) => [2 * centre - x, y]);
  const distance = (p) => { let best = Infinity; for (let i = 0; i < mirrored.length; i++) { const a = mirrored[i], b = mirrored[(i + 1) % mirrored.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])); } return best; };
  const worst = Math.max(...outline.map(distance));
  const width = Math.max(...xs) - Math.min(...xs);
  if (!(worst < 0.02 * width)) fail(`the mirrored panel is not symmetric: worst point ${worst.toFixed(2)} cm from its mirror image on a ${width.toFixed(1)} cm wide panel`);
  await page.locator('#flat').screenshot({ path: 'e2e-out/panel-mirrored.png' });

  // Several panels sharing seams: a bodice front and back, cut by neckline, shoulder, armhole, side and hem seams
  // that meet at shared points. The side and shoulder seams belong to both panels, with the same length on each.
  await page.click('#seam-clear');
  await page.click('#panel-clear');
  const made = await page.evaluate(() => {
    const lm = Object.fromEntries(window.landmarkPoints().map((l) => [l.name, l.point]));
    const P = (name) => ({ point: lm[name] });
    const front = (x, y) => ({ origin: [x, y, 300], dir: [0, 0, -1] });
    const back = (x, y) => ({ origin: [x, y, -300], dir: [0, 0, 1] });
    const sideL = { point: [13.5, 105, 3] };
    const sideR = { point: [-13.5, 105, 3] };
    const add = (pts) => window.seamFromSpecs(pts, false);
    add([P('neck point L'), front(0, 148), P('neck point R')]);
    add([P('neck point L'), back(0, 152), P('neck point R')]);
    add([P('neck point L'), P('shoulder point L')]);
    add([P('neck point R'), P('shoulder point R')]);
    // Half way between the shoulder point and the underarm, wherever the pose puts the arm.
    const armhole = (side) => { const [a, b] = [lm[`shoulder point ${side}`], lm[`axilla ${side}`]]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    add([P('shoulder point L'), front(...armhole('L')), P('axilla L')]);
    add([P('shoulder point L'), back(...armhole('L')), P('axilla L')]);
    add([P('shoulder point R'), front(...armhole('R')), P('axilla R')]);
    add([P('shoulder point R'), back(...armhole('R')), P('axilla R')]);
    add([P('axilla L'), sideL]);
    add([P('axilla R'), sideR]);
    add([sideL, front(8, 105), front(0, 105), front(-8, 105), sideR]);
    add([sideL, back(8, 105), back(0, 105), back(-8, 105), sideR]);
    window.panelAtSpec(front(0, 125));
    window.panelAtSpec(back(0, 125));
    return document.getElementById('panels').innerText;
  });
  const sides = (text) => [...text.matchAll(/Seam (\d+): ([0-9.]+) cm \(flat ([0-9.]+)\)(, shared with panel (\d+))?/g)].map((m) => ({ seam: Number(m[1]), length: Number(m[2]), flat: Number(m[3]), shared: m[5] ? Number(m[5]) : undefined }));
  const [frontText, backText] = made.split(/Panel 2/);
  const [frontSides, backSides] = [sides(frontText), sides(backText)];
  if (frontSides.length !== 8 || backSides.length !== 8) fail(`expected 8 sides on the front and back panels, got ${frontSides.length} and ${backSides.length}: "${made}"`);
  const sharedSeams = [3, 4, 9, 10];
  for (const seam of sharedSeams) {
    const [a, b] = [frontSides.find((e) => e.seam === seam), backSides.find((e) => e.seam === seam)];
    if (!a || !b || a.shared !== 2 || b.shared !== 1) fail(`seam ${seam} should be shared by panels 1 and 2: "${made}"`);
    if (Math.abs(a.length - b.length) > 0.01) fail(`shared seam ${seam} has different lengths on the two panels: ${a.length} and ${b.length}`);
    // On the flat patterns too: the same seam must be the same length on both panels, and as long as on the body.
    if (Math.abs(a.flat - b.flat) > 0.15 || Math.abs(a.flat - a.length) > 0.004 * a.length + 0.05) fail(`shared seam ${seam} flattens to ${a.flat} cm and ${b.flat} cm (body ${a.length} cm): the panels would not fit together`);
  }
  if (frontSides.some((e) => !sharedSeams.includes(e.seam) && e.shared !== undefined)) fail('a seam only one panel touches was reported as shared');
  await page.locator('#flat').screenshot({ path: 'e2e-out/panels-front-back.png' });

  // Cloth simulation of the sewn front and back: ticking the view before running says it is out of date, clicking
  // Simulate shows the spinner over the 3D view, and when it ends the overlay is gone and the cloth is reported.
  const started = await page.evaluate(() => {
    const tick = document.getElementById('cloth-on');
    tick.checked = true;
    tick.dispatchEvent(new Event('change'));
    const stale = document.getElementById('panels').innerText.includes('out of date');
    document.getElementById('cloth-run').click();
    return { stale, overlay: document.querySelector('.busy').classList.contains('on') };
  });
  if (!started.stale) fail('a cloth view that has not been simulated should say it is out of date');
  if (!started.overlay) fail('the spinner overlay did not show when Simulate cloth was clicked');
  await page.waitForFunction(() => !document.querySelector('.busy').classList.contains('on') && document.getElementById('panels').innerText.includes('cloth simulation:'), null, { timeout: 900000 })
    .catch(async () => fail(`the cloth simulation did not finish and report: "${await page.$eval('#panels', (e) => e.innerText)}"`));
  const clothText = await page.$eval('#panels', (e) => e.innerText);
  if (clothText.includes('out of date')) fail(`panels still out of date after simulating: "${clothText}"`);
  if ((clothText.match(/cloth simulation:/g) ?? []).length !== 2) fail(`expected both panels to report the cloth simulation: "${clothText}"`);
  await page.screenshot({ path: 'e2e-out/cloth.png' });
  await page.evaluate(() => { const tick = document.getElementById('cloth-on'); tick.checked = false; tick.dispatchEvent(new Event('change')); });

  // A new seam can start in the middle of an existing one: the click snaps to the seam's path and the seam gains a
  // control point there (so the two meet, and a panel can be cut on both sides).
  await page.click('#seam-clear');
  await page.click('#panel-clear');
  await page.evaluate(() => {
    window.setView('front');
    window.seamFromSpecs([{ origin: [-10, 125, 300], dir: [0, 0, -1] }, { origin: [10, 125, 300], dir: [0, 0, -1] }], false);
  });
  await page.waitForTimeout(300);
  const mid = await page.evaluate(() => window.seamPathPoint(0, 0.3));
  const at30 = await page.evaluate((p) => window.screenOfPoint(p), mid);
  await page.click('#seam-new'); // the first seam is still the one being drawn: start another
  await page.mouse.click(at30.x + 2, at30.y + 2);
  if (!(await snapNote()).includes('seam 1')) fail(`a click on a seam did not snap to it: "${await snapNote()}"`);
  await page.mouse.click(at30.x + 2, at30.y + 90);
  const joined = await page.evaluate(() => window.seamState());
  if (joined.length !== 2 || joined[0].points.length !== 3 || joined[1].points.length !== 2) fail(`expected the first seam to gain a control point and a second seam of two points: ${JSON.stringify(joined.map((q) => q.points.length))}`);
  const shared = joined[0].points[1].map((v, i) => v - joined[1].points[0][i]);
  if (Math.hypot(...shared) > 1e-6) fail('the new seam does not start exactly on the first seam');

  // Guide lines: the waist (and bust, hip...) line and where it crosses centre front, the sides and centre back are
  // offered as snap targets, and a label says what a click would snap to.
  await page.click('#seam-clear');
  await page.evaluate(() => window.setView('front'));
  await page.waitForTimeout(300);
  const guideNames = (await page.evaluate(() => window.guideTargets())).map((t) => t.name);
  for (const want of ['waist line, centre front', 'bust line, centre front', 'hip line, left side', 'waist line, centre back']) if (!guideNames.includes(want)) fail(`no snap target "${want}" among ${guideNames.join(', ')}`);
  const waistFront = (await page.evaluate(() => window.guideTargets())).find((t) => t.name === 'waist line, centre front').point;
  const wfScreen = await page.evaluate((p) => window.screenOfPoint(p), waistFront);
  await page.mouse.move(wfScreen.x + 2, wfScreen.y + 2);
  await page.waitForTimeout(100);
  const hoverText = await page.$eval('#hover', (e) => (getComputedStyle(e).display === 'none' ? '' : e.textContent));
  if (hoverText !== 'waist line, centre front') fail(`hovering the waist at centre front showed "${hoverText}"`);
  await page.mouse.click(wfScreen.x + 2, wfScreen.y + 2);
  if (!(await snapNote()).includes('waist line, centre front')) fail(`a click at the waist line at centre front did not snap to it: "${await snapNote()}"`);
  // A point on the waist line between centre front and the side snaps to the line itself.
  const onLine = await page.evaluate(() => { for (let f = 0; f < 1; f += 0.005) { const p = window.guidePoint('waist line', f); if (p && p[2] > 8 && p[0] > 6 && p[0] < 9) return p; } return undefined; });
  if (!onLine) fail('found no point on the waist line between centre front and the side');
  const lineScreen = await page.evaluate((p) => window.screenOfPoint(p), onLine);
  await page.mouse.click(lineScreen.x + 1, lineScreen.y + 1);
  if ((await snapNote()) !== 'Snapped to waist line') fail(`a click on the waist line did not snap to it: "${await snapNote()}"`);
  const drawnPoints = await page.evaluate(() => window.seamState());
  if (drawnPoints[0].points.length !== 2 || Math.abs(drawnPoints[0].points[1][1] - onLine[1]) > 0.3) fail('the seam point placed on the waist line is not at the waist height');
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
