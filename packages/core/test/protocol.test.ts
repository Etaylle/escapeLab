import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../src/index.js';

describe('client messages', () => {
  it('pass a puzzle input on untouched — the open puzzle checks it', () => {
    const msg = { kind: 'puzzle-input', input: { wireId: 'w2' } };
    expect(parseClientMessage(JSON.stringify(msg))).toEqual(msg);
  });

  it('take a position only with the run it was walked in', () => {
    const pos = { kind: 'pos', x: 3.5, y: 2.5, facing: 0, moving: true };
    expect(() => parseClientMessage(JSON.stringify(pos))).toThrow(/Unbekanntes Nachrichtenformat/);
    const stamped = { ...pos, run: 1_000_000 };
    expect(parseClientMessage(JSON.stringify(stamped))).toEqual(stamped);
  });

  it('know no per-puzzle messages any more', () => {
    for (const kind of [
      'press-button',
      'cut-wire',
      'press-key',
      'toggle-switch',
      'commit-switches',
      'press-simon',
      'move-maze',
    ]) {
      const msg = { kind, wireId: 'w1', keyIndex: 0, switchIndex: 0, buttonIndex: 0, dir: 0 };
      expect(() => parseClientMessage(JSON.stringify(msg)), kind).toThrow(
        /Unbekanntes Nachrichtenformat/,
      );
    }
  });
});
