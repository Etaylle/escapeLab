import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission, placesOf } from '../src/index.js';
import type { Mission } from '../src/index.js';
import { chamberLab, consoleLab, handsTaken } from './lab.js';

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

  it('the console lab of three as it stands: its box after the chain takes two', () => {
    // A lab for the station of two consoles; the wiring box after it keeps the backup rule's
    // two, which every test built on the lab relies on.
    expect(handsAt(doppelpultDrei)).toEqual({ kette: 3, kabel: 2 });
  });
});
