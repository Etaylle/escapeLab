import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateEdgework,
  moduleFor,
  puzzleDefSchema,
  type ConsoleId,
  type PuzzleView,
  type RelayView,
} from '@escapelab/core';
import type { Panel as PanelOf } from '../src/puzzles/index.js';

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
const { needleAngle, probedWith, scrambled } = await import('../src/puzzles/CircuitPanel.js');
const { closeAfterSolved, Device, heldView, SOLVED_CLOSE_MS, STRIP_LEDS } = await import(
  '../src/puzzles/Device.js'
);
const { PANELS, SOUNDS } = await import('../src/puzzles/index.js');
const { typedOrder } = await import('../src/puzzles/KeypadPanel.js');
const { knobAngle } = await import('../src/puzzles/MorsePanel.js');
const { FINAL_SECONDS, RelayConsole } = await import('../src/puzzles/RelayPanel.js');
const { HOLD_TICKS } = await import('../src/puzzles/ButtonPanel.js');

type Kind = PuzzleView['kind'];
type ViewOf<K extends Kind> = Extract<PuzzleView, { kind: K }>;

const noop = (): void => undefined;

/** A small deterministic generator, enough to set an instance up. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

/**
 * The open puzzle of `kind` as player p1 sees it at console `seat` of its
 * station, with the def's `fields`, nobody backing p1 up.
 */
function seen<K extends Kind>(
  kind: K,
  fields: Record<string, unknown> = {},
  seat: ConsoleId = 'a',
): ViewOf<K> {
  const def = puzzleDefSchema.parse({ type: kind, id: kind, title: 'Station', ...fields });
  const station = moduleFor(def.type);
  const rng = lcg(7);
  const edgework = generateEdgework(rng);
  const crew = ['p1', 'p2'];
  const setup = {
    edgework,
    alarms: 0,
    remainingSec: 600,
    at: 0,
    crew,
    console: null,
    atConsoles: { a: [], b: [] },
    readers: [],
  };
  const state = station.init(def, rng, setup);
  const viewer = { playerId: 'p1', operating: true, reading: false, console: seat };
  const view = station.view(def, state, viewer, { edgework, alarms: 0, crew, operators: ['p1'] });
  const common = { index: 0, total: 1, title: def.title, manual: null, console: seat };
  return { ...view, ...common, backup: null } as ViewOf<K>;
}

/** A change from `before` to `after` at an open device. */
function changed<V>(before: V, after: V, alarm = false) {
  return { before, after, alarm, seq: 1 };
}

/** The module's panel over `after`, just changed from `before`. */
function panelAfter<K extends Kind>(
  kind: K,
  before: ViewOf<K>,
  after: ViewOf<K>,
  alarm = false,
): string {
  // PANELS is keyed by kind, so the entry for this kind takes exactly this puzzle.
  const Panel = PANELS[kind] as unknown as PanelOf<K>;
  return renderToStaticMarkup(
    <Panel puzzle={after} change={changed(before, after, alarm)} send={noop} deadlineAt={null} />,
  );
}

/** The module's change sounds, played over a change from `before` to `after`. */
function soundsOf<K extends Kind>(kind: K, before: ViewOf<K>, after: ViewOf<K>, alarm = false) {
  const play = SOUNDS[kind] as ((change: ReturnType<typeof changed>) => void) | undefined;
  play?.(changed(before, after, alarm));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the device', () => {
  function device(alarms: number, solved: boolean): string {
    return renderToStaticMarkup(
      <Device
        kind="keypad"
        paragraph="§1"
        title="Tastenfeld"
        tag={null}
        leds={[]}
        alarms={alarms}
        solved={solved}
        press={null}
      >
        <p>Gesicht</p>
      </Device>,
    );
  }

  it('stands calm: its kind only, the face open to presses, a dark strip along its foot', () => {
    const html = device(0, false);
    expect(html.startsWith('<div class="device device--keypad">')).toBe(true);
    expect(html).toContain('<div class="device-face"><p>Gesicht</p></div>');
    const strip = html.match(/<span class="device-strip-led" style="--i:(\d+)"><\/span>/g);
    expect(strip).toHaveLength(STRIP_LEDS);
    expect(html).toContain('<span class="device-strip" aria-hidden="true">');
  });

  it('flashes red and jolts with every alarm, each named apart from the one before', () => {
    expect(device(1, false)).toContain(
      '<div class="device device--keypad device--alarm device--alarm-odd">',
    );
    expect(device(2, false)).toContain('device--alarm device--alarm-even"');
    expect(device(3, false)).toContain('device--alarm device--alarm-odd"');
  });

  it('once solved sweeps its strip green, dims its plate and takes no more presses', () => {
    const html = device(0, true);
    expect(html.startsWith('<div class="device device--keypad device--solved">')).toBe(true);
    expect(html).toContain('<div class="device-face" inert="">');
  });
});

describe('a solved device', () => {
  it('stays in view as it stands done: a sync station with every press in', () => {
    const sync = seen('button-sync');
    expect(heldView(sync, 1)).toMatchObject({ youPressed: true, pressedCount: 2 });
  });

  it('lights every key of a solved keypad and every sign of the Signalkette’s last stage', () => {
    const keypad = seen('keypad');
    const held = heldView(keypad, 1);
    expect(held?.kind === 'keypad' && held.keys?.every((key) => key.lit)).toBe(true);
    expect(held).toMatchObject({ litCount: 4 });
    expect(heldView(seen('signal'), 1)).toMatchObject({ done: 4 });
    const maze = seen('maze');
    expect(heldView(maze, 1)).toBe(maze);
  });

  it('goes at once where it was only closed or walked away from', () => {
    expect(heldView(seen('keypad'), 0)).toBeNull();
    expect(heldView({ ...seen('keypad'), index: 2 }, 2)).toBeNull();
  });

  it(`closes itself ${SOLVED_CLOSE_MS} ms after the solve, unless that is called off`, () => {
    vi.useFakeTimers();
    const close = vi.fn();
    closeAfterSolved(close);
    vi.advanceTimersByTime(SOLVED_CLOSE_MS - 1);
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledTimes(1);
    const kept = vi.fn();
    closeAfterSolved(kept)();
    vi.advanceTimersByTime(2 * SOLVED_CLOSE_MS);
    expect(kept).not.toHaveBeenCalled();
    expect(SOLVED_CLOSE_MS).toBe(800);
  });
});

describe('the fuse box', () => {
  type Circuit = ViewOf<'circuit'>;
  const at = (seat: ConsoleId, change: Partial<Circuit> = {}): Circuit => ({
    ...seen('circuit', { wires: { min: 5, max: 5 } }, seat),
    ...change,
  });
  const cutAt = (box: Circuit, place: number): Circuit => ({
    ...box,
    wires: (box.wires ?? []).map((wire, i) => ({ ...wire, cut: wire.cut || i === place })),
  });
  const rows = (html: string): string[] =>
    html.match(/<button class="circuit-wire [^"]*".*?<\/button>/g) ?? [];

  it('splits a wire as it is cut, its halves falling, sparks off the cut — and crackles', () => {
    const box = at('a');
    const html = panelAfter('circuit', box, cutAt(box, 2));
    const snapped = rows(html).filter((row) => row.includes('circuit-wire--snapped'));
    expect(snapped).toHaveLength(1);
    expect(snapped[0]).toContain('data-index="2"');
    expect(snapped[0]).toContain('<g class="cable-half cable-half--left">');
    expect(snapped[0]).toContain('<g class="cable-half cable-half--right">');
    expect(snapped[0]).toContain('<span class="spark" aria-hidden="true">');
    expect(html.match(/class="spark-bit"/g)).toHaveLength(7);
    soundsOf('circuit', box, cutAt(box, 2));
    expect(sounds.sparkCrackle).toHaveBeenCalledTimes(1);
    expect(sounds.shortArc).not.toHaveBeenCalled();
  });

  it('shows a box opened with a wire cut before as cut, and nothing falling', () => {
    const html = renderToStaticMarkup(
      <PANELS.circuit puzzle={cutAt(at('a'), 2)} change={null} send={noop} deadlineAt={null} />,
    );
    expect(html).not.toMatch(/snapped|class="spark"/);
  });

  it('flashes white for a short, and the rewired board comes back flickering', () => {
    const cut = cutAt(at('a'), 1);
    const shorted = at('a', { shorts: 1, lastResult: 'short' });
    const html = panelAfter('circuit', cut, shorted);
    expect(html).toContain('<span class="circuit-flash" aria-hidden="true"></span>');
    expect(html).toContain('<ol class="circuit-board circuit-board--rewired"');
    // The rewiring makes every wire whole again: that is no cut.
    expect(html).not.toMatch(/snapped|class="spark"/);
    soundsOf('circuit', cut, shorted);
    expect(sounds.shortArc).toHaveBeenCalledTimes(1);
    expect(sounds.sparkCrackle).not.toHaveBeenCalled();
  });

  /** The angle the dial's needle stands at, from its style. */
  const needle = (html: string): number =>
    Number(/<g class="gauge-needle" style="transform:rotate\((-?[\d.]+)deg\)">/.exec(html)?.[1]);

  /** The voltage display's digits, read off its lit segments. */
  function voltage(html: string): string {
    const lit = { abcdef: '0', bc: '1', abdeg: '2', abcdg: '3', bcfg: '4', acdfg: '5' };
    const more = { acdefg: '6', abc: '7', abcdefg: '8', abcdfg: '9', g: '-', '': ' ' };
    const chars: Record<string, string> = { ...lit, ...more };
    const display = [...html.matchAll(/<span class="device-display"[^>]*><svg[^>]*>(.*?)<\/svg>/g)];
    return (display[1]?.[1] ?? '')
      .split('<g ')
      .slice(1)
      .map((cell) => {
        const segments = [...cell.matchAll(/<rect class="seg( seg--on)?"/g)];
        const on = segments.map((s, i) => (s[1] === undefined ? '' : 'abcdefg'.charAt(i)));
        return chars[on.join('')] ?? '?';
      })
      .join('');
  }

  it('swings the needle to a new reading, runs its digits wild and slides its line in', () => {
    const meter = at('b');
    const probed = at('b', { readings: [null, null, 110, null, null], probed: 2 });
    const html = panelAfter('circuit', meter, probed);
    expect(needle(html)).toBe(needleAngle(110));
    expect(html).toContain(
      '<li class="circuit-log-new"><span>Kabel 3</span><span class="circuit-reading">110 V</span>',
    );
    expect(html.match(/circuit-log-new/g)).toHaveLength(1);
    // The first frame of settling: wild digits, not yet the reading.
    expect(voltage(html)).toBe(scrambled('110', 0));
    expect(voltage(html)).not.toBe('110');
    soundsOf('circuit', meter, probed);
    expect(sounds.voltageHum).toHaveBeenCalledWith(110);
  });

  it('plays nothing for a reading that did not change, and hums 0 V as silence', () => {
    const probed = at('b', { readings: [null, null, 110, null, null], probed: 2 });
    expect(probedWith(changed(probed, probed))).toBeNull();
    const html = panelAfter('circuit', probed, probed);
    expect(html).not.toContain('circuit-log-new');
    const dead = at('b', { readings: [0, null, 110, null, null], probed: 0 });
    expect(probedWith(changed(probed, dead))).toEqual({ wire: 0, volts: 0 });
  });

  it('scrambles every digit of a reading into another, frame by frame', () => {
    expect(scrambled('110', 0)).toMatch(/^\d{3}$/);
    expect(scrambled('110', 0)).not.toBe(scrambled('110', 1));
    expect(scrambled('---', 3)).toBe('---');
  });
});

describe('the wiring', () => {
  it('splits the wire just cut, sparks off it and crackles; the pliers snipped at the press', () => {
    const before = seen('wiring');
    const wires = (before.wires ?? []).map((wire, i) => ({ ...wire, cut: i === 1 }));
    const after = { ...before, wires, cutsDone: 1 };
    const html = panelAfter('wiring', before, after);
    expect(html.match(/class="wiring-wire [^"]*wiring-snapped wiring-cut"/g)).toHaveLength(1);
    expect(html.match(/<span class="spark"/g)).toHaveLength(1);
    expect(html.match(/<span class="wiring-cutter"><svg class="pliers"/g)).toHaveLength(
      wires.length - 1,
    );
    soundsOf('wiring', before, after);
    expect(sounds.sparkCrackle).toHaveBeenCalledTimes(1);
    expect(sounds.pliersSnip).not.toHaveBeenCalled();
  });
});

describe('the keypad', () => {
  type Keypad = ViewOf<'keypad'>;
  const lightUp = (pad: Keypad, ...places: number[]): Keypad => ({
    ...pad,
    keys: (pad.keys ?? []).map((key, i) => ({ ...key, lit: key.lit || places.includes(i) })),
    litCount: pad.litCount + places.length,
  });

  it('types the glyph of a key just lit into its display with a blink, and beeps', () => {
    const pad = seen('keypad');
    const after = lightUp(pad, 2);
    const glyph = after.keys?.[2]?.glyph ?? '';
    const html = panelAfter('keypad', pad, after);
    expect(html).toContain(
      `<span class="keypad-cell keypad-cell--in keypad-cell--typed">${glyph}</span>`,
    );
    expect(html).toContain('role="img" aria-label="Eingegeben: 1 von 4"');
    expect(html.match(/keypad-key--fresh/g)).toHaveLength(1);
    soundsOf('keypad', pad, after);
    expect(sounds.typeBlip).toHaveBeenCalledTimes(1);
    soundsOf('keypad', after, after);
    expect(sounds.typeBlip).toHaveBeenCalledTimes(1);
  });

  it('keeps the glyphs in the order they lit, those lit before it opened first', () => {
    const keys = (lit: number[]) =>
      [0, 1, 2, 3].map((i) => ({ glyph: `${i}`, lit: lit.includes(i) }));
    expect(typedOrder([], keys([1, 3]))).toEqual([1, 3]);
    expect(typedOrder([3, 1], keys([0, 1, 3]))).toEqual([3, 1, 0]);
    expect(typedOrder([2], keys([]))).toEqual([]);
  });

  it('shows a player without the keys a mark for every key in, and blinks the newest', () => {
    const watched = { ...seen('keypad'), keys: null, litCount: 1 };
    const html = panelAfter('keypad', { ...watched, litCount: 0 }, watched);
    expect(html).toContain('<span class="keypad-cell keypad-cell--in keypad-cell--typed"></span>');
    expect(html.match(/keypad-cell--in/g)).toHaveLength(1);
  });
});

describe('the switch bank', () => {
  it('clacks as a switch shows flipped, and only then', () => {
    const bank = seen('switches');
    const flipped = {
      ...bank,
      switches: (bank.switches ?? []).map((sw, i) => (i === 0 ? { ...sw, up: !sw.up } : sw)),
    };
    soundsOf('switches', bank, flipped);
    expect(sounds.toggleClack).toHaveBeenCalledTimes(1);
    soundsOf('switches', bank, { ...bank, attempts: 1 });
    expect(sounds.toggleClack).toHaveBeenCalledTimes(1);
  });
});

describe('the memory bank', () => {
  type Memory = ViewOf<'memory'>;
  const at = (stage: number, fields: Partial<Memory> = {}): Memory => ({
    ...seen('memory'),
    stage,
    ...fields,
  });

  it('lights the stage just done with a pop and a chime as the bank moves on', () => {
    const html = panelAfter('memory', at(1), at(2));
    expect(html).toContain('device-lamp device-lamp--green device-lamp--fresh');
    expect(html.match(/device-lamp--fresh/g)).toHaveLength(1);
    expect(html).toContain('<div class="memory-stage" role="img" aria-label="Stufe 2 von 5">');
    soundsOf('memory', at(1), at(2));
    expect(sounds.stageChime).toHaveBeenCalledTimes(1);
  });

  it('flashes the fall back to stage 1, at stage 1 as a fresh layout too', () => {
    expect(panelAfter('memory', at(3), at(1))).toContain(
      '<p class="memory-reset" role="status">Zurück auf Stufe 1</p>',
    );
    const fresh = at(1, { display: ((at(1).display ?? 0) % 4) + 1 });
    expect(panelAfter('memory', at(1), fresh)).toContain('memory-reset');
    soundsOf('memory', at(3), at(1));
    expect(sounds.stageChime).not.toHaveBeenCalled();
  });

  it('says nothing of a fall as it opens', () => {
    const html = renderToStaticMarkup(
      <PANELS.memory puzzle={at(1)} change={null} send={noop} deadlineAt={null} />,
    );
    expect(html).not.toContain('memory-reset');
  });
});

describe('the morse console', () => {
  it('turns its knob over 270° of the band, a detent for every change of the dial', () => {
    expect([0, 7.5, 15].map((dial) => knobAngle(dial, 16))).toEqual([-135, 0, 135]);
    expect(knobAngle(0, 1)).toBe(0);
    const morse = seen('morse');
    soundsOf('morse', morse, { ...morse, dial: morse.dial + 1 });
    expect(sounds.dialDetent).toHaveBeenCalledTimes(1);
    soundsOf('morse', morse, morse);
    expect(sounds.dialDetent).toHaveBeenCalledTimes(1);
  });
});

describe('the maze', () => {
  type Maze = ViewOf<'maze'>;
  const maze = (): Maze & { pos: { x: number; y: number } } => {
    const view = seen('maze');
    if (view.pos === null) {
      throw new Error('expected the navigation console');
    }
    return { ...view, pos: view.pos };
  };

  it('ticks with every step of the marker', () => {
    const here = maze();
    soundsOf('maze', here, { ...here, pos: { x: here.pos.x + 1, y: here.pos.y } });
    expect(sounds.stepTick).toHaveBeenCalledTimes(1);
    expect(sounds.wallThud).not.toHaveBeenCalled();
  });

  it('flashes the marker red and shakes it with a thud at every bump into a wall', () => {
    const here = maze();
    const bumped: Maze = { ...here, lastResult: 'wall' };
    const html = panelAfter('maze', bumped, bumped, true);
    expect(html).toContain('<circle class="maze-marker maze-marker--bump maze-marker--bump-odd"');
    soundsOf('maze', bumped, bumped, true);
    expect(sounds.wallThud).toHaveBeenCalledTimes(1);
    // Against the wall with no alarm coming in, it has bumped into nothing new.
    expect(panelAfter('maze', here, bumped)).not.toContain('maze-marker--bump');
  });
});

describe('the Signalkette', () => {
  type Signal = ViewOf<'signal'>;
  const at = (seat: ConsoleId, fields: Partial<Signal> = {}): Signal => ({
    ...seen('signal', {}, seat),
    ...fields,
  });

  it('pops the lamp of a sign just in, at both consoles, and pops it audibly', () => {
    for (const seat of ['a', 'b'] as const) {
      const html = panelAfter('signal', at(seat, { done: 1 }), at(seat, { done: 2 }));
      expect(html.match(/signal-lamp signal-lamp--lit signal-lamp--fresh/g)).toHaveLength(1);
    }
    soundsOf('signal', at('a', { done: 1 }), at('a', { done: 2 }));
    expect(sounds.lampPop).toHaveBeenCalledTimes(1);
  });

  it('lights the stage just done with a pop and a chime as the next one starts', () => {
    // Stage 1 is sent from console a; stage 2 it takes in.
    const sent = at('a', { done: 3 });
    const next = at('a', { stage: 2, role: 'receiver', sends: 'b', sequence: null, done: 0 });
    const html = panelAfter('signal', sent, next);
    expect(html).toContain('<button class="signal-key"');
    expect(html).toContain('device-lamp device-lamp--green device-lamp--fresh');
    expect(html.match(/device-lamp--fresh/g)).toHaveLength(1);
    soundsOf('signal', sent, next);
    expect(sounds.stageChime).toHaveBeenCalledTimes(1);
    expect(sounds.lampPop).not.toHaveBeenCalled();
  });
});

describe('the sync button', () => {
  type Sync = ViewOf<'button-sync'>;
  const sync = (fields: Partial<Sync> = {}): Sync => ({ ...seen('button-sync'), ...fields });

  it('stomps for a partner’s press, and pops the lamp it lights', () => {
    const html = panelAfter('button-sync', sync(), sync({ pressedCount: 1 }));
    expect(html.match(/device-lamp--fresh/g)).toHaveLength(1);
    soundsOf('button-sync', sync(), sync({ pressedCount: 1 }));
    expect(sounds.mushroomStomp).toHaveBeenCalledTimes(1);
    expect(sounds.lampPop).toHaveBeenCalledTimes(1);
  });

  it('only pops for this player’s own press: its stomp came as the button went down', () => {
    soundsOf('button-sync', sync(), sync({ pressedCount: 1, youPressed: true }));
    expect(sounds.mushroomStomp).not.toHaveBeenCalled();
    expect(sounds.lampPop).toHaveBeenCalledTimes(1);
  });

  it('shakes its collar with a buzz when the window ran out', () => {
    const missed = sync({ attempts: 1, lastResult: 'missed-window' });
    expect(panelAfter('button-sync', sync({ pressedCount: 1 }), missed)).toContain(
      '<div class="sync-collar sync-collar--missed">',
    );
    soundsOf('button-sync', sync({ pressedCount: 1 }), missed);
    expect(sounds.rejectBuzz).toHaveBeenCalledTimes(1);
  });

  it('leaves the main switch as built: it sounds nothing of its own at a change', () => {
    const lever = sync({ style: 'lever' });
    soundsOf('button-sync', lever, { ...lever, pressedCount: 1 });
    const played = Object.values(sounds).filter(
      (sound) => vi.isMockFunction(sound) && sound.mock.calls.length > 0,
    );
    expect(played).toEqual([]);
  });
});

describe('the big button', () => {
  it('puts hold-time ticks on its strip while it is held, none lit as the hold starts', () => {
    const button = seen('button');
    const html = renderToStaticMarkup(
      <PANELS.button
        puzzle={{ ...button, holding: true }}
        change={null}
        send={noop}
        deadlineAt={null}
      />,
    );
    expect(html.match(/<span class="button-tick"><\/span>/g)).toHaveLength(HOLD_TICKS);
    expect(html).toContain('data-feel="none"');
    const released = renderToStaticMarkup(
      <PANELS.button puzzle={button} change={null} send={noop} deadlineAt={null} />,
    );
    expect(released).not.toContain('button-ticks');
  });
});

describe('the relay console', () => {
  const relay = (left: number): RelayView => ({
    kind: 'relay',
    controls: [
      { id: 'k', name: 'Kryo-Puffer', kind: 'dial', value: 2 },
      { id: 'f', name: 'Faradaykäfig', kind: 'switch', value: false },
    ],
    instruction: {
      playerName: 'Ben',
      control: 'Kryo-Puffer',
      value: 3,
      expiresAt: Date.now() + left,
    },
    windowSec: 15,
    completed: 1,
    required: 6,
    endsAt: Date.now() + 40_000,
  });

  it('counts the instruction down in digits, red and pulsing over its last five seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const calm = renderToStaticMarkup(
      <RelayConsole relay={relay(12_000)} send={noop} refusals={0} />,
    );
    expect(calm).toContain(
      '<span class="relay-count" role="timer" aria-label="noch 12 Sekunden">12',
    );
    const lastSeconds = relay(FINAL_SECONDS * 1000);
    const late = renderToStaticMarkup(
      <RelayConsole relay={lastSeconds} send={noop} refusals={0} />,
    );
    expect(late).toContain('<span class="relay-count relay-count--final" role="timer"');
    expect(late).toContain('>05</span>');
  });

  it('clacks its switches and catches its dials, as their data-feel says', () => {
    vi.useFakeTimers();
    const html = renderToStaticMarkup(
      <RelayConsole relay={relay(12_000)} send={noop} refusals={0} />,
    );
    expect(html).toContain('<button class="relay-switch " data-feel="clack"');
    expect(html.match(/data-feel="detent"/g)).toHaveLength(5);
  });
});
