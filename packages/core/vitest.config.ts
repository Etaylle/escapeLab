import { defineConfig } from 'vitest/config';

// The property tests play hundreds of seeded runs through the reducer; on a
// loaded machine or a small CI runner they outgrow vitest's 5 s default.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
