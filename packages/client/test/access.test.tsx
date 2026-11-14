import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessTerminal, ConsoleId, PuzzleView } from '@escapelab/core';
import type { MissionTime } from '../src/clock.js';
import { NotepadContext } from '../src/noting.js';
import { elementsOf, Sheets, type Screen, type Styled } from './cascade.js';
import { deviceRun, mapWith, NO_CLOCK, stationView } from './fixtures.js';

vi.mock('../src/puzzles/sounds.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn() : value,
    ]),
  );
});

const sounds = await import('../src/puzzles/sounds.js');
const {
  AccessList,
  AccessPanel,
  accessSounds,
  doorStatus,
  ENDING_SEC,
  lockLeft,
  nextSecond,
  rosterTaken,
  secondsTo,
  sessionWord,
} = await import('../src/puzzles/AccessPanel.js');
const { completed, grouped, inputOf, withKey } = await import('../src/puzzles/accessPrompt.js');
const { heldView } = await import('../src/puzzles/Device.js');
const { StationModal } = await import('../src/screens/Game.js');

type Access = Extract<PuzzleView, { kind: 'access' }>;

const noop = (): void => undefined;
const NOW = 1_700_000_000_000;

/** The Zugangskontrolle as p1 sees it at console `seat`, the def's `fields` set. */
const seen = (seat: ConsoleId | null, fields: Record<string, unknown> = {}): Access =>
  stationView(
    { type: 'access', id: 'zk', title: 'Zugangskontrolle', ...fields },
    seat === null ? { operating: false } : { seat },
  ) as Access;

/** The terminal's part of a view at console a, with `part` changed. */
function atTerminal(part: Partial<AccessTerminal>): Access {
  const view = seen('a');
  if (view.terminal === null) {
    throw new Error('console a shows no terminal');
  }
  return { ...view, terminal: { ...view.terminal, ...part } };
}

/** The token device at console b, its period ending `leftMs` from NOW. */
function atDevice(leftMs: number): Access {
  const view = seen('b');
  if (view.device === null) {
    throw new Error('console b shows no token device');
  }
  return {
    ...view,
    device: { account: 'huber', token: '405217', endsAt: NOW + leftMs, periodSec: 30 },
  };
}

const panel = (puzzle: Access, mission: MissionTime = NO_CLOCK): string =>
  renderToStaticMarkup(
    <AccessPanel puzzle={puzzle} change={null} send={noop} mission={mission} />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the terminal’s prompt', () => {
  it('reads six digits as a token, with or without the blank the device groups them by', () => {
    expect(inputOf('405217')).toEqual({ token: '405217' });
    expect(inputOf(' 405 217 ')).toEqual({ token: '405217' });
    expect(inputOf('40521')).toBeNull();
    expect(inputOf('4052170')).toBeNull();
    expect(grouped('405217')).toBe('405 217');
  });

  it('reads login with an account, status alone, freigeben with a door it knows', () => {
    expect(inputOf('login huber')).toEqual({ cmd: 'login', account: 'huber' });
    expect(inputOf('  LOGIN  Huber ')).toEqual({ cmd: 'login', account: 'huber' });
    expect(inputOf('status')).toEqual({ cmd: 'status' });
    expect(inputOf('freigeben werkstatt')).toEqual({ cmd: 'freigeben', door: 'werkstatt' });
    for (const line of ['', 'login', 'login a b', 'login müller', 'status x', 'freigeben küche']) {
      expect(inputOf(line), line).toBeNull();
    }
    expect(inputOf('start dns')).toBeNull();
  });

  it('completes a command, then a door the terminal asks for, never an account', () => {
    const doors = ['schleuse', 'serverraum'] as const;
    expect(completed('l', doors)).toBe('login ');
    expect(completed('fr', doors)).toBe('freigeben ');
    expect(completed('s', doors)).toBe('status');
    expect(completed('freigeben s', doors)).toBe('freigeben s');
    expect(completed('freigeben sc', doors)).toBe('freigeben schleuse');
    expect(completed('freigeben a', doors)).toBe('freigeben a');
    expect(completed('login h', doors)).toBe('login h');
    expect(completed('4052', doors)).toBe('4052');
  });

  it('puts a key’s word into the line: digits to a token, a door after freigeben', () => {
    expect(withKey('', { digit: '4' })).toBe('4');
    expect(withKey('405 2', { digit: '1' })).toBe('405 21');
    expect(withKey('login huber', { digit: '4' })).toBe('4');
    expect(withKey('405', { erase: true })).toBe('40');
    expect(withKey('status', { door: 'archiv' })).toBe('freigeben archiv');
    expect(withKey('freigeben archiv', { cmd: 'freigeben' })).toBe('freigeben archiv');
    expect(withKey('status', { cmd: 'freigeben' })).toBe('freigeben ');
    expect(withKey('405', { cmd: 'login' })).toBe('login ');
    expect(withKey('login huber', { cmd: 'status' })).toBe('status');
  });
});

describe('the clock the displays count on', () => {
  it('names the next moment a count shows another whole second, none once it is out', () => {
    expect(nextSecond(10_000, 0)).toBe(1_000);
    expect(nextSecond(10_000, 1_250)).toBe(2_000);
    expect(nextSecond(10_000, 9_500)).toBe(10_000);
    expect(nextSecond(10_000, 10_000)).toBeNull();
    expect(nextSecond(null, 0)).toBeNull();
    expect(secondsTo(10_000, 9_001)).toBe(1);
    expect(secondsTo(10_000, 12_000)).toBe(0);
  });

  it('counts a lock down to its lift on the station’s clock, whatever the mission clock does', () => {
    expect(lockLeft({ account: 'huber', until: 50_000 }, 30_000)).toBe(20);
    expect(lockLeft({ account: 'huber', until: 50_000 }, 49_001)).toBe(1);
    expect(lockLeft({ account: 'huber', until: 50_000 }, 50_000)).toBe(0);
  });
});

describe('the terminal', () => {
  it('names the doors it asks for, its session and its log — never a token or the list', () => {
    const view = seen('a');
    const html = panel(view);
    for (const row of view.terminal?.doors ?? []) {
      const name = row.door.toUpperCase();
      expect(html).toMatch(new RegExp(`data-door="${row.door}" style="[^"]*"><th scope="row">${name}<`));
    }
    expect(html.match(/<span class="access-door-status">ANGEFORDERT<\/span>/g)).toHaveLength(2);
    expect(html).toContain('data-session="—"');
    expect(html).toContain('<span class="access-level">STUFE 1</span>');
    expect(html).toContain('[INFO]</span> Angefordert: ');
    expect(html).not.toContain('access-digits');
    expect(html).not.toContain('access-roster');
    // The Serverraum's make: its glass, its prompt, its keys, the lamp for the other console.
    expect(html).toMatch(/^<form class="servers servers--terminal access access--terminal">/);
    expect(html).toContain('<span class="device-engraving">TOKEN</span>');
  });

  it('tells a door asked for, standing open with its seconds, and released apart', () => {
    const row = { door: 'lager', released: true } as const;
    expect(doorStatus(row, { door: 'lager', until: 5_000 }, 2_100)).toEqual({
      text: 'OFFEN 3 s',
      tone: 'open',
    });
    expect(doorStatus(row, { door: 'lager', until: 5_000 }, 5_000).text).toBe('FREIGEGEBEN');
    expect(doorStatus({ ...row, released: false }, null, 0).text).toBe('ANGEFORDERT');
  });

  it('names the session by its account, at Stufe 2 by its role', () => {
    expect(sessionWord(null)).toBe('—');
    expect(sessionWord({ account: 'huber' })).toBe('huber');
    expect(sessionWord({ role: 'it' })).toBe('IT-BETRIEB');
    const strict = panel(atTerminal({ strict: true, session: { role: 'haustechnik' } }));
    expect(strict).toContain('<span class="access-level access-level--2">STUFE 2</span>');
    expect(strict).toContain('data-session="HAUSTECHNIK"');
  });

  it('asks for the token with a numeric pad in place of the doors, the keyboard numeric too', () => {
    const asking = panel(atTerminal({ prompt: 'huber' }));
    expect(asking).toContain('TOKEN huber ›</span>');
    expect(asking).toContain('aria-label="Token für huber" inputMode="numeric"');
    expect(asking.match(/data-digit="\d"/g)).toHaveLength(10);
    expect(asking).toContain('data-erase=""');
    expect(asking).not.toMatch(/<button[^>]*data-door=/);
    const idle = panel(seen('a'));
    expect(idle).toContain('aria-label="Befehl" inputMode="text"');
    expect(idle).not.toContain('data-digit=');
    expect(idle.match(/<button type="button" class="servers-key" data-door=/g)).toHaveLength(2);
  });

  it('shows a lock while it holds, its seconds counting down to its lift', () => {
    const locks = [
      { account: 'huber', until: NOW + 40_000 },
      { account: 'pohl', until: NOW - 1 },
    ];
    const html = panel(atTerminal({ locks }));
    expect(html).toContain('data-account="huber"><span class="access-session-label">GESPERRT');
    expect(html).toContain('huber · 40 s');
    expect(html).not.toContain('data-account="pohl"');
  });
});

describe('the token device', () => {
  it('shows its account, the token in two groups and the bar draining from where it stands', () => {
    const html = panel(atDevice(17_000));
    expect(html).toContain('<span class="access-account-name">huber</span>');
    expect(html).toContain('<p class="access-digits" data-token="405217">405 217</p>');
    expect(html).toContain('role="timer" aria-label="Wechsel in 17 s"');
    expect(html).toContain('--bar-ms:30000ms;--bar-delay:-13000ms;--bar-left:0.567');
    expect(html).toContain('<p class="access-left">17 s</p>');
    expect(html).not.toContain('access-lcd--ending');
    for (const word of ['TÜR', 'servers-input', 'access-roster', 'data-door']) {
      expect(html).not.toContain(word);
    }
    expect(html).toContain('<span class="device-engraving">TERMINAL</span>');
  });

  it(`turns to its last ${ENDING_SEC} seconds, and ticks once each of them`, () => {
    expect(panel(atDevice(4_000))).toContain('class="access-lcd access-lcd--ending"');
    expect(panel(atDevice(ENDING_SEC * 1000 + 1))).not.toContain('access-lcd--ending');
  });
});

describe('the audience and the list', () => {
  it('shows the audience both consoles side by side, and the list under them', () => {
    const view = seen(null);
    const audience = stationView(
      { type: 'access', id: 'zk', title: 'Zugangskontrolle' },
      { who: null, operating: true, seat: null },
    ) as Access;
    expect(view).toMatchObject({ terminal: null, device: null });
    const html = panel({ ...audience, roster: [{ name: 'huber', role: 'it' }] });
    expect(html).toContain('aria-label="Pult A"');
    expect(html).toContain('aria-label="Pult B"');
    expect(html).toContain('access-digits');
    expect(html).toContain('<td>huber</td><td>IT-Betrieb</td>');
    expect(html).not.toContain('servers-input');
  });

  it('gives a source the list of this shift’s accounts, the notepad’s „Notieren" beside it', () => {
    const roster = [
      { name: 'berger', role: 'sicherheit' },
      { name: 'huber', role: 'it' },
    ] as const;
    const view = { ...seen(null), roster: [...roster] };
    const html = renderToStaticMarkup(
      <NotepadContext value={{ noteDown: () => false, toggle: noop }}>
        <AccessList puzzle={view} />
      </NotepadContext>,
    );
    expect(html).toContain('Benutzerliste dieser Schicht');
    expect(html).toContain('<td>berger</td><td>Sicherheitsdienst</td>');
    expect(html).toContain('note-down-word">Notieren');
    expect(rosterTaken({ index: 2 }, roster)).toEqual({
      part: 'Konten',
      key: '2/konten',
      lines: ['Konto   Rolle', 'berger  Sicherheitsdienst', 'huber   IT-Betrieb'],
      form: 'table',
    });
    expect(renderToStaticMarkup(<AccessList puzzle={seen('a')} />)).toBe('');
  });
});

describe('what a change sounds like', () => {
  const change = (before: Access, after: Access) => ({ before, after, alarm: false, seq: 1 });
  const line = (n: number, tag: 'ok' | 'fail' | 'info', text: string) => ({ n, tag, text });

  it('chimes a release, buzzes a failed line, chimes a session opening', () => {
    const before = atTerminal({ log: [line(1, 'info', 'a')] });
    const doors = before.terminal?.doors ?? [];
    const released = atTerminal({
      log: [line(1, 'info', 'a'), line(2, 'ok', 'LAGER offen für 5 s')],
      doors: doors.map((row, i) => ({ ...row, released: i === 0 })),
    });
    accessSounds(change(before, released));
    expect(sounds.stageChime).toHaveBeenCalledTimes(1);
    expect(sounds.okChime).not.toHaveBeenCalled();
    accessSounds(change(before, atTerminal({ log: [line(1, 'info', 'a'), line(2, 'fail', 'x')] })));
    expect(sounds.rejectBuzz).toHaveBeenCalledTimes(1);
    accessSounds(change(before, atTerminal({ log: [line(1, 'info', 'a'), line(2, 'ok', 'y')] })));
    expect(sounds.okChime).toHaveBeenCalledTimes(1);
    accessSounds(change(before, before));
    expect(sounds.typeBlip).not.toHaveBeenCalled();
  });

  it('blips at the token device as it takes the next period’s token', () => {
    accessSounds(change(atDevice(1_000), atDevice(31_000)));
    expect(sounds.typeBlip).toHaveBeenCalledTimes(1);
    accessSounds(change(atDevice(1_000), atDevice(1_000)));
    expect(sounds.typeBlip).toHaveBeenCalledTimes(1);
  });

  it('holds the terminal as it stands done: every door released', () => {
    const last = seen('a');
    const held = heldView(last, 1);
    expect(held?.kind === 'access' ? held.terminal?.doors.map((row) => row.released) : null).toEqual(
      [true, true],
    );
  });
});

// --- the type and the targets ------------------------------------------------------------------

const sheets = new Sheets();

const SCREENS: { name: string; screen: Screen; target: number }[] = [
  { name: 'a laptop’s 1280×720', screen: { width: 1280, height: 720, coarse: false }, target: 36 },
  { name: 'a desktop’s 1440×820', screen: { width: 1440, height: 820, coarse: false }, target: 36 },
  { name: 'a phone held sideways', screen: { width: 844, height: 390, coarse: true }, target: 44 },
];

/** The device as the station modal shows it in a run, the notepad within reach. */
function station(puzzle: Access): Styled[] {
  return elementsOf(
    renderToStaticMarkup(
      <NotepadContext value={{ noteDown: () => true, toggle: noop }}>
        <StationModal
          puzzle={puzzle}
          run={deviceRun()}
          map={mapWith({})}
          edgework={null}
          mission={NO_CLOCK}
          send={noop}
          onStepBack={noop}
        />
      </NotepadContext>,
    ),
  );
}

const CONSOLES = [
  { name: 'the terminal', nodes: () => station(seen('a')) },
  { name: 'the terminal asking for a token', nodes: () => station(atTerminal({ prompt: 'huber' })) },
  { name: 'the token device', nodes: () => station(atDevice(17_000)) },
];

const CONTROLS = new Set(['button', 'input']);

/** The px `node` declares at most for any of `properties` on `screen`. */
function mostOf(node: Styled, properties: string[], screen: Screen): number {
  const lengths = properties.map((property) => sheets.length(node, property, screen));
  return Math.max(0, ...lengths.filter((n) => !Number.isNaN(n)));
}

/** The words shown on `screen` whose classes, or whose parent's, include `name`. */
function carrying(nodes: readonly Styled[], name: string, screen: Screen): Styled[] {
  return nodes.filter(
    (node) =>
      node.text.trim() !== '' &&
      !sheets.hidden(node, screen) &&
      (node.classes.includes(name) || node.parent?.classes.includes(name) === true),
  );
}

describe.each(CONSOLES)('$name', ({ nodes }) => {
  it.each(SCREENS)('makes every control a target on $name', ({ screen, target }) => {
    const controls = nodes().filter((n) => CONTROLS.has(n.tag) && !sheets.hidden(n, screen));
    const short = controls.filter(
      (n) => mostOf(n, ['min-height', 'height', 'line-height'], screen) < target,
    );
    expect(short.map((n) => `${n.tag}.${n.classes.join('.')}`)).toEqual([]);
    const pads = controls.filter((n) => n.classes.includes('access-key'));
    expect(pads.filter((n) => mostOf(n, ['min-width', 'width'], screen) < target)).toEqual([]);
  });
});

describe('the words on its devices', () => {
  const terminal = [...station(seen('a')), ...station(atTerminal({ prompt: 'huber' }))];
  const device = station(atDevice(17_000));
  const ROLES = [
    { floor: 24, nodes: device, classes: ['access-digits'] },
    {
      floor: 14,
      nodes: [...terminal, ...device],
      classes: [
        'access-door',
        'access-session-line',
        'servers-line',
        'access-account-name',
        'access-left',
      ],
    },
    { floor: 12, nodes: [...terminal, ...device], classes: ['access-head', 'access-account-label'] },
  ];

  it.each(SCREENS)('read the token in large digits, the rest of the face 14 px, on $name', ({
    screen,
  }) => {
    for (const { floor, nodes, classes } of ROLES) {
      for (const name of classes) {
        const words = carrying(nodes, name, screen);
        expect(words.length, name).toBeGreaterThan(0);
        const small = words.filter((node) => !(sheets.fontSize(node, screen) >= floor));
        expect(small.map((node) => `${name} ${sheets.fontSize(node, screen)}`)).toEqual([]);
      }
    }
  });
});
