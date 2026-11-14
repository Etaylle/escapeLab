import { MODULES, moduleFor, type PuzzleDef } from '../src/index.js';

/**
 * The Übungshalle (missions/uebungshalle.json), made from the module registry: one hall with a
 * station of every type the lab knows, each in a bay of its own with its rules in a book on the
 * floor beside it and a sign naming the machine and its type, the notice board and the
 * Laborkennung at the entrance, where the crew starts. Its stations are taken in any order, no
 * clock runs, no drone flies, no emergency comes, and the hall's lights burn from the start. It
 * has no hatch: the run is won with the last station, as a practice ends — no siren, no escape
 * across the hall. A module added to the registry gets its bay here by itself: hall.test.ts holds
 * the committed file to what this makes, and writeHall.ts writes it anew (`node --import tsx
 * ../core/test/writeHall.ts`, run from packages/server).
 *
 * The bays stand BAYS_ABREAST to a row, BAY_W × BAY_H tiles each, inside a free strip of floor
 * along the walls; the entrance takes the ENTRANCE rows under the last row of bays. In a bay,
 * from its top left tile:
 *
 *   one console    station (1,1), its book (6,1), a desk (7,1), the sign (3,4)
 *   two consoles   console a (1,1), console b (6,1), the book (4,5), a desk (5,5), the sign (3,3)
 *
 * Every book lies more than 4 tiles from each console it serves, so that nobody stands at both,
 * and every station's places stand 4 tiles or more from the next bay's.
 */

/** The bays a row of the hall holds. */
const BAYS_ABREAST = 4;
/** A bay's size, tiles. */
const BAY_W = 9;
const BAY_H = 7;
/** The rows of floor under the bays: the crew's starts, the sign and the board. */
const ENTRANCE = 3;

type Tile = { x: number; y: number };

/** Where a bay's things stand, from its top left tile. */
interface BayPlan {
  consoles: (Tile & { console?: 'a' | 'b' })[];
  book: Tile;
  desk: Tile;
  sign: Tile;
}

const ONE_CONSOLE: BayPlan = {
  consoles: [{ x: 1, y: 1 }],
  book: { x: 6, y: 1 },
  desk: { x: 7, y: 1 },
  sign: { x: 3, y: 4 },
};

const TWO_CONSOLES: BayPlan = {
  consoles: [
    { x: 1, y: 1, console: 'a' },
    { x: 6, y: 1, console: 'b' },
  ],
  book: { x: 4, y: 5 },
  desk: { x: 5, y: 5 },
  sign: { x: 3, y: 3 },
};

/**
 * The notes of the last shift the hall keeps at a station's rules, by module type: how its
 * machine is learned, never an instance's answer. A type without any keeps none.
 */
const NOTES: Readonly<Partial<Record<PuzzleDef['type'], readonly string[]>>> = {
  wiring: [
    'Einweisung: Erst die Kabel von oben zählen; dann gilt die Liste zu dieser Zahl und ihre ' +
      'erste passende Regel.',
    'Einweisung: Kennung, Leuchten und Zellen stehen auf dem Kennungsschild am Eingang der Halle.',
  ],
  keypad: [
    'Einweisung: Nur eine Spalte der Tafel enthält alle vier Zeichen; dort gilt die Folge von ' +
      'oben nach unten.',
  ],
  switches: [
    'Einweisung: Jeder Schalter hat seine eigene Zeile. Erst alle sechs stellen, dann PRÜFEN.',
    'Einweisung: Für die Zeilen mit „wenn“ zählen Endziffer der Kennung, Zellen und Leuchte SIG.',
  ],
  simon: [
    'Einweisung: Die Kennung wählt die Tabelle, der Alarmstand die Zeile, die blinkende Farbe ' +
      'die Spalte.',
    'Einweisung: Nach einem Alarm gilt die nächste Zeile, und die Stufe beginnt von vorn.',
  ],
  maze: [
    'Einweisung: Nur der Schaltplan zeigt die Wände, das Pult nur den Prüfkopf. Vom Ziel ' +
      'rückwärts ist der Weg kurz.',
  ],
  memory: [
    'Einweisung: Zu jeder Stufe Platz und Ziffer der angenommenen Taste notieren; die Bank ' +
      'zeigt sie später nicht.',
  ],
  morse: [
    'Einweisung: Das Wort beginnt nach der langen Pause. Drei Buchstaben genügen für die ' +
      'Frequenztabelle.',
  ],
  button: [
    'Einweisung: Die Uhr der Halle zählt vorwärts; die gesuchte Ziffer kommt an der letzten ' +
      'Stelle binnen zehn Sekunden.',
  ],
  signal: [
    'Einweisung: Ein Pult zeigt die Folge, das Gegenpult quittiert sie. Es zählen Farbe und ' +
      'Form, nie die Lage der Taste.',
  ],
  circuit: [
    'Einweisung: Der Kasten zeigt Farben, das Prüfpult Spannungen. Nach jedem Schnitt alle ' +
      'ganzen Kabel neu messen.',
  ],
  servers: [
    'Einweisung: Zuerst den Dienst mit E50 vom Strom nehmen, dann von NETZ aus in der Folge ' +
      'des Netzplans hochfahren.',
  ],
  access: [
    'Einweisung: Erst die Tür am Terminal, dann auf der Benutzerliste das Konto, dessen Rolle ' +
      'sie freigibt.',
    'Einweisung: Den Token erst eingeben, wenn das Tokengerät dieses Konto zeigt.',
  ],
};

/** A machine as its printed page's title line names it: „Signalkette, Typ SK-4 (Baujahr 1986)". */
const TITLE_LINE = /^(.+), Typ (\S+) \(Baujahr \d+\)$/;

/**
 * What the lab calls a module's machine and its type designation, read off the title line of
 * its printed page: the name up to „mit" (the Leitungsnetz, not the Leitungsnetz mit
 * Navigationspult) and the type.
 */
export function machineOf(type: PuzzleDef['type']): { name: string; type: string } {
  const puzzleModule = moduleFor(type);
  const def = puzzleModule.defSchema.parse({ type, id: type, title: type });
  const heading = puzzleModule.manual(def)[0]?.heading ?? '';
  const match = TITLE_LINE.exec(heading);
  const [, name, designation] = match ?? [];
  if (name === undefined || designation === undefined) {
    throw new Error(`hall: the printed page of "${type}" opens on no title line („${heading}")`);
  }
  return { name: name.split(' mit ')[0] ?? name, type: designation };
}

/**
 * Every type that stands at a station, in the registry's order: the relay runs only as an
 * emergency.
 */
export function stationTypes(): PuzzleDef['type'][] {
  return MODULES.map((m) => m.type).filter((type): type is PuzzleDef['type'] => type !== 'relay');
}

/** Where the bay of the `n`-th station has its top left tile. */
function bayOrigin(n: number): Tile {
  return { x: 2 + (n % BAYS_ABREAST) * BAY_W, y: 1 + Math.floor(n / BAYS_ABREAST) * BAY_H };
}

const at = (origin: Tile, offset: Tile): Tile => ({
  x: origin.x + offset.x,
  y: origin.y + offset.y,
});

/** One station of the hall, its puzzle and what stands in its bay. */
function bayOf(type: PuzzleDef['type'], n: number) {
  const machine = machineOf(type);
  const plan = moduleFor(type).consoles === 2 ? TWO_CONSOLES : ONE_CONSOLE;
  const origin = bayOrigin(n);
  const book = `anleitung-${type}`;
  return {
    puzzle: { type, id: type, title: machine.name, hints: [...(NOTES[type] ?? [])] },
    stations: plan.consoles.map(({ console, ...spot }) => ({
      puzzleId: type,
      ...at(origin, spot),
      ...(console === undefined ? {} : { console }),
    })),
    manual: {
      id: book,
      kind: 'book',
      label: `ANLEITUNG ${machine.name.toUpperCase()}`,
      puzzleIds: [type],
      spots: [at(origin, plan.book)],
    },
    desk: { kind: 'desk', ...at(origin, plan.desk) },
    label: { text: `${machine.name.toUpperCase()} · ${machine.type}`, ...at(origin, plan.sign) },
  };
}

/** The hall's tiles: walls round a floor of `width` × `height` tiles. */
function hallTiles(width: number, height: number): string[] {
  const wall = '#'.repeat(width);
  const floor = `#${'.'.repeat(width - 2)}#`;
  return [wall, ...Array.from({ length: height - 2 }, () => floor), wall];
}

/** The Übungshalle's mission file, made from the registry. */
export function hallMission(): Record<string, unknown> {
  const bays = stationTypes().map(bayOf);
  const width = 2 + 2 + BAYS_ABREAST * BAY_W;
  const rows = Math.ceil(bays.length / BAYS_ABREAST);
  const entrance = 1 + rows * BAY_H;
  const height = entrance + ENTRANCE + 1;
  const middle = Math.floor(width / 2);
  return {
    id: 'uebungshalle',
    title: 'Übungshalle',
    subtitle: 'Jede Station der Anlage einmal, die Regeln daneben, ohne Uhr',
    listOrder: 25,
    order: 'free',
    lit: true,
    players: { min: 2, max: 3 },
    story: {
      intro:
        'Übungshalle der Forschungsanlage Kaltenbrunn: Jede Maschine der Anlage steht hier ' +
        'einmal, ihre Betriebsanleitung daneben. Keine Uhr läuft, keine Drohne fliegt.',
      win: 'Jede Station abgenommen. Die Halle steht für die nächste Schicht bereit.',
      lose:
        'Die Übung endet vor der letzten Station. Die Halle bleibt für die nächste Schicht offen.',
    },
    timeLimitSec: 0,
    hintDelaySec: 20,
    maxAlarms: null,
    puzzles: bays.map((bay) => bay.puzzle),
    map: {
      tiles: hallTiles(width, height),
      spawns: [-3, 0, 3].map((dx) => ({ x: middle + dx, y: entrance + 1 })),
      stations: bays.flatMap((bay) => bay.stations),
      labels: [{ text: 'ÜBUNGSHALLE', x: middle, y: entrance }, ...bays.map((bay) => bay.label)],
      decor: bays.map((bay) => bay.desk),
      manuals: bays.map((bay) => bay.manual),
      notes: [
        {
          x: middle + 3,
          y: height - 1,
          text: 'Übungshalle · Jede Station steht offen; die Regeln liegen daneben',
        },
      ],
      edgeworkSign: { x: middle - 3, y: entrance + 2 },
    },
  };
}
