// Mutation testing with Stryker: `npm run mutate -- <module> [<module> ...] [--gate]` (or `all`).
// Each module is mutated against only the tests that exercise it, because every mutant re-runs them.
// With --gate the run FAILS if a module's score is below its minimum in mutation-thresholds.json.
// See ENGINEERING.md ("Mutation testing") for how to read the report and what the scores mean.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MODULES = {
  slice: { mutate: 'src/core/slice.ts', tests: ['src/core/slice.test.ts'] },
  pose: { mutate: 'src/core/pose.ts', tests: ['src/core/pose.rig.test.ts', 'src/core/pose.test.ts'] },
  flatten: { mutate: 'src/core/flatten.ts', tests: ['src/core/flatten.test.ts'] },
  // pose.test.ts covers the default-pose path through evaluate() on the real body.
  bodyModel: { mutate: 'src/core/bodyModel.ts', tests: ['src/core/bodyModel.synthetic.test.ts', 'src/core/bodyModel.test.ts', 'src/core/pose.test.ts'] },
};

const args = process.argv.slice(2);
const gate = args.includes('--gate');
const wanted = args.filter((a) => !a.startsWith('--'));
const names = wanted.includes('all') ? Object.keys(MODULES) : wanted;
if (names.length === 0 || names.some((n) => !MODULES[n])) {
  console.error(`usage: npm run mutate -- <${Object.keys(MODULES).join('|')}|all> ... [--gate]`);
  process.exit(2);
}
const thresholds = JSON.parse(readFileSync('mutation-thresholds.json', 'utf8'));

/**
 * Reads the report the run just wrote. A mutant that completed no tests "survives" by default, so a harness
 * that silently runs nothing reports low scores that look like weak tests (this happened with the Vitest
 * runner plugin): refuse to report a score the harness did not earn.
 */
function readResult() {
  const report = JSON.parse(readFileSync('reports/mutation/mutation.json', 'utf8'));
  const mutants = Object.values(report.files).flatMap((f) => f.mutants).filter((m) => !['Ignored', 'CompileError'].includes(m.status));
  const idle = mutants.filter((m) => m.status === 'Survived' && !(m.testsCompleted > 0));
  const detected = mutants.filter((m) => m.status === 'Killed' || m.status === 'Timeout').length;
  return { total: mutants.length, detected, survived: mutants.length - detected, idle: idle.length, score: (100 * detected) / Math.max(1, mutants.length) };
}

const summary = [];
let failed = false;
for (const name of names) {
  const { mutate, tests } = MODULES[name];
  console.log(`\n=== mutation testing: ${mutate} (tests: ${tests.join(', ')}) ===`);
  const r = spawnSync('npx', ['stryker', 'run', '--mutate', mutate], {
    stdio: 'inherit',
    env: { ...process.env, MUTATION_TESTS: tests.join(',') },
  });
  if (r.status !== 0) { failed = true; summary.push({ name, error: 'stryker failed' }); continue; }
  const res = readResult();
  const min = thresholds[name];
  if (res.idle > 0) {
    console.error(`\nHARNESS FAILURE for ${mutate}: ${res.idle} of ${res.total} mutants "survived" without any test running. The score is meaningless. See ENGINEERING.md, "Mutation testing".`);
    failed = true;
  }
  const below = gate && !(res.score >= min);
  if (below) {
    console.error(`\nMUTATION GATE FAILED for ${mutate}: score ${res.score.toFixed(2)}% is below the minimum ${min}% (${res.survived} mutants survived). Open reports/mutation/index.html, kill the survivors that are real gaps, and see ENGINEERING.md, "Mutation testing".`);
    failed = true;
  }
  summary.push({ name, ...res, min, ok: !below && res.idle === 0 });
}

console.log('\n=== mutation summary ===');
for (const s of summary) {
  console.log(s.error ? `  ${s.name}: ${s.error}` : `  ${s.name.padEnd(10)} ${s.score.toFixed(2).padStart(6)}%  (minimum ${s.min}%)  ${s.detected}/${s.total} mutants detected  ${s.ok ? 'ok' : 'FAILED'}`);
}
process.exit(failed ? 1 : 0);
