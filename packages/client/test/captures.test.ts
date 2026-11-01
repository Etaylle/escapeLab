import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  initialState,
  moduleFor,
  parseMission,
  viewForSpectator,
  type Action,
  type GameState,
  type ManualSection,
  type Mission,
  type ServerRow,
} from '@escapelab/core';
import {
  blockTaken,
  CAPTURE_LINES,
  captureAt,
  edgeworkTaken,
  notable,
  pinnedNoteTaken,
  placeName,
  shiftNotesTaken,
  SIGN,
  type Capture,
} from '../src/noting.js';
import { TERMINAL, terminalTaken } from '../src/puzzles/ServersPanel.js';
import { noteRoom } from '../src/screens/PinnedNote.js';

/**
 * The capture templates on the real Blackout: its four sources as their rules print, the
 * Serverraum's terminal and the Laborkennung as the seed the walkthrough pins (5) deals them —
 * the plan of tools/fixtures/blackout-plan.json — and the notes of the last shift as written.
 * Every capture holds the exact data a player needs there and nothing else, in twelve lines at
 * most with its head.
 */

const MISSIONS = new URL('../../../missions/', import.meta.url);

function missionOf(file: string): Mission {
  return parseMission(JSON.parse(readFileSync(new URL(file, MISSIONS), 'utf8')));
}

const blackout = missionOf('blackout.json');

/** The seed-5 plan the walkthrough carries: the terminal's table, the serial. */
const plan = JSON.parse(
  readFileSync(new URL('../../../tools/fixtures/blackout-plan.json', import.meta.url), 'utf8'),
) as { seed: number; serial: string; subsysteme: { rows: ServerRow[] } };

/** Blackout started on the plan's seed by Anna and Ben, as the walkthrough starts it. */
function started(): GameState {
  const at = 1_700_000_000_000;
  const actions: Action[] = [
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at, seed: plan.seed },
  ];
  return actions.reduce(applyAction, initialState(blackout));
}

/** A station of `mission` by its id: where it stands in the mission, and its printed rules. */
function stationOf(mission: Mission, id: string): { index: number; manual: ManualSection[] } {
  const index = mission.puzzles.findIndex((def) => def.id === id);
  const def = mission.puzzles[index];
  if (def === undefined) {
    throw new Error(`${mission.id} has no station "${id}"`);
  }
  return { index, manual: moduleFor(def.type).manual(def as never) };
}

/** Every capture a source of `mission` offers: each rules list and table of each station. */
function capturesAt(mission: Mission, sourceId: string): Capture[] {
  const source = mission.map.manuals.find((manual) => manual.id === sourceId);
  if (source === undefined) {
    throw new Error(`${mission.id} has no source "${sourceId}"`);
  }
  const place = { id: source.id, name: placeName(source.label) };
  return source.puzzleIds.flatMap((id) => {
    const station = stationOf(mission, id);
    return station.manual.flatMap((section) =>
      section.blocks
        .filter(notable)
        .map((block) => captureAt(place, blockTaken(station, station.manual, section, block))),
    );
  });
}

/** A capture as the notepad shows it: its head over its lines. */
const shown = (capture: Capture): string[] => [capture.head, ...capture.lines];

/** The capture of `sourceId` whose head names `part`. */
function captureOf(sourceId: string, part: string): Capture {
  const found = capturesAt(blackout, sourceId).find((capture) => capture.head.endsWith(part));
  if (found === undefined) {
    throw new Error(`no capture „… · ${part}" at ${sourceId}`);
  }
  return found;
}

describe('captures of Blackout’s sources, as their rules print', () => {
  it('takes the legend at the Klemmbrett: a row a key row, each console’s colour, pattern', () => {
    expect(shown(captureOf('klemmbrett', 'Legende'))).toEqual([
      'Klemmbrett · Legende',
      'Zeile  Pult A  Muster    Pult B  Muster',
      '1      rot     glatt     gelb    Ring',
      '2      blau    Punkte    grün    Streifen',
      '3      grün    Streifen  rot     glatt',
      '4      gelb    Ring      blau    Punkte',
    ]);
    expect(captureOf('klemmbrett', 'Legende').form).toBe('table');
  });

  it('takes the Notstrom’s rules in the Handbuch as numbered lines, word for word', () => {
    const capture = captureOf('buch-archiv', 'Schnittfolge');
    expect(capture.head).toBe('Handbuch · Schnittfolge');
    expect(capture.form).toBe('text');
    expect(capture.lines).toEqual([
      '1. Wenn die Laborkennung gerade endet, wird jeweils das Kabel mit der höchsten ' +
        'gemessenen Spannung getrennt.',
      '2. Wenn die Laborkennung ungerade endet, wird jeweils das Kabel mit der niedrigsten ' +
        'gemessenen Spannung über 0 V getrennt.',
      '3. Wenn kein Kabel mehr Spannung zeigt, ist der Kasten gesichert.',
    ]);
  });

  it('takes the Morsetafel two wide, aligned, with the letters that tell the words apart', () => {
    const capture = captureOf('aktenschrank', 'Morsetafel');
    // The printed table keeps each code's signs together with no-break spaces, and so does this.
    expect(shown(capture).map((line) => line.replaceAll('\u00a0', ' '))).toEqual([
      'Aktenschrank · Morsetafel',
      'A  · −      N  − ·',
      'B  − · · ·  O  − − −',
      'D  − · ·    P  · − − ·',
      'E  ·        Q  − − · −',
      'F  · · − ·  R  · − ·',
      'I  · ·      S  · · ·',
      'K  − · −    T  −',
      'L  · − · ·  U  · · −',
      'M  − −      W  · − −',
    ]);
    // Every word of the Frequenztabelle is known by its first three letters, and each is there.
    const words = captureOf('aktenschrank', 'Frequenztabelle').lines.flatMap((line) =>
      [...line.matchAll(/[A-Z]{5}/g)].map(([word]) => word),
    );
    expect(words).toHaveLength(16);
    const letters = new Set(capture.lines.flatMap((line) => line.match(/\b[A-Z]\b/g) ?? []));
    for (const word of words) {
      expect([...word.slice(0, 3)].every((letter) => letters.has(letter)), word).toBe(true);
    }
    expect([...'CGHJVXYZ'].filter((letter) => letters.has(letter))).toEqual([]);
  });

  it('takes the Frequenztabelle two columns wide, aligned: every word with its frequency', () => {
    expect(shown(captureOf('aktenschrank', 'Frequenztabelle'))).toEqual([
      'Aktenschrank · Frequenztabelle',
      'DIODE  3,545 MHz  MODEM  3,540 MHz',
      'DRAHT  3,515 MHz  MOTOR  3,510 MHz',
      'FUNKE  3,570 MHz  PUMPE  3,555 MHz',
      'KABEL  3,530 MHz  QUARZ  3,580 MHz',
      'KANAL  3,505 MHz  SONDE  3,535 MHz',
      'KETTE  3,560 MHz  SPULE  3,565 MHz',
      'LABOR  3,520 MHz  STROM  3,525 MHz',
      'LAMPE  3,575 MHz  WELLE  3,550 MHz',
    ]);
  });

  it('takes the Spind’s tables of sentences a row a line, and every list apart', () => {
    expect(capturesAt(blackout, 'spind').map((capture) => capture.head)).toEqual([
      'Spind · Netzplan',
      'Spind · Befehl am Terminal',
      'Spind · Code',
      'Spind · Regeln',
    ]);
    expect(shown(captureOf('spind', 'Code'))).toEqual([
      'Spind · Code',
      'Code · Verfahren',
      'E11 · Neustart genügt: start',
      'E23 · Strom aus, dann an, dann start',
      'E42 · Erst jede Abhängigkeit per restart, dann start',
      'E50 · Quarantäne: Strom aus und nie starten — infiziert sonst einen weiteren Dienst',
    ]);
    expect(captureOf('spind', 'Code').form).toBe('text');
    expect(shown(captureOf('spind', 'Netzplan'))).toEqual([
      'Spind · Netzplan',
      'Dienst  hängt ab von',
      'NETZ    —',
      'DNS     NETZ',
      'DB      NETZ',
      'AUTH    NETZ, DNS',
      'WEB     AUTH, DB',
      'MAIL    AUTH, DNS',
    ]);
  });

  it('keeps one capture of each part at a source apart from every other', () => {
    const keys = blackout.map.manuals.flatMap((source) =>
      capturesAt(blackout, source.id).map((capture) => capture.key),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('captures of what the seed deals', () => {
  it('takes the terminal’s table as it opens on seed 5: Dienst, Status, Strom, Braucht', () => {
    const station = stationOf(blackout, 'subsysteme');
    const capture = captureAt(TERMINAL, terminalTaken(station, plan.subsysteme.rows));
    expect(shown(capture)).toEqual([
      'Terminal · Dienste',
      'Dienst  Status      Strom  Braucht',
      'NETZ    RUNNING     AN     —',
      'DNS     RUNNING     AN     NETZ',
      'DB      FEHLER E23  AN     NETZ',
      'AUTH    FEHLER E11  AUS    NETZ, DNS',
      'WEB     FEHLER E42  AUS    AUTH, DB',
      'MAIL    FEHLER E50  AN     AUTH, DNS',
    ]);
    expect(capture.form).toBe('table');
  });

  it('takes the Laborkennung seed 5 deals as one line: serial, control lamps, cells', () => {
    const { edgework } = started();
    if (edgework === null) {
      throw new Error('Blackout dealt no Laborkennung');
    }
    expect(edgework.serial).toBe(plan.serial);
    expect(shown(captureAt(SIGN, edgeworkTaken(edgework)))).toEqual([
      'Schild · Laborkennung',
      'UZKM9-8 · CAR aus, SIG an, NSA aus · 4 Notstromzellen',
    ]);
  });
});

describe('captures of the notes of the last shift', () => {
  it('takes a source’s notes on its station word for word, one a line', () => {
    const kette = stationOf(blackout, 'signalkette');
    const hints = blackout.puzzles[kette.index]?.hints ?? [];
    const capture = captureAt(
      { id: 'klemmbrett', name: 'Klemmbrett' },
      shiftNotesTaken(kette, hints),
    );
    expect(shown(capture)).toEqual([
      'Klemmbrett · Notizen der letzten Schicht',
      'Frühschicht: Jedes Pult quittiert nach seiner eigenen Spalte der Legende. Verwechselt ' +
        'gibt es Alarm.',
      'Haller: Ab Stufe 3 zeigt die Anzeige jedes Zeichen nur kurz. Erst mitschreiben, dann ' +
        'quittieren.',
    ]);
    expect(capture.form).toBe('text');
  });

  it('takes a note pinned up word for word, under the room it hangs in', () => {
    // The audience's map: every note on it, found by the crew or not.
    const { map } = viewForSpectator(started());
    if (map === null) {
      throw new Error('the run shows no map');
    }
    expect(blackout.map.notes.map((_, index) => noteRoom(map, index))).toEqual([
      'FLUR',
      'SERVERRAUM',
      'ARCHIV',
    ]);
    const [first] = blackout.map.notes;
    const capture = captureAt(
      { id: 'zettel', name: 'Zettel' },
      pinnedNoteTaken({ index: 0, text: first?.text ?? '' }, noteRoom(map, 0)),
    );
    expect(shown(capture)).toEqual(['Zettel · Flur', first?.text]);
    expect(noteRoom(map, 9)).toBeNull();
  });
});

describe('every capture there is', () => {
  const missions = readdirSync(MISSIONS)
    .filter((name) => name.endsWith('.json'))
    .map(missionOf);

  it('holds at most twelve lines with its head, in every mission and every source', () => {
    const over = missions.flatMap((mission) =>
      mission.map.manuals.flatMap((source) =>
        capturesAt(mission, source.id)
          .filter((capture) => capture.lines.length > CAPTURE_LINES)
          .map((capture) => `${mission.id}: ${capture.head} (${capture.lines.length + 1})`),
      ),
    );
    expect(missions.length).toBeGreaterThanOrEqual(4);
    expect(over).toEqual([]);
  });

  it('sets a switch bank’s long table a pair of rows a line: with the star and without', () => {
    const bank = missions
      .flatMap((mission) => mission.puzzles.map((def) => ({ mission, def })))
      .find(({ def }) => def.type === 'switches' && 'features' in def && def.features === 3);
    if (bank === undefined) {
      throw new Error('no mission has a switch bank with stars');
    }
    const station = stationOf(bank.mission, bank.def.id);
    const section = station.manual.find((each) => each.heading === 'Stellungstabelle');
    const block = section?.blocks.find(notable);
    if (section === undefined || block?.kind !== 'table') {
      throw new Error('the bank prints no Stellungstabelle');
    }
    const { lines, form } = blockTaken(station, station.manual, section, block);
    expect(block.rows).toHaveLength(16);
    expect(form).toBe('text');
    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe('LED · Markierung · Stern nein · Stern ja');
    expect(lines[1]).toBe('aus · keine · runter · hoch');
    expect(lines[4]).toBe(
      'aus · beides · hoch, wenn SIG leuchtet · hoch, wenn mindestens 2 Zellen',
    );
    // Every combination the table prints is in it: eight rows, two ways each.
    const printed = new Set(block.rows.map((row) => row.join('|')));
    const paired = lines.slice(1).flatMap((line) => {
      const [led, marking, without, withStar] = line.split(' · ');
      return [`${led}|${marking}|nein|${without}`, `${led}|${marking}|ja|${withStar}`];
    });
    expect(new Set(paired)).toEqual(printed);
  });

  it('names its source and the part of it in its head', () => {
    for (const mission of missions) {
      for (const source of mission.map.manuals) {
        for (const capture of capturesAt(mission, source.id)) {
          expect(capture.head, mission.id).toMatch(/^\p{Lu}[\p{L}\- ]* · \S/u);
        }
      }
    }
  });

  it('names a place as the lab does', () => {
    expect(placeName('KLEMMBRETT')).toBe('Klemmbrett');
    expect(placeName('SÜD-FLUR')).toBe('Süd-Flur');
    expect(placeName('KAMMER WEST')).toBe('Kammer West');
  });
});
