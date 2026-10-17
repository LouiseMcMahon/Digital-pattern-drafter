import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildTorso, defaultMeasurements, type Measurements } from './core/body';
import type { EaseField } from './core/ease';
import { flatten } from './core/flatten';
import { boundaryLoops, extractSubmesh } from './core/mesh';

const m: Measurements = structuredClone(defaultMeasurements);
const ease = { bust: 0, waist: 0, hip: 0, vertical: 0 };
let panelTop = 'shoulder';

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
for (const k of ['bust', 'underbust', 'waist', 'hip', 'chest', 'neck', 'shoulderWidth', 'bustApexSeparation', 'bustProminence'] as const) {
  const [lo, hi] = { bust: [70, 130], underbust: [60, 120], waist: [55, 120], hip: [75, 140], chest: [70, 130], neck: [30, 46], shoulderWidth: [32, 48], bustApexSeparation: [12, 26], bustProminence: [0, 8] }[k];
  slider(k, lo, hi, 1, () => m[k], (v) => (m[k] = v));
}
h('Horizontal ease (%)');
slider('Bust', -40, 40, 1, () => ease.bust, (v) => (ease.bust = v));
slider('Waist', -40, 40, 1, () => ease.waist, (v) => (ease.waist = v));
slider('Hip', -40, 40, 1, () => ease.hip, (v) => (ease.hip = v));
h('Vertical ease (%)');
slider('Whole panel', -40, 40, 1, () => ease.vertical, (v) => (ease.vertical = v));
h('Panel top');
const sel = document.createElement('select');
for (const r of ['bust', 'chest', 'shoulder', 'neckBase']) sel.append(new Option(r, r, false, r === panelTop));
sel.onchange = () => { panelTop = sel.value; update(); };
controls.append(sel);
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
camera.position.set(0, 10, 170);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 10, 0);
orbit.update();
const render = () => renderer.render(scene, camera);
orbit.addEventListener('change', render);
function resize() {
  renderer.setSize(threeEl.clientWidth, threeEl.clientHeight);
  camera.aspect = threeEl.clientWidth / threeEl.clientHeight;
  camera.updateProjectionMatrix();
  render();
}
new ResizeObserver(resize).observe(threeEl);

const body = new THREE.Group();
scene.add(body);
const dot = new THREE.SphereGeometry(0.6);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xcc3333 });

let timer: number | undefined;
function update() {
  const torso = buildTorso(m);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(torso.mesh.positions), 3));
  geo.setIndex(Array.from(torso.mesh.triangles));
  geo.computeVertexNormals();
  body.clear();
  body.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9a08a, side: THREE.DoubleSide })));
  for (const l of torso.landmarks) {
    const d = new THREE.Mesh(dot, dotMat);
    d.position.set(torso.mesh.positions[3 * l.vertex], torso.mesh.positions[3 * l.vertex + 1], torso.mesh.positions[3 * l.vertex + 2]);
    body.add(d);
  }
  render();
  // Flattening is the slow part: wait until the sliders settle.
  clearTimeout(timer);
  timer = window.setTimeout(() => flat(torso), 150);
}

function flat(torso: ReturnType<typeof buildTorso>) {
  const field: EaseField = {
    knots: [
      { y: m.hipHeight, horizontal: ease.hip, vertical: ease.vertical },
      { y: 0, horizontal: ease.waist, vertical: ease.vertical },
      { y: m.bustHeight, horizontal: ease.bust, vertical: ease.vertical },
    ],
  };
  const topRow = torso.rowOf[panelTop];
  const keep = (t: number) => Math.floor(torso.mesh.triangles[3 * t] / torso.cols) < topRow;
  const lines: string[] = [];
  let ox = 0;
  const notes: string[] = [];
  for (const [name, tris] of [['Front', torso.frontTriangles], ['Back', torso.backTriangles]] as const) {
    const panel = extractSubmesh(torso.mesh, tris.filter(keep));
    const r = flatten(panel.mesh, { ease: field, iterations: 250 });
    const loop = boundaryLoops(panel.mesh).sort((a, b) => b.length - a.length)[0];
    const xs = Array.from({ length: r.uv.length / 2 }, (_, i) => r.uv[2 * i]);
    const ys = Array.from({ length: r.uv.length / 2 }, (_, i) => -r.uv[2 * i + 1]);
    const [x0, x1, y0] = [Math.min(...xs), Math.max(...xs), Math.min(...ys)];
    const P = (i: number) => `${(r.uv[2 * i] - x0 + ox).toFixed(2)},${(-r.uv[2 * i + 1] - y0).toFixed(2)}`;
    lines.push(`<polygon points="${loop.map(P).join(' ')}" fill="#fff6" stroke="#222" stroke-width=".4"/>`);
    const inverse = new Map(panel.vertexMap.map((v, i) => [v, i]));
    for (const l of torso.landmarks) {
      const i = inverse.get(l.vertex);
      if (i !== undefined) lines.push(`<circle cx="${P(i).split(',')[0]}" cy="${P(i).split(',')[1]}" r=".5" fill="#c33"/>`);
    }
    notes.push(`${name}: ${(x1 - x0).toFixed(1)} × ${(Math.max(...ys) - y0).toFixed(1)} cm, layout error ${(r.rmsEdgeError * 100).toFixed(1)}%, flips ${r.flippedTriangles}`);
    ox += x1 - x0 + 8;
  }
  flatEl.innerHTML = `<svg viewBox="-3 -3 ${ox + 2} ${90}" preserveAspectRatio="xMidYMid meet">${lines.join('')}</svg>`;
  report.innerHTML = notes.join('<br>');
}
update();
