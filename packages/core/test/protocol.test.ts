import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseClientMessage, RESTART_CLOSE, RTC_SIGNAL_MAX } from '../src/index.js';

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

/** A crew pass as a browser mints it: 16 bytes of id, 32 of secret, hex. */
const PASS = { id: 'a1'.repeat(16), secret: '0f'.repeat(32) };

describe('the crew pass', () => {
  it('goes with every way onto a seat: opening a room, joining one, resuming', () => {
    const doors = [
      { kind: 'create-room', name: 'Anna', pass: PASS },
      { kind: 'join-room', code: 'ABCD', name: 'Ben', pass: PASS },
      { kind: 'resume', code: 'ABCD', pass: PASS },
    ];
    for (const msg of doors) {
      expect(parseClientMessage(JSON.stringify(msg)), msg.kind).toEqual(msg);
      const bare = { ...msg, pass: undefined };
      expect(() => parseClientMessage(JSON.stringify(bare)), msg.kind).toThrow(
        /Unbekanntes Nachrichtenformat/,
      );
    }
  });

  it('is hex of its full length, an id and a secret, nothing else', () => {
    const bad = [
      { id: PASS.id },
      { secret: PASS.secret },
      { id: PASS.id.slice(1), secret: PASS.secret },
      { id: PASS.id, secret: `${PASS.secret}00` },
      { id: PASS.id.toUpperCase(), secret: PASS.secret },
      { id: 'zz'.repeat(16), secret: PASS.secret },
    ];
    for (const pass of bad) {
      const msg = { kind: 'resume', code: 'ABCD', pass };
      expect(() => parseClientMessage(JSON.stringify(msg)), JSON.stringify(pass)).toThrow(
        /Unbekanntes Nachrichtenformat/,
      );
    }
  });

  it('replaces the old resume by player id and token', () => {
    const old = { kind: 'resume', code: 'ABCD', playerId: 'p-ben', token: 't-ben' };
    expect(() => parseClientMessage(JSON.stringify(old))).toThrow(/Unbekanntes Nachrichtenformat/);
  });
});

describe('client messages', () => {
  it('pass a puzzle input on untouched — the open puzzle checks it', () => {
    const msg = { kind: 'puzzle-input', input: { wireId: 'w2' } };
    expect(parseClientMessage(JSON.stringify(msg))).toEqual(msg);
  });

  it('take a position only with the run it was walked in and the moment it was true', () => {
    const pos = { kind: 'pos', x: 3.5, y: 2.5, facing: 0, moving: true };
    expect(() => parseClientMessage(JSON.stringify(pos))).toThrow(/Unbekanntes Nachrichtenformat/);
    const inRun = { ...pos, run: 1_000_000 };
    expect(() => parseClientMessage(JSON.stringify(inRun))).toThrow(
      /Unbekanntes Nachrichtenformat/,
    );
    const stamped = { ...inRun, t: 1_700_000_000_016.7 };
    expect(parseClientMessage(JSON.stringify(stamped))).toEqual(stamped);
  });

  it('ask for the server’s time with the page’s own, a number', () => {
    const ask = { kind: 'clock', sent: 1_700_000_000_123.5 };
    expect(parseClientMessage(JSON.stringify(ask))).toEqual(ask);
    expect(() => parseClientMessage(JSON.stringify({ kind: 'clock' }))).toThrow(
      /Unbekanntes Nachrichtenformat/,
    );
    expect(() => parseClientMessage(JSON.stringify({ kind: 'clock', sent: 'now' }))).toThrow(
      /Unbekanntes Nachrichtenformat/,
    );
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

/** Every TypeScript source under `dir`, by its path. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourcesUnder(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the close code of a restart', () => {
  it('is Service Restart, the protocol’s alone: no client or server module writes it', () => {
    expect(RESTART_CLOSE).toBe(1012);
    const packages = fileURLToPath(new URL('../../', import.meta.url));
    const own = ['client/src', 'server/src']
      .flatMap((root) => sourcesUnder(join(packages, root)))
      .filter((path) => /\b1012\b/.test(readFileSync(path, 'utf8')));
    expect(own).toEqual([]);
  });
});

describe('the asks of a login', () => {
  const pass = { id: 'a1'.repeat(16), secret: '0f'.repeat(32) };
  const say = (msg: object): unknown => parseClientMessage(JSON.stringify(msg));

  it('carry an Ausweisnummer and a Kennwort as typed, for the server to read', () => {
    const signIn = { kind: 'sign-in', pass, login: ' el 7k3m 9q2d ', password: 'x' };
    expect(say(signIn)).toEqual(signIn);
    const change = { kind: 'change-password', pass, old: 'alt', password: 'ä'.repeat(512) };
    expect(say(change)).toEqual(change);
    expect(say({ kind: 'set-password', pass, password: '12345678' })).toMatchObject({ pass });
  });

  it('carry no Kennwort longer than 512 and no Ausweisnummer longer than 32, nor none', () => {
    for (const msg of [
      { kind: 'sign-in', pass, login: 'E'.repeat(33), password: 'x' },
      { kind: 'sign-in', pass, login: '', password: 'x' },
      { kind: 'sign-in', pass, login: 'EL-7K3M-9Q2D', password: '' },
      { kind: 'set-password', pass, password: 'x'.repeat(513) },
      { kind: 'change-password', pass, password: 'x'.repeat(8) },
      { kind: 'set-password', password: 'x'.repeat(8) },
    ]) {
      expect(() => say(msg), JSON.stringify(msg).slice(0, 80)).toThrow(
        /Unbekanntes Nachrichtenformat/,
      );
    }
  });
});
