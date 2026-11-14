import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage, SpectatorView } from '@escapelab/core';
import { PASS_KEY } from '../src/pass.js';
import { comebackOfTab } from '../src/tab.js';
import { takeIn } from '../src/ws.js';
import { page, storage } from './page.js';

/** Ben's pass. */
const PASS = { id: 'b3'.repeat(16), secret: '7e'.repeat(32) };

/** What the audience of room QX7R is shown. */
const AUDIENCE: ServerMessage = {
  kind: 'spectator-view',
  code: 'QX7R',
  at: 1,
  view: { phase: 'playing' } as SpectatorView,
};

describe('the room a tab is in, kept for its next socket', () => {
  let session: Map<string, string>;
  beforeEach(() => {
    session = new Map();
    vi.stubGlobal('sessionStorage', storage(session));
    vi.stubGlobal('window', {
      localStorage: storage(new Map([[PASS_KEY, JSON.stringify({ ...PASS, name: 'Ben' })]])),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the room a tab watches: its next socket comes back to the audience', () => {
    const { kept, got } = page();
    takeIn(AUDIENCE, kept);
    expect(got.code).toBe('QX7R');
    expect(comebackOfTab()).toEqual({ kind: 'spectate', code: 'QX7R' });
  });

  it('keeps the room once the audience is back: a refusal after that drops nothing', () => {
    const { kept, got } = page();
    kept.resuming.current = true;
    takeIn(AUDIENCE, kept);
    takeIn({ kind: 'error', message: 'Noch in keinem Raum.', of: 'ping' }, kept);
    expect(got.audience).not.toBeNull();
    expect(comebackOfTab()).toEqual({ kind: 'spectate', code: 'QX7R' });
  });

  it('brings a tab that sits back to its seat, on the browser’s pass', () => {
    takeIn({ kind: 'joined', code: 'QX7R' }, page().kept);
    expect(comebackOfTab()).toEqual({ kind: 'resume', code: 'QX7R', pass: PASS });
    // A tab that kept its room before tabs could watch sat in it.
    session.set('escapelab-session', '{"code":"AB12"}');
    expect(comebackOfTab()).toEqual({ kind: 'resume', code: 'AB12', pass: PASS });
  });

  it('lets the audience go where the room it watched is gone', () => {
    const { kept, got } = page();
    takeIn(AUDIENCE, kept);
    kept.resuming.current = true;
    takeIn({ kind: 'error', message: 'Raum "QX7R" existiert nicht (mehr).', of: 'spectate' }, kept);
    expect(got.audience).toBeNull();
    expect(got.code).toBeNull();
    expect(comebackOfTab()).toBeNull();
  });
});

describe('how many watch the room', () => {
  it('is what the server said last, for the chip in the bar', () => {
    const { kept, got } = page();
    expect(got.watching).toBeNull();
    takeIn({ kind: 'audience', code: 'QX7R', count: 2 }, kept);
    expect(got.watching).toBe(2);
    takeIn({ kind: 'audience', code: 'QX7R', count: 0 }, kept);
    expect(got.watching).toBe(0);
  });
});
