import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomPlan } from '../src/world/ambience.js';
import { OWN_STEP_DB, SPRINT_STEP_GAIN, STEP_LEVEL } from '../src/world/audio.js';
import {
  followFloors,
  forgetFloors,
  ownSurface,
  STEP_SPREAD,
  STEPS,
  stepRate,
  stepTake,
  surfaceAt,
  SURFACES,
} from '../src/world/footsteps.js';
import { SFX_IDS } from '../src/world/samples.js';
import { fakeGraph, lastContext, type FakeBufferSource, type FakeGain } from './fakeGraph.js';
import { loadedSamples } from './fakeSamples.js';

/** A corridor (x 0–3) and a reactor hall (x 5–8) with a doorway at x 4, one row high. */
const PLAN: RoomPlan = {
  width: 9,
  rooms: ['FLUR', 'FLUR', 'FLUR', 'FLUR', null, 'REAKTOR', 'REAKTOR', 'REAKTOR', 'REAKTOR'],
  kinds: new Map([
    ['FLUR', 'corridor'],
    ['REAKTOR', 'reactor'],
  ]),
  links: [{ a: 'FLUR', b: 'REAKTOR', door: 'tuer', x: 4.5, y: 0.5 }],
};

describe('the floor under a step', () => {
  afterEach(() => {
    forgetFloors();
    vi.restoreAllMocks();
  });

  it('is concrete, linoleum or steel by the room’s kind', () => {
    expect(SURFACES).toEqual({
      corridor: 'concrete',
      machine: 'concrete',
      plain: 'concrete',
      lab: 'lino',
      archive: 'lino',
      control: 'lino',
      server: 'steel',
      reactor: 'steel',
    });
  });

  it('has three takes on each floor, every one a recording the game knows', () => {
    for (const takes of Object.values(STEPS)) {
      expect(takes).toHaveLength(3);
      for (const id of takes) expect(SFX_IDS).toContain(id);
    }
    expect(new Set(Object.values(STEPS).flat()).size).toBe(9);
  });

  it('picks a take at random and strays at most 5 % from its speed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect([stepTake('lino'), stepRate()]).toEqual(['step-lino-1', 1 - STEP_SPREAD]);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(stepTake('steel')).toBe('step-steel-3');
    expect(stepRate()).toBeCloseTo(1 + STEP_SPREAD, 2);
    expect(STEP_SPREAD).toBe(0.05);
  });

  it('follows the room the player stands in, and reads a tile’s floor off the plan', () => {
    expect(ownSurface()).toBe('concrete'); // nothing known yet
    followFloors(PLAN, 'REAKTOR');
    expect(ownSurface()).toBe('steel');
    expect(surfaceAt(1, 0)).toBe('concrete');
    expect(surfaceAt(6, 0)).toBe('steel');
    expect(surfaceAt(4, 0)).toBeNull(); // the doorway: whoever stands there keeps their floor
    expect(surfaceAt(-1, 0)).toBeNull();
    expect(surfaceAt(3, 5)).toBeNull();
    forgetFloors();
    expect([ownSurface(), surfaceAt(6, 0)]).toEqual(['concrete', null]);
  });
});

describe('your own steps', () => {
  beforeEach(() => {
    fakeGraph();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function stepping(room: string) {
    vi.resetModules();
    await loadedSamples();
    const floors = await import('../src/world/footsteps.js');
    floors.followFloors(PLAN, room);
    const audio = await import('../src/world/audio.js');
    audio.sharedAudio();
    return { audio, ctx: lastContext() };
  }

  /** The level a step played at: the gain of the outlet its source feeds. */
  const levelOf = (step: FakeBufferSource | undefined): number =>
    (step?.outputs[0] as FakeGain | undefined)?.gain.value ?? NaN;

  it('sound the floor of the room you stand in, 4 dB under a partner’s', async () => {
    const { audio, ctx } = await stepping('REAKTOR');
    audio.footstep();
    const [step] = ctx.all<FakeBufferSource>('buffer');
    expect(step?.buffer?.tag).toBe('step-steel-2');
    expect(step?.playbackRate.value).toBe(1);
    expect(levelOf(step)).toBeCloseTo(STEP_LEVEL * 10 ** (OWN_STEP_DB / 20), 12);
    expect(OWN_STEP_DB).toBe(-4);
    audio.footstep(true);
    const sprint = ctx.all<FakeBufferSource>('buffer')[1];
    expect(levelOf(sprint)).toBeCloseTo(levelOf(step) * SPRINT_STEP_GAIN, 12);
  });

  it('sound concrete in a corridor', async () => {
    const { audio, ctx } = await stepping('FLUR');
    audio.footstep();
    expect(ctx.all<FakeBufferSource>('buffer')[0]?.buffer?.tag).toBe('step-concrete-2');
  });
});
