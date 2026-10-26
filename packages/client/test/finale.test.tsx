import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapView, PlayerView, SpectatorView } from '@escapelab/core';
import { alarmsCause, EndScreen, TitleCard, titleCardOf } from '../src/screens/End.js';
import {
  clockStage,
  FinaleVeil,
  GameScreen,
  StageTop,
  type ColdOpen,
} from '../src/screens/Game.js';
import { SpectateScreen } from '../src/screens/Spectate.js';
import {
  alarmClasses,
  alarmFx,
  DRONE_MARK_MS,
  FLASH_MS,
  nextAlarm,
  SHAKE_MS,
  STROBE_MS,
} from '../src/world/alarm.js';
import {
  DOOR_SLIDE_MS,
  doorOpenness,
  doorTurned,
  isHorizontalDoor,
  spillThrough,
} from '../src/world/doors.js';
import {
  EXIT_GRIND_MS,
  escapeChecklist,
  escapeSince,
  exitOpening,
  RED_SHIFT_MS,
  redShift,
} from '../src/world/escape.js';
import {
  DIM_MS,
  endingOf,
  finaleFrame,
  finaleMs,
  finaleStart,
  PULLBACK_MS,
  veilOf,
  WHITE_MS,
} from '../src/world/finale.js';
import { WARM_UP_MS, warmUp } from '../src/world/rooms.js';
import { BrokenContext, fakeAudio, freshAudio, started, startedAt, startsOf } from './fakeAudio.js';
import { mapWith } from './fixtures.js';

const noop = (): void => undefined;
const T0 = 1_000_000;

/** How many times `values` drop by more than `by` from one to the next. */
function drops(values: readonly number[], by = 0.05): number {
  return values.filter((v, i) => i > 0 && (values[i - 1] ?? 0) - v > by).length;
}

/** `f` sampled every `step` ms from 0 to `to`. */
function sampled(f: (ms: number) => number, to: number, step = 5): number[] {
  return Array.from({ length: Math.floor(to / step) + 1 }, (_, i) => f(i * step));
}

describe('an alarm in the world', () => {
  it('comes with a penalty this screen sees come in, not with one it found there', () => {
    expect(nextAlarm(null, 2, 2, T0)).toBeNull();
    expect(nextAlarm(null, 2, 3, T0)).toEqual({ seq: 3, at: T0 });
    const last = { seq: 3, at: T0 };
    expect(nextAlarm(last, 3, 3, T0 + 500)).toBe(last);
    expect(nextAlarm(last, 3, 5, T0 + 500)).toEqual({ seq: 5, at: T0 + 500 });
  });

  it('strobes twice and shakes the camera, then leaves the drones their marks for a second', () => {
    expect(STROBE_MS).toBe(3 * FLASH_MS);
    expect(FLASH_MS).toBe(120);
    expect(alarmClasses(alarmFx(0, false))).toBe('alarm-strobe alarm-shake');
    expect(alarmClasses(alarmFx(SHAKE_MS - 1, false))).toBe('alarm-strobe alarm-shake');
    expect(alarmClasses(alarmFx(SHAKE_MS, false))).toBe('alarm-strobe');
    expect(alarmClasses(alarmFx(STROBE_MS, false))).toBe('');
    expect(alarmFx(STROBE_MS, false).droneMarks).toBe(true);
    expect(alarmFx(DRONE_MARK_MS - 1, false).droneMarks).toBe(true);
    expect(alarmFx(DRONE_MARK_MS, false)).toEqual({ strobe: false, shake: false, droneMarks: false });
    expect(alarmClasses(alarmFx(null, false))).toBe('');
  });

  it('neither strobes nor shakes under reduced motion; the drones still say who saw', () => {
    expect(alarmFx(0, true)).toEqual({ strobe: false, shake: false, droneMarks: true });
    expect(alarmClasses(alarmFx(0, true))).toBe('');
  });

  it('flashes twice for 120 ms in its stylesheet, and drops both under reduced motion', () => {
    const css = readFileSync(new URL('../src/styles/finale.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.world-wrap\.alarm-strobe::after \{[^}]*animation: alarm-strobe 360ms/);
    expect(css).toMatch(/\.world-wrap\.alarm-shake \.world-canvas \{[^}]*alarm-shake 300ms/);
    const reduced = css.slice(css.indexOf(":where([data-motion='reduce'])"));
    expect(reduced).toMatch(/\.world-wrap\.alarm-strobe::after,[^{]*alarm-shake[^{]*\{\s*animation: none/);
  });
});

describe('a door', () => {
  const now = T0;

  it('stands as it is where this screen first sees it', () => {
    const { motion, moved } = doorTurned(undefined, true, now);
    expect(moved).toBe(false);
    expect(doorOpenness(motion, now)).toBe(1);
    expect(doorOpenness(doorTurned(undefined, false, now).motion, now)).toBe(0);
  });

  it('slides open over 350 ms, easing in and out, and back as it shuts', () => {
    const shut = doorTurned(undefined, false, now).motion;
    const { motion, moved } = doorTurned(shut, true, now);
    expect(moved).toBe(true);
    const slide = sampled((ms) => doorOpenness(motion, now + ms), DOOR_SLIDE_MS, 25);
    expect(slide[0]).toBe(0);
    expect(slide.at(-1)).toBe(1);
    expect(slide.every((v, i) => i === 0 || v >= (slide[i - 1] ?? 0))).toBe(true);
    // Eased: the first 25 ms move it less than an even slide would.
    expect(slide[1]).toBeLessThan(25 / DOOR_SLIDE_MS);
    expect(doorOpenness(motion, now + DOOR_SLIDE_MS / 2)).toBeCloseTo(0.5);
    // Shut again halfway: it slides back from where it stands.
    const back = doorTurned(motion, false, now + DOOR_SLIDE_MS / 2);
    expect(back.moved).toBe(true);
    expect(doorOpenness(back.motion, now + DOOR_SLIDE_MS / 2)).toBeCloseTo(0.5);
    expect(doorOpenness(back.motion, now + DOOR_SLIDE_MS * 1.5)).toBe(0);
    expect(doorTurned(back.motion, false, now + DOOR_SLIDE_MS * 2).moved).toBe(false);
  });

  /**
   * A lit room west of a door into a dark one, the door at (3,1):
   *
   *   01234567
   * 0 ########
   * 1 #..D...#
   * 2 ########
   */
  const corridor = mapWith({
    width: 8,
    height: 3,
    tiles: ['########', '#......#', '########'],
    doors: [{ id: 'tuer', x: 3, y: 1, open: true }],
  });
  const door = corridor.doors[0] ?? { id: '', x: 0, y: 0, open: false };
  const litWest = (x: number): boolean => x <= 3;

  it('lets a lit room’s light spill through into the dark, a wedge from its doorway', () => {
    expect(isHorizontalDoor(corridor, door)).toBe(false);
    const spill = spillThrough(corridor, door, 1, (x) => litWest(x));
    expect(spill).toMatchObject({ doorId: 'tuer', facing: 0 });
    expect(spill?.x).toBeGreaterThan(3.5);
    // The other way round, it falls west.
    const west = spillThrough(corridor, door, 0.5, (x) => x >= 3);
    expect(Math.cos(west?.facing ?? 0)).toBeCloseTo(-1);
    expect(west?.x).toBeLessThan(3.5);
  });

  it('spills nothing while shut, nor with light or dark on both sides', () => {
    expect(spillThrough(corridor, door, 0, (x) => litWest(x))).toBeNull();
    expect(spillThrough(corridor, door, 1, () => true)).toBeNull();
    expect(spillThrough(corridor, door, 1, () => false)).toBeNull();
  });
});

describe('a room coming on', () => {
  it('warms up over half a second, dipping twice on the way', () => {
    expect(WARM_UP_MS).toBe(500);
    expect(warmUp(0)).toBe(0);
    expect(warmUp(WARM_UP_MS)).toBe(1);
    expect(warmUp(-Infinity)).toBe(0);
    expect(warmUp(Infinity)).toBe(1);
    expect(drops(sampled((ms) => warmUp(ms), WARM_UP_MS))).toBe(2);
  });

  it('comes on without the flicker under reduced motion', () => {
    const smooth = sampled((ms) => warmUp(ms, true), WARM_UP_MS);
    expect(drops(smooth, 0)).toBe(0);
    expect(smooth.at(-1)).toBe(1);
  });
});

const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost: true };
const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: false, isHost: false };

/** The hatch at (8,2), open since `openedAt` with `atExit` on it. */
function hatch(openedAt: number | null, atExit: string[] = []): NonNullable<MapView['exit']> {
  return { x: 8, y: 2, open: openedAt !== null, openedAt, atExit };
}

/** Anna's view of a run of two: playing, its map `map`. */
function viewOf(parts: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: 'playing',
    missionId: 'systemcheck',
    missionTitle: 'Tutorial: Systemcheck',
    difficulty: 'normal',
    storyText: 'Alle draußen.',
    crewSize: { min: 2, max: 2 },
    you: anna,
    players: [
      { ...anna, connected: true },
      { ...ben, connected: true },
    ],
    palette: [],
    deadlineAt: Date.now() + 300_000,
    startedAt: T0,
    finishedAt: null,
    timeLimitSec: 420,
    lights: { out: true, outAt: T0 },
    currentPuzzleIndex: 4,
    puzzleCount: 4,
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
    map: mapWith({ exit: hatch(T0 + 60_000, ['p2']) }),
    ...parts,
  };
}

const dark: ColdOpen = {
  darkSince: T0 - 10_000,
  dark: true,
  intro: false,
  flashUntil: null,
  gates: { sign: T0, line: T0 },
};

function bar(view: PlayerView): string {
  const map = view.map ?? mapWith({});
  return renderToStaticMarkup(
    <StageTop view={view} map={map} coldOpen={dark} notice={null} alarmVisible={false} />,
  );
}

describe('the escape', () => {
  it('begins on this screen when the view with the hatch open comes, or long ago', () => {
    expect(escapeSince(null, T0)).toBeNull();
    expect(escapeSince(hatch(null), T0)).toBeNull();
    expect(escapeSince(hatch(T0 - 500), T0)).toBe(T0);
    expect(escapeSince(hatch(T0 - 3001), T0)).toBe(T0 - EXIT_GRIND_MS);
  });

  it('turns the light red over a second and grinds the hatch open in jerks over two', () => {
    expect(redShift(0)).toBe(0);
    expect(redShift(RED_SHIFT_MS / 2)).toBeCloseTo(0.5);
    expect(redShift(RED_SHIFT_MS)).toBe(1);
    const grind = sampled(exitOpening, EXIT_GRIND_MS, 10);
    expect(grind[0]).toBe(0);
    expect(grind.at(-1)).toBe(1);
    expect(grind.every((v, i) => i === 0 || v >= (grind[i - 1] ?? 0))).toBe(true);
    // It sticks between its pushes: stretches where it does not move at all.
    const stuck = grind.filter((v, i) => i > 0 && v === grind[i - 1] && v > 0 && v < 1);
    expect(stuck.length).toBeGreaterThan(5);
  });

  it('ticks the crew off on the hatch, as the view says, the connected ones in order', () => {
    const players = [
      { ...anna, connected: true },
      { ...ben, connected: true },
      { id: 'p3', name: 'Cem', color: '#fbbf24', ready: false, isHost: false, connected: false },
    ];
    expect(escapeChecklist(players, hatch(T0, ['p2']))).toEqual([
      { id: 'p1', name: 'Anna', color: '#2dd4bf', out: false },
      { id: 'p2', name: 'Ben', color: '#f472b6', out: true },
    ]);
  });

  it('calls everybody to the hatch over the checklist, the clock amber with minutes left', () => {
    const html = bar(viewOf());
    expect(html).toContain('<div class="stage-goal stage-goal--escape">');
    expect(html).toMatch(
      /<h1><svg class="icon icon-exit"[^>]*>.*?<\/svg> NOTAUSGANG ENTRIEGELT<\/h1>/,
    );
    const mates = html.match(/<li class="escape-mate[^"]*">.*?<\/li>/g) ?? [];
    expect(mates).toHaveLength(2);
    expect(mates[0]).toMatch(/^<li class="escape-mate">.*Anna<\/li>$/);
    expect(mates[1]).toMatch(/^<li class="escape-mate escape-mate--out">.*Ben<svg class="icon icon-check"/);
    expect(html).toContain('aria-label="Am Notausgang: 1 von 2"');
    expect(html).toMatch(/<div class="countdown countdown--escape">0[45]:\d\d<\/div>/);
  });

  it('turns the clock red only in its last minute, the escape or not', () => {
    expect(clockStage(300_000, true)).toBe('countdown--escape');
    expect(clockStage(300_000, false)).toBe('');
    expect(clockStage(59_999, true)).toBe('critical');
    expect(clockStage(59_999, false)).toBe('critical');
    expect(clockStage(9_999, true)).toBe('final');
  });

  it('says nothing of it while the hatch is shut', () => {
    const html = bar(viewOf({ map: mapWith({ exit: hatch(null) }) }));
    expect(html).not.toContain('NOTAUSGANG');
    expect(html).not.toContain('escape-list');
    expect(html).toMatch(/<div class="countdown\s*">/);
  });
});

describe('the end of a run', () => {
  it('is won, lost on time or lost on the alarm that reached the limit', () => {
    const alarms = { count: 2, limit: 5 };
    expect(endingOf({ phase: 'playing', alarms })).toBeNull();
    expect(endingOf({ phase: 'won', alarms })).toBe('won');
    expect(endingOf({ phase: 'lost', alarms })).toBe('lost:time');
    expect(endingOf({ phase: 'lost', alarms: { count: 5, limit: 5 } })).toBe('lost:alarms');
    expect(endingOf({ phase: 'lost', alarms: { count: 9, limit: null } })).toBe('lost:time');
  });

  it('plays where this screen saw the run and the end came in time, and skips it otherwise', () => {
    const won = finaleMs('won', false);
    expect(finaleStart(T0, true, T0 + 200, won)).toEqual({ since: T0 + 200, played: true });
    expect(finaleStart(T0, true, T0 + 3000, won)).toEqual({ since: T0 + 3000, played: true });
    // The same three seconds as the cold open: later, the end screen straight away.
    expect(finaleStart(T0, true, T0 + 3001, won)).toEqual({ since: T0 + 3001 - won, played: false });
    // A screen that never saw the run, as after a reload on the end screen.
    expect(finaleStart(T0, false, T0 + 100, won)).toEqual({ since: T0 + 100 - won, played: false });
    expect(finaleStart(null, true, T0, won).played).toBe(false);
  });

  it('pulls the camera back over the lit lab for 1.2 s, then fades to white over 0.6 s', () => {
    expect(finaleMs('won', false)).toBe(PULLBACK_MS + WHITE_MS);
    expect(veilOf('won', false)).toEqual({ delay: 1200, duration: 600, tone: 'white' });
    expect(finaleFrame('won', 0)).toEqual({ lit: 0, pull: 0, dark: 0 });
    expect(finaleFrame('won', PULLBACK_MS / 2).pull).toBeCloseTo(0.5);
    expect(finaleFrame('won', PULLBACK_MS)).toEqual({ lit: 1, pull: 1, dark: 0 });
    // The lights come on as a room's do, flickering twice.
    expect(drops(sampled((ms) => finaleFrame('won', ms).lit, WARM_UP_MS))).toBe(2);
  });

  it('lets the light die to black over 1.5 s for a run lost, either way', () => {
    for (const ending of ['lost:time', 'lost:alarms'] as const) {
      expect(finaleMs(ending, false)).toBe(DIM_MS);
      expect(veilOf(ending, false)).toEqual({ delay: 0, duration: 1500, tone: 'black' });
      expect(finaleFrame(ending, 0).dark).toBe(0);
      expect(finaleFrame(ending, DIM_MS / 2).dark).toBeCloseTo(0.5);
      expect(finaleFrame(ending, DIM_MS)).toEqual({ lit: 0, pull: 0, dark: 1 });
    }
  });

  it('cuts instead of moving under reduced motion, its fades a third as long', () => {
    expect(finaleFrame('won', 0, true)).toEqual({ lit: 1, pull: 1, dark: 0 });
    expect(veilOf('won', true)).toEqual({ delay: 1200, duration: 200, tone: 'white' });
    expect(finaleMs('lost:time', true)).toBe(500);
    expect(finaleFrame('lost:alarms', 250, true).dark).toBeCloseTo(0.5);
  });
});

/** Anna's view of the run once over: `phase`, at the alarms `alarms`. */
function over(parts: Partial<PlayerView>): PlayerView {
  return viewOf({
    phase: 'won',
    finishedAt: T0 + 75_000,
    deadlineAt: T0 + 420_000,
    grade: { rank: 'S', label: 'Makellos' },
    map: null,
    ...parts,
  });
}

const card = (view: PlayerView, fresh = false): string =>
  renderToStaticMarkup(<TitleCard {...titleCardOf(view, view.you.id, fresh)} />);

describe('the title card', () => {
  it('ends a run won on GESCHAFFT, the crew outside before the open door', () => {
    const html = card(over({}));
    expect(html).toMatch(/^<section class="end-title end-title--won" aria-label="GESCHAFFT">/);
    expect(html).toContain('<span class="end-title-mission">Tutorial: Systemcheck</span>');
    expect(html).toContain('<h1 class="end-title-word">GESCHAFFT</h1>');
    expect(html).toContain(
      'class="end-scene end-scene--out" role="img" ' +
        'aria-label="Draußen vor dem offenen Notausgang: Anna, Ben"',
    );
    // Each of the crew a figure in their colour, side by side, named under it.
    const mates = html.match(/<li class="end-mate"><canvas class="seat-figure"[^>]*><\/canvas>/g);
    expect(mates).toHaveLength(2);
    expect(html).toContain('<span class="end-mate-name">Ben</span>');
    expect(html).toContain('<span class="end-scene-caption">Alle draußen</span>');
    // The time and the rank, large.
    expect(html).toContain('<span class="end-fact-value">1:15</span>');
    expect(html).toContain('<span class="grade-rank">S</span>');
  });

  it('ends a run lost on time on ZEIT ABGELAUFEN, the crew in the dark', () => {
    const html = card(over({ phase: 'lost', grade: null, currentPuzzleIndex: 2 }));
    expect(html).toMatch(/^<section class="end-title end-title--time" aria-label="ZEIT ABGELAUFEN">/);
    expect(html).toContain('<h1 class="end-title-word">ZEIT ABGELAUFEN</h1>');
    expect(html).toContain('aria-label="Im dunklen Labor: Anna, Ben"');
    expect(html).toContain('<span class="end-fact-value">2/4</span>');
    expect(html).not.toContain('draußen');
    expect(html).not.toContain('grade-rank');
  });

  it('ends a run lost on its alarms on NOTVERSORGUNG ABGESCHALTET, and says how many', () => {
    const lost = over({ phase: 'lost', grade: null, alarms: { count: 5, limit: 5 } });
    const html = card(lost);
    expect(html).toMatch(/^<section class="end-title end-title--alarms"/);
    expect(html).toContain('<h1 class="end-title-word">NOTVERSORGUNG ABGESCHALTET</h1>');
    expect(html).toContain('<div class="end-facts"><span class="end-cause">5 von 5 Alarmen</span>');
    // Lost on time, or won, the card has no word of alarms.
    expect(card(over({ phase: 'lost', grade: null, alarms: { count: 2, limit: 5 } }))).not.toContain(
      'end-cause',
    );
    expect(card(over({}))).not.toContain('end-cause');
    expect(alarmsCause({ count: 3, limit: 3 })).toBe('3 von 3 Alarmen');
    expect(alarmsCause({ count: 3, limit: null })).toBeNull();
  });

  it('comes up out of the end’s fade only where this screen played it', () => {
    expect(card(over({}), true)).toMatch(/^<section class="end-title end-title--won end-title--fresh"/);
    expect(card(over({}), false)).not.toContain('end-title--fresh');
  });

  it('opens the end screen above today’s report, standing and rematch', () => {
    const html = renderToStaticMarkup(
      <EndScreen view={over({})} fresh={false} send={noop} leaveRoom={noop} />,
    );
    expect(html).toMatch(/^<div class="end-screen"><section class="end-title end-title--won"/);
    const at = (part: string): number => html.indexOf(part);
    expect(at('end-title-word')).toBeLessThan(at('class="story"'));
    expect(at('class="story"')).toBeLessThan(at('Beiträge'));
    expect(at('Beiträge')).toBeLessThan(at('Nochmal — ich bin dabei'));
    // The time is the card's: the numbers below keep to what is left and what it cost.
    expect(html).toContain('<span class="stat-label">Restzeit</span>');
    expect(html).not.toContain('gebraucht');
  });

  it('is the audience’s too, where the world was, the run over', () => {
    const watched: SpectatorView = {
      phase: 'lost',
      missionTitle: 'Blackout im Labor',
      difficulty: 'normal',
      storyText: 'Dunkel.',
      deadlineAt: T0,
      startedAt: T0 - 600_000,
      finishedAt: T0,
      timeLimitSec: 660,
      lights: { out: true, outAt: T0 - 597_000 },
      currentPuzzleIndex: 3,
      puzzleCount: 6,
      penaltySeq: 1,
      alarms: { count: 1, limit: 5 },
      hintsUsed: 0,
      pausedFor: null,
      events: [],
      grade: null,
      players: [anna, ben].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        connected: true,
        presence: { stationId: null, console: null, manualId: null, signSeen: false },
      })),
      credits: {},
      map: null,
      puzzle: null,
      edgework: null,
      panels: [],
    };
    const html = renderToStaticMarkup(
      <SpectateScreen
        view={watched}
        finale={null}
        positionsRef={{ current: { run: null, players: {} } }}
        dronesRef={{ current: {} }}
        pingsRef={{ current: [] }}
        chatsRef={{ current: [] }}
        leaveRoom={noop}
      />,
    );
    expect(html).toContain(
      '<div class="spectate-world"><section class="end-title end-title--time" ' +
        'aria-label="ZEIT ABGELAUFEN">',
    );
    expect(html).toContain('<span class="end-fact-value">3/6</span>');
  });
});

describe('the game screen while the world plays the end', () => {
  const game = (view: PlayerView, finale: Parameters<typeof GameScreen>[0]['finale']): string =>
    renderToStaticMarkup(
      <GameScreen
        view={view}
        roomCode="KX4P"
        positionsRef={{ current: { run: null, players: {} } }}
        dronesRef={{ current: {} }}
        pingsRef={{ current: [] }}
        chatsRef={{ current: [] }}
        send={noop}
        refusals={0}
        finale={finale}
      />,
    );
  const map = mapWith({ exit: hatch(T0 + 60_000, ['p1', 'p2']) });

  it('closes with the veil over everything, nothing over the world', () => {
    const view = over({ map, phase: 'won', pausedFor: ['Ben'] });
    const html = game(view, { ending: 'won', since: Date.now(), map, running: true, played: true });
    expect(html).toMatch(/^<div class="game game--finale game--won">/);
    expect(html).toMatch(/<div class="finale-veil finale-veil--white" style="animation-delay:\d+ms;animation-duration:600ms"/);
    expect(html).not.toContain('overlay pause');
    expect(html).not.toContain('vignette');
  });

  it('shows none of it while the run goes on, the red edge over the world alone', () => {
    const html = game(viewOf({ map }), null);
    expect(html).toMatch(/^<div class="game">/);
    expect(html).not.toContain('finale-veil');
    // Right over the canvas, under the coach, the controls and the bar: never over the page.
    expect(html).toContain(
      '<div class="world-wrap"><canvas class="world-canvas "></canvas>' +
        '<div class="vignette" aria-hidden="true"></div>',
    );
    expect(html.match(/vignette/g)).toHaveLength(1);
  });

  it('edges the world red only in the clock’s last minute outside the escape', () => {
    const calm = mapWith({ exit: hatch(null) });
    const edged = (deadlineAt: number | null): boolean =>
      game(viewOf({ map: calm, deadlineAt }), null).includes('class="vignette"');
    expect(edged(Date.now() + 30_000)).toBe(true);
    expect(edged(Date.now() + 90_000)).toBe(false);
    expect(edged(null)).toBe(false);
  });

  it('leaves the audience’s lab without it, in the escape too', () => {
    const watched: SpectatorView = {
      phase: 'playing',
      missionTitle: 'Tutorial: Systemcheck',
      difficulty: 'normal',
      storyText: 'Alle raus.',
      deadlineAt: Date.now() + 30_000,
      startedAt: T0,
      finishedAt: null,
      timeLimitSec: 420,
      lights: { out: true, outAt: T0 },
      currentPuzzleIndex: 4,
      puzzleCount: 4,
      penaltySeq: 0,
      alarms: { count: 0, limit: null },
      hintsUsed: 0,
      pausedFor: null,
      events: [],
      grade: null,
      players: [anna, ben].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        connected: true,
        presence: { stationId: null, console: null, manualId: null, signSeen: false },
      })),
      credits: {},
      map,
      puzzle: null,
      edgework: null,
      panels: [],
    };
    const html = renderToStaticMarkup(
      <SpectateScreen
        view={watched}
        finale={null}
        positionsRef={{ current: { run: null, players: {} } }}
        dronesRef={{ current: {} }}
        pingsRef={{ current: [] }}
        chatsRef={{ current: [] }}
        leaveRoom={noop}
      />,
    );
    expect(html).toContain('<canvas class="world-canvas world-canvas--wide"></canvas>');
    expect(html).not.toContain('vignette');
  });

  it('times the veil from when the end started on this screen, to black for a run lost', () => {
    const html = renderToStaticMarkup(<FinaleVeil ending="lost:alarms" since={Date.now() - 500} />);
    const delay = Number(/animation-delay:(-?\d+)ms/.exec(html)?.[1]);
    expect(html).toContain('class="finale-veil finale-veil--black"');
    expect(delay).toBeLessThanOrEqual(-500);
    expect(delay).toBeGreaterThan(-600);
    expect(html).toContain('animation-duration:1500ms');
  });
});

describe('the sounds of the alarm, the escape and the end', () => {
  beforeEach(() => {
    fakeAudio();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sound the klaxon, and as it fades three times, each weaker and slower', async () => {
    const audio = await freshAudio();
    audio.klaxon();
    expect(started.map((s) => [s.kind, s.at, s.rate])).toEqual([
      ['klaxon', expect.closeTo(10.01, 3), 1],
    ]);
    started.length = 0;
    audio.klaxonFade();
    expect(started.map((s) => [s.kind, s.at, s.rate])).toEqual([
      ['klaxon', expect.closeTo(10.01, 3), 1],
      ['klaxon', expect.closeTo(10.71, 3), 0.9],
      ['klaxon', expect.closeTo(11.41, 3), 0.8],
    ]);
  });

  it('start the siren once however often asked, and stop it without a fuss', async () => {
    const audio = await freshAudio();
    audio.startSiren();
    audio.startSiren();
    expect(startsOf('siren')).toHaveLength(1);
    expect(() => audio.stopSiren()).not.toThrow();
    expect(() => audio.stopSiren()).not.toThrow();
    audio.startSiren();
    expect(startsOf('siren')).toHaveLength(2);
  });

  it('grind the hatch open, and click the lights on with their tubes striking after', async () => {
    const audio = await freshAudio();
    audio.exitGrind();
    expect(startedAt('hatch-grind', 10.01)).toBe(true);
    started.length = 0;
    audio.lightsOnClick();
    expect(startedAt('relay-click', 10.01)).toBe(true);
    expect(startedAt('tube-strike', 10.13)).toBe(true);
    expect(started.filter((s) => s.kind === 'tone' || s.kind === 'noise')).toEqual([]);
  });

  it('never throw, with no audio at all or with one that breaks', async () => {
    const all = (audio: Awaited<ReturnType<typeof freshAudio>>): void => {
      audio.klaxon();
      audio.klaxonFade();
      audio.lightsOnClick();
      audio.startSiren();
      audio.exitGrind();
      audio.stopSiren();
    };
    vi.stubGlobal('AudioContext', undefined);
    const none = await freshAudio();
    expect(() => all(none)).not.toThrow();
    vi.stubGlobal('AudioContext', BrokenContext);
    const broken = await freshAudio();
    expect(() => all(broken)).not.toThrow();
    expect(started.filter((s) => s.kind === 'tone')).toHaveLength(0);
  });
});
