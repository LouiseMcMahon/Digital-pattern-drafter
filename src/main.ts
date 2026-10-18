import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type BodyModel, type BodyParams, loadBodyFromUrl } from './core/bodyModel';
import { GUIDE_RINGS, ringLandmarks } from './core/guides';
import { mirrorSeam } from './core/mirror';
import { area, cutMesh, locateInCut, panelEdges, regionFrom } from './core/cut';
import { uniformEase } from './core/ease';
import type { FitTargets } from './core/fit';
import { FLATTEN_TOLERANCE, flatten } from './core/flatten';
import { boundaryLoops, extractSubmesh, len, sub } from './core/mesh';
import { FIXTURES } from './core/fixtures';
import { type Seam, type SnapTarget, type SurfacePoint, SurfaceGraph, closestSurfacePoint, findControlPoint, insertControlPoint, nearestOnSeams, polylineLength, pointOnSurface, raycast, snapPoint, snapToVertex } from './core/seam';
import { MEASUREMENT_LABELS, MEASUREMENT_NAMES, type MeasurementName, Measurer } from './core/measure';
import type { FitRequest, FitResponse } from './fit.worker';

const controls = document.getElementById('controls')!;
const threeEl = document.getElementById('three')!;

controls.innerHTML = `
  <div class="head"><h1>Digital Pattern Drafter</h1><p>Shape a body, draw seams, flatten panels.</p></div>
  <details open><summary>1 · Body</summary><div class="body">
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
  <details open><summary>2 · Seams</summary><div class="body">
    <label class="switch" title="Click the body to add points, drag a point to move it, shift-click a point to delete it. Click the first point to close the seam. Points snap to landmarks (green), the bust, waist and hip lines (teal) and other seams; a label shows what a click will snap to."><input type="checkbox" id="draw"><span><b>Draw seams</b><br><span class="hint">Click to add points · drag to move · shift-click to delete · click the first point to close</span></span></label>
    <div class="row">
      <button id="seam-undo" title="Remove the last point">Undo</button>
      <button id="seam-close" title="Join the last point back to the first">Close</button>
      <button id="seam-new" title="Finish this seam and start another">New seam</button>
      <button id="seam-mirror" title="Copy the last seam to the other side of the body (points on the centre line are shared). Draw one half, mirror it, then make a panel.">Mirror</button>
      <button id="seam-clear" class="danger">Clear</button>
    </div>
    <div id="seams"></div>
  </div></details>
  <details open><summary>3 · Panels</summary><div class="body">
    <div class="row"><button id="panel-pick" class="grow" title="Then click inside a closed set of seams">Make a panel</button><button id="panel-clear" class="danger">Clear</button></div>
    <div id="panels"></div>
    <svg id="flat" width="312" height="1" style="display:none"></svg>
  </div></details>
  <div id="status">Loading body model…</div>`;
const viewbar = document.createElement('div');
viewbar.className = 'viewbar';
viewbar.innerHTML = '<button data-view="front">Front</button><button data-view="side">Side</button><button data-view="back">Back</button><button data-view="three">3/4</button><button data-view="torso">Torso</button>';
const hoverEl = document.createElement('div');
hoverEl.id = 'hover';
const snapEl = document.createElement('div');
snapEl.id = 'snap';
threeEl.append(viewbar, snapEl);
document.body.append(hoverEl);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');
// Nothing can be used before the body model has loaded: the handlers below all need it.
const setControlsEnabled = (on: boolean) => document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('aside input, aside select, aside button, .viewbar button').forEach((el) => { el.disabled = !on; });
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
  drawLines($<HTMLInputElement>('lines').checked ? info : undefined);
  drawLandmarks();
  drawSeams();
  if (panels.length) refreshPanels();
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
const redrawSeams = () => { drawSeams(); render(); if (panels.length) refreshPanels(); };

// Panels: a region of the body enclosed by seams. Each is remembered by a point inside it (so it follows the seams
// and the body), cut out of the mesh, tinted on the body and flattened with its own ease.
interface Panel { seed: SurfacePoint; horizontal: number; vertical: number }
let panels: Panel[] = [];
let pickingPanel = false;
let outlines: [number, number][][] = []; // the flat outline of each panel, for tests
const PANEL_COLORS = [0x2a9d8f, 0xe9c46a, 0xe76f51, 0x6a4c93, 0x4361ee];
const MAX_PANEL_SHARE = 0.6; // a region bigger than this share of the body is not enclosed by the seams

/** Strain colours: red where a piece would have to stretch to lie flat, blue where it would have to squeeze, near-white where it fits. */
function strainRgb(strain: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, strain / 0.03));
  const target: [number, number, number] = t >= 0 ? [0.84, 0.15, 0.16] : [0.12, 0.47, 0.71];
  const base: [number, number, number] = [0.92, 0.92, 0.92];
  return base.map((b, i) => b + (target[i] - b) * Math.abs(t)) as [number, number, number];
}
const strainCss = (strain: number) => `rgb(${strainRgb(strain).map((v) => Math.round(255 * v)).join(',')})`;

function derivePanels() {
  const original = bodyMesh();
  const cut = cutMesh(original, graph, seams);
  const everything = area(cut.mesh, Array.from({ length: cut.mesh.triangles.length / 3 }, (_, i) => i));
  return panels.map((panel) => {
    const triangles = regionFrom(cut, locateInCut(cut, original, panel.seed));
    const size = area(cut.mesh, triangles);
    if (size > MAX_PANEL_SHARE * everything) return { panel, triangles, cut, size, error: 'The seams do not enclose this area (add seams until it is closed in).' };
    const sub = extractSubmesh(cut.mesh, triangles);
    const loops = boundaryLoops(sub.mesh);
    if (loops.length !== 1) return { panel, triangles, cut, size, error: `This area has ${loops.length} edges, so it cannot lie flat. A panel that goes right round a limb needs a seam along it.` };
    return { panel, triangles, cut, size, sub, loop: loops[0], edges: panelEdges(cut, triangles) ?? [] };
  });
}

function refreshPanels() {
  for (const c of [...panelGroup.children]) { panelGroup.remove(c); disposeTree(c); }
  const svg = $<SVGSVGElement & HTMLElement>('flat');
  const rows: string[] = [];
  if (panels.length === 0) { $('panels').innerHTML = '<span class="hint">No panels yet. Close some seams, press Make a panel, then click inside them.</span>'; svg.style.display = 'none'; render(); return; }
  const shapes: string[] = [];
  const labels: string[] = [];
  outlines = [];
  let x = 0;
  let top = 0;
  const derived = derivePanels();
  // Which panels each seam is a side of: a seam with two panels is a shared seam line (sewn together).
  const panelsOfSeam = new Map<number, number[]>();
  derived.forEach((d, i) => d.edges?.forEach((e) => { if (e.seam !== undefined) panelsOfSeam.set(e.seam, [...(panelsOfSeam.get(e.seam) ?? []), i]); }));
  derived.forEach((d, i) => {
    const color = PANEL_COLORS[i % PANEL_COLORS.length];
    const hex = '#' + color.toString(16).padStart(6, '0');
    const ease = `<div class="item-head"><span style="width:10px;height:10px;border-radius:2px;background:${hex}"></span><b>Panel ${i + 1}</b><label title="Ease, % across">ease across <input type="number" step="1" value="${d.panel.horizontal}" data-panel="${i}" data-axis="horizontal">%</label><label title="Ease, % down">down <input type="number" step="1" value="${d.panel.vertical}" data-panel="${i}" data-axis="vertical">%</label><button data-delete-panel="${i}" title="Remove this panel">✕</button></div>`;
    if (!d.sub) { rows.push(`<div class="item error">${ease}<span class="bad">${d.error}</span></div>`); return; }
    let flat: ReturnType<typeof flatten>;
    try {
      flat = flatten(d.sub.mesh, { ease: uniformEase(d.panel.horizontal, d.panel.vertical) });
    } catch (err) {
      console.error(err);
      rows.push(`<div class="item error">${ease}<span class="bad">This piece could not be flattened (${err instanceof Error ? err.message : 'unknown error'}). Check its seams and make the panel again.</span></div>`);
      return;
    }
    const tooCurved = flat.worstStrain > FLATTEN_TOLERANCE;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(d.cut.mesh.positions), 3));
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from(d.triangles.flatMap((t) => [0, 1, 2].map((k) => d.cut.mesh.triangles[3 * t + k]))), 1));
    if (tooCurved) { // colour the piece by how much it would have to stretch (red) or squeeze (blue) to lie flat
      const colors = new Float32Array(d.cut.mesh.positions.length);
      d.sub.vertexMap.forEach((cutVertex, subVertex) => { colors.set(strainRgb(flat.vertexStrain[subVertex]), 3 * cutVertex); });
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    panelGroup.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: tooCurved ? 0xffffff : color, vertexColors: tooCurved, transparent: true, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide })));
    const ox = x; // where this panel starts in the flat view
    const xs = d.loop.map((v) => flat.uv[2 * v]);
    const ys = d.loop.map((v) => flat.uv[2 * v + 1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    outlines.push(d.loop.map((v) => [flat.uv[2 * v], flat.uv[2 * v + 1]] as [number, number]));
    const at = (v: number) => `${(flat.uv[2 * v] - x0 + x).toFixed(2)},${(y1 - flat.uv[2 * v + 1]).toFixed(2)}`;
    if (tooCurved) { // the flat piece too, coloured by stretch, with a red outline: this one is not a valid pattern piece
      const tri = d.sub.mesh.triangles;
      for (let t = 0; t < tri.length; t += 3) {
        const mean = (flat.vertexStrain[tri[t]] + flat.vertexStrain[tri[t + 1]] + flat.vertexStrain[tri[t + 2]]) / 3;
        shapes.push(`<path fill="${strainCss(mean)}" stroke="${strainCss(mean)}" stroke-width="0.05" d="M${at(tri[t])}L${at(tri[t + 1])}L${at(tri[t + 2])}Z"/>`);
      }
      shapes.push(`<path fill="none" stroke="#c00" stroke-width="0.5" stroke-dasharray="1.2 0.8" d="M${d.loop.map(at).join('L')}Z"/>`);
    } else {
      shapes.push(`<path fill="${hex}" fill-opacity="0.35" stroke="${hex}" stroke-width="0.3" d="M${d.loop.map(at).join('L')}Z"/>`);
    }
    x += x1 - x0 + 4;
    top = Math.max(top, y1 - y0);
    const subOf = new Map(d.sub.vertexMap.map((cutVertex, subVertex) => [cutVertex, subVertex]));
    const flatLength = (vs: number[]) => vs.slice(1).reduce((sum, v, k) => { const [a, b] = [subOf.get(vs[k])!, subOf.get(v)!]; return sum + Math.hypot(flat.uv[2 * a] - flat.uv[2 * b], flat.uv[2 * a + 1] - flat.uv[2 * b + 1]); }, 0);
    const sides: string[] = [];
    for (const e of d.edges) {
      if (e.seam === undefined) continue;
      const others = (panelsOfSeam.get(e.seam) ?? []).filter((j) => j !== i).map((j) => j + 1);
      sides.push(`Seam ${e.seam + 1}: ${e.length.toFixed(1)} cm (flat ${flatLength(e.vertices).toFixed(1)})${others.length ? `, shared with panel ${others.join(', ')}` : ''}`);
      const mid = subOf.get(e.vertices[Math.floor(e.vertices.length / 2)])!;
      labels.push(`<text x="${(flat.uv[2 * mid] - x0 + ox).toFixed(2)}" y="${(y1 - flat.uv[2 * mid + 1]).toFixed(2)}" font-size="2.6" text-anchor="middle" dominant-baseline="middle" fill="#222" stroke="#fff" stroke-width="0.7" paint-order="stroke">${e.seam + 1}</text>`);
    }
    const verdict = tooCurved
      ? `<span class="bad">This piece cannot lie flat: it would stretch or squeeze by up to ${(100 * flat.worstStrain).toFixed(1)}% (limit ${(100 * FLATTEN_TOLERANCE).toFixed(1)}%). Add a dart or more seam lines through the red (stretched) and blue (squeezed) areas, then make the panel again.</span>`
      : `<span class="ok">Lies flat (worst stretch ${(100 * flat.worstStrain).toFixed(1)}%).</span>`;
    const warn = flat.flippedTriangles > 0 ? ` <span class="bad">${flat.flippedTriangles} flipped triangles</span>` : '';
    rows.push(`<div class="item">${ease}<span class="muted">${(x1 - x0).toFixed(1)} x ${(y1 - y0).toFixed(1)} cm flat, ${d.size.toFixed(0)} cm² on the body; ${warn}</span>${verdict}<span class="sides">${sides.join('<br>')}</span></div>`);
  });
  $('panels').innerHTML = rows.join('');
  svg.style.display = shapes.length ? 'block' : 'none';
  if (shapes.length) {
    svg.setAttribute('viewBox', `-1 -1 ${(x + 2).toFixed(1)} ${(top + 2).toFixed(1)}`);
    svg.setAttribute('height', String(Math.min(400, Math.max(60, (312 * (top + 2)) / (x + 2)))));
    svg.innerHTML = shapes.join('') + labels.join('');
  }
  $('panels').querySelectorAll<HTMLInputElement>('input[data-panel]').forEach((el) => {
    el.onchange = () => { panels[Number(el.dataset.panel)][el.dataset.axis as 'horizontal' | 'vertical'] = Number(el.value) || 0; refreshPanels(); };
  });
  $('panels').querySelectorAll<HTMLButtonElement>('button[data-delete-panel]').forEach((el) => {
    el.onclick = () => { panels.splice(Number(el.dataset.deletePanel), 1); refreshPanels(); };
  });
  render();
}
$('panel-pick').onclick = () => {
  pickingPanel = !pickingPanel;
  $('panel-pick').classList.toggle('active', pickingPanel);
  $('panel-pick').textContent = pickingPanel ? 'Click inside the seams… (cancel)' : 'Make a panel';
  renderer.domElement.style.cursor = pickingPanel ? 'crosshair' : '';
};
$('panel-clear').onclick = () => { panels = []; refreshPanels(); };

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
    dragging = undefined;
    renderer.domElement.releasePointerCapture(e.pointerId);
    redrawSeams();
    return;
  }
  const start = down;
  down = undefined;
  if (!start || !body || !($<HTMLInputElement>('draw').checked || pickingPanel)) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
  const hit = pick(e);
  if (!hit) return;
  if (pickingPanel) {
    panels.push({ seed: hit.surface, horizontal: 0, vertical: 0 });
    pickingPanel = false;
    $('panel-pick').textContent = 'Make a panel';
    $('panel-pick').classList.remove('active');
    renderer.domElement.style.cursor = '';
    refreshPanels();
    return;
  }
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
  seams.push({ points: points.map(place), closed });
  redrawSeams();
};
(window as unknown as Record<string, unknown>).panelAt = (point: [number, number, number], horizontal = 0, vertical = 0) => {
  const hit = point[2] === 999 ? raycast(bodyMesh(), [point[0], point[1], 300], [0, 0, -1]) : undefined;
  panels.push({ seed: hit ? { tri: hit.tri, bary: hit.bary } : closestSurfacePoint(bodyMesh(), point), horizontal, vertical });
  refreshPanels();
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
  seams.push({ points: specs.map(placeSpec), closed });
  redrawSeams();
};
(window as unknown as Record<string, unknown>).panelAtSpec = (spec: PointSpec) => {
  panels.push({ seed: placeSpec(spec), horizontal: 0, vertical: 0 });
  refreshPanels();
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
$('seam-undo').onclick = () => {
  if (!activeSeam()) return;
  if (activeSeam().closed) activeSeam().closed = false;
  else activeSeam().points.pop();
  if (activeSeam().points.length === 0) seams.pop();
  redrawSeams();
};
$('seam-close').onclick = () => { if (activeSeam() && activeSeam().points.length > 2) { activeSeam().closed = true; redrawSeams(); } };
$('seam-new').onclick = () => { if (activeSeam() && activeSeam().points.length > 0 && !activeSeam().closed) { seams.push({ points: [], closed: false }); redrawSeams(); } };
$('seam-mirror').onclick = () => {
  const seam = activeSeam();
  if (!seam || seam.points.length === 0) return;
  seams.push(mirrorSeam(bodyMesh(), seam));
  setSnapNote();
  redrawSeams();
};
$('seam-clear').onclick = () => { seams = []; redrawSeams(); };

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
    show({ z: b.presets.female });
    setControlsEnabled(true);
    status.textContent = 'Ready. Pick an example or type measurements, then press Fit body.';
  })
  .catch((err) => { status.innerHTML = `<span class="bad">Could not load the body model: ${err instanceof Error ? err.message : String(err)}. Reload the page to try again.</span>`; });
