// Mutation testing with Stryker: `npm run mutate -- <module> [<module> ...] [--gate]` (or `all`).
// Several modules (all, changed) run in parallel, one Stryker run each, `--jobs=N` at a time (default: one per CPU).
// Each module is mutated against only the tests that exercise it, because every mutant re-runs them.
// With --gate the run FAILS if a module's score is below its minimum in mutation-thresholds.json.
// See ENGINEERING.md ("Mutation testing") for how to read the report and what the scores mean.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

const MODULES = {
  slice: { mutate: 'src/core/slice.ts', tests: ['src/core/slice.test.ts'] },
  pose: { mutate: 'src/core/pose.ts', tests: ['src/core/pose.rig.test.ts'] },
  geodesic: { mutate: 'src/core/geodesic.ts', tests: ['src/core/seam.test.ts'] },
  cut: { mutate: 'src/core/cut.ts', tests: ['src/core/cut.test.ts'] },
  mesh: { mutate: 'src/core/mesh.ts', tests: ['src/core/mesh.test.ts'] },
  ease: { mutate: 'src/core/ease.ts', tests: ['src/core/ease.test.ts'] },
  lscm: { mutate: 'src/core/lscm.ts', tests: ['src/core/lscm.test.ts'] },
  flatten: { mutate: 'src/core/flatten.ts', tests: ['src/core/flatten.test.ts', 'src/core/lscm.test.ts'] },
  body: { mutate: 'src/core/body.ts', tests: ['src/core/body.test.ts'] },
  seam: { mutate: 'src/core/seam.ts', tests: ['src/core/seam.test.ts'] },
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
const names = wanted.includes('changed') ? changedModules() : wanted.includes('all') ? Object.keys(MODULES) : wanted;
if (wanted.includes('changed')) console.log(names.length ? `changed modules: ${names.join(', ')}` : 'no mutation-tested module changed; nothing to do');
if ((names.length === 0 && !wanted.includes('changed')) || names.some((n) => !MODULES[n])) {
  console.error(`usage: npm run mutate -- <${Object.keys(MODULES).join('|')}|all|changed> ... [--gate]`);
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
  config.mutate = [mutate];
  writeFileSync(`${dir}/stryker.config.json`, JSON.stringify(config, null, 2));
  const args = ['stryker', 'run', `${dir}/stryker.config.json`];
  const env = { ...process.env, MUTATION_TESTS: tests.join(',') };
  if (!quiet) {
    console.log(`\n=== mutation testing: ${mutate} (tests: ${tests.join(', ')}) ===`);
    return Promise.resolve(spawnSync('npx', args, { stdio: 'inherit', env }).status);
  }
  const log = createWriteStream(`${dir}/stryker.log`);
  return new Promise((resolve) => {
    const child = spawn('npx', args, { env });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('close', (code) => { log.end(); resolve(code); });
  });
}

const cpuCount = cpus().length;
const jobsArg = args.find((a) => a.startsWith('--jobs='));
const jobs = Math.max(1, Math.min(names.length, jobsArg ? Number(jobsArg.slice(7)) : names.length > 1 ? Math.min(names.length, cpuCount) : 1));
const concurrency = Math.max(1, Math.floor(cpuCount / jobs)); // Stryker workers per module: the machine is shared between the jobs
// Slowest first, so the last jobs to start are the short ones.
const SLOWEST = ['flatten', 'geodesic', 'cut', 'seam', 'bodyModel', 'body', 'lscm', 'pose', 'slice'];
const queue = [...names].sort((a, b) => (SLOWEST.indexOf(a) + 1 || 99) - (SLOWEST.indexOf(b) + 1 || 99));
if (jobs > 1) console.log(`running ${names.length} modules, ${jobs} at a time, ${concurrency} Stryker worker(s) each (logs in reports/mutation/<module>/stryker.log)`);

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
    const below = gate && !(res.score >= min);
    if (below) {
      console.error(`\nMUTATION GATE FAILED for ${MODULES[name].mutate}: score ${res.score.toFixed(2)}% is below the minimum ${min}% (${res.survived} mutants survived). Open reports/mutation/${name}/index.html, kill the survivors that are real gaps, and see ENGINEERING.md, "Mutation testing".`);
      failed = true;
    }
    summary.push({ name, ...res, min, minutes, ok: !below && res.idle === 0 });
    if (jobs > 1) console.log(`  finished ${name} in ${minutes} min: ${res.score.toFixed(2)}%`);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));

console.log('\n=== mutation summary ===');
for (const name of names) {
  const s = summary.find((q) => q.name === name);
  console.log(!s || s.error ? `  ${name}: ${s?.error ?? 'did not run'}` : `  ${name.padEnd(10)} ${s.score.toFixed(2).padStart(6)}%  (minimum ${s.min}%)  ${s.detected}/${s.total} mutants detected  ${s.minutes} min  ${s.ok ? 'ok' : 'FAILED'}`);
}
process.exit(failed ? 1 : 0);
