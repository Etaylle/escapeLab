import { describe, expect, it } from 'vitest';
import { parseClientMessage, RTC_SIGNAL_MAX } from '../src/index.js';

/** A voice signal for Ben, as a client sends it. */
const toBen = (signal: object): string => JSON.stringify({ kind: 'rtc', to: 'ben', signal });

/** An audio offer of `length` characters, the shape a browser writes. */
const sdpOf = (length: number): string => `v=0\r\na=${'x'.repeat(Math.max(0, length - 8))}\r\n`;

describe('voice signals', () => {
  it('carry an offer, an answer or an ICE candidate to one member, untouched', () => {
    const offer = { type: 'offer', sdp: sdpOf(3000) };
    const answer = { type: 'answer', sdp: sdpOf(2500) };
    const ice = {
      type: 'ice',
      candidate: {
        candidate: 'candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'a1B2',
      },
    };
    for (const signal of [offer, answer, ice]) {
      expect(parseClientMessage(toBen(signal))).toEqual({ kind: 'rtc', to: 'ben', signal });
    }
  });

  it('take a candidate as a browser hands it over, its line and index unknown', () => {
    const ice = { type: 'ice', candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null } };
    expect(parseClientMessage(toBen(ice))).toEqual({ kind: 'rtc', to: 'ben', signal: ice });
  });

  it('refuse what is no offer, answer or candidate, and a signal for nobody', () => {
    for (const signal of [
      { type: 'bye' },
      { type: 'offer' },
      { type: 'offer', sdp: '' },
      { type: 'ice' },
      { type: 'ice', candidate: { sdpMid: '0' } },
      { type: 'answer', sdp: 42 },
    ]) {
      expect(() => parseClientMessage(toBen(signal)), JSON.stringify(signal)).toThrow(
        /Unbekanntes Nachrichtenformat/,
      );
    }
    const nobody = { kind: 'rtc', to: '', signal: { type: 'offer', sdp: sdpOf(100) } };
    expect(() => parseClientMessage(JSON.stringify(nobody))).toThrow(
      /Unbekanntes Nachrichtenformat/,
    );
  });

  it('weigh 16 kB at most, as JSON', () => {
    const fits = { type: 'offer', sdp: sdpOf(RTC_SIGNAL_MAX - 64) };
    expect(JSON.stringify(fits).length).toBeLessThanOrEqual(RTC_SIGNAL_MAX);
    expect(parseClientMessage(toBen(fits))).toEqual({ kind: 'rtc', to: 'ben', signal: fits });
    const heavy = { type: 'offer', sdp: sdpOf(RTC_SIGNAL_MAX) };
    expect(JSON.stringify(heavy).length).toBeGreaterThan(RTC_SIGNAL_MAX);
    expect(() => parseClientMessage(toBen(heavy))).toThrow(/Unbekanntes Nachrichtenformat/);
    const candidate = { candidate: 'c'.repeat(RTC_SIGNAL_MAX - 10), sdpMid: '0' };
    expect(() => parseClientMessage(toBen({ type: 'ice', candidate }))).toThrow(
      /Unbekanntes Nachrichtenformat/,
    );
  });
});

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
