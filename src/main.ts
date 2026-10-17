import * as THREE from 'three';
import { buildFrontTorso, defaultMeasurements, type Measurements } from './core/body';
import type { EaseField } from './core/ease';
import { flatten } from './core/flatten';

const m: Measurements = structuredClone(defaultMeasurements);
const ease = { bust: 0, waist: 0, hip: 0, vertical: 0 };

const controls = document.getElementById('controls')!;
const flatEl = document.getElementById('flat')!;
const threeEl = document.getElementById('three')!;

function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) {
  const l = document.createElement('label');
  const val = document.createElement('b');
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min, max, step, value: get() });
  const upd = () => (val.textContent = String(get()));
  input.oninput = () => { set(+input.value); upd(); update(); };
  l.append(label + ': ', val, input);
  upd();
  controls.append(l);
}

const h = (t: string) => { const e = document.createElement('h4'); e.textContent = t; controls.append(e); };
h('Body (cm)');
slider('Bust', 70, 130, 1, () => m.bust, (v) => (m.bust = v));
slider('Waist', 55, 120, 1, () => m.waist, (v) => (m.waist = v));
slider('Hip', 75, 140, 1, () => m.hip, (v) => (m.hip = v));
h('Horizontal ease (%)');
slider('Bust', -40, 40, 1, () => ease.bust, (v) => (ease.bust = v));
slider('Waist', -40, 40, 1, () => ease.waist, (v) => (ease.waist = v));
slider('Hip', -40, 40, 1, () => ease.hip, (v) => (ease.hip = v));
h('Vertical ease (%)');
slider('Whole panel', -40, 40, 1, () => ease.vertical, (v) => (ease.vertical = v));
const report = document.createElement('div');
report.id = 'report';
report.className = 'ok';
controls.append(report);

// 3D view
const renderer = new THREE.WebGLRenderer({ antialias: true });
threeEl.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f4f4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
const camera = new THREE.PerspectiveCamera(35, 1, 1, 1000);
camera.position.set(0, 10, 160);
let torso: THREE.Mesh | undefined;
function resize() {
  const { clientWidth: w, clientHeight: hh } = threeEl;
  renderer.setSize(w, hh);
  camera.aspect = w / hh;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}
new ResizeObserver(resize).observe(threeEl);

function update() {
  const g = buildFrontTorso(m);
  const field: EaseField = {
    knots: [
      { y: m.hipHeight, horizontal: ease.hip, vertical: ease.vertical },
      { y: 0, horizontal: ease.waist, vertical: ease.vertical },
      { y: m.bustHeight, horizontal: ease.bust, vertical: ease.vertical },
    ],
  };
  const r = flatten(g.mesh, { ease: field });

  if (torso) { scene.remove(torso); torso.geometry.dispose(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.mesh.positions), 3));
  geo.setIndex(Array.from(g.mesh.triangles));
  geo.computeVertexNormals();
  torso = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9a08a, side: THREE.DoubleSide }));
  scene.add(torso);
  camera.lookAt(0, 8, 0);
  resize();

  // Flat pattern: outline of the grid (hem, side, top, side) as SVG.
  const { rows, cols } = g;
  const pt = (rr: number, c: number) => `${r.uv[2 * (rr * cols + c)].toFixed(2)},${(-r.uv[2 * (rr * cols + c) + 1]).toFixed(2)}`;
  const outline: string[] = [];
  for (let c = 0; c < cols; c++) outline.push(pt(0, c));
  for (let rr = 1; rr < rows; rr++) outline.push(pt(rr, cols - 1));
  for (let c = cols - 2; c >= 0; c--) outline.push(pt(rows - 1, c));
  for (let rr = rows - 2; rr > 0; rr--) outline.push(pt(rr, 0));
  const xs = Array.from({ length: r.uv.length / 2 }, (_, i) => r.uv[2 * i]);
  const ys = Array.from({ length: r.uv.length / 2 }, (_, i) => -r.uv[2 * i + 1]);
  const [x0, y0] = [Math.min(...xs) - 3, Math.min(...ys) - 3];
  const [w, hh] = [Math.max(...xs) - Math.min(...xs) + 6, Math.max(...ys) - Math.min(...ys) + 6];
  const waistRow = g.ys.findIndex((y) => y >= 0);
  const waistLine = Array.from({ length: cols }, (_, c) => pt(waistRow, c)).join(' ');
  flatEl.innerHTML = `<svg viewBox="${x0} ${y0} ${w} ${hh}"><polygon points="${outline.join(' ')}" fill="#fff6" stroke="#222" stroke-width=".4"/><polyline points="${waistLine}" fill="none" stroke="#c33" stroke-width=".3" stroke-dasharray="1 1"/></svg>`;

  const [pw, ph] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  report.innerHTML = `Front panel: ${pw.toFixed(1)} cm wide, ${ph.toFixed(1)} cm tall<br>
    Layout error ${(r.rmsEdgeError * 100).toFixed(1)}%, flipped triangles: ${r.flippedTriangles}`;
}
update();
