import { describe, expect, it } from 'vitest';
import { applyAction, MODULES, moduleFor, viewFor, viewForSpectator } from '../src/index.js';
import type { ConsoleId, PuzzleContext } from '../src/index.js';
import { mulberry32 } from '../src/rng.js';
import { consoleLab, lightsOut, standing, started, T0 } from './lab.js';
import { offVoice, PAPERS, WORLD } from './voice.js';

/**
 * The line engraved in the head of every station's console (the module's `plate`): what the
 * machine there does, with its machine named as the subject — a bare „Trennt Kabel …" reads as
 * an order to the crew in German, and an engraving drops nothing a reader could take for one
 * —, on one line, in the voice of the lab's papers, giving nothing away. Every mission's devices
 * carry it, the tutorial's included, since it hangs on the def alone.
 */

/** The longest line, in characters, that fits a device's head at the largest text size. */
const LINE_MAX = 56;

/** The def variants a plate may follow: only a sync station's look changes its machine. */
const VARIANTS: Record<string, object[]> = { 'button-sync': [{}, { style: 'lever' }] };

/** A neutral moment for setting up a module; the plate needs none. */
const SETUP: PuzzleContext = {
  edgework: { serial: 'K7G3B-2', indicators: [], cells: 1 },
  alarms: 0,
  remainingSec: 600,
  at: 0,
  crew: ['p0', 'p1'],
  console: null,
  atConsoles: { a: [], b: [] },
  readers: [],
};

interface Plate {
  label: string;
  type: string;
  def: object;
  console: ConsoleId;
  text: string;
}

/** Every station module's plates: each variant, each console. */
const plates: Plate[] = MODULES.filter((m) => m.type !== 'relay').flatMap((m) => {
  const station = moduleFor(m.type);
  const consoles: ConsoleId[] = station.consoles === 2 ? ['a', 'b'] : ['a'];
  return (VARIANTS[m.type] ?? [{}]).flatMap((variant) => {
    const def = station.defSchema.parse({ type: m.type, id: m.type, title: 'T', ...variant });
    return consoles.map((console) => ({
      label: `${m.type} ${JSON.stringify(variant)} at ${console}`,
      type: m.type,
      def,
      console,
      text: station.plate(def, console),
    }));
  });
});

describe('the plates in the devices’ heads', () => {
  it('engrave a line for every console of every station module', () => {
    const types = new Set(plates.map((plate) => plate.type));
    expect(types).toEqual(new Set(MODULES.map((m) => m.type).filter((type) => type !== 'relay')));
    expect(plates.filter((plate) => plate.text.trim() === '').map((p) => p.label)).toEqual([]);
  });

  it.each(plates)('$label names its machine and says what it does', ({ text }) => {
    expect(text).toMatch(/^((Der|Das|Die) \p{Lu}\p{L}*|Pult [AB]) \p{Ll}+t /u);
  });

  it.each(plates)(`$label keeps to one line of ${LINE_MAX} characters at most`, ({ text }) => {
    expect(text).not.toMatch(/[\n.!?:;]/);
    expect([...text].length).toBeLessThanOrEqual(LINE_MAX);
  });

  it.each(plates)('$label speaks of the machine and never to anybody', ({ text }) => {
    expect(offVoice([text], PAPERS)).toEqual([]);
    expect(offVoice([text], WORLD)).toEqual([]);
  });

  it.each(plates)('$label gives nothing away: no number, colour or condition', ({ text }) => {
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/\b(rot|blau|gelb|grün|weiß|schwarz|orange|violett)\w*/i);
    expect(text).not.toMatch(/\b(wenn|falls|sobald|solange|erst|zuerst|dann|danach|nur)\b/i);
  });

  it('tells the two consoles of a station apart', () => {
    const twoConsoles = plates.filter((plate) => plate.console === 'b');
    expect(twoConsoles.map((plate) => plate.type).sort()).toEqual(['circuit', 'servers', 'signal']);
    for (const b of twoConsoles) {
      const a = plates.find((plate) => plate.type === b.type && plate.console === 'a');
      expect(a?.text).not.toBe(b.text);
    }
  });

  it('tells the main switch from the sync button by its look', () => {
    const sync = plates.filter((plate) => plate.type === 'button-sync').map((p) => p.text);
    expect(new Set(sync).size).toBe(2);
  });

  it.each(plates)('$label hangs on the def alone: no copy and no run changes it', (plate) => {
    const station = moduleFor(plate.type as never);
    expect(station.plate(structuredClone(plate.def) as never, plate.console)).toBe(plate.text);
    for (let seed = 0; seed < 3; seed++) {
      station.init(plate.def as never, mulberry32(seed), SETUP);
      expect(station.plate(plate.def as never, plate.console)).toBe(plate.text);
    }
  });
});

describe('the view of an open station', () => {
  it('carries the plate of the console the viewer stands at, and none for anybody else', () => {
    // The Signalkette switched on: p1 at console a, p2 at console b, p3 at the book.
    const lab = lightsOut(started(consoleLab(3)));
    const here = standing(lab, {
      stations: { kette: ['p1'], 'kette/b': ['p2'] },
      manuals: { buch: ['p3'] },
    });
    const state = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 100 });
    const def = state.mission.puzzles[0];
    if (def === undefined) {
      throw new Error('the lab has the Signalkette first');
    }
    const signal = moduleFor(def.type);
    expect(viewFor(state, 'p1').puzzle?.plate).toBe(signal.plate(def, 'a'));
    expect(viewFor(state, 'p2').puzzle?.plate).toBe(signal.plate(def, 'b'));
    expect(viewFor(state, 'p3').puzzle?.plate).toBeNull();
    expect(viewForSpectator(state).puzzle?.plate).toBeNull();
  });
});
