import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapView, PlayerView } from '@escapelab/core';
import { GameScreen, StageTop, type ColdOpen } from '../src/screens/Game.js';
import {
  blackoutCue,
  coldOpenFrame,
  darkSince,
  FADE_MS,
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
  startsOf,
  toOutput,
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

describe('the lights failing under reduced motion', () => {
  const covers = Array.from({ length: FLICKER_MS / 5 }, (_, i) => coldOpenFrame(i * 5, true).cover);

  it('fade out once over the last 300 ms before the bang, no flicker at all', () => {
    expect(FADE_MS).toBe(300);
    // Never down and up again: the cover only grows.
    expect(covers.every((cover, i) => i === 0 || cover >= (covers[i - 1] ?? 0))).toBe(true);
    expect(coldOpenFrame(FLICKER_MS - FADE_MS, true).cover).toBe(0);
    expect(coldOpenFrame(FLICKER_MS - FADE_MS / 2, true).cover).toBeCloseTo(0.5);
    expect(coldOpenFrame(FLICKER_MS, true)).toEqual({ lit: false, cover: 1 });
    // The same dark from the bang to the click, and the same lamps after it.
    expect(coldOpenFrame(REVEAL_MS + 150, true)).toEqual(coldOpenFrame(REVEAL_MS + 150));
  });

  it('keeps the bang and the click, with no drop to arc in', () => {
    expect(blackoutCue(0, true)).toEqual({ drops: [], bang: 0.9, click: 1.3 });
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
    noteHere: null,
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
    expect(html).toContain('Start im ARCHIV');
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

describe('the start of a run with the power on', () => {
  function game(view: PlayerView): string {
    return renderToStaticMarkup(
      <GameScreen
        view={view}
        roomCode="KX4P"
        positionsRef={{ current: { run: null, players: {} } }}
        dronesRef={{ current: {} }}
        pingsRef={{ current: [] }}
        chatsRef={{ current: [] }}
        send={() => undefined}
        refusals={0}
        finale={null}
      />,
    );
  }

  it('counts nothing down to its surprise: no briefing, so no countdown beeps either', () => {
    expect(game(viewOf({ startedAt: Date.now() }))).not.toContain('briefing');
    // A run that opens in the dark briefs — and counts its briefing down.
    const dark = viewOf({ startedAt: Date.now(), lights: { out: true, outAt: Date.now() } });
    expect(game(dark)).toContain('<div class="overlay briefing">');
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
    expect(startsOf('mains-hum')).toHaveLength(1);
    expect(started.filter((s) => s.kind === 'tone')).toEqual([]);
    expect(() => audio.stopPowerHum()).not.toThrow();
    expect(() => audio.stopPowerHum()).not.toThrow();
  });

  it('put the arcs, the thunk and the click where the screen has them', async () => {
    const audio = await freshAudio();
    audio.startPowerHum();
    audio.blackoutSounds(blackoutCue(0));
    const t = 10.01;
    for (const drop of [0.1, 0.29, 0.47, 0.64]) {
      expect(startedAt('short-arc', t + drop), `an arc in the drop at ${drop}`).toBe(true);
    }
    expect(startedAt('breaker-thunk', t + 0.9)).toBe(true);
    expect(startedAt('power-down', t + 0.9)).toBe(true);
    expect(startedAt('relay-click', t + 1.3)).toBe(true);
    expect(startedAt('emergency-buzz', t + 1.38)).toBe(true);
    // The hum dies with the thunk, slowing to a quarter as it fades.
    expect(ramps).toContainEqual({ to: 0.25, at: t + 0.9 + 1.4 });
  });

  it('throw the lever home with its ka-chunk', async () => {
    const audio = await freshAudio();
    audio.leverChunk();
    expect(startedAt('lever-chunk', 10.01)).toBe(true);
  });

  it('make nothing up for a recording that could not be loaded', async () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const audio = await freshAudio({ 'lever-chunk': { status: 404 } });
    audio.leverChunk();
    audio.leverChunk();
    expect(started).toEqual([]);
    expect(said).toHaveBeenCalledTimes(1);
    said.mockRestore();
  });

  it('count a briefing down by the lab’s one sound switch: a beep a number, the last higher', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '1', setItem: () => undefined });
    const audio = await freshAudio();
    audio.briefingCountdown(0);
    const beeps = startsOf('countdown-beep').map((s) => s.at);
    expect(beeps).toEqual([10.01, 11.21, 12.41].map((at) => expect.closeTo(at, 3)));
    expect(startsOf('countdown-go').map((s) => s.at)).toEqual([expect.closeTo(13.61, 3)]);
    // Through the master gain, at 0 with the sound off: nothing reaches the output past it.
    expect(toOutput).toHaveLength(1);
    expect(toOutput[0]?.gain?.value).toBe(0);
    expect(audio.isMuted()).toBe(true);
  });

  it('beep only the numbers still ahead for a briefing come to late', async () => {
    const audio = await freshAudio();
    audio.briefingCountdown(2500);
    const go = ['countdown-go', expect.closeTo(11.11, 3)];
    expect(started.map((s) => [s.kind, s.at])).toEqual([go]);
    started.length = 0;
    audio.briefingCountdown(4000);
    expect(started).toEqual([]);
  });

  it('count the last ten seconds higher as they run out, and thunk at zero', async () => {
    const audio = await freshAudio();
    for (const left of [10, 5, 1, 0]) audio.countdownBeep(left);
    expect(startsOf('countdown-beep').map((s) => s.rate)).toEqual([
      1,
      expect.closeTo(1 + (5 * 55) / 620, 6),
      expect.closeTo(1 + (9 * 55) / 620, 6),
    ]);
    expect(startsOf('breaker-thunk')).toHaveLength(1);
  });

  it('key the radio with its recorded key — no tone to clash with a solve’s chord', async () => {
    const audio = await freshAudio();
    audio.radioChirp();
    expect(started.map((s) => [s.kind, s.at])).toEqual([['radio-key', expect.closeTo(10.01, 3)]]);
  });

  it('arc in no drop under reduced motion, but thunk and click as ever', async () => {
    const audio = await freshAudio();
    audio.blackoutSounds(blackoutCue(0, true));
    const t = 10.01;
    expect(startsOf('short-arc')).toEqual([]);
    expect(startedAt('breaker-thunk', t + 0.9)).toBe(true);
    expect(startedAt('relay-click', t + 1.3)).toBe(true);
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
