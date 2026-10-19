import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type BodyModel, type BodyParams, loadBodyFromUrl } from './core/bodyModel';
import { GUIDE_RINGS, centreLines, ringLandmarks } from './core/guides';
import { mirrorSeam } from './core/mirror';
import { offsetOutline } from './core/allowance';
import { type ClothPatternResult, type ClothPiece, type ClothProgress } from './core/cloth';
import type { ClothMessage, ClothRequest } from './cloth.worker';
import { splitCrossings } from './core/crossings';
import { type Design, type PanelSeed, cloneDesign, parseDesign, serializeDesign } from './core/design';
import type { FitTargets } from './core/fit';
import { FLATTEN_TOLERANCE } from './core/flatten';
import { History } from './core/history';
import { len, sub } from './core/mesh';
import type { PanelFlat, PanelsResult } from './core/panelPipeline';
import { FIXTURES } from './core/fixtures';
import { type Seam, type SnapTarget, type SurfacePoint, SurfaceGraph, closestSurfacePoint, findControlPoint, insertControlPoint, nearestOnSeams, polylineLength, pointOnSurface, raycast, snapPoint, snapToVertex } from './core/seam';
import { MEASUREMENT_LABELS, MEASUREMENT_NAMES, type MeasurementName, Measurer } from './core/measure';
import type { FitRequest, FitResponse } from './fit.worker';
import type { PanelsRequest, PanelsResponse } from './panels.worker';

const controls = document.getElementById('controls')!;
const threeEl = document.getElementById('three')!;

controls.innerHTML = `
  <div class="head"><h1>Digital Pattern Drafter</h1><p>Shape a body, draw seams, flatten panels.</p></div>
  <div class="tabs" role="tablist"><button role="tab" class="active" data-tab="measure">Measurements</button><button role="tab" data-tab="draw">Drawing</button></div>
  <div class="tabpane" data-pane="measure">
  <details open><summary>Body</summary><div class="body">
    <div class="row">
      <select id="preset" class="grow" title="Starting body"><option value="female">Woman</option><option value="male">Man</option></select>
      <select id="fixture" class="grow" title="Load an example set of measurements"><option value="">Example…</option>${Object.entries(FIXTURES).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('')}</select>
    </div>
    <p class="hint">Enter any measurements in cm. Blanks are left to a typical body.</p>
    <table id="table"><thead><tr><th>Measurement</th><th>Target</th><th>Body</th><th>Diff</th></tr></thead><tbody>
    ${MEASUREMENT_NAMES.map((n) => `<tr><td>${MEASUREMENT_LABELS[n]}</td><td><input type="number" step="0.5" id="in-${n}"></td><td id="got-${n}"></td><td id="err-${n}"></td></tr>`).join('')}
    </tbody></table>
    <div class="row"><button id="fit" class="primary grow">Fit body</button><button id="reset">Reset</button></div>
    <label class="switch"><input type="checkbox" id="lines"><span>Show where each ring is measured</span></label>
  </div></details>
  </div>
  <div class="tabpane" data-pane="draw" hidden>
  <details open><summary>Seams</summary><div class="body">
    <label class="switch" title="Click the body to add points, drag a point to move it, shift-click a point to delete it. Click the first point to close the seam. Points snap to landmarks (green), the bust, waist and hip lines (teal) and other seams; a label shows what a click will snap to."><input type="checkbox" id="draw"><span><b>Draw seams</b><br><span class="hint">Click to add points · drag to move · shift-click to delete · click the first point to close</span></span></label>
    <div class="row">
      <button id="seam-undo" title="Undo the last change to the seams or panels (Ctrl+Z)">Undo</button>
      <button id="seam-redo" title="Redo (Ctrl+Shift+Z or Ctrl+Y)">Redo</button>
      <button id="seam-close" title="Join the last point back to the first">Close</button>
      <button id="seam-new" title="Finish this seam and start another">New seam</button>
      <button id="seam-mirror" title="Copy the last seam to the other side of the body (points on the centre line are shared). Draw one half, mirror it, then make a panel.">Mirror</button>
      <button id="seam-clear" class="danger">Clear</button>
    </div>
    <div class="row">
      <button id="design-save" class="grow" title="Save the seams and panels to a file">Save seams…</button>
      <button id="design-load" class="grow" title="Open a file saved earlier. It replaces the seams and panels now on the body (Undo brings them back).">Open seams…</button>
      <input type="file" id="design-file" accept="application/json,.json" hidden>
    </div>
    <div id="seams"></div>
  </div></details>
  <details open><summary>Panels</summary><div class="body">
    <div class="row"><button id="panel-pick" class="grow" title="Then click inside a closed set of seams">Make a panel</button><button id="panel-clear" class="danger">Clear</button></div>
    <div class="row"><label title="Cutting line drawn round each flat piece, in cm. 0 turns it off.">Seam allowance <input type="number" id="allowance" step="0.5" min="0" value="1" style="width:4em"> cm</label></div>
    <label class="switch" title="Pull the seams taut and let each panel bridge hollows instead of following the skin. Off: panels are cut straight from the skin."><input type="checkbox" id="drape-on" checked><span>Drape panels over the body</span></label>
    <div class="row">
      <label class="switch" title="Lay the flat pattern over the body with every edge keeping its length (no stretch), so seams may fall short of their lines instead."><input type="checkbox" id="cloth-on"><span>Show cloth simulation</span></label>
      <button id="cloth-run" title="Runs the simulation for every panel (several seconds each; the page is busy meanwhile). Moving a seam or changing ease makes the result out of date.">Simulate cloth (slow)</button>
    </div>
    <label class="row">Colour panels by <select id="panel-colour" class="grow"><option value="lift">lift off the body</option><option value="strain">strain (red/blue) or panel colour</option></select></label>
    <div id="lift-key" class="hint"></div>
    <div class="row" title="A panel that hangs free from a seam instead of lying on the body, such as a skirt from a waist seam. Draw the seam first (a closed seam is cut open at its first point, or wherever you choose with Choose side seam; for half a skirt draw from centre front to centre back).">Hang a panel from seam <input type="number" id="hang-seam" min="1" step="1" value="1" style="width:48px"> length <input type="number" id="hang-length" min="1" step="1" value="60" style="width:52px">cm flare <input type="number" id="hang-flare" step="5" value="30" style="width:48px">% <label title="A fitted (pencil) skirt: follows the body down to the hips, then runs to the hem. Flare is then the hem width against the hips (negative: narrower). It needs shaping (darts) to lie flat; the strain shows how much."><input type="checkbox" id="hang-fitted">fitted</label> <label title="Cut a skirt from a closed seam at both side seams, giving a front and a back panel (the usual way). Off: one panel with a single side seam."><input type="checkbox" id="hang-two" checked>two side seams</label> <button id="hang-make">Add</button></div>
    <div id="hang-note" class="hint"></div>
    <div id="panels"></div>
    <svg id="flat" width="312" height="1" style="display:none"></svg>
  </div></details>
  </div>
  <div id="status">Loading body model…</div>`;
controls.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((tab) => tab.addEventListener('click', () => {
  controls.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((t) => {
    const on = t === tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  controls.querySelectorAll<HTMLElement>('.tabpane').forEach((p) => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
}));
const viewbar = document.createElement('div');
viewbar.className = 'viewbar';
viewbar.innerHTML = '<button data-view="front">Front</button><button data-view="side">Side</button><button data-view="back">Back</button><button data-view="three">3/4</button><button data-view="torso">Torso</button>';
const hoverEl = document.createElement('div');
hoverEl.id = 'hover';
const snapEl = document.createElement('div');
snapEl.id = 'snap';
const busyEl = document.createElement('div');
busyEl.className = 'busy';
busyEl.innerHTML = '<div class="spinner"></div><div id="busy-text">Simulating cloth…</div><div class="bar"><div id="busy-bar"></div></div><div id="busy-detail"></div>';
threeEl.append(viewbar, snapEl, busyEl);
document.body.append(hoverEl);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');
// Nothing can be used before the body model has loaded: the handlers below all need it.
const setControlsEnabled = (on: boolean) => document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('aside input, aside select, aside button:not([role=tab]), .viewbar button').forEach((el) => { el.disabled = !on; });
setControlsEnabled(false);

// 3D view
// preserveDrawingBuffer so the smoke test (and a user's screenshot) can read back what was drawn.
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
threeEl.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f4f4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(150, 300, 250);
scene.add(sun);
scene.add(new THREE.DirectionalLight(0xbbccff, 0.5).translateZ(-300).translateY(100));
const camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
camera.position.set(0, 100, 380);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 95, 0);
orbit.update();
const render = () => renderer.render(scene, camera);
orbit.addEventListener('change', render);
new ResizeObserver(() => {
  renderer.setSize(threeEl.clientWidth, threeEl.clientHeight);
  camera.aspect = threeEl.clientWidth / threeEl.clientHeight;
  camera.updateProjectionMatrix();
  render();
}).observe(threeEl);
let mesh: THREE.Mesh | undefined;
const lineGroup = new THREE.Group();
scene.add(lineGroup);
const seamGroup = new THREE.Group();
scene.add(seamGroup);
const landmarkGroup = new THREE.Group(); // snap targets, shown while drawing
scene.add(landmarkGroup);
const panelGroup = new THREE.Group(); // panels tinted on the body
scene.add(panelGroup);

const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  // camera x,y,z then target x,y,z
  front: [0, 100, 380, 0, 95, 0],
  side: [380, 100, 0, 0, 95, 0],
  back: [0, 100, -380, 0, 95, 0],
  three: [250, 130, 280, 0, 95, 0],
  torso: [150, 135, 190, 0, 125, 0],
  chest: [0, 140, 190, 0, 138, 0],
  chestBack: [0, 140, -190, 0, 138, 0],
  chestSide: [190, 140, 20, 0, 138, 0],
  lower: [0, 70, 300, 0, 70, 0],
};
function setView(name: string) {
  const v = VIEWS[name];
  camera.position.set(v[0], v[1], v[2]);
  orbit.target.set(v[3], v[4], v[5]);
  orbit.update();
  render();
}
viewbar.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view!)));
(window as unknown as { setView: typeof setView }).setView = setView;

let body: BodyModel;
let measurer: Measurer;
let current: BodyParams = {};
let shapePositions: Float64Array = new Float64Array(0);
let graph: SurfaceGraph;
// The last seam is the one being drawn. Control points are stored on faces, so they follow the body when it is re-fitted.
let seams: Seam[] = [];
// Named places the seam points snap to (neck and shoulder points, bust apex, ...), re-found on every body.
let landmarks: SnapTarget[] = [];
// Guide lines (the bust, waist, hip... lines round the body) and the points where they cross centre front, centre back and the sides.
let guides: { name: string; points: number[] }[] = [];
let ringTargets: SnapTarget[] = [];
// The path of every leg of every seam (control point to control point), for snapping to the middle of a seam.
let seamLegs: number[][][] = [];

/** Remove an object and free its GPU resources (geometries and materials are not freed by removal). */
function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    (Array.isArray(mat) ? mat : [mat]).forEach((x) => x?.dispose());
  });
}

type Inspection = ReturnType<Measurer['inspect']>;

function drawLines(info: Inspection | undefined) {
  for (const c of [...lineGroup.children]) { lineGroup.remove(c); disposeTree(c); }
  if (!info) return;
  for (const r of info.rings) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(r.points), 3));
    lineGroup.add(new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xd01040 })));
  }
  for (const m of info.marks) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.7), new THREE.MeshBasicMaterial({ color: m.name.startsWith('crease') ? 0x1060ff : 0x10a040 }));
    dot.position.set(m.point[0], m.point[1], m.point[2]);
    lineGroup.add(dot);
  }
  for (const pth of info.paths) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pth.points), 3));
    lineGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff8000 })));
  }
}
$('lines').onchange = () => show(current);

function show(params: BodyParams) {
  current = params;
  const shape = body.evaluate(params);
  shapePositions = shape.positions;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(shape.positions), 3));
  geo.setIndex(new THREE.BufferAttribute(body.faces, 1));
  geo.computeVertexNormals();
  if (mesh) { scene.remove(mesh); disposeTree(mesh); }
  mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x808084, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  scene.add(mesh);
  render();
  // One measurement pass: with the overlay on, the same pass also records what to draw.
  const info = measurer.inspect(shape);
  const m = info.values;
  landmarks = info.marks.filter((k) => !k.name.startsWith('crease')).map((k) => ({ name: k.name, point: k.point }));
  guides = [];
  ringTargets = [];
  for (const g of GUIDE_RINGS) {
    const ring = info.rings.find((r) => r.name === g.measurement);
    if (!ring || ring.points.length < 9) continue;
    guides.push({ name: `${g.label} line`, points: [...ring.points, ring.points[0], ring.points[1], ring.points[2]] });
    ringTargets.push(...ringLandmarks(g.label, ring.points));
  }
  const markY = (n: string) => info.marks.find((k) => k.name === n)?.point[1];
  const neckY = [markY('neck point L'), markY('neck point R')].filter((y): y is number => y !== undefined);
  const hipY = markY('hip level'), napeY = markY('nape C7');
  if (hipY !== undefined && napeY !== undefined && neckY.length)
    guides.push(...centreLines(shapePositions, body.faces, hipY, neckY.reduce((a, b) => a + b) / neckY.length, napeY));
  drawLines($<HTMLInputElement>('lines').checked ? info : undefined);
  drawLandmarks();
  drawSeams();
  if (panels.length) void refreshPanels();
  render();
  for (const n of MEASUREMENT_NAMES) $(`got-${n}`).textContent = m[n].toFixed(1);
  return m;
}

const bodyMesh = () => ({ positions: shapePositions, triangles: body.faces });
function drawSeams() {
  seamLegs = [];
  for (const c of [...seamGroup.children]) { seamGroup.remove(c); disposeTree(c); }
  const m = bodyMesh();
  const rows: string[] = [];
  seams.forEach((seam, i) => {
    const active = i === seams.length - 1;
    const color = active ? 0xd01040 : 0x1060ff;
    const legs = graph.seamLegs(shapePositions, seam);
    seamLegs[i] = legs;
    const path = seam.points.length === 1 ? [...pointOnSurface(m, seam.points[0])] : legs.flatMap((leg, k) => (k === 0 ? leg : leg.slice(3)));
    if (path.length >= 6) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(path), 3));
      seamGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color })));
    }
    for (const p of seam.points) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.6), new THREE.MeshBasicMaterial({ color }));
      dot.position.set(...pointOnSurface(m, p));
      seamGroup.add(dot);
    }
    rows.push(`<label class="item-head" style="padding:2px 0"><input type="checkbox" data-merge="${i}" title="Tick two open seams to merge them"${mergeSel.has(i) ? ' checked' : ''}${seam.closed || seam.points.length < 2 ? ' disabled' : ''}><span style="width:9px;height:9px;border-radius:50%;background:${active ? '#d01040' : '#1060ff'}"></span><span style="flex:1">Seam ${i + 1}${active ? ' (drawing)' : ''}: ${seam.points.length} points${seam.closed ? ', closed' : ''}, ${polylineLength(path).toFixed(1)} cm</span></label>`);
  });
  $('seams').innerHTML = rows.length ? `${rows.join('')}<button id="seam-merge" style="margin-top:4px" title="Join the two ticked open seams into one, end to end">Merge ticked seams</button>` : '<span class="hint">No seams yet. Switch on Draw seams, then click the body.</span>';
  $('seams').querySelectorAll<HTMLInputElement>('input[data-merge]').forEach((el) => {
    el.onchange = () => { const i = Number(el.dataset.merge); if (el.checked) mergeSel.add(i); else mergeSel.delete(i); updateMergeButton(); };
  });
  const mb = document.getElementById('seam-merge') as HTMLButtonElement | null;
  if (mb) mb.onclick = mergeTicked;
  updateMergeButton();
}
const mergeSel = new Set<number>();
function updateMergeButton() {
  const mb = document.getElementById('seam-merge') as HTMLButtonElement | null;
  if (mb) mb.disabled = [...mergeSel].filter((i) => i < seams.length).length !== 2;
}
const samePoint = (a: SurfacePoint, b: SurfacePoint) => a.tri === b.tri && a.bary.every((w, k) => Math.abs(w - b.bary[k]) < 1e-9);
/** Joins the two ticked open seams into one chain at their nearest ends (a shared end point is kept once). */
function mergeTicked() {
  const [i, j] = [...mergeSel].filter((k) => k < seams.length).sort((x, y) => x - y);
  mergeSel.clear();
  if (j === undefined) return;
  checkpoint();
  const m = bodyMesh();
  const [a, b] = [seams[i], seams[j]];
  const ends = (q: Seam) => [q.points[0], q.points[q.points.length - 1]];
  let best = { d: Infinity, flipA: false, flipB: false };
  ends(a).forEach((pa, ka) => ends(b).forEach((pb, kb) => {
    const d = len(sub(pointOnSurface(m, pa), pointOnSurface(m, pb)));
    if (d < best.d) best = { d, flipA: ka === 0, flipB: kb === 1 };
  }));
  const first = best.flipA ? [...a.points].reverse() : a.points;
  const second = best.flipB ? [...b.points].reverse() : b.points;
  const merged: Seam = { points: [...first, ...(samePoint(first[first.length - 1], second[0]) ? second.slice(1) : second)], closed: false };
  seams.splice(j, 1);
  seams.splice(i, 1);
  seams.push(merged); // the merged seam becomes the one being drawn
  redrawSeams();
}
const activeSeam = () => seams[seams.length - 1];
/** After a finished edit: join seams that cross, redraw, remember the design, and re-flatten the panels. */
const redrawSeams = () => {
  if (graph) splitCrossings(bodyMesh(), graph, seams);
  drawSeams();
  render();
  saveLocal();
  if (panels.length) void refreshPanels();
};

// Undo and redo cover the seams and the panels together. Call checkpoint() just before a change.
const history = new History<Design>(cloneDesign);
const design = (): Design => ({ seams, panels });
const updateHistoryButtons = () => {
  $<HTMLButtonElement>('seam-undo').disabled = !history.canUndo;
  $<HTMLButtonElement>('seam-redo').disabled = !history.canRedo;
};
function checkpoint() { history.record(design()); updateHistoryButtons(); }
function goTo(d: Design | undefined) {
  if (!d) return;
  seams = d.seams;
  panels = d.panels;
  mergeSel.clear();
  setSnapNote();
  redrawSeams();
  if (!panels.length) void refreshPanels();
  updateHistoryButtons();
}
const undo = () => goTo(history.undo(design()));
const redo = () => goTo(history.redo(design()));
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !body || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
});

// The design is also kept in this browser, so a reload does not lose it.
const LOCAL_KEY = 'digital-pattern-drafter-design';
function saveLocal() {
  try { localStorage.setItem(LOCAL_KEY, serializeDesign(design(), body.faces.length / 3)); } catch { /* storage may be blocked: the file save still works */ }
}
function restoreLocal() {
  try {
    const text = localStorage.getItem(LOCAL_KEY);
    if (!text) return;
    ({ seams, panels } = parseDesign(text, body.faces.length / 3));
  } catch { /* nothing saved, or saved for another mesh: start empty */ }
}

// Panels: a region of the body enclosed by seams. Each is remembered by a point inside it (so it follows the seams
// and the body), cut out of the mesh, tinted on the body and flattened with its own ease. The cutting and flattening
// run in a worker (a panel takes about a second); the page draws what comes back.
type Panel = PanelSeed;
let panels: Panel[] = [];
let pickingPanel = false;
let pickingSide = -1; // the hanging panel whose side seam is being chosen
let outlines: [number, number][][] = []; // the flat outline of each panel, for tests
const PANEL_COLORS = [0x2a9d8f, 0xe9c46a, 0xe76f51, 0x6a4c93, 0x4361ee];

/** Strain colours: red where a piece would have to stretch to lie flat, blue where it would have to squeeze, near-white where it fits. */
function strainRgb(strain: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, strain / 0.03));
  const target: [number, number, number] = t >= 0 ? [0.84, 0.15, 0.16] : [0.12, 0.47, 0.71];
  const base: [number, number, number] = [0.92, 0.92, 0.92];
  return base.map((b, i) => b + (target[i] - b) * Math.abs(t)) as [number, number, number];
}
const strainCss = (strain: number) => `rgb(${strainRgb(strain).map((v) => Math.round(255 * v)).join(',')})`;

// Cloth simulations take seconds, so they run only when asked for and are kept until the panel's shape changes.
const clothCache = new Map<string, ClothPatternResult[]>();
/** The panels as they are now, ready to simulate (set each time the panels are drawn); the button runs it. */
let lastGarment: { key: string; pieces: ClothPiece[]; targets: Float64Array } | undefined;
// A key for a set of arrays (two independent 32-bit hashes of each, and its length) so a stale simulation is never shown for a changed panel.
const signature = (...arrays: ArrayLike<number>[]) => arrays.map((a) => { let h1 = 0; let h2 = 2166136261; for (let i = 0; i < a.length; i++) { const x = Math.round(a[i] * 1e4); h1 = (Math.imul(h1, 31) + x) | 0; h2 = Math.imul(h2 ^ x, 16777619); } return `${a.length}:${h1}:${h2}`; }).join('/');
const clothOn = () => ($<HTMLInputElement>('cloth-on')).checked;
const drapeOn = () => ($<HTMLInputElement>('drape-on')).checked;
const colourBy = () => ($<HTMLSelectElement>('panel-colour')).value;
/** Pale blue where the cloth rests on the body, through to deep orange at 1.2 cm or more off it. */
const liftRgb = (gap: number): [number, number, number] => { const t = Math.min(1, gap / 1.2); return [0.75 + 0.2 * t, 0.88 - 0.58 * t, 0.95 - 0.9 * t]; };

const panelsWorker = new Worker(new URL('./panels.worker.ts', import.meta.url), { type: 'module' });
let panelsRequest = 0; // the newest request: older answers are dropped
const panelsWaiting = new Map<number, () => void>();
const panelsFailed = (message: string) => {
  $('panels').style.opacity = '';
  $('panels').innerHTML = `<div class="item error"><span class="bad">The panels could not be made: ${message}. Your seams are unchanged: change one and try again.</span></div>`;
};
panelsWorker.onmessage = (e: MessageEvent<PanelsResponse>) => {
  const r = e.data;
  if (r.id === panelsRequest) { if ('error' in r) panelsFailed(r.error); else renderPanels(r.result); }
  panelsWaiting.get(r.id)?.();
  panelsWaiting.delete(r.id);
};
panelsWorker.onerror = (e) => {
  panelsFailed(e.message || 'the panel worker crashed');
  panelsWaiting.forEach((done) => done());
  panelsWaiting.clear();
};

/** Cuts and flattens the panels in the worker and draws them; resolves when this request has been answered. */
function refreshPanels(): Promise<void> {
  const id = ++panelsRequest;
  if (panels.length === 0) {
    for (const c of [...panelGroup.children]) { panelGroup.remove(c); disposeTree(c); }
    $('panels').style.opacity = '';
    $('panels').innerHTML = '<span class="hint">No panels yet. Close some seams, press Make a panel, then click inside them.</span>';
    $<SVGSVGElement & HTMLElement>('flat').style.display = 'none';
    outlines = [];
    render();
    return Promise.resolve();
  }
  $('panels').style.opacity = '0.5'; // the old pieces stay until the new ones are ready
  return new Promise((resolve) => {
    panelsWaiting.set(id, resolve);
    panelsWorker.postMessage({ id, positions: shapePositions, triangles: body.faces, seams, panels, drapeOn: drapeOn() } satisfies PanelsRequest);
  });
}
const changePanels = () => { saveLocal(); return refreshPanels(); };

function renderPanels(result: PanelsResult) {
  for (const c of [...panelGroup.children]) { panelGroup.remove(c); disposeTree(c); }
  const svg = $<SVGSVGElement & HTMLElement>('flat');
  $('panels').style.opacity = '';
  const rows: string[] = [];
  const shapes: string[] = [];
  const labels: string[] = [];
  outlines = [];
  const allowance = Math.max(0, parseFloat($<HTMLInputElement>('allowance').value) || 0);
  let x = 0;
  let top = 0;
  // Which panels each seam is a side of: a seam with two panels is a shared seam line (sewn together).
  const panelsOfSeam = new Map<number, number[]>();
  result.panels.forEach((d, i) => { if (d.error === undefined) d.edges.forEach((e) => { if (e.seam !== undefined) panelsOfSeam.set(e.seam, [...(panelsOfSeam.get(e.seam) ?? []), i]); }); });
  // The cloth simulation works on all the flattened panels together, sewn at the seams they share.
  const flattened = result.panels.map((_, i) => i).filter((i) => result.panels[i].error === undefined && !(result.panels[i] as PanelFlat).hanging);
  const flatPanel = (i: number) => result.panels[i] as PanelFlat;
  const clothKey = flattened.map((i) => signature(flatPanel(i).draped.positions, flatPanel(i).flat.uv, flatPanel(i).sub.vertexMap)).join('|');
  lastGarment = flattened.length ? { key: clothKey, pieces: flattened.map((i) => ({ mesh: flatPanel(i).draped, flat: flatPanel(i).flat.uv, vertexMap: flatPanel(i).sub.vertexMap })), targets: result.taut } : undefined;
  const garment = clothOn() ? clothCache.get(clothKey) : undefined; // simulations are run by the button, not here
  result.panels.forEach((d, i) => {
    const color = PANEL_COLORS[i % PANEL_COLORS.length];
    const hex = '#' + color.toString(16).padStart(6, '0');
    const hang = panels[i]?.hang;
    const hangInputs = hang ? `<label title="Length from the seam down to the hem (cm)">length <input type="number" step="1" min="1" value="${hang.length}" data-hang="${i}" data-field="length">cm</label><label title="How much wider the hem is than the seam, %">flare <input type="number" step="5" value="${hang.flare}" data-hang="${i}" data-field="flare">%</label>` : '';
    const ease = `<div class="item-head"><span style="width:10px;height:10px;border-radius:2px;background:${hex}"></span><b>Panel ${i + 1}${hang ? ` (${hang.fitted ? 'fitted, ' : ''}${hang.half === undefined ? '' : hang.half === 0 ? 'half 1, ' : 'half 2, '}hangs from seam ${hang.seam + 1})` : ''}</b>${hangInputs}${hang && seams[hang.seam]?.closed ? `<button data-side-panel="${i}" title="Then click on the body where the side seam should be">${pickingSide === i ? 'Click the body� (cancel)' : 'Choose side seam'}</button>` : ''}<label title="Ease, % across">ease across <input type="number" step="1" value="${panels[i]?.horizontal ?? 0}" data-panel="${i}" data-axis="horizontal">%</label><label title="Ease, % down">down <input type="number" step="1" value="${panels[i]?.vertical ?? 0}" data-panel="${i}" data-axis="vertical">%</label><button data-delete-panel="${i}" title="Remove this panel">✕</button></div>`;
    if (d.error !== undefined) { rows.push(`<div class="item error">${ease}<span class="bad">${d.error}</span></div>`); return; }
    const flat = d.flat;
    // Cloth simulation: lay the flat patterns over the body, sewn together along shared seams, keeping every edge its
    // pattern length. What is left of stretch is real; where the patterns cannot reach the seam lines without stretching, the seam falls short instead.
    const cloth = garment?.[flattened.indexOf(i)]; // undefined for a hanging panel, which is not part of the cloth simulation
    const clothStale = clothOn() && !cloth;
    const shape = cloth ? cloth.mesh : d.draped;
    const gap = cloth ? cloth.gap : d.gap;
    const strain = cloth ?? flat; // the stretch between the 3D shape shown and the pattern drawn
    const pat = cloth ?? flat; // the pattern: the cloth's own flattening when simulated
    const tooCurved = strain.worstStrain > FLATTEN_TOLERANCE;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(shape.positions), 3));
    g.setIndex(new THREE.BufferAttribute(shape.triangles, 1));
    const byLift = colourBy() === 'lift';
    if (byLift || tooCurved) { // colour the piece by lift off the body, or by how much it would have to stretch (red) or squeeze (blue) to lie flat
      const colors = new Float32Array(d.draped.positions.length);
      d.sub.vertexMap.forEach((_, subVertex) => { colors.set(byLift ? liftRgb(gap[subVertex]) : strainRgb(strain.vertexStrain[subVertex]), 3 * subVertex); });
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    panelGroup.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: byLift || tooCurved ? 0xffffff : color, vertexColors: byLift || tooCurved, transparent: true, opacity: byLift ? 0.9 : 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide })));
    const ox = x; // where this panel starts in the flat view
    const xs = d.loop.map((v) => pat.uv[2 * v]);
    const ys = d.loop.map((v) => pat.uv[2 * v + 1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    outlines.push(d.loop.map((v) => [pat.uv[2 * v], pat.uv[2 * v + 1]] as [number, number]));
    // Flat piece drawn in the page's units (cm), y pointing down, room left all round for the seam allowance.
    const place = (v: number): [number, number] => [pat.uv[2 * v] - x0 + ox + allowance, y1 - pat.uv[2 * v + 1] + allowance];
    const at = (v: number) => place(v).map((c) => c.toFixed(2)).join(',');
    if (tooCurved) { // the flat piece too, coloured by stretch, with a red outline: this one is not a valid pattern piece
      const tri = d.sub.mesh.triangles;
      for (let t = 0; t < tri.length; t += 3) {
        const mean = (strain.vertexStrain[tri[t]] + strain.vertexStrain[tri[t + 1]] + strain.vertexStrain[tri[t + 2]]) / 3;
        shapes.push(`<path fill="${strainCss(mean)}" stroke="${strainCss(mean)}" stroke-width="0.05" d="M${at(tri[t])}L${at(tri[t + 1])}L${at(tri[t + 2])}Z"/>`);
      }
      shapes.push(`<path fill="none" stroke="#c00" stroke-width="0.5" stroke-dasharray="1.2 0.8" d="M${d.loop.map(at).join('L')}Z"/>`);
    } else {
      shapes.push(`<path fill="${hex}" fill-opacity="0.35" stroke="${hex}" stroke-width="0.3" d="M${d.loop.map(at).join('L')}Z"/>`);
      if (allowance > 0) shapes.push(`<path fill="none" stroke="#222" stroke-width="0.25" stroke-dasharray="1 0.6" d="M${offsetOutline(d.loop.map(place), allowance).map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).join('L')}Z"/>`);
    }
    x += x1 - x0 + 4 + 2 * allowance;
    top = Math.max(top, y1 - y0 + 2 * allowance);
    const subOf = new Map(d.sub.vertexMap.map((cutVertex, subVertex) => [cutVertex, subVertex]));
    const flatLength = (vs: number[]) => vs.slice(1).reduce((sum, v, k) => { const [a, b] = [subOf.get(vs[k])!, subOf.get(v)!]; return sum + Math.hypot(pat.uv[2 * a] - pat.uv[2 * b], pat.uv[2 * a + 1] - pat.uv[2 * b + 1]); }, 0);
    const drapedLength = (vs: number[]) => vs.slice(1).reduce((sum, v, k) => { const [a, b] = [subOf.get(vs[k])!, subOf.get(v)!]; return sum + Math.hypot(...[0, 1, 2].map((c) => shape.positions[3 * a + c] - shape.positions[3 * b + c]) as [number, number, number]); }, 0);
    const sides: string[] = [];
    for (const e of d.edges) {
      if (e.seam === undefined && e.name === undefined) continue;
      if (e.seam === undefined) { // a side of a hanging panel that is not on a seam: its side seam or its hem
        sides.push(`${e.name}: ${e.length.toFixed(1)} cm (flat ${flatLength(e.vertices).toFixed(1)})`);
        const [hx, hy] = place(subOf.get(e.vertices[Math.floor(e.vertices.length / 2)])!);
        labels.push(`<text x="${hx.toFixed(2)}" y="${hy.toFixed(2)}" font-size="2.2" text-anchor="middle" dominant-baseline="middle" fill="#222" stroke="#fff" stroke-width="0.6" paint-order="stroke">${e.name}: ${flatLength(e.vertices).toFixed(1)}</text>`);
        continue;
      }
      const others = (panelsOfSeam.get(e.seam) ?? []).filter((j) => j !== i).map((j) => j + 1);
      sides.push(`Seam ${e.seam + 1}: ${drapedLength(e.vertices).toFixed(1)} cm (flat ${flatLength(e.vertices).toFixed(1)})${others.length ? `, shared with panel ${others.join(', ')}` : ''}`);
      const [lx, ly] = place(subOf.get(e.vertices[Math.floor(e.vertices.length / 2)])!);
      labels.push(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-size="2.2" text-anchor="middle" dominant-baseline="middle" fill="#222" stroke="#fff" stroke-width="0.6" paint-order="stroke">${e.seam + 1}: ${flatLength(e.vertices).toFixed(1)}</text>`);
    }
    const verdict = tooCurved
      ? `<span class="bad">This piece cannot lie flat: it would stretch or squeeze by up to ${(100 * strain.worstStrain).toFixed(1)}% (limit ${(100 * FLATTEN_TOLERANCE).toFixed(1)}%). Add a dart or more seam lines through the red (stretched) and blue (squeezed) areas, then make the panel again.</span>`
      : `<span class="ok">Lies flat (worst stretch ${(100 * strain.worstStrain).toFixed(1)}%).</span>`;
    // A piece that is hopelessly out of shape (tens of percent, or many flipped triangles) is nearly always an area that
    // runs on into an arm, leg or hand: a click near the armhole lands on the arm, which is in front of the body's side.
    const limbHint = strain.worstStrain > 0.3 || pat.flippedTriangles > 0.02 * (d.sub.mesh.triangles.length / 3)
      ? '<span class="bad"><b>This area probably runs on into an arm or leg.</b> If you meant a piece of the body, remove this panel and click on the torso away from the arm (or close the seams so the area is just the piece you want).</span>'
      : '';
    if (d.hanging) { // draw the side seams and the hem on the 3D panel
      for (const e of d.edges) {
        if (!e.name) continue;
        const line = new THREE.BufferGeometry().setFromPoints(e.vertices.map((v) => new THREE.Vector3(shape.positions[3 * v], shape.positions[3 * v + 1], shape.positions[3 * v + 2])));
        panelGroup.add(new THREE.Line(line, new THREE.LineBasicMaterial({ color: e.name === 'Hem' ? 0x333333 : 0x10205a, depthTest: false })));
      }
    }
    const widened = d.hanging && d.flareUsed !== undefined && d.flareUsed > (hang?.flare ?? 0) + 0.5 ? ` <span class="muted">Flare widened to ${d.flareUsed.toFixed(0)}% so the panel clears the body.</span>` : '';
    const warn = pat.flippedTriangles > 0 ? ` <span class="bad">${pat.flippedTriangles} flipped triangles</span>` : '';
    rows.push(`<div class="item">${ease}<span class="muted">${(x1 - x0).toFixed(1)} x ${(y1 - y0).toFixed(1)} cm flat, ${d.size.toFixed(0)} cm² on the body; ${clothStale ? '<span class="bad">Cloth simulation is out of date or not run yet: click "Simulate cloth". Showing the drape.</span> ' : ''}${cloth ? `cloth simulation: up to ${Math.max(...gap).toFixed(1)} cm off the body, seams fall up to ${cloth.maxSeamError.toFixed(1)} cm short of their lines` : drapeOn() ? `draped up to ${Math.max(...gap).toFixed(1)} cm off the body` : 'not draped'};${warn}${widened}</span>${verdict}${limbHint}<span class="sides">${sides.join('<br>')}</span></div>`);
  });
  $('panels').innerHTML = rows.join('');
  svg.style.display = shapes.length ? 'block' : 'none';
  if (shapes.length) {
    svg.setAttribute('viewBox', `-1 -1 ${(x + 2).toFixed(1)} ${(top + 2).toFixed(1)}`);
    svg.setAttribute('height', String(Math.min(400, Math.max(60, (312 * (top + 2)) / (x + 2)))));
    svg.innerHTML = shapes.join('') + labels.join('');
  }
  $('panels').querySelectorAll<HTMLInputElement>('input[data-panel]').forEach((el) => {
    el.onchange = () => { checkpoint(); panels[Number(el.dataset.panel)][el.dataset.axis as 'horizontal' | 'vertical'] = Number(el.value) || 0; void changePanels(); };
  });
  $('panels').querySelectorAll<HTMLInputElement>('input[data-hang]').forEach((el) => {
    el.onchange = () => {
      const h = panels[Number(el.dataset.hang)].hang!;
      const value = Number(el.value);
      if (el.dataset.field === 'length' && !(value > 0)) { el.value = String(h.length); return; }
      checkpoint();
      h[el.dataset.field as 'length' | 'flare'] = Number.isFinite(value) ? value : 0;
      void changePanels();
    };
  });
  $('panels').querySelectorAll<HTMLButtonElement>('button[data-side-panel]').forEach((el) => {
    el.onclick = () => {
      const i = Number(el.dataset.sidePanel);
      pickingSide = pickingSide === i ? -1 : i;
      el.textContent = pickingSide === i ? 'Click the body� (cancel)' : 'Choose side seam';
      renderer.domElement.style.cursor = pickingSide >= 0 ? 'crosshair' : '';
    };
  });
  $('panels').querySelectorAll<HTMLButtonElement>('button[data-delete-panel]').forEach((el) => {
    el.onclick = () => { checkpoint(); panels.splice(Number(el.dataset.deletePanel), 1); void changePanels(); };
  });
  render();
}
$('hang-make').onclick = () => {
  const index = Math.round(Number($<HTMLInputElement>('hang-seam').value)) - 1;
  const length = Number($<HTMLInputElement>('hang-length').value);
  const flare = Number($<HTMLInputElement>('hang-flare').value) || 0;
  const note = $('hang-note');
  if (!seams[index] || seams[index].points.length < 2) { note.textContent = `Seam ${index + 1} does not exist yet or has fewer than 2 points.`; return; }
  if (!(length > 0)) { note.textContent = 'Give a length above 0.'; return; }
  note.textContent = '';
  checkpoint();
  const fitted = $<HTMLInputElement>('hang-fitted').checked ? { fitted: true } : {};
  if (seams[index].closed && seams[index].points.length > 2 && $<HTMLInputElement>('hang-two').checked) {
    // The side seams go where the seam is furthest out to the side, and opposite.
    const path = graph.seamPath(shapePositions, seams[index]);
    let side = 0;
    for (let i = 3; i < path.length; i += 3) if (Math.abs(path[i]) > Math.abs(path[side])) side = i;
    const seed = closestSurfacePoint(bodyMesh(), [path[side], path[side + 1], path[side + 2]]);
    for (const half of [0, 1] as const) panels.push({ seed: { tri: seed.tri, bary: seed.bary }, horizontal: 0, vertical: 0, hang: { seam: index, length, flare, ...fitted, half } });
  } else panels.push({ seed: seams[index].points[0], horizontal: 0, vertical: 0, hang: { seam: index, length, flare, ...fitted } });
  void changePanels();
};
$('allowance').onchange = () => { if (panels.length) void refreshPanels(); };
$('panel-pick').onclick = () => {
  pickingPanel = !pickingPanel;
  $('panel-pick').classList.toggle('active', pickingPanel);
  $('panel-pick').textContent = pickingPanel ? 'Click inside the seams… (cancel)' : 'Make a panel';
  renderer.domElement.style.cursor = pickingPanel ? 'crosshair' : '';
};
$('drape-on').onchange = () => refreshPanels();
$('cloth-on').onchange = () => refreshPanels();
/** What the overlay says for each step of the simulation, in plain words. */
function describeProgress(p: ClothProgress): { text: string; detail: string } {
  const percent = Math.round(100 * p.fraction);
  if (p.stage === 'flattening') return { text: `Flattening the cloth into patterns (round ${p.round} of ${p.rounds})`, detail: `Opening the draped cloth out flat to see what shape each piece should be cut. ${percent}% done.` };
  return p.round === 1
    ? { text: 'Laying the panels over the body', detail: `Every edge keeps the length it has on the flat pattern, the cloth cannot go inside the body, and panels sewn together are pulled on at their seams. ${percent}% done.` }
    : { text: `Fitting the patterns to the cloth (round ${p.round} of ${p.rounds})`, detail: `Settling the cloth again against its new patterns so sewn panels agree along their seams. ${percent}% done.` };
}

// Paint, then carry on: lets the overlay and its progress show between steps of the simulation.
function runClothInWorker(garment: NonNullable<typeof lastGarment>): Promise<ClothPatternResult[]> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./cloth.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<ClothMessage>) => {
      const m = e.data;
      if (m.kind === 'progress') {
        const { text, detail } = describeProgress(m.progress);
        $('busy-text').textContent = text;
        $('busy-detail').textContent = detail;
        $('busy-bar').style.width = `${Math.round(100 * m.progress.fraction)}%`;
        return;
      }
      w.terminate();
      if (m.kind === 'done') resolve(m.results); else reject(new Error(m.error));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ body: bodyMesh(), pieces: garment.pieces, targets: garment.targets } satisfies ClothRequest);
  });
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

$('cloth-run').onclick = async () => {
  const button = $('cloth-run');
  const garment = lastGarment;
  if (panels.length === 0 || !garment) { // nothing to simulate: say so rather than flash the overlay
    button.textContent = 'Make a panel first';
    setTimeout(() => { button.textContent = 'Simulate cloth (slow)'; }, 2000);
    return;
  }
  button.textContent = 'Simulating…';
  $('busy-text').textContent = `Simulating cloth for ${garment.pieces.length} panel${garment.pieces.length === 1 ? '' : 's'}…`;
  $('busy-detail').textContent = 'Starting.';
  $('busy-bar').style.width = '0%';
  busyEl.classList.add('on');
  try {
    await nextFrame();
    // The simulation runs in a worker, which reports where it is every few iterations.
    const results = await runClothInWorker(garment);
    if (clothCache.size >= 10) clothCache.clear();
    clothCache.set(garment.key, results);
    $<HTMLInputElement>('cloth-on').checked = true;
    refreshPanels();
  } finally {
    button.textContent = 'Simulate cloth (slow)';
    busyEl.classList.remove('on');
  }
};
$('panel-colour').onchange = () => { $('lift-key').textContent = colourBy() === 'lift' ? 'Pale blue: resting on the body. Orange: 1.2 cm or more off it (bridging a hollow).' : ''; refreshPanels(); };
$('lift-key').textContent = 'Pale blue: resting on the body. Orange: 1.2 cm or more off it (bridging a hollow).';
$('panel-clear').onclick = () => { if (!panels.length) return; checkpoint(); panels = []; void changePanels(); };

function drawLandmarks() {
  for (const c of [...landmarkGroup.children]) { landmarkGroup.remove(c); disposeTree(c); }
  if (!$<HTMLInputElement>('draw').checked) return;
  for (const g of guides) { // the lines a seam is usually drawn through, faint, with the places they cross the body's centre lines and sides
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.points), 3));
    landmarkGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x1b9aaa, transparent: true, opacity: 0.55 })));
  }
  const dots: [SnapTarget[], number, number][] = [[ringTargets, 0x1b9aaa, 0.4], [landmarks, 0x10a040, 0.55]];
  for (const [list, color, size] of dots) {
    for (const l of list) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(size), new THREE.MeshBasicMaterial({ color }));
      dot.position.set(...l.point);
      landmarkGroup.add(dot);
    }
  }
}
$('draw').onchange = () => { drawLandmarks(); $('hover').style.display = 'none'; render(); };
renderer.domElement.addEventListener('pointerleave', () => { $('hover').style.display = 'none'; });

const ndc = (e: PointerEvent) => {
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
};
/** The body point under the pointer, or undefined. */
function pick(e: PointerEvent) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc(e), camera);
  const hit = raycast(bodyMesh(), [ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z], [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z]);
  return hit && { surface: { tri: hit.tri, bary: hit.bary }, at: pointOnSurface(bodyMesh(), hit), t: hit.t };
}
/** How many cm a screen pixel covers at a point on the body (so snapping and grabbing feel the same at any zoom). */
const pixelCm = (at: [number, number, number]) =>
  (2 * camera.position.distanceTo(new THREE.Vector3(...at)) * Math.tan((camera.fov * Math.PI) / 360)) / renderer.domElement.clientHeight;
const SNAP_PIXELS = 10;
const GRAB_PIXELS = 8;
const drawing = () => $<HTMLInputElement>('draw').checked && !!body && !pickingPanel;

/** Snap targets for a new or moved point: the landmarks, and every other seam point (so seams can meet). */
function targets(skip?: { seam: number; index: number }): SnapTarget[] {
  const m = bodyMesh();
  const out = [...landmarks, ...ringTargets];
  seams.forEach((seam, si) => seam.points.forEach((p, i) => {
    if (!(skip && skip.seam === si && skip.index === i)) out.push({ name: `seam ${si + 1} point ${i + 1}`, point: pointOnSurface(m, p), surface: p });
  }));
  return out;
}
/**
 * Snap by what the user sees: targets within SNAP_PIXELS of the pointer on screen and not hidden behind the body.
 * (Distance in space is the wrong test: a landmark on a steep part of the body, like the neck point, is a
 * centimetre or more away in depth from a click a few pixels off it.)
 */
/** The guide lines in the shape nearestOnSeams takes: one "seam" per line, one leg each. */
const guideLegs = () => guides.map((g) => [g.points]);
function snapAt(e: PointerEvent, hit: NonNullable<ReturnType<typeof pick>>, skip?: { seam: number; index: number }) {
  const rect = renderer.domElement.getBoundingClientRect();
  const onScreen = (p: [number, number, number]) => {
    const v = new THREE.Vector3(...p).project(camera);
    const hidden = Math.abs(camera.position.distanceTo(new THREE.Vector3(...p)) - hit.t) > 3;
    return hidden ? Infinity : Math.hypot(rect.left + ((v.x + 1) / 2) * rect.width - e.clientX, rect.top + ((1 - v.y) / 2) * rect.height - e.clientY);
  };
  const mesh = bodyMesh();
  // 1. a landmark or the end of another seam; 2. any point along another seam (a new junction); 3. a mesh vertex.
  const visible = targets(skip).filter((t) => onScreen(t.point) <= SNAP_PIXELS);
  const named = snapPoint(mesh, hit.surface, visible, Infinity, 0);
  if (named.target) return { ...named, junction: undefined };
  // A seam can end on its own earlier legs only through its control points, so the seam being drawn or dragged is skipped.
  const own = skip ? skip.seam : activeSeam() && !activeSeam().closed ? seams.length - 1 : -1;
  const along = nearestOnSeams(seamLegs, onScreen, SNAP_PIXELS, own);
  if (along) return { point: closestSurfacePoint(mesh, along.at) as SurfacePoint, target: `seam ${along.seam + 1}`, junction: { seam: along.seam, leg: along.leg, at: along.at } };
  const guide = nearestOnSeams(guideLegs(), onScreen, SNAP_PIXELS);
  if (guide) return { point: closestSurfacePoint(mesh, guide.at) as SurfacePoint, target: guides[guide.seam].name, junction: undefined };
  return { point: snapToVertex(mesh, hit.surface, SNAP_PIXELS * pixelCm(hit.at)), target: undefined, junction: undefined };
}
/** The control point under the pointer, measured on screen like snapping is. */
function grabAt(e: PointerEvent, hit: NonNullable<ReturnType<typeof pick>>) {
  const rect = renderer.domElement.getBoundingClientRect();
  // While a seam is being drawn the other seams are locked: only the open one can be grabbed, so a click on another
  // seam's point snaps to it (sharing the point) instead of dragging it.
  const open = activeSeam() && !activeSeam().closed ? seams.length - 1 : -1;
  const grabbable = open >= 0 ? [activeSeam()] : seams;
  const found = findControlPoint(bodyMesh(), grabbable, (p) => {
    const v = new THREE.Vector3(...p).project(camera);
    const hidden = Math.abs(camera.position.distanceTo(new THREE.Vector3(...p)) - hit.t) > 3;
    return hidden ? Infinity : Math.hypot(rect.left + ((v.x + 1) / 2) * rect.width - e.clientX, rect.top + ((1 - v.y) / 2) * rect.height - e.clientY);
  }, GRAB_PIXELS);
  return found && open >= 0 ? { seam: open, index: found.index } : found;
}
const setSnapNote = (name?: string) => { $('snap').textContent = name ? `Snapped to ${name}` : ''; };

// Gesture: a press on a control point drags it (shift deletes it); a press elsewhere that is released without
// moving adds a point; anything else is the orbit control turning the view.
let down: { x: number; y: number } | undefined;
let dragging: { seam: number; index: number } | undefined;
let grabbedFrom: { x: number; y: number } | undefined; // where the press on a control point began, to tell a click from a drag
let dragRecorded = false; // the state before a drag is put in the history once, when the point first moves
let draggedOnto:ReturnType<typeof snapAt>['junction']; // where a dragged point would join the middle of another seam, applied when it is dropped
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
  if (!drawing()) return;
  const hit = pick(e);
  const grab = hit && grabAt(e, hit);
  if (!grab) return;
  e.stopImmediatePropagation(); // capture phase: the orbit control never sees this press
  down = undefined;
  grabbedFrom = { x: e.clientX, y: e.clientY };
  if (e.shiftKey) {
    checkpoint();
    seams[grab.seam].points.splice(grab.index, 1);
    if (seams[grab.seam].points.length < 3) seams[grab.seam].closed = false;
    if (seams[grab.seam].points.length === 0) seams.splice(grab.seam, 1);
    redrawSeams();
    return;
  }
  dragging = grab;
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!drawing()) return;
  const hit = pick(e);
  if (dragging) {
    if (!hit) return;
    const snapped = snapAt(e, hit, dragging);
    if (!dragRecorded) { checkpoint(); dragRecorded = true; }
    seams[dragging.seam].points[dragging.index] = snapped.point;
    draggedOnto = snapped.junction;
    setSnapNote(snapped.target);
    drawSeams(); // the panels are re-cut when the drag ends, not on every move
    render();
    return;
  }
  renderer.domElement.style.cursor = hit && grabAt(e, hit) ? 'grab' : '';
  // Say what a click here would snap to.
  const label = $('hover');
  const target = hit && !grabAt(e, hit) ? snapAt(e, hit).target : undefined;
  label.textContent = target ?? '';
  label.style.display = target ? 'block' : 'none';
  if (target) { label.style.left = `${e.clientX + 14}px`; label.style.top = `${e.clientY + 12}px`; }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (dragging) {
    const clicked = grabbedFrom && Math.hypot(e.clientX - grabbedFrom.x, e.clientY - grabbedFrom.y) <= 4;
    grabbedFrom = undefined;
    // A click (not a drag) on the first point of the seam being drawn closes it.
    if (clicked && dragging.index === 0 && dragging.seam === seams.length - 1 && !activeSeam().closed && activeSeam().points.length > 1) {
      if (!dragRecorded) checkpoint();
      dragRecorded = false;
      activeSeam().closed = true;
      draggedOnto = undefined;
      dragging = undefined;
      renderer.domElement.releasePointerCapture(e.pointerId);
      setSnapNote();
      redrawSeams();
      return;
    }
    if (draggedOnto) seams[dragging.seam].points[dragging.index] = insertControlPoint(bodyMesh(), seams[draggedOnto.seam], draggedOnto.leg, draggedOnto.at);
    draggedOnto = undefined;
    dragRecorded = false;
    dragging = undefined;
    renderer.domElement.releasePointerCapture(e.pointerId);
    redrawSeams();
    return;
  }
  const start = down;
  down = undefined;
  if (!start || !body || !($<HTMLInputElement>('draw').checked || pickingPanel || pickingSide >= 0)) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
  const hit = pick(e);
  if (!hit) return;
  if (pickingSide >= 0) { // the side seam of a hanging panel goes where the click is (the panel cuts open at the nearest point of its seam)
    checkpoint();
    const picked = panels[pickingSide].hang!;
    for (const q of panels) if (q.hang && q.hang.seam === picked.seam && (q === panels[pickingSide] || (q.hang.half !== undefined && picked.half !== undefined))) q.seed = hit.surface; // both halves of a skirt share their side seams
    pickingSide = -1;
    renderer.domElement.style.cursor = '';
    void changePanels();
    return;
  }
  if (pickingPanel) {
    checkpoint();
    panels.push({ seed: hit.surface, horizontal: 0, vertical: 0 });
    pickingPanel = false;
    $('panel-pick').textContent = 'Make a panel';
    $('panel-pick').classList.remove('active');
    renderer.domElement.style.cursor = '';
    void changePanels();
    return;
  }
  checkpoint();
  if (!activeSeam() || activeSeam().closed) seams.push({ points: [], closed: false });
  const snapped = snapAt(e, hit);
  activeSeam().points.push(snapped.junction ? insertControlPoint(bodyMesh(), seams[snapped.junction.seam], snapped.junction.leg, snapped.junction.at) : snapped.point);
  setSnapNote(snapped.target);
  redrawSeams();
});
// Test hooks (the e2e script drives the real page with them): where a landmark is on screen, and what the seams hold.
(window as unknown as Record<string, unknown>).screenOf = (name: string) => {
  const l = landmarks.find((k) => k.name === name);
  if (!l) return undefined;
  const v = new THREE.Vector3(...l.point).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
};
(window as unknown as Record<string, unknown>).screenOfSeamPoint = (seam: number, index: number) => {
  const p = seams[seam]?.points[index];
  if (!p) return undefined;
  const v = new THREE.Vector3(...pointOnSurface(bodyMesh(), p)).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
};
(window as unknown as Record<string, unknown>).screenOfPoint = (p: [number, number, number]) => {
  const v = new THREE.Vector3(...p).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
};
(window as unknown as Record<string, unknown>).landmarkPoints = () => landmarks.map((l) => ({ name: l.name, point: l.point }));
(window as unknown as Record<string, unknown>).seamFromPoints = (points: [number, number, number][], closed: boolean) => {
  // A point with z = 999 is "the front of the body at this x and y".
  const place = (p: [number, number, number]): SurfacePoint => {
    const hit = p[2] === 999 ? raycast(bodyMesh(), [p[0], p[1], 300], [0, 0, -1]) : undefined;
    return hit ? { tri: hit.tri, bary: hit.bary } : closestSurfacePoint(bodyMesh(), p);
  };
  checkpoint();
  seams.push({ points: points.map(place), closed });
  redrawSeams();
};
(window as unknown as Record<string, unknown>).panelAt = async (point: [number, number, number], horizontal = 0, vertical = 0) => {
  const hit = point[2] === 999 ? raycast(bodyMesh(), [point[0], point[1], 300], [0, 0, -1]) : undefined;
  panels.push({ seed: hit ? { tri: hit.tri, bary: hit.bary } : closestSurfacePoint(bodyMesh(), point), horizontal, vertical });
  await changePanels();
  return outlines[outlines.length - 1];
};
// A seam point can also be given as a ray ({ origin, dir }: the first body point it hits) or a place ({ point }).
type PointSpec = { origin: [number, number, number]; dir: [number, number, number] } | { point: [number, number, number] };
const placeSpec = (spec: PointSpec): SurfacePoint => {
  if ('point' in spec) return closestSurfacePoint(bodyMesh(), spec.point);
  const hit = raycast(bodyMesh(), spec.origin, spec.dir)!;
  return { tri: hit.tri, bary: hit.bary };
};
(window as unknown as Record<string, unknown>).seamFromSpecs = (specs: PointSpec[], closed: boolean) => {
  checkpoint();
  seams.push({ points: specs.map(placeSpec), closed });
  redrawSeams();
};
(window as unknown as Record<string, unknown>).panelAtSpec = async (spec: PointSpec) => {
  panels.push({ seed: placeSpec(spec), horizontal: 0, vertical: 0 });
  await changePanels();
  return outlines[outlines.length - 1];
};
(window as unknown as Record<string, unknown>).seamPathPoint = (seam: number, fraction: number) => {
  const poly = graph.seamPath(shapePositions, seams[seam]);
  const total = polylineLength(poly);
  let remaining = fraction * total;
  for (let i = 3; i < poly.length; i += 3) {
    const l = Math.hypot(poly[i] - poly[i - 3], poly[i + 1] - poly[i - 2], poly[i + 2] - poly[i - 1]);
    if (remaining <= l) { const t = l ? remaining / l : 0; return [0, 1, 2].map((k) => poly[i - 3 + k] + t * (poly[i + k] - poly[i - 3 + k])); }
    remaining -= l;
  }
  return poly.slice(-3);
};
(window as unknown as Record<string, unknown>).guideTargets = () => ringTargets.map((t) => ({ name: t.name, point: t.point }));
(window as unknown as Record<string, unknown>).guidePoint = (name: string, fraction: number) => {
  const g = guides.find((q) => q.name === name);
  if (!g) return undefined;
  const n = g.points.length / 3 - 1;
  const i = Math.min(n - 1, Math.floor(fraction * n));
  const t = fraction * n - i;
  return [0, 1, 2].map((k) => g.points[3 * i + k] + t * (g.points[3 * (i + 1) + k] - g.points[3 * i + k]));
};
(window as unknown as Record<string, unknown>).seamState = () => seams.map((q) => ({ closed: q.closed, points: q.points.map((p) => pointOnSurface(bodyMesh(), p)) }));
$('seam-undo').onclick = undo;
$('seam-redo').onclick = redo;
$('seam-close').onclick = () => { if (activeSeam() && activeSeam().points.length > 2 && !activeSeam().closed) { checkpoint(); activeSeam().closed = true; redrawSeams(); } };
$('seam-new').onclick = () => { if (activeSeam() && activeSeam().points.length > 0 && !activeSeam().closed) { checkpoint(); seams.push({ points: [], closed: false }); redrawSeams(); } };
$('seam-mirror').onclick = () => {
  const seam = activeSeam();
  if (!seam || seam.points.length === 0) return;
  checkpoint();
  seams.push(mirrorSeam(bodyMesh(), seam));
  setSnapNote();
  redrawSeams();
};
$('seam-clear').onclick = () => { if (!seams.length) return; checkpoint(); seams = []; redrawSeams(); };

$('design-save').onclick = () => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([serializeDesign(design(), body.faces.length / 3)], { type: 'application/json' }));
  link.download = 'seams.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  status.textContent = `Saved ${seams.length} seams and ${panels.length} panels to seams.json.`;
};
$('design-load').onclick = () => $('design-file').click();
$('design-file').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const loaded = parseDesign(await file.text(), body.faces.length / 3);
    checkpoint();
    seams = loaded.seams;
    panels = loaded.panels;
    mergeSel.clear();
    redrawSeams();
    if (!panels.length) void refreshPanels();
    status.textContent = `Opened ${seams.length} seams and ${panels.length} panels from ${file.name}.`;
  } catch (err) {
    status.innerHTML = `<span class="bad">${err instanceof Error ? err.message : String(err)}. Nothing was changed.</span>`;
  }
};

const worker = new Worker(new URL('./fit.worker.ts', import.meta.url), { type: 'module' });
let targetsAtFit: FitTargets = {};

function readTargets(): FitTargets {
  const t: FitTargets = {};
  for (const n of MEASUREMENT_NAMES) {
    const v = parseFloat($<HTMLInputElement>(`in-${n}`).value);
    if (Number.isFinite(v)) t[n] = v;
  }
  return t;
}

function showErrors(errors: Partial<Record<MeasurementName, number>>) {
  for (const n of MEASUREMENT_NAMES) {
    const e = errors[n];
    const el = $(`err-${n}`);
    el.textContent = e === undefined ? '' : (e >= 0 ? '+' : '') + e.toFixed(2);
    el.className = e === undefined ? '' : Math.abs(e) <= 0.5 ? 'ok' : 'bad';
  }
}

const fitFailed = (message: string) => {
  status.innerHTML = `<span class="bad">The fit failed: ${message}. Your measurements are unchanged: adjust them and try again.</span>`;
  $<HTMLButtonElement>('fit').disabled = false;
};
worker.onerror = (e) => fitFailed(e.message || 'the fitting worker crashed');
worker.onmessageerror = () => fitFailed('the fitting worker sent an unreadable result');
worker.onmessage = (e: MessageEvent<FitResponse>) => {
  const r = e.data;
  if ('error' in r) return fitFailed(r.error);
  show({ z: r.z, local: r.local });
  showErrors(r.errors);
  const lines = [`Fitted in ${r.iterations} iterations; largest difference ${r.maxError.toFixed(2)} cm.`];
  if (r.unmet.length) lines.push(`<span class="bad">Could not match: ${r.unmet.map((u) => `${MEASUREMENT_LABELS[u.name]} (wanted ${u.target}, got ${u.achieved.toFixed(1)})`).join('; ')}</span>`);
  for (const w of r.warnings) lines.push(`<span class="warn">Check: ${w}</span>`);
  status.innerHTML = lines.join('<br>');
  $<HTMLButtonElement>('fit').disabled = false;
};

$('fit').onclick = () => {
  targetsAtFit = readTargets();
  if (!Object.keys(targetsAtFit).length) { status.textContent = 'Enter at least one measurement.'; return; }
  $<HTMLButtonElement>('fit').disabled = true;
  status.textContent = 'Fitting… this can take 5–30 seconds.';
  worker.postMessage({ targets: targetsAtFit, options: { preset: $<HTMLSelectElement>('preset').value as 'female' | 'male' } } satisfies FitRequest);
};
$('reset').onclick = () => {
  for (const n of MEASUREMENT_NAMES) $<HTMLInputElement>(`in-${n}`).value = '';
  showErrors({});
  show({ z: body.presets[$<HTMLSelectElement>('preset').value] });
  status.textContent = 'Reset to the typical body.';
};
$<HTMLSelectElement>('preset').onchange = () => { show({ z: body.presets[$<HTMLSelectElement>('preset').value] }); showErrors({}); };
$<HTMLSelectElement>('fixture').onchange = (e) => {
  const fx = FIXTURES[(e.target as HTMLSelectElement).value];
  if (!fx) return;
  $<HTMLSelectElement>('preset').value = fx.preset;
  for (const n of MEASUREMENT_NAMES) $<HTMLInputElement>(`in-${n}`).value = fx.targets[n] !== undefined ? String(fx.targets[n]) : '';
};

loadBodyFromUrl(import.meta.env.BASE_URL + 'body')
  .then((b) => {
    body = b;
    graph = new SurfaceGraph(b.faces, b.vertexCount);
    measurer = new Measurer(b);
    restoreLocal();
    show({ z: b.presets.female });
    setControlsEnabled(true);
    updateHistoryButtons();
    status.textContent = 'Ready. Pick an example or type measurements, then press Fit body.';
  })
  .catch((err) => { status.innerHTML = `<span class="bad">Could not load the body model: ${err instanceof Error ? err.message : String(err)}. Reload the page to try again.</span>`; });
