import * as THREE from 'three';
import { buildFrontTorso, circumferenceAt, defaultMeasurements, type Measurements } from './core/body';
import { fabrics, type EaseField } from './core/ease';
import { flatten, stretchDemand } from './core/flatten';

const m: Measurements = structuredClone(defaultMeasurements);
const ease = { chest: 4, waist: 4, hip: 4, vertical: 0, fabric: 0 };

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
h('Horizontal ease (cm, total)');
slider('Bust', -30, 20, 1, () => ease.chest, (v) => (ease.chest = v));
slider('Waist', -30, 20, 1, () => ease.waist, (v) => (ease.waist = v));
slider('Hip', -30, 20, 1, () => ease.hip, (v) => (ease.hip = v));
h('Vertical ease');
slider('% of length', -20, 20, 1, () => ease.vertical * 100, (v) => (ease.vertical = v / 100));
h('Fabric');
const sel = document.createElement('select');
fabrics.forEach((f, i) => sel.append(new Option(f.name, String(i))));
sel.onchange = () => { ease.fabric = +sel.value; update(); };
controls.append(sel);
const report = document.createElement('div');
report.id = 'report';
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
      { y: m.hipHeight, horizontalCm: ease.hip, vertical: ease.vertical },
      { y: 0, horizontalCm: ease.waist, vertical: ease.vertical },
      { y: m.bustHeight, horizontalCm: ease.chest, vertical: ease.vertical },
    ],
  };
  const r = flatten(g.mesh, { ease: field, circumferenceAt: (y) => circumferenceAt(m, y) });

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

  const f = fabrics[ease.fabric];
  const s = stretchDemand(g.mesh, r.uv, f);
  report.className = s.fabricOk ? 'ok' : 'bad';
  report.innerHTML = `Front panel width at hem: ${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} cm<br>
    Stretch needed: ${(Math.max(0, s.maxH) * 100).toFixed(0)}% across, ${(Math.max(0, s.maxV) * 100).toFixed(0)}% down<br>
    ${f.name}: ${s.fabricOk ? 'OK' : 'exceeds fabric stretch'}<br>
    Layout error ${(r.rmsEdgeError * 100).toFixed(1)}%, flipped triangles: ${r.flippedTriangles}`;
}
update();
