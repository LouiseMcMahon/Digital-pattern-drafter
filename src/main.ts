import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type BodyModel, type BodyParams, loadBodyFromUrl } from './core/bodyModel';
import type { FitTargets } from './core/fit';
import { FIXTURES } from './core/fixtures';
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
  <div id="status">Loading body model…</div>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');

// 3D view
const renderer = new THREE.WebGLRenderer({ antialias: true });
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

const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  // camera x,y,z then target x,y,z
  front: [0, 100, 380, 0, 95, 0],
  side: [380, 100, 0, 0, 95, 0],
  back: [0, 100, -380, 0, 95, 0],
  three: [250, 130, 280, 0, 95, 0],
  torso: [150, 135, 190, 0, 125, 0],
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

function drawLines(shape: ReturnType<BodyModel['evaluate']>) {
  lineGroup.clear();
  if (!$<HTMLInputElement>('lines').checked) return;
  for (const r of measurer.rings(shape)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(r.points), 3));
    lineGroup.add(new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xd01040 })));
  }
}
$('lines').onchange = () => { drawLines(body.evaluate(current)); render(); };

function show(params: BodyParams) {
  current = params;
  const shape = body.evaluate(params);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(shape.positions), 3));
  geo.setIndex(new THREE.BufferAttribute(body.faces, 1));
  geo.computeVertexNormals();
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9a08a }));
  scene.add(mesh);
  render();
  drawLines(shape);
  const m = measurer.measure(shape);
  for (const n of MEASUREMENT_NAMES) $(`got-${n}`).textContent = m[n].toFixed(1);
  return m;
}

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

worker.onmessage = (e: MessageEvent<FitResponse>) => {
  const r = e.data;
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

loadBodyFromUrl(import.meta.env.BASE_URL + 'body').then((b) => {
  body = b;
  measurer = new Measurer(b);
  show({ z: b.presets.female });
  status.textContent = 'Ready. Pick an example or type measurements, then press Fit body.';
});
