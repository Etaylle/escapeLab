import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import {
  parseMission,
  type Mission,
  type ServerMessage,
  type SpectatorView,
} from '@escapelab/core';
import type { DemoHost } from '../src/demo/host.js';

/**
 * The demo room in a test: Blackout as its file has it, somebody of the audience watching, and
 * the fake clock run on until the room stands where the test waits for it.
 */

export function blackoutMission(): Mission {
  const file = new URL('../../../missions/blackout.json', import.meta.url);
  return parseMission(JSON.parse(readFileSync(file, 'utf8')));
}

/** One of the audience: everything its connection heard, and how it leaves. */
export interface Watcher {
  heard: ServerMessage[];
  leave: () => void;
}

/** Somebody watches `host`'s room from now on. */
export function watch(host: DemoHost): Watcher {
  const heard: ServerMessage[] = [];
  const { detach } = host.watch((msg) => heard.push(msg));
  return { heard, leave: detach };
}

/** The latest view `watcher` was sent. */
export function seenBy(watcher: Watcher): SpectatorView {
  const last = watcher.heard.filter((msg) => msg.kind === 'spectator-view').at(-1);
  if (last?.kind !== 'spectator-view') {
    throw new Error('the audience was sent no view');
  }
  return last.view;
}

/** How long a tick of the fake clock is, ms: the crew's own. */
const TICK_MS = 80;

/**
 * The fake clock run on, a tick at a time, until `there(view)` — at most `seconds` of it, which
 * throws. Each view heard meanwhile is dropped, so that a long run keeps a short list.
 */
export function playUntil(
  watcher: Watcher,
  there: (view: SpectatorView) => boolean,
  seconds = 1200,
): SpectatorView {
  for (let tick = 0; tick * TICK_MS < seconds * 1000; tick++) {
    const view = seenBy(watcher);
    if (there(view)) {
      return view;
    }
    const kept: ServerMessage = { kind: 'spectator-view', view, code: '', at: 0 };
    watcher.heard.splice(0, watcher.heard.length, kept);
    vi.advanceTimersByTime(TICK_MS);
  }
  throw new Error(`the demo did not get there in ${seconds} s`);
}

/** Whether the run on `view` is over. */
export const over = (view: SpectatorView): boolean => view.phase === 'won' || view.phase === 'lost';

/** The run's clock at its end, s: from the lights going out to the hatch. */
export function clockOf(view: SpectatorView): number {
  return ((view.finishedAt ?? 0) - (view.lights.outAt ?? 0)) / 1000;
}
