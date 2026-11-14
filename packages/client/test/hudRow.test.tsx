import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  initialState,
  parseMission,
  scaleMission,
  viewFor,
  type Action,
  type Edgework,
  type PlayerView,
} from '@escapelab/core';
import type { Notice } from '../src/radio.js';
import { gameClass, StageTop, type ColdOpen, type RowParts } from '../src/screens/Game.js';
import {
  foldsHud,
  freshTags,
  ROW_MAX_HEIGHT,
  TAG_SHOWN_MS,
  type TagMemory,
  type TagNow,
} from '../src/screens/hudFold.js';
import { RowCrew, RowTools } from '../src/screens/HudRow.js';
import type { VoiceMesh, VoiceState } from '../src/voice/mesh.js';
import { VoiceContext } from '../src/voice/useVoice.js';
import { iconsAsWords, mapWith } from './fixtures.js';

const T0 = 1_700_000_000_000;
const noop = (): void => undefined;

describe('the HUD folds into one row', () => {
  it('on a touch screen held sideways, 500 px tall or less: a phone', () => {
    for (const [width, height] of [
      [844, 390],
      [932, 430],
      [667, 375],
      [1000, ROW_MAX_HEIGHT],
    ] as const) {
      expect(foldsHud({ width, height, coarse: true }), `${width}×${height}`).toBe(true);
    }
  });

  it('nowhere taller, held upright or square, or steered by keys', () => {
    expect(ROW_MAX_HEIGHT).toBe(500);
    expect(foldsHud({ width: 1000, height: ROW_MAX_HEIGHT + 1, coarse: true })).toBe(false);
    expect(foldsHud({ width: 1366, height: 1024, coarse: true })).toBe(false);
    expect(foldsHud({ width: 420, height: 760, coarse: true })).toBe(false);
    expect(foldsHud({ width: 390, height: 390, coarse: true })).toBe(false);
    expect(foldsHud({ width: 844, height: 390, coarse: false })).toBe(false);
  });

  it('by the same height every rule for a phone held sideways reads in the stylesheets', () => {
    const sideways = '(pointer: coarse) and (orientation: landscape) and (';
    for (const sheet of ['pwa.css', 'devices.css', 'coldopen.css']) {
      const css = readFileSync(new URL(`../src/styles/${sheet}`, import.meta.url), 'utf8');
      const heights = [...css.matchAll(/max-height: (\d+)px\)/g)]
        .filter((match) => css.slice(Math.max(0, match.index - 60), match.index).includes(sideways))
        .map((match) => Number(match[1]));
      expect(heights.length, sheet).toBeGreaterThan(0);
      expect(new Set(heights), sheet).toEqual(new Set([ROW_MAX_HEIGHT]));
    }
  });

  it('names the game for it, beside its other states', () => {
    expect(gameClass(null, false, false, true)).toBe('game game--row');
    expect(gameClass(null, true, true, true)).toBe('game game--noting game--hud-held game--row');
    expect(gameClass(null, false)).toBe('game');
  });
});

describe('a crew member’s tag in the row', () => {
  const crew = (ben: string): TagNow[] => [
    { id: 'p1', said: 'unterwegs' },
    { id: 'p2', said: ben },
  ];
  /** Steps the row's memory through `steps` — what Ben's tag says at each moment — from empty. */
  function seen(steps: [at: number, ben: string][]): ReadonlySet<string>[] {
    let memory: TagMemory = new Map();
    return steps.map(([at, ben]) => {
      const fresh = freshTags(memory, crew(ben), at);
      memory = fresh.memory;
      return fresh.shown;
    });
  }

  it('stays hidden as the row first sees it: nothing has changed yet', () => {
    const [first] = seen([[T0, 'am Pult A']]);
    expect(first?.size).toBe(0);
  });

  it('shows for TAG_SHOWN_MS after it changed, and no longer', () => {
    expect(TAG_SHOWN_MS).toBe(3000);
    const shown = seen([
      [T0, 'unterwegs'],
      [T0 + 1000, 'am Pult A'],
      [T0 + 1000 + TAG_SHOWN_MS - 1, 'am Pult A'],
      [T0 + 1000 + TAG_SHOWN_MS, 'am Pult A'],
    ]);
    expect(shown.map((ids) => ids.has('p2'))).toEqual([false, true, true, false]);
    // Anna's tag never changed: never shown.
    expect(shown.some((ids) => ids.has('p1'))).toBe(false);
  });

  it('shows a change back as a change, its three seconds counted from the newest', () => {
    const shown = seen([
      [T0, 'unterwegs'],
      [T0 + 100, 'liest'],
      [T0 + 2000, 'unterwegs'],
      [T0 + 2000 + TAG_SHOWN_MS - 1, 'unterwegs'],
      [T0 + 2000 + TAG_SHOWN_MS, 'unterwegs'],
    ]);
    expect(shown.map((ids) => ids.has('p2'))).toEqual([false, true, true, true, false]);
  });

  it('forgets a crew member who is gone from the crew', () => {
    const first = freshTags(new Map(), crew('liest'), T0);
    const later = freshTags(first.memory, [{ id: 'p1', said: 'unterwegs' }], T0 + 10);
    expect([...later.memory.keys()]).toEqual(['p1']);
  });
});

/** Blackout under way for Anna and Ben at the normal difficulty: the lights out, the clock on. */
function blackoutView(): PlayerView {
  const blackout = scaleMission(
    parseMission(
      JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
    ),
    'normal',
  );
  const actions: Action[] = [
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at: T0, seed: 5 },
    { type: 'lights-out', at: T0 + 5000 },
    { type: 'drone-spotted', at: T0 + 6000, penaltySec: 20, playerId: 'p2' },
  ];
  return viewFor(actions.reduce(applyAction, initialState(blackout)), 'p1');
}

const DARK: ColdOpen = {
  darkSince: T0,
  dark: true,
  intro: true,
  flashUntil: null,
  gates: { sign: T0, line: T0 },
};

/** Stand-ins for the crew strip's parts, to see where the bar puts them. */
const PARTS: RowParts = {
  crew: <span className="probe-crew" />,
  tools: <span className="probe-tools" />,
};

/** The objective bar as Anna's screen draws it, folded into the row with `row`. */
function bar(notice: Notice | null, row: RowParts | null = PARTS, alarm = false): string {
  const view = blackoutView();
  if (view.map === null) {
    throw new Error('the run has no map');
  }
  return iconsAsWords(
    renderToStaticMarkup(
      <StageTop
        view={view}
        map={view.map}
        coldOpen={DARK}
        notice={notice}
        alarmVisible={alarm}
        row={row}
      />,
    ),
  );
}

/** Where each of `needles` first stands in `html`, in their order. */
const places = (html: string, needles: string[]): number[] =>
  needles.map((needle) => html.indexOf(needle));

describe('the objective bar folded into the row', () => {
  const LINE: Notice = {
    kind: 'line',
    event: { at: T0, kind: 'radio', label: 'Strom weg im ganzen Trakt.', seconds: null },
    notBefore: 0,
  };

  it('stands in one row: the LEDs over the goal, the crew, the clock, the buttons', () => {
    const html = bar(null);
    expect(html.match(/class="stage-row"/g)).toHaveLength(1);
    const order = places(html, [
      'class="stage-row"',
      'class="led-strip"',
      '<h1>',
      'class="probe-crew"',
      'class="stage-clock"',
      'class="alarm-marks"',
      'class="probe-tools"',
    ]);
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('puts a line on the air in the goal’s place, in the same row', () => {
    const html = bar(LINE);
    expect(html).not.toContain('class="stage-goal"');
    expect(html).toContain(
      '<div class="stage-row"><div class="radio-banner" role="status">' +
        '<span class="radio-banner-from">[radio] LEITSTELLE · HELMUT</span> — ' +
        'Strom weg im ganzen Trakt.' +
        '</div><span class="probe-crew">',
    );
    const sign = bar({ kind: 'sign' });
    expect(sign).toMatch(/<div class="stage-row"><div class="toast" role="status">/);
    expect(sign).not.toContain('class="stage-goal"');
  });

  it('keeps an alarm under the row, not in it', () => {
    const html = bar(null, PARTS, true);
    const under = '<span class="probe-tools"></span></div><div class="alarm" role="alert">';
    expect(html).toContain(under);
  });

  it('keeps the bar as it was where nothing folds: the goal, the clock, then the line', () => {
    const html = bar(LINE, null);
    expect(html).not.toContain('stage-row');
    const order = places(html, [
      'class="stage-goal"',
      'class="stage-clock"',
      'class="radio-banner"',
    ]);
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

/** A stand-in for the page's voice, as the screens read it: its state and nothing else. */
function voiceOf(state: Partial<VoiceState>): VoiceMesh {
  const full: VoiceState = {
    mic: 'on',
    open: false,
    held: false,
    listening: false,
    speaking: new Set(),
    intercom: new Set(),
    ...state,
  };
  return { subscribe: () => noop, getState: () => full } as Pick<
    VoiceMesh,
    'subscribe' | 'getState'
  > as VoiceMesh;
}

function within(voice: VoiceMesh | null, node: ReactNode): string {
  return iconsAsWords(renderToStaticMarkup(<VoiceContext value={voice}>{node}</VoiceContext>));
}

const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: true, isHost: true };
const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false };

/** Anna's view of a run with Ben; `parts` change it. */
function annaSees(parts: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    cast: { pa: 'anlage', operator: 'helmut', lead: 'kessler' },
    crewSize: { min: 2, max: 3 },
    chat: [],
    you: anna,
    players: [
      { ...anna, connected: true },
      { ...ben, connected: true },
    ],
    palette: [],
    deadlineAt: null,
    startedAt: 1,
    lights: { out: true, outAt: 1 },
    finishedAt: null,
    timeLimitSec: 600,
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
    presence: { stationId: null, console: null, manualId: 'buch', signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    noteHere: null,
    puzzle: null,
    map: mapWith({}),
    ...parts,
  };
}

function crew(view: PlayerView, voice: VoiceMesh | null = null): string {
  const positionsRef = { current: { run: null, players: {} } };
  return within(voice, <RowCrew view={view} positionsRef={positionsRef} />);
}

describe('the crew in the row', () => {
  it('is a dot in each one’s colour, name and doing in its label, no words by it at first', () => {
    const html = crew(annaSees());
    const mates = html.match(/<li[^>]*>.*?<\/li>/g) ?? [];
    expect(mates).toHaveLength(2);
    expect(mates[0]).toBe(
      '<li class="row-mate" aria-label="Anna: liest" title="Anna: liest">' +
        '<span class="crew-dot crew-dot--0" style="background-color:#2dd4bf" aria-hidden="true">' +
          '</span></li>',
    );
    expect(mates[1]).toContain('aria-label="Ben: unterwegs"');
    expect(html).not.toContain('presence-tag');
    expect(html).not.toContain('hud-idle');
  });

  it('rings the dot of whoever speaks', () => {
    const html = crew(annaSees(), voiceOf({ speaking: new Set(['p2']) }));
    expect(html).toContain('<li class="row-mate row-mate--speaking" aria-label="Ben: unterwegs"');
    expect(html).toContain('<li class="row-mate" aria-label="Anna: liest"');
  });

  it('ticks off whoever stands on the open hatch in the escape, and no one before', () => {
    const exit = { x: 3, y: 3, open: true, openedAt: 1, atExit: ['p2'] };
    const html = crew(annaSees({ map: mapWith({ exit }) }));
    expect(html).toContain(
      'aria-label="Ben: unterwegs, am Notausgang" title="Ben: unterwegs, am Notausgang">' +
        '<span class="crew-dot crew-dot--1" style="background-color:#f472b6" aria-hidden="true">' +
          '</span>[check]</li>',
    );
    const shut = { x: 3, y: 3, open: false, openedAt: null, atExit: ['p2'] };
    expect(crew(annaSees({ map: mapWith({ exit: shut }) }))).not.toContain('[check]');
  });

  it('shows the Laborkennung’s value once the sign is read, after the crew', () => {
    expect(crew(annaSees())).not.toContain('edgework');
    const edgework: Edgework = {
      serial: 'K7G3A-2',
      indicators: [{ id: 'FRQ', lit: true }],
      cells: 3,
    };
    const html = crew(annaSees({ edgework }));
    expect(html.indexOf('<span class="edgework-value"')).toBeGreaterThan(html.indexOf('</ul>'));
  });
});

describe('the row’s buttons', () => {
  const tools = (voice: VoiceMesh | null, notesOpen = false): string =>
    within(
      voice,
      <RowTools notesOpen={notesOpen} onToggleNotes={noop} onOpenInfo={noop} onOpenMenu={noop} />,
    );

  it('open the notepad, the info panel and the menu by their icons, their words in labels', () => {
    expect(tools(null, true)).toBe(
      '<button class="hud-info hud-notes" aria-pressed="true" aria-label="Notizen" ' +
        'title="Notizen">[pencil]</button>' +
        '<button class="hud-info" aria-label="Info" title="Info">[info]</button>' +
        '<button class="hud-info hud-menu" aria-label="Menü" title="Menü">[menu]</button>',
    );
  });

  it('switch the microphone between the button and open, first, while it is on', () => {
    expect(tools(voiceOf({ mic: 'on' }))).toMatch(
      /^<button class="hud-info hud-mic" aria-pressed="false" aria-label="Mikro: Taste"/,
    );
    expect(tools(voiceOf({ mic: 'on', open: true }))).toContain(
      'aria-pressed="true" aria-label="Mikro: offen"',
    );
    expect(tools(voiceOf({ mic: 'off' }))).not.toContain('hud-mic');
  });
});

/** What the block opened by `header` holds, up to its matching brace; '' where there is none. */
function blockAfter(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start === -1) {
    return '';
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    depth += source.charAt(i) === '{' ? 1 : source.charAt(i) === '}' ? -1 : 0;
    if (depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  return '';
}

describe('the row’s stylesheet', () => {
  const PWA = readFileSync(new URL('../src/styles/pwa.css', import.meta.url), 'utf8');

  it('stands a fingertip’s 44 px tall, the bar round it adding nothing', () => {
    expect(blockAfter(PWA, '\n.stage-row {')).toMatch(/\n {2}height: 44px;/);
    expect(blockAfter(PWA, '\n.game--row .stage-top {')).toMatch(/padding: 0;\s*gap: 0;/);
  });

  it('makes each button a fingertip wide and the row’s height', () => {
    const button = blockAfter(PWA, '\n.stage-row .hud-info {');
    expect(button).toMatch(/\n {2}width: 44px;/);
    expect(button).toMatch(/\n {2}height: 100%;/);
    expect(button).toMatch(/pointer-events: auto;/);
  });

  it('cuts the goal short in one line, and a line on the air at two', () => {
    expect(blockAfter(PWA, '\n.stage-row > .stage-goal {')).toMatch(
      /white-space: nowrap;\s*text-overflow: ellipsis;/,
    );
    expect(blockAfter(PWA, '\n.stage-row .stage-sub {')).toMatch(/display: inline;/);
    expect(blockAfter(PWA, '\n.stage-row > .radio-banner,')).toMatch(/line-clamp: 2;/);
  });

  it('sets nothing in it under the HUD’s 12 px', () => {
    const from = PWA.indexOf('\n.game--row .stage-top {');
    const row = PWA.slice(from, PWA.indexOf('.game--row:not(.game--noting) .notepad'));
    const sizes = [...row.matchAll(/font-size: calc\((\d+)px \* var\(--text-scale\)\)/g)].map(
      (match) => Number(match[1]),
    );
    expect(sizes.length).toBeGreaterThan(3);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  it('keeps the notepad in the world under the row, and beside a sheet its strip whole', () => {
    expect(blockAfter(PWA, '\n.game--row:not(.game--noting) .notepad {')).toMatch(
      /max-height: calc\(100% - 44px - 18px\);/,
    );
    expect(PWA).not.toMatch(/\n\.game--row \.notepad \{/);
  });
});
