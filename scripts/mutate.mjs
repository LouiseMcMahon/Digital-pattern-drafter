// Mutation testing with Stryker: `npm run mutate -- <module> [<module> ...]` (or `all`).
// Each module is mutated against only the tests that exercise it, because every mutant re-runs them.
// See ENGINEERING.md ("Mutation testing") for how to read the report and what the scores mean.
import { spawnSync } from 'node:child_process';

const MODULES = {
  slice: { mutate: 'src/core/slice.ts', tests: ['src/core/slice.test.ts'] },
  pose: { mutate: 'src/core/pose.ts', tests: ['src/core/pose.test.ts'] },
  flatten: { mutate: 'src/core/flatten.ts', tests: ['src/core/flatten.test.ts'] },
  bodyModel: { mutate: 'src/core/bodyModel.ts', tests: ['src/core/bodyModel.test.ts', 'src/core/body.test.ts'] },
};

const args = process.argv.slice(2);
const names = args.includes('all') ? Object.keys(MODULES) : args;
if (names.length === 0 || names.some((n) => !MODULES[n])) {
  console.error(`usage: npm run mutate -- <${Object.keys(MODULES).join('|')}|all> ...`);
  process.exit(2);
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
}
process.exit(failed ? 1 : 0);
