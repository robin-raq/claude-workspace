import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The entry point only wires real dependencies and re-raises exit codes;
      // it is exercised by integration tests through the built binary, which
      // v8 coverage cannot attribute to source files.
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
