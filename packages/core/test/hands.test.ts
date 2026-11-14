import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, moduleFor, parseMission, placesOf, viewFor } from '../src/index.js';
import type { GameState, Mission, PlayerView } from '../src/index.js';
import {
  chamberLab,
  consoleLab,
  handsTaken,
  lightsOut,
  lineDrops,
  standing,
  started,
  T0,
} from './lab.js';

const missionsDir = new URL('../../../missions/', import.meta.url);

/** A shipped mission, by its file's name. */
function shipped(id: string): Mission {
  return parseMission(JSON.parse(readFileSync(new URL(`${id}.json`, missionsDir), 'utf8')));
}

const blackout = shipped('blackout');
const doppelpultZwei = consoleLab(2, 'doppelpult-zwei');
const doppelpultDrei = consoleLab(3, 'doppelpult-drei');
const kammerDrei = chamberLab();

/** How many hands each station of `mission` puts to work at once for its largest crew, by id. */
function handsAt(mission: Mission): Record<string, number> {
  const crew = mission.players.max;
  return Object.fromEntries(mission.puzzles.map((def) => [def.id, handsTaken(mission, def, crew)]));
}

describe('the places of a station', () => {
  it('are its consoles, the sources covering it, the plates it holds, the parts it needs', () => {
    expect(placesOf(blackout, 'notstrom')).toEqual([
      { kind: 'console', console: 'a' },
      { kind: 'console', console: 'b' },
      { kind: 'source', id: 'buch-archiv' },
      { kind: 'plate', id: 'flurplatte' },
    ]);
    expect(placesOf(blackout, 'frequenz')).toEqual([
      { kind: 'console', console: 'a' },
      { kind: 'source', id: 'aktenschrank' },
      { kind: 'part', id: 'schluessel' },
    ]);
    expect(placesOf(blackout, 'reaktorstart')).toEqual([
      { kind: 'console', console: 'a' },
      { kind: 'part', id: 'ersatzsicherung' },
    ]);
  });

  it('leave out a plate that holds a drone still, and one that holds no door of its own', () => {
    // The camera plate freezes the Flur's drone while the Serverraum is up: no door's plate.
    expect(placesOf(blackout, 'subsysteme')).toEqual([
      { kind: 'console', console: 'a' },
      { kind: 'console', console: 'b' },
      { kind: 'source', id: 'spind' },
    ]);
    expect(placesOf(blackout, 'signalkette').map((place) => place.kind)).not.toContain('plate');
  });

  it('give a cabinet’s key to the first station the cabinet covers, and to no later one', () => {
    const manuals = blackout.map.manuals.map((manual) =>
      manual.id === 'aktenschrank' ? { ...manual, puzzleIds: ['subsysteme', 'frequenz'] } : manual,
    );
    const shared = { ...blackout, map: { ...blackout.map, manuals } };
    expect(placesOf(shared, 'subsysteme')).toContainEqual({ kind: 'part', id: 'schluessel' });
    expect(placesOf(shared, 'frequenz')).not.toContainEqual({ kind: 'part', id: 'schluessel' });
  });
});

describe('a place for every hand', () => {
  it('Blackout: every station puts a crew of three to work at once', () => {
    expect(handsAt(blackout)).toEqual({
      notlicht: 3,
      notstrom: 4,
      signalkette: 3,
      subsysteme: 3,
      frequenz: 3,
      reaktorstart: 4,
    });
  });

  const full = [blackout, shipped('systemcheck'), doppelpultZwei, kammerDrei];
  it.each(full.map((mission) => [mission.id, mission] as const))(
    '%s: every station takes its largest crew at once',
    (_id, mission) => {
      const short = Object.entries(handsAt(mission)).filter(([, n]) => n < mission.players.max);
      expect(short).toEqual([]);
    },
  );

  it('the Systemcheck and the labs, station by station', () => {
    expect(handsAt(shipped('systemcheck'))).toEqual({
      init: 2,
      signalprobe: 3,
      doppelbestaetigung: 2,
      synchronkalibrierung: 2,
    });
    expect(handsAt(doppelpultZwei)).toEqual({ kette: 3, kabel: 2 });
    expect(handsAt(kammerDrei)).toEqual({ kabel: 3 });
  });

  it('Kettenreaktion and Doppelschicht as they stand: most stations take two (backlog N-6)', () => {
    // A crew of three in Kettenreaktion, of four in the Doppelschicht: at a station of one
    // console the third and the fourth find no place of their own — nothing to read for
    // them, no part, no plate held until it is solved.
    expect(handsAt(shipped('kettenreaktion'))).toEqual({
      lastverteilung: 2,
      kuehlkreislauf: 2,
      freigabecode: 2,
      resonanz: 2,
      leitungsnetz: 2,
      abschaltung: 4,
    });
    expect(handsAt(shipped('doppelschicht'))).toEqual({
      notstrom: 2,
      zugangscode: 2,
      kuehlung: 2,
      funkfeuer: 2,
      leitungsnetz: 3,
      druckausgleich: 2,
      notaus: 4,
    });
  });

  it('the console lab of three as it stands, the labs\' one exception: its box takes two', () => {
    // Kept as it is (M-three, the lead's call; backlog N-6): a lab for the station of two
    // consoles, whose wiring box after the chain keeps the backup rule's two places — console and
    // book — for a crew of three. Eight test files feed on the lab as it stands.
    expect(handsAt(doppelpultDrei)).toEqual({ kette: 3, kabel: 2 });
  });
});

/**
 * Blackout for a crew of `size` on the harness's seed, its lights out, the crew moved on to the
 * station of `puzzleId` as if every one before it were solved.
 */
function atStation(puzzleId: string, size = 3): GameState {
  const state = lightsOut(started(blackout, 5, T0, size));
  return { ...state, currentPuzzleIndex: blackout.puzzles.findIndex((p) => p.id === puzzleId) };
}

/** The hands as `p1`'s view tells them. */
const handsIn = (state: GameState): PlayerView['hands'] => viewFor(state, 'p1').hands;

/** The place each of the crew holds, by id, as the view tells it. */
function heldIn(state: GameState): Record<string, unknown> {
  return Object.fromEntries((handsIn(state)?.held ?? []).map((hand) => [hand.playerId, hand.place]));
}

const A = { kind: 'console', console: 'a' } as const;
const B = { kind: 'console', console: 'b' } as const;

describe('the hands at the station in front of the crew', () => {
  it('are left out for a crew of two, before the lights go out, and once no station is up', () => {
    expect(handsIn(atStation('notlicht', 2))).toBeUndefined();
    expect(handsIn(started(blackout, 5, T0, 3))).toBeUndefined();
    expect(handsIn(atStation('notlicht'))).toBeDefined();
    const over = applyAction(atStation('notlicht'), { type: 'time-expired', at: T0 + 2_000_000 });
    expect(handsIn(over)).toBeUndefined();
    expect(handsIn(atStation('nirgends'))).toBeUndefined();
  });

  it('count the crew the run counts: none once it goes on without the third', () => {
    const state = atStation('notlicht');
    const without = { ...state, away: { p3: { since: T0, waivableAt: T0, waived: true } } };
    expect(handsIn(without)).toBeUndefined();
  });

  it('put the whole crew at the main switch, which waits for whoever is not there yet', () => {
    const all = standing(atStation('notlicht'), { stations: { notlicht: ['p1', 'p2', 'p3'] } });
    expect(handsIn(all)).toEqual({
      held: [
        { playerId: 'p1', place: A },
        { playerId: 'p2', place: A },
        { playerId: 'p3', place: A },
      ],
      open: [],
    });
    const two = standing(atStation('notlicht'), { stations: { notlicht: ['p3', 'p1'] } });
    expect(heldIn(two)).toEqual({ p1: A, p2: null, p3: A });
    expect(handsIn(two)?.open).toEqual([A]);
  });

  it('name the box, the meter and the plate held at the Notstrom, the book once it is known', () => {
    const where = {
      stations: { notstrom: ['p1'], 'notstrom/b': ['p2'] },
      plates: { flurplatte: ['p3'] },
    };
    const manned = standing(atStation('notstrom'), where);
    expect(heldIn(manned)).toEqual({ p1: A, p2: B, p3: { kind: 'plate', id: 'flurplatte' } });
    // Nobody has come across the book yet: no place to name.
    expect(handsIn(manned)?.open).toEqual([]);
    const found = standing(atStation('notstrom'), { ...where, found: { p2: ['source:buch-archiv'] } });
    expect(handsIn(found)?.open).toEqual([{ kind: 'source', id: 'buch-archiv' }]);
    const reading = standing(found, { stations: where.stations, manuals: { 'buch-archiv': ['p3'] } });
    expect(heldIn(reading)).toMatchObject({ p3: { kind: 'source', id: 'buch-archiv' } });
    expect(handsIn(reading)?.open).toEqual([{ kind: 'plate', id: 'flurplatte' }]);
  });

  it('name whoever is away only where their avatar holds a plate or a part still', () => {
    const away = applyAction(atStation('notstrom'), lineDrops('p3', T0 + 1000));
    expect(heldIn(away)).toEqual({ p1: null, p2: null });
    const holding = standing(away, { plates: { flurplatte: ['p3'] } });
    const plate = { kind: 'plate', id: 'flurplatte' };
    expect(heldIn(holding)).toEqual({ p1: null, p2: null, p3: plate });
  });

  it('take a plate that holds a door not open for good, or a drone, as a job — no other', () => {
    // At the Signalkette the Maschinenraum's door is open for good; the camera plate holds a drone.
    const idle = standing(atStation('signalkette'), { plates: { flurplatte: ['p3'] } });
    expect(heldIn(idle)).toMatchObject({ p3: null });
    const camera = standing(atStation('signalkette'), { plates: { kameraplatte: ['p3'] } });
    expect(heldIn(camera)).toMatchObject({ p3: { kind: 'plate', id: 'kameraplatte' } });
  });

  it('name a part in hand, and one to fetch once found — a key once its cabinet is too', () => {
    const key = { kind: 'part', id: 'schluessel' } as const;
    const station = atStation('frequenz');
    const keyFound = standing(station, { found: { p2: ['item:schluessel'] } });
    expect(handsIn(keyFound)?.open).not.toContainEqual(key);
    const both = standing(station, {
      found: { p2: ['item:schluessel'], p1: ['source:aktenschrank'] },
    });
    expect(handsIn(both)?.open).toEqual([A, { kind: 'source', id: 'aktenschrank' }, key]);
    const lying = both.items['schluessel'] ?? { x: 0, y: 0, carriedBy: null, delivered: false };
    const carried = { ...both, items: { ...both.items, schluessel: { ...lying, carriedBy: 'p3' } } };
    expect(heldIn(carried)).toMatchObject({ p3: key });
    expect(handsIn(carried)?.open).not.toContainEqual(key);
    const used = { ...both, items: { ...both.items, schluessel: { ...lying, delivered: true } } };
    expect(handsIn(used)?.open).not.toContainEqual(key);
  });
});

/** Every key of `value`, however deep. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => keysOf(item, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.add(key);
      keysOf(item, out);
    }
  }
  return out;
}

/** Every string in `value`, however deep. */
function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => stringsOf(item, out));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => stringsOf(item, out));
  }
  return out;
}

/** What the hands may carry: who, and places by kind, console and id — nothing else. */
const HAND_KEYS = new Set(['held', 'open', 'playerId', 'place', 'kind', 'console', 'id']);

describe('what the hands carry', () => {
  it('places alone, as ids: the rules reach the reader alone, whoever the hands name', () => {
    const working = standing(atStation('signalkette'), {
      stations: { signalkette: ['p1'], 'signalkette/b': ['p2'] },
      manuals: { klemmbrett: ['p3'] },
      found: { p3: ['source:klemmbrett'] },
    });
    const state = applyAction(working, { type: 'interact', playerId: 'p1', at: T0 + 10 });
    const def = blackout.puzzles.find((p) => p.id === 'signalkette');
    if (state.puzzleState === null || def === undefined) {
      throw new Error('the Signalkette is not switched on');
    }
    // Every sentence of the printed rules long enough to tell apart.
    const rules = stringsOf(moduleFor(def.type).manual(def)).filter((s) => s.length >= 24);
    expect(rules.length).toBeGreaterThan(0);
    for (const id of ['p1', 'p2', 'p3']) {
      const view = viewFor(state, id);
      expect([...keysOf(view.hands)].filter((key) => !HAND_KEYS.has(key)), id).toEqual([]);
      const wire = JSON.stringify(view);
      const read = rules.filter((rule) => wire.includes(JSON.stringify(rule).slice(1, -1)));
      expect(read.length > 0, id).toBe(id === 'p3');
    }
  });

  it('name no source or part nobody has found, at any of Blackout\'s stations', () => {
    const unfound = /aktenschrank|schluessel|spind|klemmbrett|buch-archiv|ersatzsicherung/;
    for (const def of blackout.puzzles) {
      const state = atStation(def.id);
      for (const id of ['p1', 'p2', 'p3']) {
        const hands = JSON.stringify(viewFor(state, id).hands ?? null);
        expect(hands, `${def.id} ${id}`).not.toMatch(unfound);
      }
    }
  });

  it('name a key found nowhere while nobody has come across its cabinet', () => {
    const keyOnly = standing(atStation('frequenz'), { found: { p2: ['item:schluessel'] } });
    for (const id of ['p1', 'p2', 'p3']) {
      expect(JSON.stringify(viewFor(keyOnly, id).hands), id).not.toContain('schluessel');
    }
  });
});
