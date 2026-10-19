// Mutation testing with Stryker: `npm run mutate -- <module> [<module> ...] [--gate]` (or `all`).
// With --diff only the lines that differ from the base branch (origin/main, or MUTATE_BASE) are mutated: `changed --diff` is the quick check while working.
// Several modules (all, changed) run in parallel, one Stryker run each, `--jobs=N` at a time (default: one per CPU).
// Each module is mutated against only the tests that exercise it, because every mutant re-runs them.
// With --gate the run FAILS if a module's score is below its minimum in mutation-thresholds.json.
// See ENGINEERING.md ("Mutation testing") for how to read the report and what the scores mean.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const MODULES = {
  slice: { mutate: 'src/core/slice.ts', tests: ['src/core/slice.test.ts'] },
  pose: { mutate: 'src/core/pose.ts', tests: ['src/core/pose.rig.test.ts'] },
  guides: { mutate: 'src/core/guides.ts', tests: ['src/core/guides.test.ts'] },
  mirror: { mutate: 'src/core/mirror.ts', tests: ['src/core/mirror.test.ts'] },
  geodesic: { mutate: 'src/core/geodesic.ts', tests: ['src/core/seam.test.ts'] },
  cut: { mutate: 'src/core/cut.ts', tests: ['src/core/cut.test.ts'] },
  bodyField: { mutate: 'src/core/bodyField.ts', tests: ['src/core/bodyField.test.ts'] },
  drape: { mutate: 'src/core/drape.ts', tests: ['src/core/drape.test.ts'] },
  cloth: { mutate: 'src/core/cloth.ts', tests: ['src/core/cloth.test.ts'] },
  mesh: { mutate: 'src/core/mesh.ts', tests: ['src/core/mesh.test.ts'] },
  ease: { mutate: 'src/core/ease.ts', tests: ['src/core/ease.test.ts'] },
  lscm: { mutate: 'src/core/lscm.ts', tests: ['src/core/lscm.test.ts'] },
  flatten: { mutate: 'src/core/flatten.ts', tests: ['src/core/flatten.test.ts', 'src/core/lscm.test.ts'] },
  body: { mutate: 'src/core/body.ts', tests: ['src/core/body.test.ts'] },
  seam: { mutate: 'src/core/seam.ts', tests: ['src/core/seam.test.ts'] },
  history: { mutate: 'src/core/history.ts', tests: ['src/core/history.test.ts'] },
  design: { mutate: 'src/core/design.ts', tests: ['src/core/design.test.ts'] },
  crossings: { mutate: 'src/core/crossings.ts', tests: ['src/core/crossings.test.ts'] },
  allowance: { mutate: 'src/core/allowance.ts', tests: ['src/core/allowance.test.ts'] },
  panelPipeline: { mutate: 'src/core/panelPipeline.ts', tests: ['src/core/panelPipeline.test.ts', 'src/core/panelPipeline.failure.test.ts'] },
  // pose.test.ts covers the default-pose path through evaluate() on the real body.
  bodyModel: { mutate: 'src/core/bodyModel.ts', tests: ['src/core/bodyModel.synthetic.test.ts', 'src/core/bodyModel.test.ts'] },
};

const args = process.argv.slice(2);
const gate = args.includes('--gate');
const wanted = args.filter((a) => !a.startsWith('--'));

/** Modules whose source or tests differ from the base branch (or are uncommitted): what a developer needs to re-check locally. */
function changedModules() {
  const git = (...a) => spawnSync('git', a, { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const base = process.env.MUTATE_BASE ?? 'origin/main';
  const files = new Set([...git('diff', '--name-only', `${base}...HEAD`), ...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')]);
  return Object.keys(MODULES).filter((n) => files.has(MODULES[n].mutate) || MODULES[n].tests.some((t) => files.has(t)));
}
const diffMode = args.includes('--diff');
/** Line ranges of a source file that differ from the base branch (committed, uncommitted or new), or undefined if none. */
function changedRanges(file) {
  const run = (...a) => spawnSync('git', a, { encoding: 'utf8' }).stdout;
  const base = process.env.MUTATE_BASE ?? 'origin/main';
  const mergeBase = run('merge-base', base, 'HEAD').trim() || base;
  const text = readFileSync(file, 'utf8');
  if (run('ls-files', '--error-unmatch', file).trim() === '') return [[1, text.split('\n').length]]; // not tracked: all of it is new
  const ranges = [];
  for (const m of run('diff', '-U0', mergeBase, '--', file).matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [start, count] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2])];
    if (count > 0) ranges.push([start, start + count - 1]);
  }
  return ranges.length ? ranges : undefined;
}
const names = wanted.includes('changed') ? changedModules() : wanted.includes('all') ? Object.keys(MODULES) : wanted;
const ranges = new Map();
if (diffMode) {
  for (const n of [...names]) {
    const r = names.includes(n) && MODULES[n] ? changedRanges(MODULES[n].mutate) : undefined;
    if (r) ranges.set(n, r);
    else names.splice(names.indexOf(n), 1);
  }
  console.log(names.length ? `mutating only the changed lines: ${names.map((n) => `${n} (${ranges.get(n).map(([a, b]) => (a === b ? a : `${a}-${b}`)).join(', ')})`).join('; ')}` : 'no changed source lines in any mutation-tested module; nothing to do');
}
if (wanted.includes('changed')) console.log(names.length ? `changed modules: ${names.join(', ')}` : 'no mutation-tested module changed; nothing to do');
if ((names.length === 0 && !wanted.includes('changed') && !diffMode) || names.some((n) => !MODULES[n])) {
  console.error(`usage: npm run mutate -- <${Object.keys(MODULES).join('|')}|all|changed> ... [--gate] [--diff] [--jobs=N]`);
  process.exit(2);
}
const thresholds = JSON.parse(readFileSync('mutation-thresholds.json', 'utf8'));

/**
 * Reads the report the run just wrote. A mutant that completed no tests "survives" by default, so a harness
 * that silently runs nothing reports low scores that look like weak tests (this happened with the Vitest
 * runner plugin): refuse to report a score the harness did not earn.
 */
function readResult(name) {
  const report = JSON.parse(readFileSync(`reports/mutation/${name}/mutation.json`, 'utf8'));
  const mutants = Object.values(report.files).flatMap((f) => f.mutants).filter((m) => !['Ignored', 'CompileError'].includes(m.status));
  const idle = mutants.filter((m) => m.status === 'Survived' && !(m.testsCompleted > 0));
  const detected = mutants.filter((m) => m.status === 'Killed' || m.status === 'Timeout').length;
  return { total: mutants.length, detected, survived: mutants.length - detected, idle: idle.length, score: (100 * detected) / Math.max(1, mutants.length) };
}

/** Runs Stryker for one module with its own report and temp folders, so several can run at once. */
function runModule(name, concurrency, quiet) {
  const { mutate, tests } = MODULES[name];
  const dir = `reports/mutation/${name}`;
  mkdirSync(dir, { recursive: true });
  // Stryker's command line cannot set the nested report paths, so each module gets its own copy of the config.
  const config = JSON.parse(readFileSync('stryker.config.json', 'utf8'));
  delete config.$schema;
  config.tempDirName = `.stryker-tmp/${name}`;
  config.htmlReporter = { fileName: `${dir}/index.html` };
  config.jsonReporter = { fileName: `${dir}/mutation.json` };
  config.concurrency = concurrency;
  config.mutate = ranges.has(name) ? ranges.get(name).map(([a, b]) => `${mutate}:${a}-${b}`) : [mutate];
  writeFileSync(`${dir}/stryker.config.json`, JSON.stringify(config, null, 2));
  // Run Stryker's own script with this node: spawning `npx` fails on Windows (it is a .cmd file).
  const args = [fileURLToPath(new URL('../node_modules/@stryker-mutator/core/bin/stryker.js', import.meta.url)), 'run', `${dir}/stryker.config.json`];
  const env = { ...process.env, MUTATION_TESTS: tests.join(',') };
  if (!quiet) {
    console.log(`\n=== mutation testing: ${mutate} (tests: ${tests.join(', ')}) ===`);
    return Promise.resolve(spawnSync(process.execPath, args, { stdio: 'inherit', env }).status);
  }
  const log = createWriteStream(`${dir}/stryker.log`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('close', (code) => { log.end(); resolve(code); });
  });
}

const cpuCount = cpus().length;
const jobsArg = args.find((a) => a.startsWith('--jobs='));
const jobs = Math.max(1, Math.min(names.length, jobsArg ? Number(jobsArg.slice(7)) : names.length > 1 ? Math.min(names.length, cpuCount) : 1));
// Stryker workers per module: the machine is shared between the jobs. MUTATE_WORKERS caps it: with every core busy the tests run slow, mutants that only run slower time out, and a timeout counts as detected, so fewer workers give the honest score.
const concurrency = process.env.MUTATE_WORKERS ? Math.max(1, Number(process.env.MUTATE_WORKERS)) : Math.max(1, Math.floor(cpuCount / jobs));
// Slowest first, so the last jobs to start are the short ones.
const SLOWEST = ['flatten', 'panelPipeline', 'geodesic', 'cut', 'seam', 'crossings', 'bodyModel', 'body', 'lscm', 'pose', 'slice'];
const queue = [...names].sort((a, b) => (SLOWEST.indexOf(a) + 1 || 99) - (SLOWEST.indexOf(b) + 1 || 99));
if (jobs > 1) console.log(`running ${names.length} modules, ${jobs} at a time, ${concurrency} Stryker worker(s) each (logs in reports/mutation/<module>/stryker.log)`);

function survivors(name) {
  const report = JSON.parse(readFileSync(`reports/mutation/${name}/mutation.json`, 'utf8'));
  return Object.values(report.files).flatMap((f) => f.mutants).filter((m) => m.status === 'Survived').map((m) => ({ line: m.location.start.line, mutator: m.mutatorName, replacement: m.replacement ?? '' })).sort((a, b) => a.line - b.line);
}

const summary = [];
let failed = false;
async function worker() {
  while (queue.length) {
    const name = queue.shift();
    const started = Date.now();
    const status = await runModule(name, concurrency, jobs > 1);
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    if (status !== 0) { failed = true; summary.push({ name, error: `stryker failed (see reports/mutation/${name}/stryker.log)` }); continue; }
    const res = readResult(name);
    const min = thresholds[name];
    if (res.idle > 0) {
      console.error(`\nHARNESS FAILURE for ${MODULES[name].mutate}: ${res.idle} of ${res.total} mutants "survived" without any test running. The score is meaningless. See ENGINEERING.md, "Mutation testing".`);
      failed = true;
    }
    // On a handful of changed lines a percentage means little: list the survivors, and apply the minimum only to a sample of 20 or more.
    const sample = !diffMode || res.total >= 20;
    if (diffMode && res.survived > 0) {
      const lines = readFileSync(MODULES[name].mutate, 'utf8').split('\n');
      console.log(`\n${name}: ${res.survived} of ${res.total} mutants on the changed lines survived; each is a test that would not notice the change (or an equivalent mutant: see ENGINEERING.md):`);
      for (const m of survivors(name)) console.log(`  ${MODULES[name].mutate}:${m.line}  ${m.mutator}  \`${lines[m.line - 1].trim().slice(0, 90)}\` -> \`${m.replacement.slice(0, 50)}\``);
    }
    const below = gate && sample && !(res.score >= min);
    if (below) {
      console.error(`\nMUTATION GATE FAILED for ${MODULES[name].mutate}: score ${res.score.toFixed(2)}% is below the minimum ${min}% (${res.survived} mutants survived). Open reports/mutation/${name}/index.html, kill the survivors that are real gaps, and see ENGINEERING.md, "Mutation testing".`);
      failed = true;
    }
    summary.push({ name, ...res, min, minutes, ok: !below && res.idle === 0, ungated: gate && !sample });
    if (jobs > 1) console.log(`  finished ${name} in ${minutes} min: ${res.score.toFixed(2)}%`);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));

console.log('\n=== mutation summary ===');
for (const name of names) {
  const s = summary.find((q) => q.name === name);
  console.log(!s || s.error ? `  ${name}: ${s?.error ?? 'did not run'}` : `  ${name.padEnd(10)} ${s.score.toFixed(2).padStart(6)}%  (minimum ${s.min}%)  ${s.detected}/${s.total} mutants detected  ${s.minutes} min  ${s.ok ? 'ok' : 'FAILED'}${s.ungated ? ' (changed lines only: too few mutants to apply the minimum, survivors listed above)' : ''}`);
}
process.exit(failed ? 1 : 0);
