import { defineConfig } from 'vitest/config';

// The runs-script test starts two TypeScript child processes; on a loaded or
// swapping machine and on a small CI runner they outgrow vitest's 5 s default.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
