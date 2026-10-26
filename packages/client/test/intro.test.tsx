import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, IntroView, PlayerView } from '@escapelab/core';
import { GameScreen } from '../src/screens/Game.js';
import { darkSince, FLICKER_MS } from '../src/world/coldOpen.js';
import { IntroOverlay, overlayUp, PLANT, skipLine } from '../src/world/intro/IntroOverlay.js';
import {
  bangAt,
  barsIn,
  BARS_MS,
  blackAt,
  CLOSING_MS,
  CARD_FADE_MS,
  CARD_MS,
  cardAt,
  cutIn,
  FADE_IN_MS,
  filmed,
  hintShown,
  hudAt,
  hudBackAt,
  hudHeld,
  HUD_FADE_MS,
  introPhase,
  lightsSecFor,
  litWhole,
  NAME_CARD_MS,
  nextChange,
  PA_FROM_MS,
  PA_GAP_MS,
  PA_PACE_MS,
  paSchedule,
  SHOT_HOLD_MS,
  shotProgress,
  skippable,
  subtitleAt,
  SUBTITLE_LINGER_MS,
  titleAt,
  TITLE_FADE_MS,
  TITLE_HOLD_MS,
  type IntroCue,
} from '../src/world/intro/sequence.js';
import { shotPoint, shotStart } from '../src/world/intro/shot.js';
import {
  closesIntro,
  NAME_CARD_FRESH_MS,
  openingOf,
  skipAt,
  skipKey,
} from '../src/world/intro/useIntro.js';
import { newSim } from '../src/world/sim.js';
import { streamPositions } from '../src/world/stream.js';
import { mapWith } from './fixtures.js';

const SINCE = 1_000_000;
const LIGHTS_SEC = 29.1;
/** An intro's opening on a screen where it began at SINCE and nobody has skipped yet. */
const watching: IntroCue = {
  since: SINCE,
  lightsSec: LIGHTS_SEC,
  skippedAt: null,
  outAt: null,
  closing: false,
};
/** The same, its player having skipped 4 s in. */
const skipped: IntroCue = { ...watching, skippedAt: SINCE + 4000 };
/** A mission's name card, from SINCE. */
const nameCard: IntroCue = { ...watching, lightsSec: null };
/** The moment the lights go out on this screen. */
const OUT = SINCE + 12_000;

describe('the opening of a mission with an intro, moment by moment', () => {
  it('opens on the location card, black, for 1.5 s; then the shot', () => {
    expect(CARD_MS).toBe(1500);
    expect(introPhase(watching, SINCE)).toBe('card');
    expect(introPhase(watching, SINCE + CARD_MS - 1)).toBe('card');
    expect(introPhase(watching, SINCE + CARD_MS)).toBe('shot');
    expect(blackAt(watching, SINCE + 500)).toBe(1);
  });

  it('brings the card up and takes it away again within its 1.5 s', () => {
    expect(cardAt(watching, SINCE)).toBe(0);
    expect(cardAt(watching, SINCE + CARD_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(cardAt(watching, SINCE + 700)).toBe(1);
    expect(cardAt(watching, SINCE + CARD_MS - CARD_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(cardAt(watching, SINCE + CARD_MS)).toBe(0);
  });

  it('fades the lab in with its power on over a second, lit whole', () => {
    expect(FADE_IN_MS).toBe(1000);
    expect(blackAt(watching, SINCE + CARD_MS)).toBe(1);
    expect(blackAt(watching, SINCE + CARD_MS + 500)).toBeCloseTo(0.5);
    expect(blackAt(watching, SINCE + CARD_MS + FADE_IN_MS)).toBe(0);
    expect(litWhole(watching, SINCE + 5000)).toBe(true);
  });

  it('shows it as a film: bars in, the crew held, no HUD', () => {
    for (const at of [SINCE, SINCE + 5000, SINCE + 20_000]) {
      expect(barsIn(watching, at)).toBe(true);
      expect(filmed(watching, at)).toBe(true);
    }
  });

  it('offers the skip after 1.5 s, not before', () => {
    expect(hintShown(watching, SINCE + 1499)).toBe(false);
    expect(skippable(watching, SINCE + 1499)).toBe(false);
    expect(hintShown(watching, SINCE + 1500)).toBe(true);
    expect(skippable(watching, SINCE + 1500)).toBe(true);
  });

  it('runs the shot from the reactor end to the spawn, at rest before the lights are due', () => {
    expect(shotProgress(watching, SINCE, false)).toBe(0);
    expect(shotProgress(watching, SINCE + CARD_MS, false)).toBe(0);
    const rest = SINCE + LIGHTS_SEC * 1000 - SHOT_HOLD_MS;
    const middle = (SINCE + CARD_MS + rest) / 2;
    expect(shotProgress(watching, middle, false)).toBeCloseTo(0.5, 5);
    expect(shotProgress(watching, rest, false)).toBe(1);
    expect(shotProgress(watching, rest + 1000, false)).toBe(1);
    // Slow: a quarter of the way in a quarter of the time is less than a quarter, eased in.
    const quarter = SINCE + CARD_MS + (rest - SINCE - CARD_MS) / 4;
    expect(shotProgress(watching, quarter, false)).toBeLessThan(0.25);
  });

  it('pans nowhere under reduced motion: the camera stands on the spawn', () => {
    for (const at of [SINCE, SINCE + 3000, SINCE + 20_000]) {
      expect(shotProgress(watching, at, true)).toBe(1);
    }
  });

  it('cuts the film where the player skips: camera on the avatar, bars gone, free to walk', () => {
    const after = SINCE + 5000;
    expect(introPhase(skipped, after)).toBe('free');
    expect(shotProgress(skipped, after, false)).toBeNull();
    expect(barsIn(skipped, after)).toBe(false);
    expect(filmed(skipped, after)).toBe(false);
    expect(litWhole(skipped, after)).toBe(false);
    expect(hintShown(skipped, after)).toBe(false);
    expect(skippable(skipped, after)).toBe(false);
  });

  it('lands the title on the frame the lights die, cut straight to the spawn', () => {
    const dark = { ...watching, outAt: OUT };
    expect(cutIn(dark)).toBe(true);
    expect(bangAt(dark)).toBe(OUT);
    expect(introPhase(dark, OUT)).toBe('beat');
    expect(shotProgress(dark, OUT, false)).toBeNull();
    expect(titleAt(dark, OUT - 1)).toBe(0);
    expect(titleAt(dark, OUT)).toBe(1);
    expect(titleAt(dark, OUT + TITLE_HOLD_MS)).toBe(1);
    expect(titleAt(dark, OUT + TITLE_HOLD_MS + TITLE_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(titleAt(dark, OUT + TITLE_HOLD_MS + TITLE_FADE_MS)).toBe(0);
  });

  it('holds the title 1.5 s, then the bars retract and control returns', () => {
    const dark = { ...watching, outAt: OUT };
    expect(barsIn(dark, OUT + TITLE_HOLD_MS - 1)).toBe(true);
    expect(filmed(dark, OUT + TITLE_HOLD_MS - 1)).toBe(true);
    expect(barsIn(dark, OUT + TITLE_HOLD_MS)).toBe(false);
    expect(filmed(dark, OUT + TITLE_HOLD_MS + BARS_MS - 1)).toBe(true);
    expect(introPhase(dark, OUT + TITLE_HOLD_MS + BARS_MS)).toBe('done');
    expect(filmed(dark, OUT + TITLE_HOLD_MS + BARS_MS)).toBe(false);
  });

  it('lets a player who skipped see the lights fail as ever, the title landing at the bang', () => {
    const dark = { ...skipped, outAt: OUT };
    expect(cutIn(dark)).toBe(false);
    expect(bangAt(dark)).toBe(OUT + FLICKER_MS);
    expect(filmed(dark, OUT)).toBe(false);
    expect(titleAt(dark, OUT)).toBe(0);
    expect(titleAt(dark, OUT + FLICKER_MS)).toBe(1);
    expect(barsIn(dark, OUT + FLICKER_MS)).toBe(false);
  });

  it('films on after the skip that ends the intro, to cut to the beat as the lights go', () => {
    const closing = { ...watching, skippedAt: SINCE + 6000, closing: true };
    expect(introPhase(closing, SINCE + 6100)).toBe('shot');
    expect(filmed(closing, SINCE + 6100)).toBe(true);
    expect(hintShown(closing, SINCE + 6100)).toBe(false);
    expect(skippable(closing, SINCE + 6100)).toBe(false);
    const dark = { ...closing, outAt: SINCE + 6080 };
    expect(cutIn(dark)).toBe(true);
    expect(introPhase(dark, SINCE + 6100)).toBe('beat');
    expect(titleAt(dark, SINCE + 6080)).toBe(1);
    expect(barsIn(dark, SINCE + 6100)).toBe(true);
    // Where the lights have not gone 1.5 s on, it was a skip like any other.
    expect(introPhase(closing, SINCE + 6000 + CLOSING_MS)).toBe('free');
    expect(cutIn({ ...closing, outAt: SINCE + 6000 + CLOSING_MS + 1 })).toBe(false);
    expect(nextChange(closing, SINCE + 6000 + BARS_MS)).toBe(SINCE + 6000 + CLOSING_MS);
  });

  it('starts the cold open at the bang where the shot ran, after the flicker for a skipper', () => {
    const lights = { out: true, outAt: OUT };
    expect(darkSince(lights, SINCE, OUT, true)).toBe(OUT - FLICKER_MS);
    expect(darkSince(lights, SINCE, OUT, false)).toBe(OUT);
  });

  it('says when it changes by itself next, and nothing once it is over', () => {
    expect(nextChange(watching, SINCE)).toBe(SINCE + CARD_MS);
    expect(nextChange(watching, SINCE + CARD_MS)).toBe(SINCE + CARD_MS + FADE_IN_MS);
    expect(nextChange(watching, SINCE + 5000)).toBeNull();
    const dark = { ...watching, outAt: OUT };
    expect(nextChange(dark, OUT)).toBe(OUT + TITLE_HOLD_MS);
    expect(nextChange(dark, OUT + TITLE_HOLD_MS)).toBe(OUT + TITLE_HOLD_MS + BARS_MS);
    expect(nextChange(dark, OUT + 60_000)).toBeNull();
  });
});

describe('the name card of a mission without an intro', () => {
  it('shows the mission’s name for 2.5 s, or until skipped, and changes nothing else', () => {
    expect(NAME_CARD_MS).toBe(2500);
    expect(introPhase(nameCard, SINCE + NAME_CARD_MS - 1)).toBe('card');
    expect(introPhase(nameCard, SINCE + NAME_CARD_MS)).toBe('done');
    expect(skippable(nameCard, SINCE)).toBe(true);
    expect(introPhase({ ...nameCard, skippedAt: SINCE + 300 }, SINCE + 400)).toBe('done');
    for (const at of [SINCE, SINCE + 1000]) {
      expect(filmed(nameCard, at)).toBe(false);
      expect(barsIn(nameCard, at)).toBe(false);
      expect(shotProgress(nameCard, at, false)).toBeNull();
      expect(hintShown(nameCard, at)).toBe(false);
    }
    expect(titleAt({ ...nameCard, outAt: SINCE }, SINCE)).toBe(0);
  });
});

describe('the HUD while the opening keeps it out', () => {
  const dark = { ...watching, outAt: OUT };
  /** Where the title has dissolved on the screen that watched to the end. */
  const BACK = OUT + TITLE_HOLD_MS + TITLE_FADE_MS;
  /** Every 10 ms from `from` to `to`, epoch ms. */
  const everyTen = (from: number, to: number): number[] =>
    Array.from({ length: (to - from) / 10 + 1 }, (_, i) => from + i * 10);

  it('keeps it out through the card and the shot', () => {
    for (const at of [SINCE, SINCE + CARD_MS, SINCE + 20_000]) {
      expect(hudHeld(watching, at)).toBe(true);
      expect(hudAt(watching, at)).toBe(0);
    }
  });

  it('keeps it out while anything of the title or the bars is in the picture', () => {
    for (const at of everyTen(OUT, OUT + 3000)) {
      const barsThere = at < OUT + TITLE_HOLD_MS + BARS_MS;
      if (titleAt(dark, at) > 0 || barsThere) {
        expect(hudAt(dark, at)).toBe(0);
      }
    }
    // Control comes back with the bars gone; the HUD waits for the title to have dissolved.
    expect(filmed(dark, OUT + TITLE_HOLD_MS + BARS_MS)).toBe(false);
    expect(hudHeld(dark, OUT + TITLE_HOLD_MS + BARS_MS)).toBe(true);
    expect(hudHeld(dark, BACK - 1)).toBe(true);
    expect(hudBackAt(dark)).toBe(BACK);
  });

  it('then fades it in over 0.3 s', () => {
    expect(HUD_FADE_MS).toBe(300);
    expect(hudHeld(dark, BACK)).toBe(false);
    expect(hudAt(dark, BACK)).toBe(0);
    expect(hudAt(dark, BACK + HUD_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(hudAt(dark, BACK + HUD_FADE_MS)).toBe(1);
    expect(hudAt(dark, BACK + 60_000)).toBe(1);
  });

  it('gives a player who skipped the HUD from the skip, out again while the title shows', () => {
    const skip = SINCE + 4000;
    expect(hudHeld(skipped, skip)).toBe(false);
    expect(hudAt(skipped, skip + HUD_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(hudAt(skipped, OUT - 1)).toBe(1);
    // The lights flicker with the HUD up; the title lands at the bang on a frame without it.
    const out = { ...skipped, outAt: OUT };
    expect(hudAt(out, OUT + FLICKER_MS - 1)).toBe(1);
    expect(hudHeld(out, OUT + FLICKER_MS)).toBe(true);
    const back = OUT + FLICKER_MS + TITLE_HOLD_MS + TITLE_FADE_MS;
    expect(hudBackAt(out)).toBe(back);
    expect(hudHeld(out, back - 1)).toBe(true);
    expect(hudAt(out, back + HUD_FADE_MS / 2)).toBeCloseTo(0.5);
  });

  it('keeps it out through the film run on after the skip that was to end the intro', () => {
    const closing = { ...watching, skippedAt: SINCE + 6000, closing: true };
    expect(hudHeld(closing, SINCE + 6100)).toBe(true);
    // Where the lights did not come, the film ended 1.5 s on: the HUD comes from then.
    const ended = SINCE + 6000 + CLOSING_MS;
    expect(hudHeld(closing, ended - 1)).toBe(true);
    expect(hudAt(closing, ended + HUD_FADE_MS / 2)).toBeCloseTo(0.5);
  });

  it('keeps it out under a mission’s name card, and fades it in as the card goes', () => {
    expect(hudHeld(nameCard, SINCE)).toBe(true);
    expect(hudHeld(nameCard, SINCE + NAME_CARD_MS - 1)).toBe(true);
    expect(hudAt(nameCard, SINCE + NAME_CARD_MS + HUD_FADE_MS / 2)).toBeCloseTo(0.5);
    const pressed = { ...nameCard, skippedAt: SINCE + 800 };
    expect(hudHeld(pressed, SINCE + 800)).toBe(false);
    expect(hudAt(pressed, SINCE + 800 + HUD_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(hudBackAt(nameCard)).toBeNull();
  });

  it('has the page drawn anew as the HUD goes and comes back', () => {
    expect(nextChange(dark, OUT + TITLE_HOLD_MS + BARS_MS)).toBe(BACK);
    expect(nextChange({ ...skipped, outAt: OUT }, OUT)).toBe(OUT + FLICKER_MS);
    expect(nextChange(nameCard, SINCE)).toBe(SINCE + NAME_CARD_MS);
  });
});

describe('a press to skip', () => {
  beforeEach(() => vi.stubGlobal('document', { activeElement: null }));
  afterEach(() => vi.unstubAllGlobals());

  it('is Space alone, not repeated, not a combination and not into a field', () => {
    const press = { key: ' ', repeat: false, altKey: false, ctrlKey: false, metaKey: false };
    expect(skipKey(press)).toBe(true);
    expect(skipKey({ ...press, key: 'e' })).toBe(false);
    expect(skipKey({ ...press, repeat: true })).toBe(false);
    expect(skipKey({ ...press, ctrlKey: true })).toBe(false);
    vi.stubGlobal('document', { activeElement: { tagName: 'INPUT' } });
    expect(skipKey(press)).toBe(false);
  });

  it('skips an intro from then on and tells the room; a name card for this screen alone', () => {
    expect(skipAt(watching, SINCE + 2000)).toEqual({
      cue: { ...watching, skippedAt: SINCE + 2000 },
      tells: true,
    });
    expect(skipAt(watching, SINCE + 2000, true)?.cue.closing).toBe(true);
    expect(skipAt(nameCard, SINCE + 100, true)).toEqual({
      cue: { ...nameCard, skippedAt: SINCE + 100 },
      tells: false,
    });
  });

  it('knows its skip ends the intro where everybody else present has skipped already', () => {
    expect(closesIntro(viewOf())).toBe(false);
    expect(closesIntro(viewOf({ intro: { ...intro, done: ['p2'] } }))).toBe(true);
    const away = viewOf().players.map((p) => (p.id === 'p2' ? { ...p, connected: false } : p));
    expect(closesIntro(viewOf({ players: away }))).toBe(true);
  });

  it('does nothing on the card, once skipped, after the lights, or without an opening', () => {
    expect(skipAt(watching, SINCE + 1000)).toBeNull();
    expect(skipAt(skipped, SINCE + 5000)).toBeNull();
    expect(skipAt({ ...watching, outAt: OUT }, OUT + 10)).toBeNull();
    expect(skipAt(null, SINCE)).toBeNull();
  });
});

/** Anna's view of a Blackout run of two that began at START, the lights still on. */
const START = 5_000_000;
const intro: IntroView = {
  place: 'Trakt C',
  time: 'Nachtschicht · 23:47',
  pa: ['Durchsage der Leitstelle für Trakt C. Es ist 23 Uhr 47, die Nachtschicht hat übernommen.'],
  lightsSec: LIGHTS_SEC,
  done: [],
};

function viewOf(parts: Partial<PlayerView> = {}): PlayerView {
  const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: true, isHost: true };
  const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false };
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    crewSize: { min: 2, max: 3 },
    you: anna,
    players: [
      { ...anna, connected: true },
      { ...ben, connected: true },
    ],
    palette: [],
    deadlineAt: null,
    startedAt: START,
    finishedAt: null,
    timeLimitSec: 900,
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
    map: mapWith({
      tiles: ['#####', '#...#', '#####'],
      width: 5,
      height: 3,
      labels: [{ text: 'ARCHIV', x: 2, y: 1 }],
    }),
    intro,
    ...parts,
  };
}

/** Anna's view of a run of a mission without an intro, its lights out from the start. */
function plainView(parts: Partial<PlayerView> = {}): PlayerView {
  const { intro: dropped, ...view } = viewOf({ lights: { out: true, outAt: START }, ...parts });
  void dropped;
  return view;
}

describe('which opening a screen plays', () => {
  it('plays a mission’s intro while its lights burn, from the moment it sees the run', () => {
    expect(openingOf(viewOf(), START + 200)).toEqual({
      since: START + 200,
      lightsSec: LIGHTS_SEC,
      skippedAt: null,
      outAt: null,
      closing: false,
    });
  });

  it('starts free where this player had seen enough already, as after a reload', () => {
    const view = viewOf({ intro: { ...intro, done: ['p1'] } });
    expect(openingOf(view, START + 9000)?.skippedAt).toBe(START + 9000);
  });

  it('plays none of it where the lights are out already, nor in the lobby', () => {
    const dark = viewOf({ lights: { out: true, outAt: START + 8000 } });
    expect(openingOf(dark, START + 9000)).toBeNull();
    expect(openingOf(viewOf({ phase: 'lobby', startedAt: null }), START)).toBeNull();
  });

  it('gives a mission without an intro its name card, on a screen there from the start', () => {
    const plain = plainView();
    expect(openingOf(plain, START + 100)).toEqual({
      since: START + 100,
      lightsSec: null,
      skippedAt: null,
      outAt: null,
      closing: false,
    });
    expect(openingOf(plain, START + NAME_CARD_FRESH_MS)).toBeNull();
  });
});

describe('the announcement on the sequence’s clock', () => {
  const lines = [
    { text: 'Erste Zeile. Zweiter Satz der ersten Zeile.', ms: 4000 },
    { text: 'Zweite Zeile ohne Aufnahme.', ms: null },
  ];

  it('starts its first line 3 s in, each next one 0.8 s after the one before', () => {
    expect([PA_FROM_MS, PA_GAP_MS]).toEqual([3000, 800]);
    expect(paSchedule(lines)).toEqual([
      { text: lines[0]?.text, at: 3000, ms: 4000 },
      { text: lines[1]?.text, at: 7800, ms: 4 * PA_PACE_MS },
    ]);
  });

  it('subtitles it sentence by sentence, as long as each is, and nothing between lines', () => {
    const schedule = paSchedule(lines);
    expect(subtitleAt(schedule, 2999)).toBeNull();
    expect(subtitleAt(schedule, 3000)).toBe('Erste Zeile.');
    // „Erste Zeile." is 12 of the line's 42 letters: its share of the 4 s.
    expect(subtitleAt(schedule, 3000 + 1100)).toBe('Erste Zeile.');
    expect(subtitleAt(schedule, 3000 + 1200)).toBe('Zweiter Satz der ersten Zeile.');
    expect(subtitleAt(schedule, 7000 + SUBTITLE_LINGER_MS - 1)).toBe(
      'Zweiter Satz der ersten Zeile.',
    );
    expect(subtitleAt(schedule, 7000 + SUBTITLE_LINGER_MS)).toBeNull();
    expect(subtitleAt(schedule, 7800)).toBe('Zweite Zeile ohne Aufnahme.');
  });

  it('puts the lights out by themselves 4 s past the whole announcement, to a tenth', () => {
    expect(lightsSecFor([7065, 5219, 4644, 3309, 4848])).toBe(29.1);
    expect(lightsSecFor([])).toBe(4);
  });
});

describe('the shot across the lab', () => {
  const labels = [
    { text: 'ARCHIV', x: 3, y: 2, kind: 'archive' as const },
    { text: 'REAKTOR', x: 21, y: 12, kind: 'reactor' as const },
    { text: 'FLUR', x: 9, y: 8, kind: 'corridor' as const },
  ];

  it('starts at the reactor end, in the middle of its label’s tile', () => {
    const map = { labels, width: 27, height: 17 };
    expect(shotStart(map, { x: 3.5, y: 3.5 })).toEqual({ x: 21.5, y: 12.5 });
  });

  it('starts at the room furthest from the spawn without a reactor, mid-map without rooms', () => {
    const plain = labels.filter((label) => label.kind !== 'reactor');
    expect(shotStart({ labels: plain, width: 27, height: 17 }, { x: 3, y: 3 })).toEqual({
      x: 9.5,
      y: 8.5,
    });
    expect(shotStart({ labels: [], width: 20, height: 10 }, { x: 1, y: 1 })).toEqual({
      x: 10,
      y: 5,
    });
  });

  it('runs in a straight line to the spawn', () => {
    const from = { x: 21.5, y: 12.5 };
    const to = { x: 3.5, y: 3.5 };
    expect(shotPoint(from, to, 0)).toEqual(from);
    expect(shotPoint(from, to, 0.5)).toEqual({ x: 12.5, y: 8 });
    expect(shotPoint(from, to, 1)).toEqual(to);
  });
});

describe('the opening over the world', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const overlay = (cue: IntroCue, view = viewOf()): string =>
    renderToStaticMarkup(<IntroOverlay cue={cue} view={view} skip={() => undefined} />);

  it('shows the plant, the wing and the shift on the card, nothing of the film yet', () => {
    vi.setSystemTime(SINCE + 700);
    const html = overlay(watching);
    expect(html).toContain('<div class="intro intro--holds">');
    expect(html).toContain(`<p class="intro-plant">${PLANT}</p>`);
    expect(html).toContain('<h1 class="intro-place">Trakt C</h1>');
    expect(html).toContain('<p class="intro-time">Nachtschicht · 23:47</p>');
    expect(html).not.toContain('intro-skip');
    expect(html).not.toContain('intro-subtitle');
  });

  it('offers the skip in the lower bar, counting the crew, and subtitles the loudspeakers', () => {
    vi.setSystemTime(SINCE + 3200);
    const html = overlay(watching, viewOf({ intro: { ...intro, done: ['p2'] } }));
    expect(html).not.toContain('intro-card');
    expect(html).toContain('<div class="intro-bar intro-bar--bottom">');
    expect(html).toContain('<span class="intro-skip">Überspringen · Leertaste (1/2)</span>');
    expect(html).toContain(
      '<p class="intro-subtitle">Durchsage der Leitstelle für Trakt C.</p>',
    );
  });

  it('names a tap instead of the key on a touch screen, and counts only who is there', () => {
    const away = viewOf({
      players: viewOf().players.map((p) => (p.id === 'p2' ? { ...p, connected: false } : p)),
    });
    expect(skipLine(away, true)).toBe('Überspringen · Tippen (0/1)');
  });

  it('lets the bars slide off and the world have the pointer once the player skipped', () => {
    vi.setSystemTime(SINCE + 4100);
    const html = overlay(skipped);
    expect(html).toContain('<div class="intro">');
    expect(html).toContain('intro-bar intro-bar--top intro-bar--out');
    expect(html).not.toContain('intro-skip');
    expect(html).not.toContain('intro-subtitle');
  });

  it('lands the mission’s title as the lights die', () => {
    vi.setSystemTime(OUT + 100);
    expect(overlay({ ...watching, outAt: OUT })).toContain(
      '<h1 class="intro-title" style="opacity:1">Blackout im Labor</h1>',
    );
  });

  it('shows a mission without an intro its name on the card, over the briefing', () => {
    vi.setSystemTime(SINCE + 1000);
    const html = overlay(nameCard, plainView({ missionTitle: 'Systemcheck' }));
    expect(html).toContain('<div class="intro intro--holds intro--name">');
    expect(html).toContain('<h1 class="intro-name">Systemcheck</h1>');
    expect(html).not.toContain('intro-bar');
  });

  it('is gone once the opening is over and its title has dissolved', () => {
    const dark = { ...watching, outAt: OUT };
    expect(overlayUp(dark, OUT + TITLE_HOLD_MS + TITLE_FADE_MS - 1)).toBe(true);
    expect(overlayUp(dark, OUT + TITLE_HOLD_MS + TITLE_FADE_MS)).toBe(false);
    vi.setSystemTime(OUT + 60_000);
    expect(overlay(dark)).toBe('');
  });

  const game = (view: PlayerView): string =>
    renderToStaticMarkup(
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

  it('opens the game screen as a film, the HUD out under it', () => {
    vi.setSystemTime(START + 300);
    const html = game(viewOf());
    expect(html).toContain('<div class="game game--hud-held">');
    expect(html).toContain('<div class="intro intro--holds">');
    expect(html).toContain(PLANT);
  });

  it('keeps the HUD out under a mission’s name card, and not where the screen came late', () => {
    vi.setSystemTime(START + 300);
    expect(game(plainView())).toContain('<div class="game game--hud-held">');
    vi.setSystemTime(START + NAME_CARD_FRESH_MS);
    expect(game(plainView())).toContain('<div class="game">');
  });
});

describe('the crew held by the opening', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends no position while held, and the spawn once it lets go', () => {
    const sim = newSim(0);
    Object.assign(sim.self, { x: 3.5, y: 3.5 });
    sim.run = START;
    sim.held = true;
    const sent: ClientMessage[] = [];
    const timer = streamPositions(sim, false, (msg) => sent.push(msg));
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual([]);
    sim.held = false;
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([
      { kind: 'pos', run: START, x: 3.5, y: 3.5, facing: 0, moving: false },
    ]);
    clearInterval(timer);
  });
});
