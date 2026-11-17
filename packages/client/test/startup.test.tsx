import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleId, PuzzleView, StartupBoard, StartupTerminal } from '@escapelab/core';
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
  humVolts,
  idlePlate,
  ladderLit,
  listed,
  nextStepAt,
  NPM_REPLY,
  promptHint,
  StartupPanel,
  startupSounds,
  statusOf,
} = await import('../src/puzzles/StartupPanel.js');

const fail = (): never => {
  throw new Error('no terminal');
};
const { completed, lineOf, withKey } = await import('../src/puzzles/startupPrompt.js');
const { heldView } = await import('../src/puzzles/Device.js');
const { StationModal } = await import('../src/screens/Game.js');

type Startup = Extract<PuzzleView, { kind: 'startup' }>;

const noop = (): void => undefined;
const NOW = 1_700_000_000_000;

/** The Anlaufsteuerung as p1 sees it at console `seat` (none: away from it), `fields` set. */
const seen = (seat: ConsoleId | null, fields: Record<string, unknown> = {}): Startup =>
  stationView(
    { type: 'startup', id: 'as', title: 'Anlaufsteuerung', ...fields },
    seat === null ? { operating: false } : { seat },
  ) as Startup;

/** The live terminal at console a, with `part` changed. */
function atTerminal(part: Partial<StartupTerminal> = {}): Startup {
  const view = seen('a');
  if (view.terminal === null) {
    throw new Error('console a shows no terminal in stage 1');
  }
  return { ...view, terminal: { ...view.terminal, ...part } };
}

/** The live Schaltfeld at console b, with `part` changed. */
function atBoard(part: Partial<StartupBoard> = {}): Startup {
  const view = seen('b');
  if (view.board === null) {
    throw new Error('console b shows no Schaltfeld in stage 1');
  }
  return { ...view, board: { ...view.board, ...part } };
}

const panel = (puzzle: Startup): string =>
  renderToStaticMarkup(
    <StartupPanel puzzle={puzzle} change={null} send={noop} mission={NO_CLOCK} />,
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
  it('reads zeige and start alone, setze with a gap and a feeder, the script’s own form', () => {
    expect(lineOf('zeige')).toEqual({ input: { cmd: 'zeige' } });
    expect(lineOf('  START ')).toEqual({ input: { cmd: 'start' } });
    expect(lineOf('setze abgang 2')).toEqual({ input: { cmd: 'setze', gap: 'abgang', value: 2 } });
    expect(lineOf('abgang = 3')).toEqual({ input: { cmd: 'setze', gap: 'abgang', value: 3 } });
    expect(lineOf('sperre=4')).toEqual({ input: { cmd: 'setze', gap: 'sperre', value: 4 } });
    for (const line of ['', 'start 2', 'setze abgang', 'setze abgang 5', 'setze abgang 0']) {
      expect(lineOf(line), line).toBeNull();
    }
    expect(lineOf('setze last 2')).toBeNull();
    expect(lineOf('abgang 2')).toBeNull();
  });

  it('knows npm only to say it does not know it', () => {
    expect(lineOf('npm start')).toEqual({ npm: true });
    expect(lineOf('NPM install anlauf')).toEqual({ npm: true });
    expect(NPM_REPLY).toBe('? npm: unbekannter Befehl — AS-86, Baujahr 1986');
  });

  it('completes a command, then a gap of the stage’s script', () => {
    expect(completed('z', ['abgang'])).toBe('zeige');
    expect(completed('se', ['abgang'])).toBe('setze ');
    expect(completed('st', ['abgang'])).toBe('start');
    expect(completed('s', ['abgang'])).toBe('s');
    expect(completed('setze a', ['abgang'])).toBe('setze abgang ');
    expect(completed('setze s', ['abgang'])).toBe('setze s');
    expect(completed('setze s', ['sperre', 'abgang'])).toBe('setze sperre ');
    expect(completed('start x', ['abgang'])).toBe('start x');
  });

  it('puts a key’s word into the line: a command, a gap, a feeder in its place', () => {
    expect(withKey('setze abgang 2', { cmd: 'start' })).toBe('start');
    expect(withKey('', { cmd: 'setze' })).toBe('setze ');
    expect(withKey('setze ', { gap: 'abgang' })).toBe('setze abgang ');
    expect(withKey('setze abgang ', { feeder: 3 })).toBe('setze abgang 3');
    expect(withKey('setze abgang 3', { feeder: 1 })).toBe('setze abgang 1');
    expect(withKey('setze abgang 3', { gap: 'sperre' })).toBe('setze sperre 3');
    expect(withKey('', { feeder: 2 })).toBe('setze 2');
    expect(withKey('setze 2', { gap: 'abgang' })).toBe('setze abgang 2');
    expect(withKey('setze abgang 3', { erase: true })).toBe('setze abgang ');
  });
});

describe('the ladder', () => {
  const pulse = { sentAt: NOW };

  it('lights a step a second from the pulse’s sending, dark at the window’s end', () => {
    expect(ladderLit(null, NOW, 9)).toBe(0);
    expect(ladderLit(pulse, NOW - 5, 9)).toBe(1);
    expect(ladderLit(pulse, NOW, 9)).toBe(1);
    expect(ladderLit(pulse, NOW + 999, 9)).toBe(1);
    expect(ladderLit(pulse, NOW + 1000, 9)).toBe(2);
    expect(ladderLit(pulse, NOW + 8999, 9)).toBe(9);
    // The window's end: dark on every screen, whatever grace the server still allows.
    expect(ladderLit(pulse, NOW + 9000, 9)).toBe(0);
    expect(ladderLit(pulse, NOW + 60_000, 9)).toBe(0);
  });

  it('names the moment the ladder changes next — a step, then the dark —, none once dark', () => {
    expect(nextStepAt(null, NOW, 9)).toBeNull();
    expect(nextStepAt(pulse, NOW, 9)).toBe(NOW + 1000);
    expect(nextStepAt(pulse, NOW + 1500, 9)).toBe(NOW + 2000);
    expect(nextStepAt(pulse, NOW + 8000, 9)).toBe(NOW + 9000);
    expect(nextStepAt(pulse, NOW + 9000, 9)).toBeNull();
  });

  it('hums higher with every step', () => {
    expect(humVolts(2)).toBeGreaterThan(humVolts(1));
  });

  it('draws its steps from the foot, the window’s marked at the top, lit as it fills', () => {
    vi.setSystemTime(NOW + 6500);
    const html = panel(atBoard({ pulse: { sentAt: NOW, arrived: true } }));
    const steps = [...html.matchAll(/<li class="(startup-step[^"]*)"/g)].map((m) => m[1] ?? '');
    // The live ladder, then none: the idle terminal has no ladder.
    expect(steps).toHaveLength(9);
    expect(steps.slice(0, 3).every((c) => c.includes('startup-step--marked'))).toBe(true);
    expect(steps.filter((c) => c.includes('startup-step--lit'))).toHaveLength(7);
    expect(steps[2]).toContain('startup-step--lit');
    expect(steps[1]).not.toContain('startup-step--lit');
  });
});

describe('the consoles', () => {
  it('shows the live terminal the script and its gaps, the Schaltfeld beside it dark', () => {
    const html = panel(atTerminal());
    expect(html).toContain('AS-86 Anlaufskript, Stufe 1 von 2');
    expect(html).toMatch(/abgang = <span class="startup-value startup-value--open">\?<\/span>/);
    expect(html).toContain('Leuchtbild, Tabelle 2 im Betriebsbuch');
    expect(html).not.toMatch(/startup-lamp--(gruen|gelb|rot)/);
    expect(html).toContain('SCHALTFELD B');
    expect(html).toContain('<input');
  });

  it('shows a value set where the gap was, and that a pulse is off without counting', () => {
    const html = panel(atTerminal({ values: { abgang: 2 }, sent: true }));
    expect(html).toMatch(/abgang = <span class="startup-value startup-value--set">\[2\]<\/span>/);
    expect(html).toContain('IMPULS UNTERWEGS');
    expect(html).not.toMatch(/startup-step--lit/);
  });

  it('shows the live Schaltfeld its lamps with their words, the terminal beside it idle', () => {
    const view = atBoard();
    const html = panel(view);
    const colours = view.board?.feeders.flatMap((f) => f.lamps) ?? [];
    expect(html.match(/class="startup-lamp startup-lamp--/g)).toHaveLength(8);
    for (const colour of colours) {
      expect(html).toContain(`startup-lamp--${colour}`);
    }
    expect(html).toContain('TERMINAL B · IN RUHE · SKRIPT AN PULT A');
    expect(html).not.toContain('Anlaufskript');
    expect(html).not.toContain('<input');
    expect(html.match(/data-breaker="/g)).toHaveLength(4);
    expect(html).not.toMatch(/data-breaker="\d"[^>]*disabled/);
  });

  it('shows a breaker closed in an earlier stage at this Schaltfeld as closed', () => {
    const html = panel({ ...atBoard(), closed: [{ console: 'b', feeder: 2 }] });
    expect(html).toMatch(/startup-breaker startup-breaker--closed" data-breaker="2"/);
    expect(html.match(/startup-breaker--closed/g)).toHaveLength(1);
    const elsewhere = panel({ ...atBoard(), closed: [{ console: 'a', feeder: 2 }] });
    expect(elsewhere).not.toContain('startup-breaker--closed');
  });

  it('shows the audience both live parts, no prompt and no breaker to close', () => {
    const view = { ...atTerminal(), board: atBoard().board, role: null, console: null };
    const html = panel(view);
    expect(html).toContain('Anlaufskript');
    expect(html).toMatch(/startup-lamp--(gruen|gelb|rot)/);
    expect(html).not.toContain('<input');
    const disabled = /data-breaker="\d" data-feel="pull" aria-label="[^"]*" disabled/g;
    expect(html.match(disabled)).toHaveLength(4);
  });

  it('shows nothing of the instance away from the consoles', () => {
    expect(panel(seen(null))).toBe('<p class="muted">Dieses Pult ist nicht angeschlossen.</p>');
  });
});

describe('the script as listed', () => {
  it('puts every comment on a line of its own over its line, none past 72 characters', () => {
    const script = atTerminal().terminal?.script ?? [];
    const lines = listed(script);
    expect(lines.filter((line) => line.kind === 'comment').length).toBe(3);
    const html = panel(atTerminal());
    const texts = [...html.matchAll(/<li class="startup-line[^"]*"[^>]*>(.*?)<\/li>/g)].map((m) =>
      (m[1] ?? '').replace(/<[^>]+>/g, ''),
    );
    expect(texts.filter((text) => text.length > 72)).toEqual([]);
    const hint = /^# Last [^:]+: Leuchtbild, Tabelle 2 im Betriebsbuch$/;
    expect(texts.filter((text) => hint.test(text))).toHaveLength(1);
    expect(texts).toContain('abgang = ?');
  });
});

describe('the prompt’s hint and the Schaltfeld’s plate', () => {
  const shown = { n: 9, tag: 'info' as const, text: 'zeige: Stufe 1, Kühlkreis, offen: abgang' };

  it('names the typed steps once zeige has answered last, the gaps still open first', () => {
    const log = atTerminal().terminal?.log ?? [];
    expect(promptHint(atTerminal().terminal ?? fail())).toBeNull();
    const after = atTerminal({ log: [...log, shown] });
    expect(promptHint(after.terminal ?? fail())).toBe('Eingabe: setze abgang <nr> · start');
    expect(panel(after)).toContain('Eingabe: setze abgang &lt;nr&gt; · start');
    const set = atTerminal({ log: [...log, shown], values: { abgang: 2 } });
    expect(promptHint(set.terminal ?? fail())).toBe('Eingabe: start');
  });

  it('marks the Schaltfeld taking the pulse, and names it on the one at rest', () => {
    expect(panel(atBoard())).toContain('SCHALTFELD B · AUFGESCHALTET');
    expect(panel(atTerminal())).toContain('SCHALTFELD A · IN RUHE · AUFGESCHALTET: B');
    expect(idlePlate({ ...atTerminal(), types: 'b' })).toBe(
      'SCHALTFELD B · IN RUHE · AUFGESCHALTET: A',
    );
  });
});

describe('the status strip', () => {
  it('says what the Schaltfeld sees of the pulse, and what the last came to', () => {
    expect(statusOf(atBoard())).toBe('Stufe 1/2 · Schaltfeld B aufgeschaltet · Bereit');
    expect(statusOf(atBoard({ pulse: { sentAt: NOW, arrived: false } }))).toBe(
      'Stufe 1/2 · Impuls kommt',
    );
    expect(statusOf(atBoard({ pulse: { sentAt: NOW, arrived: true } }))).toBe(
      'Stufe 1/2 · Impuls auf den markierten Stufen',
    );
    expect(statusOf({ ...atBoard(), last: 'verworfen' })).toBe(
      'Stufe 1/2 · Schaltfeld B aufgeschaltet · Impuls verworfen: Schalter vor dem Fenster',
    );
  });

  it('says at the terminal only that a pulse is off, never where it stands', () => {
    expect(statusOf(atTerminal())).toBe('Stufe 1/2 · Skript an Pult A · Bereit');
    expect(statusOf(atTerminal({ sent: true }))).toBe(
      'Stufe 1/2 · Impuls unterwegs zu Schaltfeld B',
    );
    expect(statusOf({ ...atTerminal(), last: 'verfallen' })).toBe(
      'Stufe 1/2 · Skript an Pult A · Impuls verfallen',
    );
  });
});

describe('what a change sounds like', () => {
  const change = (before: Startup, after: Startup) => ({ before, after, alarm: false, seq: 1 });

  it('clacks the relay home and chimes as a stage runs up', () => {
    const before = atBoard();
    startupSounds(change(before, { ...before, closed: [{ console: 'b', feeder: 2 }] }));
    expect(sounds.relayClick).toHaveBeenCalledTimes(1);
    expect(sounds.stageChime).toHaveBeenCalledTimes(1);
    expect(sounds.rejectBuzz).not.toHaveBeenCalled();
  });

  it('buzzes a failed line or a wrong breaker, beeps a pulse sent', () => {
    const before = atTerminal();
    const log = [...(before.terminal?.log ?? []), { n: 9, tag: 'fail' as const, text: 'x' }];
    startupSounds(change(before, atTerminal({ log })));
    expect(sounds.rejectBuzz).toHaveBeenCalledTimes(1);
    startupSounds(change(atBoard(), { ...atBoard(), last: 'falsch' }));
    expect(sounds.rejectBuzz).toHaveBeenCalledTimes(2);
    startupSounds(change(before, atTerminal({ sent: true })));
    expect(sounds.okChime).toHaveBeenCalledTimes(1);
    startupSounds(change(atTerminal({ sent: true }), atTerminal({ sent: true })));
    expect(sounds.okChime).toHaveBeenCalledTimes(1);
  });

  it('holds the device as it stands done: run up, no pulse left', () => {
    const held = heldView(atBoard({ pulse: { sentAt: NOW, arrived: true } }), 1);
    expect(held?.kind === 'startup' ? [held.last, held.board?.pulse] : null).toEqual([
      'angelaufen',
      null,
    ]);
  });
});

// --- the type and the targets ------------------------------------------------------------------

const sheets = new Sheets();

const SCREENS: { name: string; screen: Screen; target: number }[] = [
  { name: 'a laptop’s 1280×720', screen: { width: 1280, height: 720, coarse: false }, target: 36 },
  { name: 'a phone held upright', screen: { width: 390, height: 844, coarse: true }, target: 44 },
  { name: 'a phone held sideways', screen: { width: 844, height: 390, coarse: true }, target: 44 },
];

/** The device as the station modal shows it in a run. */
function station(puzzle: Startup): Styled[] {
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

const CONTROLS = new Set(['button', 'input']);

/** The px `node` declares at most for any of `properties` on `screen`. */
function mostOf(node: Styled, properties: string[], screen: Screen): number {
  const lengths = properties.map((property) => sheets.length(node, property, screen));
  return Math.max(0, ...lengths.filter((n) => !Number.isNaN(n)));
}

const CONSOLES = [
  { name: 'the terminal', nodes: () => station(atTerminal()) },
  {
    name: 'the Schaltfeld',
    nodes: () => station(atBoard({ pulse: { sentAt: NOW, arrived: false } })),
  },
];

describe.each(CONSOLES)('$name', ({ nodes }) => {
  it.each(SCREENS)('makes every control a target on $name', ({ screen, target }) => {
    const controls = nodes().filter((n) => CONTROLS.has(n.tag) && !sheets.hidden(n, screen));
    const short = controls.filter(
      (n) => mostOf(n, ['min-height', 'height', 'line-height'], screen) < target,
    );
    expect(short.map((n) => `${n.tag}.${n.classes.join('.')}`)).toEqual([]);
    const breakers = controls.filter((n) => n.classes.includes('startup-breaker'));
    expect(breakers.filter((n) => mostOf(n, ['min-width', 'width'], screen) < target)).toEqual([]);
  });

  it.each(SCREENS)('sets its words at 14 px at least on $name', ({ screen }) => {
    const words = nodes().filter(
      (n) =>
        n.text.trim() !== '' &&
        !sheets.hidden(n, screen) &&
        [n, n.parent].some((m) => m?.classes.some((c) => c.startsWith('startup-')) === true),
    );
    expect(words.length).toBeGreaterThan(0);
    const small = words.filter((node) => !(sheets.fontSize(node, screen) >= 14));
    expect(small.map((n) => `${n.classes.join('.')} ${sheets.fontSize(n, screen)}`)).toEqual([]);
  });
});

describe('the stylesheet', () => {
  const sideways = SCREENS[2]?.screen ?? { width: 0, height: 0, coarse: true };
  const laptop = SCREENS[0]?.screen ?? { width: 0, height: 0, coarse: false };

  it('reduces the idle part to its plate, left out on a phone held sideways', () => {
    for (const view of [atTerminal(), atBoard()]) {
      const nodes = station(view);
      const idle = nodes.filter((n) => n.classes.includes('startup-idle'));
      expect(idle).toHaveLength(1);
      expect(sheets.hidden(idle[0] ?? fail(), sideways)).toBe(true);
      expect(sheets.hidden(idle[0] ?? fail(), laptop)).toBe(false);
      // The live part only: one glass or one Schaltfeld.
      const live = (n: Styled) =>
        n.classes.includes('startup-crt') || n.classes.includes('startup-board');
      const parts = nodes.filter(live);
      expect(parts).toHaveLength(1);
    }
  });

  it('keeps a command on its row and wraps a clue, never cutting one; hides only plain lines', () => {
    const nodes = station(atTerminal());
    const lines = nodes.filter((n) => n.classes.includes('startup-line'));
    const code = lines.find((n) => !n.classes.includes('startup-line--comment')) ?? fail();
    expect(sheets.declared(code, 'white-space', laptop)?.value).toBe('pre');
    const clues = lines.filter(
      (n) => n.classes.includes('startup-line--comment') && !n.classes.includes('startup-line--plain'),
    );
    expect(clues).toHaveLength(2);
    for (const clue of clues) {
      expect(sheets.declared(clue, 'white-space', sideways)?.value).toBe('pre-wrap');
      expect(sheets.declared(clue, 'overflow', sideways)).toBeUndefined();
      expect(sheets.hidden(clue, sideways)).toBe(false);
    }
    const plain = lines.filter((n) => n.classes.includes('startup-line--plain'));
    expect(plain.map((n) => n.text.trim())).toEqual([
      '# AS-86 Anlaufskript, Stufe 1 von 2',
      'lade anlauf.cfg',
    ]);
    expect(plain.every((n) => sheets.hidden(n, sideways) && !sheets.hidden(n, laptop))).toBe(true);
  });

  it('shows the log’s last three entries whole, no box to scroll them out of view', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, tag: 'info' as const, text: `l${i}` }));
    const nodes = station(atTerminal({ log: many }));
    const entries = nodes.filter((n) => n.classes.includes('servers-line'));
    expect(entries.map((n) => n.parent?.classes.includes('startup-log'))).toHaveLength(3);
    const log = nodes.find((n) => n.classes.includes('startup-log')) ?? fail();
    expect(sheets.declared(log, 'max-height', laptop)?.value).toBe('none');
  });

  it('sets the audience’s two parts one over the other, its column beside the lab narrow', () => {
    const view = { ...atTerminal(), board: atBoard().board, role: null, console: null };
    const device = station(view).find((n) => n.classes.includes('startup-device--watched'));
    const columns = (screen: Screen): string | undefined =>
      sheets.declared(device ?? fail(), 'grid-template-columns', screen)?.value;
    expect(columns(laptop)).toBe('minmax(0, 1fr)');
    expect(columns(sideways)).toBe('minmax(0, 1fr)');
  });
});
