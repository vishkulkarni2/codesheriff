import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Automatically clear mock state (calls, instances, results) between tests.
    // Individual mock implementations are preserved — use mockReset in beforeEach
    // if you need to reset return values too.
    clearMocks: true,
    // Print a test-name-scoped header so failures are easy to locate in CI output
    reporters: ['verbose'],
    // Reasonable timeout — no real network or DB in these tests
    testTimeout: 10_000,
  },
});
