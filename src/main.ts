import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type BodyModel, type BodyParams, loadBodyFromUrl } from './core/bodyModel';
import { area, cutMesh, locateInCut, regionFrom } from './core/cut';
import { uniformEase } from './core/ease';
import type { FitTargets } from './core/fit';
import { flatten } from './core/flatten';
import { boundaryLoops, extractSubmesh } from './core/mesh';
import { FIXTURES } from './core/fixtures';
import { type Seam, type SnapTarget, type SurfacePoint, SurfaceGraph, closestSurfacePoint, findControlPoint, polylineLength, pointOnSurface, raycast, snapPoint } from './core/seam';
import { MEASUREMENT_LABELS, MEASUREMENT_NAMES, type MeasurementName, Measurer } from './core/measure';
import type { FitRequest, FitResponse } from './fit.worker';

const controls = document.getElementById('controls')!;
const threeEl = document.getElementById('three')!;

controls.innerHTML = `
  <h3 style="margin:0">Body from measurements</h3>
  <p style="margin:4px 0 8px;color:#555">Enter any sewing measurements (cm). Blank ones are left to a typical body.</p>
  <label>Starting body <select id="preset"><option value="female">Woman</option><option value="male">Man</option></select></label><br>
  <label>Example <select id="fixture"><option value="">(choose)</option>${Object.entries(FIXTURES).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('')}</select></label>
  <table id="table"><thead><tr><th>Measurement</th><th>Target</th><th>Body</th><th>Diff</th></tr></thead><tbody>
  ${MEASUREMENT_NAMES.map((n) => `<tr><td>${MEASUREMENT_LABELS[n]}</td><td><input type="number" step="0.5" id="in-${n}"></td><td id="got-${n}"></td><td id="err-${n}"></td></tr>`).join('')}
  </tbody></table>
  <button id="fit">Fit body</button> <button id="reset">Reset</button>
  <div style="margin-top:6px">View: <button data-view="front">Front</button> <button data-view="side">Side</button> <button data-view="back">Back</button> <button data-view="three">3/4</button> <button data-view="torso">Torso</button></div>
  <label><input type="checkbox" id="lines"> show where each ring is measured</label>
  <h4>Seams</h4>
  <label><input type="checkbox" id="draw"> draw seams: click the body to add points, drag a point to move it, shift-click a point to delete it (drag elsewhere to turn the view). Points snap to landmarks (green) and to the ends of other seams.</label><br>
  <button id="seam-undo">Undo point</button> <button id="seam-close">Close seam</button> <button id="seam-new">Start new seam</button> <button id="seam-clear">Clear all</button>
  <h4>Panels</h4>
  <button id="panel-pick">Make a panel: click inside seams</button> <button id="panel-clear">Clear panels</button>
  <div id="panels" style="margin-top:4px"></div>
  <svg id="flat" width="340" height="1" style="margin-top:4px;background:#fff;border:1px solid #ccc;display:none"></svg>
  <div id="snap" style="margin-top:4px;color:#555;min-height:1.2em"></div>
  <div id="seams" style="margin-top:4px"></div>
  <div id="status">Loading body model…</div>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');
// Nothing can be used before the body model has loaded: the handlers below all need it.
const setControlsEnabled = (on: boolean) => controls.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button').forEach((el) => { el.disabled = !on; });
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
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view!)));
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
  mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a5a5e, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  scene.add(mesh);
  render();
  // One measurement pass: with the overlay on, the same pass also records what to draw.
  const info = measurer.inspect(shape);
  const m = info.values;
  landmarks = info.marks.filter((k) => !k.name.startsWith('crease')).map((k) => ({ name: k.name, point: k.point }));
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
  for (const c of [...seamGroup.children]) { seamGroup.remove(c); disposeTree(c); }
  const m = bodyMesh();
  const rows: string[] = [];
  seams.forEach((seam, i) => {
    const active = i === seams.length - 1;
    const color = active ? 0xd01040 : 0x1060ff;
    const path = graph.seamPath(shapePositions, seam);
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
    rows.push(`Seam ${i + 1}${active ? ' (drawing)' : ''}: ${seam.points.length} points${seam.closed ? ', closed' : ''}, ${polylineLength(path).toFixed(1)} cm`);
  });
  $('seams').innerHTML = rows.join('<br>') || '<span style="color:#555">No seams yet.</span>';
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
    return { panel, triangles, cut, size, sub, loop: loops[0] };
  });
}

function refreshPanels() {
  for (const c of [...panelGroup.children]) { panelGroup.remove(c); disposeTree(c); }
  const svg = $<SVGSVGElement & HTMLElement>('flat');
  const rows: string[] = [];
  if (panels.length === 0) { $('panels').innerHTML = '<span style="color:#555">No panels yet.</span>'; svg.style.display = 'none'; render(); return; }
  const shapes: string[] = [];
  outlines = [];
  let x = 0;
  let top = 0;
  derivePanels().forEach((d, i) => {
    const color = PANEL_COLORS[i % PANEL_COLORS.length];
    const hex = '#' + color.toString(16).padStart(6, '0');
    const ease = `<label>Panel ${i + 1} ease % across <input type="number" step="1" value="${d.panel.horizontal}" data-panel="${i}" data-axis="horizontal" style="width:48px"></label> <label>down <input type="number" step="1" value="${d.panel.vertical}" data-panel="${i}" data-axis="vertical" style="width:48px"></label> <button data-delete-panel="${i}">Remove</button>`;
    if (!d.sub) { rows.push(`<span style="color:#c00">${ease}<br>${d.error}</span>`); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(d.cut.mesh.positions), 3));
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from(d.triangles.flatMap((t) => [0, 1, 2].map((k) => d.cut.mesh.triangles[3 * t + k]))), 1));
    panelGroup.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide })));
    const flat = flatten(d.sub.mesh, { ease: uniformEase(d.panel.horizontal, d.panel.vertical) });
    const xs = d.loop.map((v) => flat.uv[2 * v]);
    const ys = d.loop.map((v) => flat.uv[2 * v + 1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    outlines.push(d.loop.map((v) => [flat.uv[2 * v], flat.uv[2 * v + 1]] as [number, number]));
    shapes.push(`<path fill="${hex}" fill-opacity="0.35" stroke="${hex}" stroke-width="0.3" d="M${d.loop.map((v) => `${(flat.uv[2 * v] - x0 + x).toFixed(2)},${(y1 - flat.uv[2 * v + 1]).toFixed(2)}`).join('L')}Z"/>`);
    x += x1 - x0 + 4;
    top = Math.max(top, y1 - y0);
    const warn = flat.flippedTriangles > 0 ? ` <span style="color:#c00">${flat.flippedTriangles} flipped triangles</span>` : '';
    rows.push(`${ease}<br><span style="color:#555">${(x1 - x0).toFixed(1)} x ${(y1 - y0).toFixed(1)} cm flat, ${d.size.toFixed(0)} cm² on the body; edge length error ${(100 * flat.rmsEdgeError).toFixed(1)}%${warn}</span>`);
  });
  $('panels').innerHTML = rows.join('<br>');
  svg.style.display = shapes.length ? 'block' : 'none';
  if (shapes.length) {
    svg.setAttribute('viewBox', `-1 -1 ${(x + 2).toFixed(1)} ${(top + 2).toFixed(1)}`);
    svg.setAttribute('height', String(Math.min(400, Math.max(60, (340 * (top + 2)) / (x + 2)))));
    svg.innerHTML = shapes.join('');
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
  $('panel-pick').textContent = pickingPanel ? 'Click inside a closed set of seams… (click again to cancel)' : 'Make a panel: click inside seams';
  renderer.domElement.style.cursor = pickingPanel ? 'crosshair' : '';
};
$('panel-clear').onclick = () => { panels = []; refreshPanels(); };

function drawLandmarks() {
  for (const c of [...landmarkGroup.children]) { landmarkGroup.remove(c); disposeTree(c); }
  if (!$<HTMLInputElement>('draw').checked) return;
  for (const l of landmarks) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0x10a040 }));
    dot.position.set(...l.point);
    landmarkGroup.add(dot);
  }
}
$('draw').onchange = () => { drawLandmarks(); render(); };

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
  const out = [...landmarks];
  seams.forEach((seam, si) => seam.points.forEach((p, i) => {
    if (!(skip && skip.seam === si && skip.index === i)) out.push({ name: `seam ${si + 1} point ${i + 1}`, point: pointOnSurface(m, p) });
  }));
  return out;
}
/**
 * Snap by what the user sees: targets within SNAP_PIXELS of the pointer on screen and not hidden behind the body.
 * (Distance in space is the wrong test: a landmark on a steep part of the body, like the neck point, is a
 * centimetre or more away in depth from a click a few pixels off it.)
 */
function snapAt(e: PointerEvent, hit: NonNullable<ReturnType<typeof pick>>, skip?: { seam: number; index: number }) {
  const rect = renderer.domElement.getBoundingClientRect();
  const visible = targets(skip).filter((t) => {
    const v = new THREE.Vector3(...t.point).project(camera);
    const px = rect.left + ((v.x + 1) / 2) * rect.width;
    const py = rect.top + ((1 - v.y) / 2) * rect.height;
    const hidden = Math.abs(camera.position.distanceTo(new THREE.Vector3(...t.point)) - hit.t) > 3;
    return !hidden && Math.hypot(px - e.clientX, py - e.clientY) <= SNAP_PIXELS;
  });
  return snapPoint(bodyMesh(), hit.surface, visible, Infinity, SNAP_PIXELS * pixelCm(hit.at));
}
/** The control point under the pointer, measured on screen like snapping is. */
function grabAt(e: PointerEvent, hit: NonNullable<ReturnType<typeof pick>>) {
  const rect = renderer.domElement.getBoundingClientRect();
  return findControlPoint(bodyMesh(), seams, (p) => {
    const v = new THREE.Vector3(...p).project(camera);
    const hidden = Math.abs(camera.position.distanceTo(new THREE.Vector3(...p)) - hit.t) > 3;
    return hidden ? Infinity : Math.hypot(rect.left + ((v.x + 1) / 2) * rect.width - e.clientX, rect.top + ((1 - v.y) / 2) * rect.height - e.clientY);
  }, GRAB_PIXELS);
}
const setSnapNote = (name?: string) => { $('snap').textContent = name ? `Snapped to ${name}` : ''; };

// Gesture: a press on a control point drags it (shift deletes it); a press elsewhere that is released without
// moving adds a point; anything else is the orbit control turning the view.
let down: { x: number; y: number } | undefined;
let dragging: { seam: number; index: number } | undefined;
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
  if (!drawing()) return;
  const hit = pick(e);
  const grab = hit && grabAt(e, hit);
  if (!grab) return;
  e.stopImmediatePropagation(); // capture phase: the orbit control never sees this press
  down = undefined;
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
    setSnapNote(snapped.target);
    drawSeams(); // the panels are re-cut when the drag ends, not on every move
    render();
    return;
  }
  renderer.domElement.style.cursor = hit && grabAt(e, hit) ? 'grab' : '';
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (dragging) { dragging = undefined; renderer.domElement.releasePointerCapture(e.pointerId); if (panels.length) refreshPanels(); return; }
  const start = down;
  down = undefined;
  if (!start || !body || !($<HTMLInputElement>('draw').checked || pickingPanel)) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
  const hit = pick(e);
  if (!hit) return;
  if (pickingPanel) {
    panels.push({ seed: hit.surface, horizontal: 0, vertical: 0 });
    pickingPanel = false;
    $('panel-pick').textContent = 'Make a panel: click inside seams';
    renderer.domElement.style.cursor = '';
    refreshPanels();
    return;
  }
  if (!activeSeam() || activeSeam().closed) seams.push({ points: [], closed: false });
  const snapped = snapAt(e, hit);
  activeSeam().points.push(snapped.point);
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
