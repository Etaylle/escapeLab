import { defineConfig } from 'vitest/config';

/**
 * The line the server logs for every seat that joins, drops, comes back or leaves, every
 * refusal at the door and every run that ends (room.ts, sockets.ts): the tests that check them
 * spy on the console, and the rest of the suite keeps them out of its output.
 */
const ROOM_LOG = /^\[escapelab\] (room [^:]+|no room): /;

// The runs-script test starts two TypeScript child processes; on a loaded or
// swapping machine and on a small CI runner they outgrow vitest's 5 s default.
// The store's tests in Postgres share one schema of the run's own (test/postgresSetup.ts).
export default defineConfig({
  test: {
    testTimeout: 30_000,
    globalSetup: ['./test/postgresSetup.ts'],
    onConsoleLog: (log, type) => !(type === 'stdout' && ROOM_LOG.test(log)),
  },
});
