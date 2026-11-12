import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_MAX_AGE_MS, type PlayerView, type ServerMessage } from '@escapelab/core';
import { PASS_KEY } from '../src/pass.js';
import { keptSeat, keptSnapshot, resumeOf, seatOf, SNAPSHOT_KEY } from '../src/snapshots.js';
import { comebackOfTab } from '../src/tab.js';
import { noteOutgoing, replyTo, takeIn } from '../src/ws.js';
import { page, storage } from './page.js';

/** Ben's pass. */
const PASS = { id: 'b3'.repeat(16), secret: '7e'.repeat(32) };

const T0 = 1_700_000_000_000;

const mate = (id: string, name: string): PlayerView['players'][number] => ({
  id,
  name,
  color: '#2dd4bf',
  ready: false,
  connected: true,
  isHost: id === 'p1',
});

/** Ben's view of Blackout's run, 12:34 left on its clock at T0. */
function running(parts: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: 'playing',
    missionTitle: 'Blackout im Labor',
    you: { id: 'p2', name: 'Ben', color: '#f472b6', ready: false, isHost: false },
    players: [mate('p1', 'Anna'), mate('p2', 'Ben'), mate('p3', 'Cem')],
    deadlineAt: T0 + 754_000,
    pausedAt: null,
    ...parts,
  } as PlayerView;
}

const SNAPSHOT: Extract<ServerMessage, { kind: 'snapshot' }> = {
  kind: 'snapshot',
  blob: 'v1.bm9uY2Vub25jZW5v.c2VhbGVk',
  seq: 41,
  at: T0,
};

/** The page of Ben's tab, seated in room QX7R, his latest view `view`. */
function seated(view: PlayerView = running()) {
  const { kept } = page();
  takeIn({ kind: 'joined', code: 'QX7R' }, kept);
  takeIn({ kind: 'view', view, at: T0 }, kept);
  return kept;
}

describe('the snapshot a browser keeps of its room', () => {
  let local: Map<string, string>;
  beforeEach(() => {
    local = new Map([[PASS_KEY, JSON.stringify({ ...PASS, name: 'Ben' })]]);
    vi.stubGlobal('sessionStorage', storage(new Map()));
    vi.stubGlobal('window', { localStorage: storage(local) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is the newest, kept under the room’s code with the card the room comes back with', () => {
    const kept = seated();
    takeIn(SNAPSHOT, kept);
    expect(JSON.parse(local.get(`${SNAPSHOT_KEY}QX7R`) ?? 'null')).toEqual({
      blob: SNAPSHOT.blob,
      seq: 41,
      at: T0,
      seat: {
        code: 'QX7R',
        missionTitle: 'Blackout im Labor',
        phase: 'playing',
        paused: true,
        crew: ['Anna', 'Ben', 'Cem'],
        leftMs: 754_000,
      },
    });
    takeIn({ ...SNAPSHOT, blob: 'v1.bmV3ZXI.bmV3ZXI', seq: 42, at: T0 + 2000 }, kept);
    expect(keptSnapshot('QX7R')).toMatchObject({ seq: 42, seat: { leftMs: 752_000 } });
    expect(keptSnapshot('qx7r')?.seq).toBe(42);
  });

  it('is the room’s last as the server goes down for a restart', () => {
    const kept = seated();
    takeIn(SNAPSHOT, kept);
    takeIn({ kind: 'restart', blob: 'v1.bGFzdA.bGFzdA', seq: 44, at: T0 + 3000 }, kept);
    expect(keptSnapshot('QX7R')).toMatchObject({ blob: 'v1.bGFzdA.bGFzdA', seq: 44 });
  });

  it('goes with every resume: the tab’s comeback, a takeover let in, the way back', () => {
    takeIn(SNAPSHOT, seated());
    const resume = { kind: 'resume', code: 'QX7R', pass: PASS, blob: SNAPSHOT.blob };
    expect(comebackOfTab()).toEqual(resume);
    expect(replyTo({ kind: 'takeover-allowed', code: 'QX7R' })).toEqual(resume);
    expect(resumeOf('QX7R')).toEqual(resume);
    // Of a room it keeps none of, a resume carries none.
    expect(resumeOf('ZZ99')).toEqual({ kind: 'resume', code: 'ZZ99', pass: PASS });
  });

  it('goes once the run is over: an ended run is not taken up again', () => {
    const kept = seated();
    takeIn(SNAPSHOT, kept);
    takeIn({ kind: 'view', view: running({ phase: 'won' }), at: T0 + 5000 }, kept);
    expect(keptSnapshot('QX7R')).toBeNull();
  });

  it('goes once the seat is given up, and stays where the seat plays on in another tab', () => {
    const kept = seated();
    takeIn(SNAPSHOT, kept);
    const message = 'Dieser Platz spielt jetzt in einem anderen Fenster.';
    takeIn({ kind: 'left', code: 'QX7R', message }, kept);
    expect(keptSnapshot('QX7R')).not.toBeNull();
    takeIn({ kind: 'left', code: 'QX7R', message: null }, kept);
    expect(keptSnapshot('QX7R')).toBeNull();
  });

  it('goes once the server will not have the seat back: taken over, or the room gone', () => {
    const kept = seated();
    takeIn(SNAPSHOT, kept);
    kept.resuming.current = true;
    const message = 'Der Platz wurde auf einem anderen Gerät übernommen.';
    takeIn({ kind: 'error', message, of: 'resume' }, kept);
    expect(keptSnapshot('QX7R')).toBeNull();
    expect(comebackOfTab()).toBeNull();
  });

  it('is nothing where what the browser keeps is no snapshot', () => {
    const card = { ...seatOf('QX7R', running(), T0), crew: [1, 2] };
    for (const bad of [
      'kaputt',
      '{"blob":1}',
      '{"blob":"v1.a.b","seq":1,"at":1,"seat":{}}',
      JSON.stringify({ blob: 'v1.a.b', seq: 1, at: 1, seat: card }),
    ]) {
      local.set(`${SNAPSHOT_KEY}QX7R`, bad);
      expect(keptSnapshot('QX7R')).toBeNull();
    }
    expect(resumeOf('QX7R')).toEqual({ kind: 'resume', code: 'QX7R', pass: PASS });
  });
});

describe('the join screen where the server has no room for the pass', () => {
  let local: Map<string, string>;
  beforeEach(() => {
    local = new Map([[PASS_KEY, JSON.stringify({ ...PASS, name: 'Ben' })]]);
    vi.stubGlobal('sessionStorage', storage(new Map()));
    vi.stubGlobal('window', { localStorage: storage(local) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A snapshot of room `code` taken at `at`, kept as the browser keeps one. */
  const keep = (code: string, at: number): void => {
    const seat = seatOf(code, running(), at);
    local.set(`${SNAPSHOT_KEY}${code}`, JSON.stringify({ ...SNAPSHOT, at, seat }));
  };

  it('shows the card of the newest snapshot the browser keeps, a day old at most', () => {
    keep('QX7R', T0);
    keep('AB12', T0 + 60_000);
    keep('ZZ99', T0 - SNAPSHOT_MAX_AGE_MS);
    local.set('escapelab-notes:QX7R:p2', '{"text":"","captures":[]}');
    // Something of the snapshot's shape, kept under another key: no snapshot of the browser's.
    const lookalike = { ...SNAPSHOT, at: T0 + 60_500, seat: seatOf('NOPE', running(), T0) };
    local.set('escapelab-elsewhere', JSON.stringify(lookalike));
    local.set(`${SNAPSHOT_KEY}KAPUTT`, 'kein Schnappschuss');
    expect(keptSeat(storage(local), T0 + 60_000)?.code).toBe('AB12');
    // What is too old, or no snapshot, goes; nothing else the browser keeps does.
    const kept = (): string[] => [...local.keys()].sort();
    expect(kept()).toEqual([
      'escapelab-elsewhere',
      'escapelab-notes:QX7R:p2',
      PASS_KEY,
      `${SNAPSHOT_KEY}AB12`,
      `${SNAPSHOT_KEY}QX7R`,
    ]);
    expect(keptSeat(storage(local), T0 + SNAPSHOT_MAX_AGE_MS)?.code).toBe('AB12');
    expect(keptSeat(storage(local), T0 + 60_001 + SNAPSHOT_MAX_AGE_MS)).toBeNull();
    expect(kept()).toEqual(['escapelab-elsewhere', 'escapelab-notes:QX7R:p2', PASS_KEY]);
    expect(keptSeat(null)).toBeNull();
  });

  it('stands where the server says the pass sits nowhere, and gives way to what it says', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 5000);
    keep('QX7R', T0);
    const { kept, got } = page();
    takeIn({ kind: 'seated', seat: null }, kept);
    expect(got.seat).toEqual(seatOf('QX7R', running(), T0));
    const lobby = { ...seatOf('AB12', running(), T0), phase: 'lobby' as const };
    takeIn({ kind: 'seated', seat: lobby }, kept);
    expect(got.seat).toEqual(lobby);
    vi.useRealTimers();
  });
});

describe('the card of a kept snapshot whose seat the server will not have back', () => {
  let local: Map<string, string>;
  beforeEach(() => {
    local = new Map([[PASS_KEY, JSON.stringify({ ...PASS, name: 'Ben' })]]);
    vi.stubGlobal('sessionStorage', storage(new Map()));
    vi.stubGlobal('window', { localStorage: storage(local) });
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 5000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('goes, the snapshot with it, once the resume its way back sent is refused', () => {
    const seat = seatOf('QX7R', running(), T0);
    local.set(`${SNAPSHOT_KEY}QX7R`, JSON.stringify({ ...SNAPSHOT, seat }));
    const { kept, got } = page();
    takeIn({ kind: 'seated', seat: null }, kept);
    expect(got.seat).toEqual(seat);
    kept.resumed.current = 'QX7R';
    const message = 'Der Spielstand dieses Raums lässt sich nicht wiederherstellen.';
    takeIn({ kind: 'error', message, of: 'resume' }, kept);
    expect(keptSnapshot('QX7R')).toBeNull();
    expect(got.seat).toBeNull();
    expect(kept.resumed.current).toBeNull();
  });

  it('is the room of the resume the page sent last, nothing else noted', () => {
    const resumed = { current: null as string | null };
    noteOutgoing({ kind: 'resume', code: 'QX7R', pass: PASS }, resumed);
    expect(resumed.current).toBe('QX7R');
    noteOutgoing({ kind: 'whereami', pass: PASS }, resumed);
    expect(resumed.current).toBe('QX7R');
  });

  it('stays once the seat is back: the resume answered', () => {
    const seat = seatOf('QX7R', running(), T0);
    local.set(`${SNAPSHOT_KEY}QX7R`, JSON.stringify({ ...SNAPSHOT, seat }));
    const { kept } = page();
    kept.resumed.current = 'QX7R';
    takeIn({ kind: 'joined', code: 'QX7R' }, kept);
    expect(kept.resumed.current).toBeNull();
    takeIn({ kind: 'error', message: 'Gerade ist keine Station in Betrieb.', of: 'resume' }, kept);
    expect(keptSnapshot('QX7R')).not.toBeNull();
  });
});

describe('the card a snapshot keeps of its room', () => {
  it('stands a run still from the snapshot on, its clock where a pause before held it', () => {
    expect(seatOf('QX7R', running(), T0 + 4000)).toMatchObject({ paused: true, leftMs: 750_000 });
    const held = running({ pausedAt: T0 + 1000 });
    expect(seatOf('QX7R', held, T0 + 4000)).toMatchObject({ paused: true, leftMs: 753_000 });
    // The clock not started yet: the lights still on.
    expect(seatOf('QX7R', running({ deadlineAt: null }), T0).leftMs).toBeNull();
  });

  it('shows a lobby as a lobby', () => {
    expect(seatOf('QX7R', running({ phase: 'lobby', deadlineAt: null }), T0)).toEqual({
      code: 'QX7R',
      missionTitle: 'Blackout im Labor',
      phase: 'lobby',
      paused: false,
      crew: ['Anna', 'Ben', 'Cem'],
      leftMs: null,
    });
  });
});
