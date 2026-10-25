import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DronePosition } from '@escapelab/core';
import { drawScientist, drawVoiceRing, HELD_SCALE, type ScientistOpts } from '../src/world/art.js';
import {
  figurePhase,
  figurePose,
  type FigurePose,
  type FigureState,
} from '../src/world/figure.js';
import {
  drawAlarmMark,
  drawCarryable,
  drawDroneBody,
  drawDroneCone,
} from '../src/world/hazards.js';
import { crewPose, draw, heldItem } from '../src/world/render/actors.js';
import { FALLBACK_COLOR, type Frame, type OtherAvatar } from '../src/world/render/frame.js';
import { callsOf, drawnAt, fakeCanvas, FakePath2D, recording, strip } from './fakeCanvas.js';
import { frameWith, lightWith, lit, player } from './frames.js';

const drone = (parts: Partial<DronePosition>): DronePosition => ({
  x: 3,
  y: 2,
  facing: 0,
  range: 3,
  halfAngleDeg: 30,
  alerted: false,
  frozen: false,
  ...parts,
});

const ben: OtherAvatar = { x: 4, y: 2, facing: 1, moving: true, rx: 4.2, ry: 2.1, phase: 0.4 };
const cleo: OtherAvatar = { x: 8, y: 4, facing: 2, moving: false, rx: 8, ry: 4, phase: 0 };
const players = [player('p1', 'Anna', '#2dd4bf'), player('p2', 'Ben', '#f472b6')];

/** What the pass drew for `frame`. */
function drawn(frame: ReturnType<typeof frameWith>) {
  const { ctx, log } = fakeCanvas(800, 600);
  draw(ctx, frame);
  return log;
}

/** A crew member as figure.ts poses them in `frame`: walking or not, nothing else going on. */
function poseIn(frame: Frame, id: string, parts: Partial<FigureState>): FigurePose {
  return figurePose({
    moving: false,
    facing: 0,
    carrying: null,
    speaking: false,
    alarmAgoMs: null,
    readyAgoMs: null,
    mood: 'play',
    t: frame.time * 1000,
    idleMs: 0,
    phase: figurePhase(id),
    reduced: false,
    ...parts,
  });
}

/** Ben as the view names him, as the frame eases him and poses him as `id`. */
function benLook(frame: Frame, parts: Partial<FigureState> = {}, id = 'p2'): ScientistOpts {
  return {
    color: '#f472b6',
    name: 'Ben',
    facing: 1,
    moving: true,
    walkPhase: 0.4,
    isYou: false,
    connected: true,
    text: frame.text,
    pose: poseIn(frame, id, { moving: true, facing: 1, ...parts }),
  };
}

describe('actors — drones and the crew, in tile space', () => {
  // The scientist's outlines are paths, built on first use.
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('clips a drone’s cone to what the drone sees, and leaves a frozen drone’s unclipped', () => {
    const eye = lit({}, 'eye');
    const watching = drone({});
    const frozen = drone({ x: 7, y: 3, frozen: true });
    const frame = frameWith({
      drones: { watching, frozen },
      light: lightWith({ eyes: new Map([['watching', eye]]) }),
    });
    const log = drawn(frame);
    expect(callsOf(log, 'clip')).toEqual([[eye.clip]]);
    const clipAt = log.findIndex((e) => e.kind === 'call' && e.name === 'clip');
    const coneAt = log.findIndex(
      (e) => e.kind === 'call' && e.name === 'translate' && e.args[0] === 3 && e.args[1] === 2,
    );
    expect(clipAt).toBeLessThan(coneAt);
    expect(strip(drawnAt(log, 3, 2))).toEqual(recording((c) => drawDroneCone(c, watching, 0.5)));
  });

  it('draws the crew where the light shows them, as the view names them, and you on top', () => {
    const others = new Map([
      ['p2', ben],
      ['p3', cleo],
    ]);
    const light = lightWith({ crewShown: (x) => x < 6 });
    const frame = frameWith({ others, players, light, walkPhase: 0.7 });
    const log = drawn(frame);
    expect(strip(drawnAt(log, 4.2, 2.1 + 0.3))).toEqual(
      recording((c) => drawScientist(c, benLook(frame))),
    );
    expect(drawnAt(log, 8, 4 + 0.3)).toEqual([]);
    const you: ScientistOpts = {
      color: '#2dd4bf',
      name: 'Anna',
      facing: 0,
      moving: false,
      walkPhase: 0.7,
      isYou: true,
      connected: true,
      text: frame.text,
      pose: poseIn(frame, 'p1', {}),
    };
    expect(strip(drawnAt(log, 2.5, 2.5 + 0.3))).toEqual(recording((c) => drawScientist(c, you)));
    const order = callsOf(log, 'translate').map(([x]) => x);
    expect(order.indexOf(2.5)).toBeGreaterThan(order.indexOf(4.2));
  });

  it('draws nobody where you stand for the audience', () => {
    const log = drawn(frameWith({ spectator: true }));
    expect(drawnAt(log, 2.5, 2.5 + 0.3)).toEqual([]);
  });

  it('rings whoever speaks, in their colour', () => {
    const others = new Map([['p2', ben]]);
    const frame = frameWith({ others, players, speaking: new Set(['p2']), time: 3.2 });
    const log = drawn(frame);
    expect(strip(drawnAt(log, 4.2, 2.1 + 0.3))).toEqual(
      recording((c) => {
        drawVoiceRing(c, '#f472b6', 3.2);
        drawScientist(c, benLook(frame, { speaking: true }));
      }),
    );
  });

  it('names you by your own name where the crew’s list has no entry for you', () => {
    const frame = frameWith({ players: [], youName: 'Zoe' });
    const log = drawn(frame);
    const you: ScientistOpts = {
      color: FALLBACK_COLOR,
      name: 'Zoe',
      facing: 0,
      moving: false,
      walkPhase: 0,
      isYou: true,
      connected: true,
      text: frame.text,
      pose: poseIn(frame, 'p1', {}),
    };
    expect(strip(drawnAt(log, 2.5, 2.5 + 0.3))).toEqual(recording((c) => drawScientist(c, you)));
  });

  it('names somebody the view does not list „???", in the crew’s fallback colour', () => {
    const frame = frameWith({ others: new Map([['p9', ben]]) });
    const log = drawn(frame);
    const stranger = { ...benLook(frame, {}, 'p9'), color: FALLBACK_COLOR, name: '???' };
    expect(strip(drawnAt(log, 4.2, 2.1 + 0.3))).toEqual(
      recording((c) => drawScientist(c, stranger)),
    );
  });

  it('marks every drone for a second after an alarm, the mark fading', () => {
    const body = drone({ x: 7, y: 3, frozen: true });
    const now = 1_000_000;
    const marked = drawn(frameWith({ drones: { body }, now, alarm: { seq: 1, at: now - 250 } }));
    expect(strip(drawnAt(marked, 7, 3, 1))).toEqual(
      recording((c) => {
        drawDroneBody(c, body, 0.5);
        drawAlarmMark(c, 0.25);
      }),
    );
    const calm = drawn(frameWith({ drones: { body }, now }));
    expect(strip(drawnAt(calm, 7, 3, 1))).toEqual(
      recording((c) => {
        drawDroneBody(c, body, 0.5);
        drawAlarmMark(c, 1);
      }),
    );
  });

  it('puts what somebody carries in their hands, and nothing over their head', () => {
    const others = new Map([['p2', ben]]);
    const carrying = new Map([
      ['p2', 'KISTE'],
      ['p1', 'SICHERUNG'],
    ]);
    const frame = frameWith({ players, others, carrying });
    const log = drawn(frame);
    const carrier = { ...benLook(frame, { carrying: 'crate' }), held: heldItem('KISTE', 0.5) };
    const drawnBen = strip(drawnAt(log, 4.2, 2.1 + 0.3));
    expect(drawnBen).toEqual(recording((c) => drawScientist(c, carrier)));
    const you = drawnAt(log, 2.5, 2.5 + 0.3);
    expect(strip(you)).toContainEqual(['scale', [HELD_SCALE, HELD_SCALE]]);
    expect(drawnAt(log, 4.2, 2.1 - 0.75)).toEqual([]);
    expect(drawnAt(log, 2.5, 2.5 - 0.75)).toEqual([]);
    const emptyHanded = drawn(frameWith({ players, others }));
    expect(strip(drawnAt(emptyHanded, 4.2, 2.1 + 0.3))).not.toContainEqual([
      'scale',
      [HELD_SCALE, HELD_SCALE],
    ]);
  });
});

describe('heldItem — what the hands hold', () => {
  it('draws the item as carried at its size on the floor: no shadow, glow or label', () => {
    const { ctx, log } = fakeCanvas();
    heldItem('SICHERUNG', 0.5)(ctx);
    const size = callsOf(log, 'scale').reduce((product, [x]) => product * Number(x), 1);
    expect(size).toBeCloseTo(1, 9);
    expect(strip(log).slice(1)).toEqual(
      recording((c) => drawCarryable(c, { label: 'SICHERUNG', pulse: 0.5, carried: true })),
    );
    expect(callsOf(log, 'fillText')).toEqual([]);
    expect(callsOf(log, 'ellipse')).toEqual([]);
  });
});

describe('crewPose — the frame says how each of the crew stands', () => {
  it('poses a crew member by what the frame says of them, at their own offset', () => {
    const frame = frameWith({
      time: 12.5,
      now: 1_000_000,
      alarm: { seq: 2, at: 1_000_000 - 120 },
      carrying: new Map([['p2', 'SCHLÜSSEL']]),
      speaking: new Set(['p2']),
      stillSince: new Map([['p2', 9000]]),
      mood: 'play',
    });
    expect(crewPose(frame, 'p2', { moving: false, facing: 2 })).toEqual(
      figurePose({
        moving: false,
        facing: 2,
        carrying: 'key',
        speaking: true,
        alarmAgoMs: 120,
        readyAgoMs: null,
        mood: 'play',
        t: 12_500,
        idleMs: 3500,
        phase: figurePhase('p2'),
        reduced: false,
      }),
    );
  });

  it('flinches the crew at an alarm, and stands nobody walking still', () => {
    const now = 1_000_000;
    const frame = frameWith({ now, alarm: { seq: 1, at: now - 125 }, time: 40 });
    const flinch = crewPose(frame, 'p1', { moving: true, facing: 0 });
    expect(flinch.rise).toBeGreaterThan(0);
    expect(flinch.arms).not.toBeNull();
    const calm = crewPose(frameWith({ now, alarm: { seq: 1, at: now - 5000 }, time: 40 }), 'p1', {
      moving: true,
      facing: 0,
    });
    expect(calm.rise).toBe(0);
    expect(calm.arms).toBeNull();
  });

  it('celebrates a run won and slumps over one lost, under reduced motion too', () => {
    const won = crewPose(frameWith({ mood: 'celebrate', reduced: true }), 'p1', {
      moving: false,
      facing: 0,
    });
    expect(won.arms?.front).toBeGreaterThan(Math.PI / 2);
    const lost = crewPose(frameWith({ mood: 'slump' }), 'p1', { moving: false, facing: 0 });
    expect(lost.dim).toBeGreaterThan(0);
    expect(lost.bob).toBeLessThan(0);
  });
});
