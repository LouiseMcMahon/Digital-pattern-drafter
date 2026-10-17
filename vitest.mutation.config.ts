import { defineConfig } from 'vitest/config';

// Used only by Stryker (stryker.config.json, scripts/mutate.mjs). Not the CI test config.
// Every mutant re-runs the whole selected test set, so this is deliberately small:
//  - the fit, golden and smoothness suites take minutes and are left out;
//  - scripts/mutate.mjs sets MUTATION_TESTS to just the test files that exercise the module under test.
const tests = process.env.MUTATION_TESTS?.split(',').filter(Boolean);

export default defineConfig({
  test: {
    include: tests ?? ['src/**/*.test.ts'],
    exclude: ['src/core/fit.test.ts', 'src/core/golden.test.ts', 'src/core/measure.smoothness.test.ts', 'node_modules/**'],
    testTimeout: 60_000,
  },
});
