import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage } from '@escapelab/core';
import { notesKey } from '../src/notes.js';
import { PASS_KEY } from '../src/pass.js';
import { LEAVE_WAIT_MS, leaveSeat, type ServerListener } from '../src/ws.js';

/** Ben's pass. */
const PASS = { id: 'b3'.repeat(16), secret: '7e'.repeat(32) };

/** A storage kept in a map, as the browser's local and session storage are. */
function storage(items: Map<string, string>) {
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

/** Ben's tab in room QX7R, his notes kept for it, the page's reload counted. */
function bensTab() {
  const local = new Map([
    [PASS_KEY, JSON.stringify({ ...PASS, name: 'Ben' })],
    [notesKey('QX7R', 'p-ben'), '{"text":"Kabel 3","captures":[]}'],
  ]);
  const session = new Map([['escapelab-session', '{"code":"QX7R"}']]);
  const reload = vi.fn();
  vi.stubGlobal('window', { localStorage: storage(local) });
  vi.stubGlobal('sessionStorage', storage(session));
  vi.stubGlobal('location', { reload });
  const listeners: ServerListener[] = [];
  const sent: ClientMessage[] = [];
  const listen = (listener: ServerListener): (() => void) => {
    listeners.push(listener);
    return () => undefined;
  };
  leaveSeat('QX7R', 'p-ben', listen, (msg) => sent.push(msg));
  const hear = (msg: Parameters<ServerListener['message']>[0]): void => {
    for (const listener of listeners) {
      listener.message(msg);
    }
  };
  return { local, session, reload, sent, hear };
}

describe('leaving a room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives the seat up on the pass and loads anew once the server has freed it', () => {
    const { local, session, reload, sent, hear } = bensTab();
    expect(sent).toEqual([{ kind: 'abandon', code: 'QX7R', pass: PASS }]);
    expect(reload).not.toHaveBeenCalled();
    hear({ kind: 'left', code: 'ABCD', message: null });
    expect(reload).not.toHaveBeenCalled();
    hear({ kind: 'left', code: 'QX7R', message: null });
    expect(reload).toHaveBeenCalledOnce();
    expect(session.has('escapelab-session')).toBe(false);
    expect(local.has(notesKey('QX7R', 'p-ben'))).toBe(false);
    vi.advanceTimersByTime(LEAVE_WAIT_MS);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('loads anew all the same without a word, keeping the notes of a seat it may hold', () => {
    const { local, session, reload } = bensTab();
    vi.advanceTimersByTime(LEAVE_WAIT_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledOnce();
    expect(session.has('escapelab-session')).toBe(false);
    expect(local.has(notesKey('QX7R', 'p-ben'))).toBe(true);
  });
});
