import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView, ServerMessage } from '@escapelab/core';
import { PASS_KEY } from '../src/pass.js';
import { keptSnapshot, resumeOf, seatOf, SNAPSHOT_KEY } from '../src/snapshots.js';
import { comebackOfTab } from '../src/tab.js';
import { replyTo, takeIn } from '../src/ws.js';
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
