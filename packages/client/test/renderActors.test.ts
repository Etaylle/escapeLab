import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DronePosition } from '@escapelab/core';
import {
  drawScientist,
  drawVoiceRing,
  type ScientistOpts,
  type WorldText,
} from '../src/world/art.js';
import {
  drawAlarmMark,
  drawCarryable,
  drawDroneBody,
  drawDroneCone,
} from '../src/world/hazards.js';
import { draw } from '../src/world/render/actors.js';
import { FALLBACK_COLOR, type OtherAvatar } from '../src/world/render/frame.js';
import { callsOf, drawnAt, fakeCanvas, FakePath2D, recording, strip } from './fakeCanvas.js';
import { frameWith, lightWith, lit, player, TILES } from './frames.js';
import { mapWith, type Item } from './fixtures.js';

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

/** Ben as the view names him, as the frame eases him. */
function benLook(text: WorldText): ScientistOpts {
  return {
    color: '#f472b6',
    name: 'Ben',
    facing: 1,
    moving: true,
    walkPhase: 0.4,
    isYou: false,
    connected: true,
    text,
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
      recording((c) => drawScientist(c, benLook(frame.text))),
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
        drawScientist(c, benLook(frame.text));
      }),
    );
  });

  it('names somebody the view does not list „???", in the crew’s fallback colour', () => {
    const frame = frameWith({ others: new Map([['p9', ben]]) });
    const log = drawn(frame);
    const stranger = { ...benLook(frame.text), color: FALLBACK_COLOR, name: '???' };
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

  it('lifts what somebody carries above their head, where the frame draws them', () => {
    const crate: Item = {
      id: 'crate',
      label: 'KISTE',
      x: 0,
      y: 0,
      carriedBy: 'p2',
      delivered: false,
      deliverTo: null,
      requiredForTitle: null,
    };
    const items = [crate, { ...crate, id: 'mine', label: 'SICHERUNG', carriedBy: 'p1' }];
    const map = mapWith({ width: 10, height: 6, tiles: TILES, items });
    const log = drawn(frameWith({ map, others: new Map([['p2', ben]]) }));
    expect(strip(drawnAt(log, 4.2, 2.1 - 0.75))).toEqual(
      recording((c) => drawCarryable(c, { label: 'KISTE', pulse: 0.5, carried: true })),
    );
    expect(strip(drawnAt(log, 2.5, 2.5 - 0.75))).toEqual(
      recording((c) => drawCarryable(c, { label: 'SICHERUNG', pulse: 0.5, carried: true })),
    );
    const delivered = [{ ...crate, delivered: true }];
    const done = mapWith({ width: 10, height: 6, tiles: TILES, items: delivered });
    const after = drawn(frameWith({ map: done, others: new Map([['p2', ben]]) }));
    expect(drawnAt(after, 4.2, 2.1 - 0.75)).toEqual([]);
  });
});
