// Mutation testing with Stryker: `npm run mutate -- <module> [<module> ...]` (or `all`).
// Each module is mutated against only the tests that exercise it, because every mutant re-runs them.
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
const names = args.includes('all') ? Object.keys(MODULES) : args;
if (names.length === 0 || names.some((n) => !MODULES[n])) {
  console.error(`usage: npm run mutate -- <${Object.keys(MODULES).join('|')}|all> ...`);
  process.exit(2);
}

/**
 * A mutant that completed no tests "survives" by default, so a harness that silently runs nothing reports
 * low scores that look like weak tests (this happened with the Vitest runner plugin). Refuse to report
 * a score the harness did not earn.
 */
function harnessRanTests(file) {
  const report = JSON.parse(readFileSync('reports/mutation/mutation.json', 'utf8'));
  const mutants = Object.values(report.files).flatMap((f) => f.mutants).filter((m) => m.status !== 'NoCoverage' && m.status !== 'Ignored' && m.status !== 'CompileError');
  const idle = mutants.filter((m) => m.status === 'Survived' && !(m.testsCompleted > 0));
  if (idle.length > 0) {
    console.error(`\nHARNESS FAILURE for ${file}: ${idle.length} of ${mutants.length} mutants "survived" without any test running. The score above is meaningless. See ENGINEERING.md, "Mutation testing".`);
    return false;
  }
  return true;
}

let failed = false;
for (const name of names) {
  const { mutate, tests } = MODULES[name];
  console.log(`\n=== mutation testing: ${mutate} (tests: ${tests.join(', ')}) ===`);
  const r = spawnSync('npx', ['stryker', 'run', '--mutate', mutate], {
    stdio: 'inherit',
    env: { ...process.env, MUTATION_TESTS: tests.join(',') },
  });
  if (r.status !== 0) failed = true;
  else if (!harnessRanTests(mutate)) failed = true;
}
process.exit(failed ? 1 : 0);
