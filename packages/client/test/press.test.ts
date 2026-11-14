import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, PlayerView } from '@escapelab/core';
import { correction, type Streamed } from '../src/world/movement.js';
import { fakeAudio, freshAudio, startsOf } from './fakeAudio.js';
import { mapWith } from './fixtures.js';

/** The press module afresh, its chirp on the fake audio engine (fakeAudio.ts). */
async function freshPress() {
  await freshAudio();
  return import('../src/world/press.js');
}

/** A running mission's view: the Notlicht armed at (11,7), nothing else about. */
function atLever(): PlayerView {
  const you = { id: 'p1', name: 'Ben', color: '#2dd4bf', ready: true, isHost: false };
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    cast: { pa: 'anlage', operator: 'helmut', lead: null },
    crewSize: { min: 2, max: 3 },
    chat: [],
    you,
    players: [{ ...you, connected: true }],
    palette: [],
    deadlineAt: null,
    startedAt: 0,
    finishedAt: null,
    timeLimitSec: 900,
    lights: { out: true, outAt: 0 },
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    pausedFor: null,
    pausedAt: null,
    events: [],
    grade: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    noteHere: null,
    puzzle: null,
    map: mapWith({
      stations: [
        {
          puzzleId: 'notlicht',
          x: 11,
          y: 7,
          title: 'Notlicht',
          status: 'armed',
          found: false,
          known: true,
        },
      ],
    }),
  };
}

type Press = Awaited<ReturnType<typeof freshPress>>;

/** E's world on a screen whose avatar stands at (x, 7.5), walked in frame 1 000. */
function worldAt(press: Press, x: number) {
  const sent: ClientMessage[] = [];
  const opened: string[] = [];
  const streamed: Streamed[] = [];
  const world = {
    view: atLever(),
    sim: { self: { x, y: 7.5 }, selfAt: 1_000, presses: press.newPresses(), streamed },
    shut: false,
    send: (msg: ClientMessage) => sent.push(msg),
    onRead: (id: string) => opened.push(`read ${id}`),
    onReadNote: (index: number) => opened.push(`note ${index}`),
    onOperate: () => opened.push('operate'),
  };
  return { world, sent, opened };
}

describe('E pressed a moment before reach', () => {
  beforeEach(() => fakeAudio());
  afterEach(() => vi.unstubAllGlobals());

  it('waits up to 150 ms for reach, and is pressed as it comes', async () => {
    const press = await freshPress();
    const { world, sent } = worldAt(press, 9.85);
    press.pressE(world, 100);
    expect(sent).toEqual([]);
    world.sim.self.x = 10.05;
    press.pressWhenInReach(world, 100 + 140);
    expect(sent).toEqual([{ kind: 'interact', x: 10.05, y: 7.5, t: expect.any(Number) }]);
  });

  it('is let go once 150 ms have passed without reach', async () => {
    const press = await freshPress();
    const { world, sent } = worldAt(press, 9.85);
    press.pressE(world, 100);
    press.pressWhenInReach(world, 100 + press.PRESS_BUFFER_MS + 1);
    world.sim.self.x = 10.05;
    press.pressWhenInReach(world, 100 + press.PRESS_BUFFER_MS + 20);
    expect(sent).toEqual([]);
  });

  it('is pressed once as reach comes, at a station already open too', async () => {
    const press = await freshPress();
    const { world, opened } = worldAt(press, 9.85);
    world.view = { ...world.view, puzzle: { kind: 'relay' } as unknown as PlayerView['puzzle'] };
    press.pressE(world, 100);
    world.sim.self.x = 10.05;
    // frame after frame while the panel waits for the server to have the player at it
    for (let frame = 1; frame <= 8; frame++) {
      press.pressWhenInReach(world, 100 + frame * 16);
    }
    expect(opened).toEqual(['operate']);
    expect(startsOf('console-ready')).toHaveLength(1);
  });
});

describe('E the server decides', () => {
  beforeEach(() => fakeAudio());
  afterEach(() => vi.unstubAllGlobals());

  it('goes out with the spot the avatar stands on and the frame it was walked in', async () => {
    const press = await freshPress();
    const { world, sent, opened } = worldAt(press, 10.12345);
    press.pressE(world, 100);
    const t = Math.round((performance.timeOrigin + 1_000) * 10) / 10;
    expect(sent).toEqual([{ kind: 'interact', x: 10.123, y: 7.5, t }]);
    expect(opened).toEqual(['operate']);
  });

  it('puts nothing back as the server brings that spot back to a walker gone on', async () => {
    const press = await freshPress();
    const { world } = worldAt(press, 10.12345);
    press.pressE(world, 100);
    const pressed = { x: 10.123, y: 7.5, facing: 0, moving: true, t: 1, rt: 2 };
    const known = { run: 1, players: { p1: pressed } };
    // 300 ms on, a sprint further: 1.6 tiles past the spot it pressed on
    expect(correction(known, 'p1', 1, { x: 11.72, y: 7.5 }, world.sim.streamed, 400)).toBeNull();
  });

  it('chirps as the server takes it, not on the press, and once', async () => {
    const press = await freshPress();
    const { world } = worldAt(press, 10.5);
    press.pressE(world, 100);
    expect(startsOf('console-ready')).toHaveLength(0);
    press.hearAnswer(world.sim.presses, { kind: 'interacted' }, 130);
    expect(startsOf('console-ready')).toHaveLength(1);
    press.hearAnswer(world.sim.presses, { kind: 'interacted' }, 140);
    expect(startsOf('console-ready')).toHaveLength(1);
  });

  it('turns the prompt pill amber with the server’s words for 2.5 s, never chirping', async () => {
    const press = await freshPress();
    const { world } = worldAt(press, 10.5);
    press.pressE(world, 100);
    const text = 'Zu weit weg — nur direkt an der leuchtenden Station.';
    press.hearAnswer(world.sim.presses, { kind: 'error', message: text, of: 'interact' }, 300);
    expect(press.refusalAt(world.sim.presses, 300)).toEqual({
      text,
      x: 11.5,
      y: 7 - 0.55,
      until: 300 + press.REFUSAL_PILL_MS,
    });
    expect(press.refusalAt(world.sim.presses, 300 + press.REFUSAL_PILL_MS)).toBeNull();
    expect(startsOf('console-ready')).toHaveLength(0);
  });

  it('leaves the pill be for a refusal of what E did not ask', async () => {
    const press = await freshPress();
    const { world } = worldAt(press, 10.5);
    press.pressE(world, 100);
    const refusal = {
      kind: 'error' as const,
      message: 'Eingabe gesperrt.',
      of: 'puzzle-input' as const,
    };
    press.hearAnswer(world.sim.presses, refusal, 200);
    expect(press.refusalAt(world.sim.presses, 200)).toBeNull();
  });

  it('works an open station at once, with its chirp: nobody else has to say yes', async () => {
    const press = await freshPress();
    const { world, sent, opened } = worldAt(press, 10.5);
    world.view = { ...world.view, puzzle: { kind: 'relay' } as unknown as PlayerView['puzzle'] };
    press.pressE(world, 100);
    expect(sent).toEqual([]);
    expect(opened).toEqual(['operate']);
    expect(startsOf('console-ready')).toHaveLength(1);
  });

  it('takes no press while something lies over the world', async () => {
    const press = await freshPress();
    const { world, sent } = worldAt(press, 10.5);
    world.shut = true;
    press.pressE(world, 100);
    world.shut = false;
    press.pressWhenInReach(world, 120);
    expect(sent).toEqual([]);
  });
});
