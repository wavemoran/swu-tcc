import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/contract.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 90 },
    },
  },
});
