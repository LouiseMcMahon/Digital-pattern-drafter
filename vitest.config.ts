import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The fit tests run real optimisations on the full body: allow them time.
    testTimeout: 300_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      // Fixtures are data, loadBodyNode is a thin fs wrapper, testBodies is test support.
      exclude: ['src/core/**/*.test.ts', 'src/core/fixtures.ts', 'src/core/loadBodyNode.ts', 'src/core/testBodies.ts'],
      reporter: ['text-summary', 'text'],
      // Ratchet: raise these when coverage rises, never lower them without saying why (ENGINEERING.md).
      thresholds: {
        statements: 90, branches: 80, functions: 90, lines: 90,
        // The code that defines what the model and the measurements mean is held to a higher bar.
        'src/core/measure.ts': { lines: 88, branches: 85 },
        'src/core/pose.ts': { lines: 95 },
        'src/core/slice.ts': { lines: 95 },
        'src/core/fit.ts': { lines: 88 },
        'src/core/bodyModel.ts': { lines: 90 },
      },
    },
  },
});
