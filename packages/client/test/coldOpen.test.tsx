import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapView, PlayerView } from '@escapelab/core';
import { StageTop, type ColdOpen } from '../src/screens/Game.js';
import {
  blackoutCue,
  coldOpenFrame,
  darkSince,
  FLICKER_MS,
  opensLit,
  REVEAL_MS,
  revealed,
  SEQUENCE_MS,
  STALE_MS,
} from '../src/world/coldOpen.js';
import { ceilingLights, lightLevels } from '../src/world/power.js';
import {
  BrokenContext,
  fakeAudio,
  freshAudio,
  ramps,
  started,
  startedAt,
} from './fakeAudio.js';
import { mapWith } from './fixtures.js';

const START = 1_000_000;
const ARRIVED = START + 3100;

describe('when the lights go out on a screen', () => {
  const out = { out: true, outAt: START + 3000 };

  it('starts the sequence when the view with the lights out arrives', () => {
    expect(darkSince(out, START, ARRIVED)).toBe(ARRIVED);
  });

  it('counts it long over for a view that comes more than three seconds late', () => {
    const late = START + 3000 + STALE_MS + 1;
    expect(darkSince(out, START, late)).toBe(late - SEQUENCE_MS);
    expect(darkSince(out, START, START + 3000 + STALE_MS)).toBe(START + 3000 + STALE_MS);
  });

  it('plays none for a mission whose lights are out from the start', () => {
    const fromStart = { out: true, outAt: START };
    expect(darkSince(fromStart, START, START + 50)).toBe(START + 50 - SEQUENCE_MS);
    expect(opensLit(fromStart, START)).toBe(false);
  });

  it('knows nothing of it while the lights are on', () => {
    const on = { out: false, outAt: null };
    expect(darkSince(on, START, ARRIVED)).toBeNull();
    expect(opensLit(on, START)).toBe(true);
    expect(opensLit(out, START)).toBe(true);
  });
});

describe('the lights failing, frame by frame', () => {
  it('keeps the lab lit and uncovered while the power is on', () => {
    expect(coldOpenFrame(null)).toEqual({ lit: true, cover: 0 });
  });

  it('flickers the whole scene three or four times before the bang', () => {
    const covers = Array.from({ length: FLICKER_MS / 5 }, (_, i) => coldOpenFrame(i * 5));
    expect(covers.every((frame) => frame.lit)).toBe(true);
    const drops = covers.filter(
      (frame, i) => frame.cover >= 0.45 && (covers[i - 1]?.cover ?? 0) < 0.45,
    );
    expect(drops.length).toBeGreaterThanOrEqual(3);
    expect(drops.length).toBeLessThanOrEqual(4);
    expect(coldOpenFrame(0).cover).toBe(0);
  });

  it('goes black at the bang until the click, then lets the lamps up over 0.3 s', () => {
    expect(coldOpenFrame(FLICKER_MS)).toEqual({ lit: false, cover: 1 });
    expect(coldOpenFrame(REVEAL_MS - 1)).toEqual({ lit: false, cover: 1 });
    expect(coldOpenFrame(REVEAL_MS + 150).cover).toBeCloseTo(0.5);
    expect(coldOpenFrame(SEQUENCE_MS)).toEqual({ lit: false, cover: 0 });
    expect(coldOpenFrame(60_000)).toEqual({ lit: false, cover: 0 });
  });

  it('starts the clock, the goal and the radio at the click', () => {
    expect(revealed(null, ARRIVED)).toBe(false);
    expect(revealed(ARRIVED, ARRIVED + REVEAL_MS - 1)).toBe(false);
    expect(revealed(ARRIVED, ARRIVED + REVEAL_MS)).toBe(true);
  });

  it('cues its sounds where the screen shows them, those still ahead from later on', () => {
    const cue = blackoutCue(0);
    expect(cue.drops).toHaveLength(4);
    expect(cue.bang).toBeCloseTo(0.9);
    expect(cue.click).toBeCloseTo(1.3);
    const late = blackoutCue(700);
    expect(late.drops).toHaveLength(1);
    expect(late.bang).toBeCloseTo(0.2);
    expect(blackoutCue(2000)).toEqual({ drops: [], bang: 0, click: 0 });
  });
});

/** A room for one spawn: the Archiv, three tiles wide. */
const archiv: MapView = mapWith({
  width: 5,
  height: 3,
  tiles: ['#####', '#...#', '#####'],
  yourSpawn: { x: 1, y: 1 },
  labels: [{ text: 'ARCHIV', x: 2, y: 1 }],
  stations: [{ puzzleId: 'notlicht', x: 3, y: 1, title: 'Notlicht', status: 'armed' }],
});

function viewOf(parts: Partial<PlayerView> = {}): PlayerView {
  const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: true, isHost: true };
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    crewSize: { min: 2, max: 3 },
    you: anna,
    players: [{ ...anna, connected: true }],
    palette: [],
    deadlineAt: null,
    startedAt: START,
    finishedAt: null,
    timeLimitSec: 660,
    lights: { out: false, outAt: null },
    currentPuzzleIndex: 0,
    puzzleCount: 6,
    pausedFor: null,
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
    puzzle: null,
    map: archiv,
    ...parts,
  };
}

function bar(view: PlayerView, coldOpen: Partial<ColdOpen>): string {
  const lived: ColdOpen = {
    darkSince: null,
    dark: false,
    intro: true,
    flashUntil: null,
    gates: { sign: START, line: null },
    ...coldOpen,
  };
  return renderToStaticMarkup(
    <StageTop view={view} map={archiv} coldOpen={lived} notice={null} alarmVisible={false} />,
  );
}

describe('the objective bar in the cold open', () => {
  it('shows NORMALBETRIEB where the clock will be while the power is on, and no goal yet', () => {
    const html = bar(viewOf(), {});
    expect(html).toContain(
      '<div class="power-status" role="status"><span class="power-dot" aria-hidden="true">' +
        '</span>NORMALBETRIEB</div>',
    );
    expect(html).toContain('<div class="stage-goal stage-goal--power"><h1>Blackout im Labor</h1>');
    expect(html).toContain('Du startest im ARCHIV');
    expect(html).not.toContain('countdown');
    expect(html).not.toContain('led-strip');
    expect(html).not.toContain('Notlicht');
    // The alarm marks stay under it.
    expect(html).toContain('class="alarm-marks"');
  });

  it('keeps it so through the flicker and the black, until the click', () => {
    const dark = viewOf({
      lights: { out: true, outAt: START + 3000 },
      deadlineAt: Date.now() + 1e6,
    });
    const html = bar(dark, { darkSince: Date.now(), dark: false });
    expect(html).toContain('NORMALBETRIEB');
    expect(html).not.toContain('countdown');
  });

  it('starts the clock at the click, its digits flashing red once, the goal line up', () => {
    const dark = viewOf({
      lights: { out: true, outAt: START + 3000 },
      deadlineAt: Date.now() + 659_000,
    });
    const flashing = {
      darkSince: Date.now() - REVEAL_MS,
      dark: true,
      flashUntil: Date.now() + 900,
    };
    const html = bar(dark, flashing);
    expect(html).toMatch(/<div class="countdown\s+countdown--start">10:59<\/div>/);
    expect(html).not.toContain('NORMALBETRIEB');
    expect(html).toContain('<h1>Notlicht</h1>');
    expect(html).toContain('class="led-strip"');
    // Once it has flashed, the clock is the clock: its last minute pulses as ever.
    const after = bar(dark, { ...flashing, flashUntil: Date.now() - 1 });
    expect(after).toMatch(/<div class="countdown\s*">10:59<\/div>/);
  });

  it('gives a screen that landed in the dark the clock without the flash', () => {
    const dark = viewOf({ lights: { out: true, outAt: START }, deadlineAt: Date.now() + 600_000 });
    const html = bar(dark, { darkSince: START - SEQUENCE_MS, dark: true, flashUntil: null });
    expect(html).toMatch(/<div class="countdown\s*">10:00<\/div>/);
    expect(html).not.toContain('countdown--start');
  });
});

describe('the ceiling lights of the lab with its power on', () => {
  /**
   * A room of two rows over a corridor, joined by a gap at (3,3).
   *
   *   0123456
   * 0 #######
   * 1 #.....#
   * 2 #.....#
   * 3 ###.###
   * 4 #.....#
   * 5 #######
   */
  const map = {
    width: 7,
    height: 6,
    tiles: ['#######', '#.....#', '#.....#', '###.###', '#.....#', '#######'],
  };

  it('hang on the floor, every third tile, moved off a wall onto the floor beside it', () => {
    const lights = ceilingLights(map);
    expect(lights.length).toBeGreaterThan(0);
    for (const light of lights) {
      expect(map.tiles[Math.floor(light.y)]?.[Math.floor(light.x)]).toBe('.');
    }
    expect(lights).toContainEqual({ x: 2.5, y: 2.5 });
    // (2,5) is the wall below the lower room: its light moves onto the floor above it.
    expect(lights).toContainEqual({ x: 2.5, y: 4.5 });
  });

  it('light the floor and leave the walls dark', () => {
    const levels = lightLevels(map);
    expect(levels[0]?.every((level) => level === 0)).toBe(true);
    expect(levels[3]?.[0]).toBe(0);
    expect(levels[2]?.[2]).toBe(1);
    expect(levels.flat().every((level) => level >= 0 && level <= 1)).toBe(true);
  });

  it('light nothing behind a wall, however near', () => {
    // One light, in the west room; the east room's tile is two tiles from it, through a wall.
    const rooms = { width: 6, height: 3, tiles: ['######', '#..#.#', '######'] };
    expect(ceilingLights(rooms)).toEqual([{ x: 2.5, y: 1.5 }]);
    const [, row] = lightLevels(rooms);
    expect(row?.[2]).toBe(1);
    expect(row?.[4]).toBe(0);
  });
});

describe('the sounds of the cold open', () => {
  beforeEach(() => {
    fakeAudio();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hum with the power on, once however often asked, and stop without a fuss', async () => {
    const audio = await freshAudio();
    audio.startPowerHum();
    audio.startPowerHum();
    expect(started.filter((s) => s.kind === 'tone')).toHaveLength(4);
    expect(() => audio.stopPowerHum()).not.toThrow();
    expect(() => audio.stopPowerHum()).not.toThrow();
  });

  it('put the bang and the click on the audio clock where the screen shows them', async () => {
    const audio = await freshAudio();
    audio.startPowerHum();
    audio.blackoutSounds(blackoutCue(0));
    const t = 10.01;
    expect(startedAt('tone', t)).toBe(true); // the arcing's rasp
    expect(startedAt('noise', t + 0.1)).toBe(true); // a crackle in the first drop
    expect(startedAt('tone', t + 0.9)).toBe(true); // the bang's thump, the power draining
    expect(startedAt('noise', t + 0.9)).toBe(true);
    expect(startedAt('noise', t + 1.3)).toBe(true); // the relay's click
    // The hum dies with the bang, its 100 Hz falling to a quarter.
    expect(ramps).toContainEqual({ to: 25, at: t + 0.9 + 1.4 });
  });

  it('throw the lever home with a ka-chunk: the latch, then the thud', async () => {
    const audio = await freshAudio();
    audio.leverChunk();
    expect(startedAt('noise', 10.01)).toBe(true);
    expect(startedAt('tone', 10.13)).toBe(true);
  });

  it('never throw, with no audio at all or with one that breaks', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const none = await freshAudio();
    expect(() => {
      none.startPowerHum();
      none.blackoutSounds(blackoutCue(0));
      none.leverChunk();
      none.stopPowerHum();
    }).not.toThrow();
    vi.stubGlobal('AudioContext', BrokenContext);
    const broken = await freshAudio();
    expect(() => {
      broken.startPowerHum();
      broken.blackoutSounds(blackoutCue(0));
      broken.leverChunk();
      broken.stopPowerHum();
    }).not.toThrow();
    expect(started.filter((s) => s.kind === 'tone')).toHaveLength(0);
  });
});
