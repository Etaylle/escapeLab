import { achievementsOf, type AchievementId } from './achievements.js';
import type { DailyDay } from './daily.js';
import type { Difficulty } from './difficulty.js';
import {
  consoleFind,
  crewFound,
  findKey,
  findOf,
  labLit,
  type Discovery,
  type Find,
} from './discovery.js';
import type { Edgework } from './edgework.js';
import type {
  DecorKind,
  ManualDef,
  ManualKind,
  MapDef,
  Mission,
  RoomKind,
} from './mission.js';
import { noteKey } from './notes.js';
import { CREW_COLORS, type Credits, type GameState, type Phase, type RunEvent } from './state.js';
import { moduleFor, type PuzzleView } from './puzzles/index.js';
import { clockStartOf, runReport } from './report.js';
import type { ConsoleId, ManualSection, Viewer, ViewContext } from './puzzles/module.js';
import { relayDefFor, relayModule, type RelayDef, type RelayView } from './puzzles/relay.js';
import {
  backupsOf,
  consoleOf,
  doorOpen,
  lightsAreOut,
  operatorsOf,
  platePressed,
  readersOf,
  sourceOpen,
} from './map.js';

/**
 * What a single player is allowed to see. Asymmetric information is enforced
 * here, on the server side: what a player sees depends on where they stand.
 * The instance at a station, the printed rules at a manual object and the
 * edgework on the sign never reach a client that is not there, so no amount
 * of DevTools digging can leak them.
 */
export interface PlayerView {
  phase: Phase;
  missionId: string;
  missionTitle: string;
  difficulty: Difficulty;
  storyText: string;
  /** how many play the mission; a run starts with any count from min to max */
  crewSize: { min: number; max: number };
  you: {
    id: string;
    name: string;
    color: string;
    ready: boolean;
    isHost: boolean;
  };
  players: {
    id: string;
    name: string;
    color: string;
    ready: boolean;
    connected: boolean;
    isHost: boolean;
  }[];
  /** crew colors and who holds them, for the lobby picker */
  palette: { color: string; takenByName: string | null }[];
  deadlineAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  timeLimitSec: number;
  /** whether the lights are out, and since when (epoch ms); see `Lights` */
  lights: Lights;
  /** solved puzzles so far (== index of the current one); independent of station activation */
  currentPuzzleIndex: number;
  puzzleCount: number;
  /** set while the run is frozen because a crew member is missing */
  pausedFor: string[] | null;
  /**
   * since when the run stands frozen, epoch ms; null while it runs. The mission clock stands
   * at it — the pause moves every deadline on by its length once it is over
   */
  pausedAt: number | null;
  /** the run report, filled in as the mission goes on */
  events: RunEvent[];
  /** only once the mission is over */
  grade: Grade | null;
  /** increments on every penalty; clients key alarm effects off it */
  penaltySeq: number;
  lastPenaltySec: number | null;
  /**
   * the alarms so far and how many end the run — the one that reaches the
   * limit loses it; null where the mission has none
   */
  alarms: { count: number; limit: number | null };
  /** notes of the last shift bought this run; they weigh on the grade */
  hintsUsed: number;
  /** who did what this run, by player id — for the end screen */
  credits: Record<string, Credits>;
  /** the lab's serial, lamps and cells — only once this player has read the sign */
  edgework: Edgework | null;
  /** where this player stands right now */
  presence: PlayerPresence;
  /** the manual objects this player stands at, open or still closed: what can be done there */
  sourcesHere: SourceHere[];
  /** the open manual objects this player stands at, with the rules of every puzzle they cover */
  manualsHere: ManualHere[];
  /** the note of the last shift this player stands at, with its words; null away from every one */
  noteHere: NoteHere | null;
  puzzle: PuzzleView | null;
  /** tile map while a mission is running; null otherwise */
  map: MapView | null;
  /**
   * Only in a room a tester pinned to a seed: that seed, and the one this run
   * plays (null before the first run and back in the lobby), which `?seed=`
   * plays again. A room that rolls its own keeps them to itself: a run's seed
   * gives every instance away.
   */
  seed?: { room: number; run: number | null };
  /**
   * The Tagesschicht, where the mission offers one (`Mission['daily']`): whether the host has
   * it on, and the UTC day whose seed the run plays (daily.ts) once one has started on it —
   * null in the lobby, where the switch names today. Left out where none is offered.
   */
  daily?: { on: boolean; day: DailyDay | null };
  /** the Erfolge the run earned, once it is over (achievements.ts); left out before its end */
  achievements?: AchievementId[];
  /**
   * The mission a won run of this one leads on to, by its catalog id — the
   * end screen offers it; left out where none follows.
   */
  nextMissionId?: string;
  /** the run's opening while the lab still has its power (`IntroView`); left out without one */
  intro?: IntroView;
}

/**
 * A mission's intro as every screen plays it (client world/intro/): the location card's lines,
 * what the plant's loudspeakers say, when the lights fail by themselves, and who of the crew
 * has seen enough of it — the skip each screen counts.
 */
export interface IntroView {
  /** the wing of the plant the run plays in; '' where the mission names none */
  place: string;
  /** the card's last line, the shift and the time; '' where the mission names none */
  time: string;
  /** mission control's announcement over the lab's loudspeakers, line by line */
  pa: string[];
  /** seconds from the start until the lights fail by themselves */
  lightsSec: number;
  /** who of the crew has seen enough of it this run, by player id */
  done: string[];
}

/**
 * The lab's power. A mission with an intro starts with it on — lit, the
 * clock standing still, no station armed — until the lights fail; one
 * without is out from the start. Out stays out for the rest of the run.
 */
export interface Lights {
  out: boolean;
  /** epoch ms the lights went out; null while they are on */
  outAt: number | null;
}

export interface PlayerPresence {
  /** puzzle id of the station this player stands at */
  stationId: string | null;
  /** the console of that station they stand at: 'a' where it has one; null with no station */
  console: ConsoleId | null;
  /** id of the open manual object this player reads at */
  manualId: string | null;
  /** has walked up to the edgework sign this run */
  signSeen: boolean;
}

/** A manual object where the player stands: a locker still to search, a cabinet to unlock. */
export interface SourceHere {
  id: string;
  kind: ManualKind;
  label: string;
  /** readable: books, terminals, charts and clipboards always, lockers and cabinets once opened */
  opened: boolean;
  /** the item that unlocks it, by id — a cabinet's key; null for everything else */
  needsKey: string | null;
}

/**
 * An open manual object as read on the spot. Printed rules are no secret —
 * the Handbuch screen prints them all — so they come whole, in mission
 * order. Beside the open station's rules lie the notes of the last shift.
 */
export interface ManualHere {
  id: string;
  label: string;
  kind: ManualKind;
  sections: {
    puzzleId: string;
    /** position in the mission from 0, like `currentPuzzleIndex` */
    index: number;
    title: string;
    manual: ManualSection[];
    /** the notes asked for so far — for the open station only, empty for every other */
    notes: string[];
    /** epoch ms from when the next note may be asked for; null when there is none to ask for */
    noteReadyAt: number | null;
    /** how many more notes there are; 0 unless this is the open station */
    notesLeft: number;
    /** seconds the next note costs, already scaled to the difficulty */
    costSec: number;
  }[];
}

/** A note of the last shift as read on the spot: which of the map's it is, and what it says. */
export interface NoteHere {
  /** its index among the map's notes: what a read names */
  index: number;
  text: string;
}

/**
 * A thing the crew knows of, as a view tells it whole (discovery.ts): somebody of the crew has
 * found it — or, a station's spot, it is the armed one, the objective every view shares. The
 * audience knows everything.
 */
export interface Known {
  /** this player has found it */
  found: boolean;
  known: true;
}

/**
 * A thing nobody has found, in this player's sight — or anywhere, while the power lights the
 * whole lab (discovery.ts `labLit`): the view tells what it is and where, no more.
 */
export interface Glimpse {
  seen: true;
  found: false;
  known: false;
}

/** Which console a station spot is, and how it looks. */
export interface StationSpotLook {
  /** which console the spot is; left out where the station has one */
  console?: ConsoleId;
  /**
   * a main switch with a lever for each of the crew, or a fuse box — where
   * a wrong cut shorts it out, the world's sparks fly; left out for a console
   */
  look?: 'lever' | 'fusebox';
}

/** A part's look: a fuse cartridge, a key, or a crate for anything else. */
export type PartKind = 'fuse' | 'key' | 'crate';

/** A part's look, told from its label: a „Sicherung" is a fuse, a „Schlüssel" a key. */
export function partKind(label: string): PartKind {
  if (/sicherung/i.test(label)) {
    return 'fuse';
  }
  return /schl(?:ü|ue)ssel/i.test(label) ? 'key' : 'crate';
}

/**
 * Static world + authoritative door/plate/station state. Live avatar
 * positions travel separately (client-authoritative, streamed as
 * `positions` messages) and are not part of this view.
 */
export interface MapView {
  width: number;
  height: number;
  tiles: string[];
  /** the spawn this player drew — the client simulates movement from here */
  yourSpawn: { x: number; y: number };
  doors: { id: string; x: number; y: number; open: boolean }[];
  plates: {
    id: string;
    x: number;
    y: number;
    label: string;
    pressed: boolean;
    /** holding it freezes a drone: a camera plate */
    freezesDrone: boolean;
  }[];
  /**
   * one entry per spot — a station with two consoles has two, the same puzzle at both: whole
   * for the armed station, the objective every view shares, and for a spot the crew has found;
   * of any other only which station's spot it is, its console and look, and where, while it is
   * in sight
   */
  stations: (
    | ({
        puzzleId: string;
        x: number;
        y: number;
        title: string;
        status: 'done' | 'armed' | 'locked';
      } & StationSpotLook &
        Known)
    | ({ puzzleId: string; x: number; y: number } & StationSpotLook & Glimpse)
  )[];
  /**
   * the manual objects of the run this player can make out: whole where the crew has come
   * across them (`known`) — where this run placed them, the puzzles whose printed rules lie
   * there —, and of one nobody has found, only what it is and where, while it is in sight
   * (`seen`). Named once this player has found it (`found`); the minimap and the arrows show
   * only what the crew knows of
   */
  manuals: (
    | ({
        id: string;
        kind: ManualKind;
        x: number;
        y: number;
        label: string;
        puzzleIds: string[];
        /** readable: always, for a locker or cabinet once opened */
        opened: boolean;
        /** a cabinet's key, by item id; null for everything else */
        needsKey: string | null;
      } & Known)
    | ({ id: string; kind: ManualKind; x: number; y: number } & Glimpse)
  )[];
  /**
   * the notes of the last shift this player can make out, where each lies — on a wall or the
   * floor: whether somebody has read it, where the crew has come across it, and of one nobody
   * has found, only where it is, while it is in sight; never what it says
   */
  notes: (
    | ({ index: number; x: number; y: number; read: boolean } & Known)
    | ({ index: number; x: number; y: number } & Glimpse)
  )[];
  /**
   * the wall sign with the Laborkennung, on every map as a landmark: whether this player has
   * found it, whether anybody of the crew has; null for none
   */
  edgeworkSign: { x: number; y: number; found: boolean; known: boolean } | null;
  /**
   * this player's finds that matter, oldest first (discovery.ts `discover`): their screen
   * answers each once with its caption, and with the chime where it chimes; none for the
   * audience
   */
  discoveries: Discovery[];
  /** the emergency lamps, on the floor or on a wall beside it; they glow once the lights are out */
  lamps: { x: number; y: number }[];
  /** room names, each with the kind of room it names, where the mission gives one */
  labels: { text: string; x: number; y: number; kind?: RoomKind }[];
  /** the furniture on the floor: solid for every step, as walls are */
  decor: { kind: DecorKind; x: number; y: number; variant?: number }[];
  /** labels of the rooms whose lights the solved stations have switched on, first lit first */
  litRooms: string[];
  /** escape hatch; open once every puzzle is solved */
  exit: {
    x: number;
    y: number;
    open: boolean;
    /** epoch ms the hatch was unlocked, with the last station's solve; null while locked */
    openedAt: number | null;
    /** who stands on the open hatch right now, by player id; the run is won once it is everybody */
    atExit: string[];
  } | null;
  /**
   * the parts this player can make out and where they have to go: whole once somebody has
   * found one or taken it up (`known`), and of a part lying where nobody has found it, only what
   * it is and where, while it is in sight (`seen`)
   */
  items: (
    | ({
        id: string;
        kind: PartKind;
        label: string;
        x: number;
        y: number;
        carriedBy: string | null;
        delivered: boolean;
        /** a key's is the cabinet it unlocks, once that has been come across; null until then */
        deliverTo: { x: number; y: number } | null;
        /**
         * the station waiting for it, if any: its title, and how many stations after the one in
         * front of the crew it comes — 0 for that one, whether or not the map shows it yet
         */
        requiredFor: { title: string; ahead: number } | null;
      } & Known)
    | ({ id: string; kind: PartKind; x: number; y: number } & Glimpse)
  )[];
  /** emergency panels; `active` only while an emergency is running */
  sabotage: {
    label: string;
    hint: string;
    endsAt: number;
    panels: { id: string; x: number; y: number; occupied: boolean }[];
    /** relay mode only: this player's console and instruction, and the drill as printed */
    relay?: RelayView & { manual: ManualSection[] };
  } | null;
}

/** A station's spot on a map: whole when the crew knows of it or it is armed, else glimpsed. */
export type MapStation = MapView['stations'][number];
/** A station's spot told whole: its title and status. */
export type KnownStation = Extract<MapStation, { known: true }>;
/** A manual object on a map: known to the crew and whole, or glimpsed. */
export type MapSource = MapView['manuals'][number];
/** A manual object the crew knows of: where it lies, what it covers, how it opens. */
export type KnownSource = Extract<MapSource, { known: true }>;
/** A note of the last shift on a map: known to the crew, or glimpsed. */
export type MapNote = MapView['notes'][number];
/** A part on a map: known to the crew and whole, or glimpsed lying about. */
export type MapPart = MapView['items'][number];
/** A part somebody of the crew has found or taken up: who carries it, where it goes. */
export type KnownPart = Extract<MapPart, { known: true }>;

export interface Grade {
  /** S, A, B or C — only awarded for a mission that was actually finished */
  rank: 'S' | 'A' | 'B' | 'C';
  label: string;
}

/**
 * How well the crew did: a clean run with time to spare is the top rank,
 * every alarm and every lost second pushes it down. Hints count too, but
 * more gently: they only stand between the crew and the top two ranks.
 */
function gradeFor(state: GameState): Grade | null {
  if (state.phase !== 'won' || state.startedAt === null || state.finishedAt === null) {
    return null;
  }
  const budget = state.mission.timeLimitSec * 1000;
  // The run's time is the clock's: from the lights going out, the intro left out.
  const { startedAt, lightsOutAt } = state;
  const used = state.finishedAt - clockStartOf({ startedAt, lightsOutAt });
  const spare = Math.max(0, 1 - used / budget);
  const alarms = state.penaltySeq;
  const hints = state.hintsUsed;
  if (alarms === 0 && hints === 0 && spare >= 0.3) {
    return { rank: 'S', label: 'Makellos — kein einziger Alarm, massig Zeit übrig' };
  }
  if (alarms <= 1 && hints <= 1 && spare >= 0.15) {
    return { rank: 'A', label: 'Sauber — fast ohne Zwischenfälle' };
  }
  if (alarms <= 3) {
    return { rank: 'B', label: 'Solide — es hat gewackelt, aber alle sind draußen' };
  }
  return { rank: 'C', label: 'Knapp vorbei an der Katastrophe' };
}

/** The alarms so far against the mission's limit; every viewer sees the same. */
function alarmsOf(state: GameState): PlayerView['alarms'] {
  return { count: state.penaltySeq, limit: state.mission.maxAlarms ?? null };
}

function storyText(state: GameState): string {
  switch (state.phase) {
    case 'won':
      return state.mission.story.win;
    case 'lost':
      return state.mission.story.lose;
    default:
      return state.mission.story.intro;
  }
}

/**
 * Views are rebuilt on every change; this is what a module's view may read
 * — about the open station `puzzleId`, or about none for an emergency.
 */
function viewContext(state: GameState, puzzleId: string | null): ViewContext {
  if (state.edgework === null) {
    throw new Error('view: this run has no edgework — was start-mission skipped?');
  }
  return {
    edgework: state.edgework,
    alarms: state.penaltySeq,
    crew: state.players.filter((p) => p.connected).map((p) => p.id),
    operators: puzzleId === null ? [] : operatorsOf(state, puzzleId),
  };
}

/** The lab's power as every viewer sees it. */
function lightsOf(state: GameState): Lights {
  return { out: state.lightsOutAt !== null, outAt: state.lightsOutAt };
}

/** The mission's intro as the crew's screens play it; none for a mission without one. */
function introOf(state: GameState): Pick<PlayerView, 'intro'> {
  const intro = state.mission.intro;
  if (intro === undefined) {
    return {};
  }
  const { place = '', time = '', pa, lightsSec } = intro;
  return { intro: { place, time, pa: [...pa], lightsSec, done: [...state.introDone] } };
}

/** The manual objects `playerId` stands at, in map order. */
function sourcesAt(state: GameState, playerId: string): ManualDef[] {
  return state.mission.map.manuals.filter(
    (m) => state.presence.manuals[m.id]?.includes(playerId) === true,
  );
}

/**
 * Where one player stands. Next to two stations or manual objects at once,
 * the one of the current puzzle wins.
 */
function presenceOf(state: GameState, playerId: string): PlayerPresence {
  const current = state.mission.puzzles[state.currentPuzzleIndex]?.id;
  const stations = [...new Set(state.mission.map.stations.map((s) => s.puzzleId))].filter(
    (id) => consoleOf(state, id, playerId) !== null,
  );
  const stationId = stations.find((id) => id === current) ?? stations[0] ?? null;
  const manuals = sourcesAt(state, playerId).filter((m) => sourceOpen(state, m));
  const manual =
    manuals.find((m) => current !== undefined && m.puzzleIds.includes(current)) ?? manuals[0];
  return {
    stationId,
    console: stationId === null ? null : consoleOf(state, stationId, playerId),
    manualId: manual?.id ?? null,
    signSeen: state.presence.signSeen.includes(playerId),
  };
}

function sourcesHereFor(state: GameState, playerId: string): SourceHere[] {
  if (state.phase !== 'playing') {
    return [];
  }
  return sourcesAt(state, playerId).map((m) => ({
    id: m.id,
    kind: m.kind,
    label: m.label,
    opened: sourceOpen(state, m),
    needsKey: m.needsKey ?? null,
  }));
}

/** The rules of every puzzle a manual object covers; the open station's with its notes. */
function sectionsOf(state: GameState, manual: ManualDef): ManualHere['sections'] {
  const open = state.puzzleState === null ? undefined : state.currentPuzzleIndex;
  return state.mission.puzzles.flatMap((def, index) => {
    if (!manual.puzzleIds.includes(def.id)) {
      return [];
    }
    const notesLeft = index === open ? def.hints.length - state.hintsRevealed : 0;
    return [
      {
        puzzleId: def.id,
        index,
        title: def.title,
        manual: moduleFor(def.type).manual(def),
        notes: index === open ? def.hints.slice(0, state.hintsRevealed) : [],
        noteReadyAt: notesLeft > 0 ? state.hintReadyAt : null,
        notesLeft,
        costSec: state.mission.hintCostSec,
      },
    ];
  });
}

function manualsHereFor(state: GameState, playerId: string): ManualHere[] {
  if (state.phase !== 'playing') {
    return [];
  }
  return sourcesAt(state, playerId)
    .filter((m) => sourceOpen(state, m))
    .map((m) => ({ id: m.id, label: m.label, kind: m.kind, sections: sectionsOf(state, m) }));
}

/**
 * The first note of the map, in map order, that `playerId` stands at; null at none. The server
 * counts a player at a note only once they have found it: round a pillar or through a wall, a
 * note nobody could see from there gives its words to nobody.
 */
function noteHereFor(state: GameState, playerId: string): NoteHere | null {
  if (state.phase !== 'playing') {
    return null;
  }
  const index = state.mission.map.notes.findIndex(
    (_, i) => state.presence.notes[noteKey(i)]?.includes(playerId) === true,
  );
  const note = state.mission.map.notes[index];
  return note === undefined ? null : { index, text: note.text };
}

/**
 * The open puzzle as one player sees it from where they stand, or as the
 * audience sees it (`playerId` null): instance, rules and the reader's side.
 */
function puzzleViewFor(state: GameState, playerId: string | null): PuzzleView | null {
  if (state.phase !== 'playing' || state.puzzleState === null) {
    return null;
  }
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    return null;
  }
  const puzzleModule = moduleFor(def.type);
  const viewer = viewerOf(state, def.id, playerId);
  return {
    ...puzzleModule.view(def, state.puzzleState, viewer, viewContext(state, def.id)),
    index: state.currentPuzzleIndex,
    total: state.mission.puzzles.length,
    title: def.title,
    manual: viewer.reading ? puzzleModule.manual(def) : null,
    console: viewer.console,
    plate: viewer.console === null ? null : puzzleModule.plate(def, viewer.console),
    backup: puzzleModule.wholeCrew ? null : backupFor(state, def.id, playerId),
  };
}

/**
 * Who lets `playerId`'s inputs at the open station of `puzzleId` count, by
 * name, and where they stand; null for the audience, away from the station
 * and while nobody backs them up.
 */
function backupFor(
  state: GameState,
  puzzleId: string,
  playerId: string | null,
): PuzzleView['backup'] {
  const [first] = playerId === null ? [] : backupsOf(state, puzzleId, playerId);
  const name = state.players.find((p) => p.id === first?.playerId)?.name;
  return first === undefined || name === undefined ? null : { name, where: first.where };
}

/** Who looks at the open puzzle `puzzleId` from where; the audience sees it from everywhere. */
function viewerOf(state: GameState, puzzleId: string, playerId: string | null): Viewer {
  if (playerId === null) {
    return { playerId: null, operating: true, reading: true, console: null };
  }
  const at = consoleOf(state, puzzleId, playerId);
  return {
    playerId,
    operating: at !== null,
    reading: readersOf(state, puzzleId).includes(playerId),
    console: at,
  };
}

/**
 * The running relay emergency as one player sees it, with the def it runs
 * on; null in valves mode and between emergencies.
 */
function relayViewFor(
  state: GameState,
  playerId: string | null,
): { def: RelayDef; view: RelayView } | null {
  const sabotage = state.mission.map.sabotage;
  const emergency = state.sabotage?.emergency;
  if (sabotage === undefined || emergency === undefined) {
    return null;
  }
  const def = relayDefFor(state.players, sabotage);
  return { def, view: relayModule.view(def, emergency, playerId, viewContext(state, null)) };
}

/** Relay mode adds the player's console and the printed drill to the sabotage view. */
function relayPartFor(
  state: GameState,
  playerId: string | null,
): Pick<NonNullable<MapView['sabotage']>, 'relay'> {
  const relay = relayViewFor(state, playerId);
  return relay === null ? {} : { relay: { ...relay.view, manual: relayModule.manual(relay.def) } };
}

/** Who a map view is for: a player, or the audience (null), which has everything in sight. */
type MapViewer = string | null;

/** A station's state on the map: solved, up now — once the lights are out — or still to come. */
function stationStatus(state: GameState, index: number): 'done' | 'armed' | 'locked' {
  if (index < state.currentPuzzleIndex) {
    return 'done';
  }
  return index === state.currentPuzzleIndex && lightsAreOut(state) ? 'armed' : 'locked';
}

/** A station spot's look: a main switch, a fuse box, or a plain console (null). */
function stationLook(
  def: Mission['puzzles'][number] | undefined,
  spot: MapDef['stations'][number],
): 'lever' | 'fusebox' | null {
  if (def?.type === 'button-sync' && def.style === 'lever') {
    return 'lever';
  }
  // The fuse box is where the wires are cut: console a, the meter stands at b.
  return def?.type === 'circuit' && spot.console !== 'b' ? 'fusebox' : null;
}

/**
 * Every station spot this viewer can make out: whole the armed station's, the objective every
 * view shares, and a spot the crew has found; of any other only what it is and where, while it
 * is in sight.
 */
function stationsOnMap(state: GameState, viewer: MapViewer): MapView['stations'] {
  const sighting = sightingFor(state, viewer);
  return state.mission.map.stations.flatMap((s): MapView['stations'] => {
    const index = state.mission.puzzles.findIndex((p) => p.id === s.puzzleId);
    const def = state.mission.puzzles[index];
    const status = stationStatus(state, index);
    const { seen, found, known } = sighting(consoleFind(s));
    const look = stationLook(def, s);
    const spot = {
      puzzleId: s.puzzleId,
      x: s.x,
      y: s.y,
      ...(s.console === undefined ? {} : { console: s.console }),
      ...(look === null ? {} : { look }),
    };
    if (known || status === 'armed') {
      return [{ ...spot, title: def?.title ?? s.puzzleId, status, found, known: true }];
    }
    return seen ? [{ ...spot, ...GLIMPSE }] : [];
  });
}

/** What a map view says of a thing as far as its viewer is concerned. */
interface Sighted {
  /** in the viewer's sight right now — anything is while the power lights the whole lab */
  seen: boolean;
  /** found by the viewer */
  found: boolean;
  /** found by somebody of the crew */
  known: boolean;
}

/** The sign where it hangs, as `viewer` and their crew have come across it. */
function signOnMap(
  state: GameState,
  viewer: MapViewer,
  at: { x: number; y: number },
): NonNullable<MapView['edgeworkSign']> {
  const { found, known } = sightingFor(state, viewer)({ of: 'sign' });
  return { x: at.x, y: at.y, found, known };
}

/** A thing nobody has found, as a view in sight of it tells it: what and where, no more. */
const GLIMPSE = { seen: true, found: false, known: false } as const;

/**
 * What a map view says of a thing as far as its viewer is concerned: in their sight right now
 * (anything is while the power lights the whole lab, discovery.ts `labLit`), found by them,
 * known to the crew. The audience has it all.
 */
function sightingFor(state: GameState, viewer: MapViewer): (find: Find) => Sighted {
  const mine = new Set(viewer === null ? [] : (state.found[viewer] ?? []));
  const sight = new Set(viewer === null ? [] : (state.presence.sight[viewer] ?? []));
  const lit = labLit(state);
  return (find) => {
    if (viewer === null) {
      return { seen: true, found: true, known: true };
    }
    const key = findKey(find);
    return { seen: lit || sight.has(key), found: mine.has(key), known: crewFound(state, key) };
  };
}

/**
 * The manual objects this viewer can make out: whole where the crew knows of them, and of one
 * nobody has found only what it is and where, while it is in sight.
 */
function manualsOnMap(state: GameState, viewer: MapViewer): MapView['manuals'] {
  const sighting = sightingFor(state, viewer);
  return state.mission.map.manuals.flatMap((m): MapView['manuals'] => {
    const place = state.places[m.id];
    if (place === undefined) {
      return [];
    }
    const where = { id: m.id, kind: m.kind, x: place.x, y: place.y };
    const { seen, found, known } = sighting({ of: 'source', id: m.id });
    if (known) {
      const rules = { label: m.label, puzzleIds: [...m.puzzleIds], needsKey: m.needsKey ?? null };
      return [{ ...where, ...rules, opened: sourceOpen(state, m), found, known }];
    }
    return seen ? [{ ...where, ...GLIMPSE }] : [];
  });
}

/**
 * The notes this viewer can make out: where, and whether read, where the crew knows of them;
 * of one nobody has found only where it is, while it is in sight.
 */
function notesOnMap(state: GameState, viewer: MapViewer): MapView['notes'] {
  const sighting = sightingFor(state, viewer);
  return state.mission.map.notes.flatMap((note, index): MapView['notes'] => {
    const where = { index, x: note.x, y: note.y };
    const { seen, found, known } = sighting({ of: 'note', index });
    if (known) {
      return [{ ...where, read: state.notesRead.includes(index), found, known }];
    }
    return seen ? [{ ...where, ...GLIMPSE }] : [];
  });
}

/** This viewer's finds that matter, oldest first; none for the audience. */
function discoveriesFor(state: GameState, viewer: MapViewer): Discovery[] {
  const own = viewer === null ? [] : (state.discoveries[viewer] ?? []);
  return own.flatMap(({ key, at, chime }) => {
    const find = findOf(state.mission.map, key);
    return find === null ? [] : [{ find, at, chime }];
  });
}

type PartDef = MapDef['items'][number];

/** Where a part has to go: its drop-off, or a key's cabinet once the crew knows the cabinet. */
function dropOffOf(
  state: GameState,
  def: PartDef,
  sighting: (find: Find) => Sighted,
): { x: number; y: number } | null {
  if (def.deliverTo !== undefined) {
    return { x: def.deliverTo.x, y: def.deliverTo.y };
  }
  const lock = state.mission.map.manuals.find((m) => m.needsKey === def.id);
  const known = lock !== undefined && sighting({ of: 'source', id: lock.id }).known;
  const at = known ? state.places[lock.id] : undefined;
  return at === undefined ? null : { x: at.x, y: at.y };
}

/** The station a part is for, and how many stations come before it; null for none. */
function stationFor(state: GameState, def: PartDef): { title: string; ahead: number } | null {
  const index = state.mission.puzzles.findIndex((p) => p.id === def.requiredFor);
  const station = state.mission.puzzles[index];
  return station === undefined
    ? null
    : { title: station.title, ahead: index - state.currentPuzzleIndex };
}

/**
 * What there is to tell of a part known to this viewer: its label, who carries it, whether it
 * is in its place, and where it has to go — a key's cabinet once the cabinet is known.
 */
function partWhereabouts(state: GameState, def: PartDef, sighting: (find: Find) => Sighted) {
  const live = state.items[def.id];
  return {
    label: def.label,
    carriedBy: live?.carriedBy ?? null,
    delivered: live?.delivered ?? false,
    deliverTo: dropOffOf(state, def, sighting),
    requiredFor: stationFor(state, def),
  };
}

/** What a part is and where it lies now: where it was put down or is carried, else its spot. */
function partSpot(state: GameState, def: PartDef) {
  const live = state.items[def.id];
  return {
    id: def.id,
    kind: partKind(def.label),
    x: live?.x ?? def.x + 0.5,
    y: live?.y ?? def.y + 0.5,
  };
}

/** Whether somebody has taken a part up, or put it in its place. */
function taken(state: GameState, def: PartDef): boolean {
  const live = state.items[def.id];
  return live !== undefined && (live.carriedBy !== null || live.delivered);
}

/**
 * The parts this viewer can make out: whole once somebody has found one, taken it up or put it
 * in its place; of a part nobody has found, lying about, only what it is and where, while it is
 * in sight.
 */
function itemsOnMap(state: GameState, viewer: MapViewer): MapView['items'] {
  const sighting = sightingFor(state, viewer);
  return state.mission.map.items.flatMap((def): MapView['items'] => {
    const where = partSpot(state, def);
    const { seen, found, known } = sighting({ of: 'item', id: def.id });
    if (known || taken(state, def)) {
      return [{ ...where, ...partWhereabouts(state, def, sighting), found, known: true }];
    }
    return seen ? [{ ...where, ...GLIMPSE }] : [];
  });
}

/**
 * The hatch as every viewer sees it: open once the last station is solved,
 * since the moment the run report logged it unlocked, and who of the crew
 * stands on it — as the server counts them from their positions.
 */
function exitOf(state: GameState): MapView['exit'] {
  const exit = state.mission.map.exit;
  if (exit === undefined) {
    return null;
  }
  const open = state.currentPuzzleIndex >= state.mission.puzzles.length;
  const unlocked = state.events.find((event) => event.kind === 'escape');
  return {
    x: exit.x,
    y: exit.y,
    open,
    openedAt: open ? (unlocked?.at ?? null) : null,
    atExit: open ? [...state.presence.exit] : [],
  };
}

/** The rooms the solved stations have lit, each once, in the order they lit up. */
function litRoomsOf(state: GameState): string[] {
  const solved = state.mission.puzzles.slice(0, state.currentPuzzleIndex);
  return [...new Set(solved.flatMap((puzzle) => puzzle.lights))];
}

function mapViewFor(state: GameState, viewer: MapViewer): MapView | null {
  const map = state.mission.map;
  if (state.phase !== 'playing') {
    return null;
  }
  const seat = viewer === null ? state.players[0] : state.players.find((p) => p.id === viewer);
  const spawn = seat?.spawn;
  return {
    width: map.tiles[0]?.length ?? 0,
    height: map.tiles.length,
    tiles: [...map.tiles],
    yourSpawn: { x: spawn?.x ?? 1, y: spawn?.y ?? 1 },
    doors: map.doors.map((d) => ({ id: d.id, x: d.x, y: d.y, open: doorOpen(map, state, d.id) })),
    plates: map.plates.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      label: p.label,
      pressed: platePressed(state, p.id),
      freezesDrone: map.drones.some((d) => d.frozenByPlate === p.id),
    })),
    stations: stationsOnMap(state, viewer),
    manuals: manualsOnMap(state, viewer),
    notes: notesOnMap(state, viewer),
    edgeworkSign:
      map.edgeworkSign === undefined ? null : signOnMap(state, viewer, map.edgeworkSign),
    discoveries: discoveriesFor(state, viewer),
    lamps: map.lamps.map((lamp) => ({ x: lamp.x, y: lamp.y })),
    labels: map.labels.map((l) => ({
      text: l.text,
      x: l.x,
      y: l.y,
      ...(l.kind === undefined ? {} : { kind: l.kind }),
    })),
    decor: map.decor.map((piece) => ({
      kind: piece.kind,
      x: piece.x,
      y: piece.y,
      ...(piece.variant === undefined ? {} : { variant: piece.variant }),
    })),
    litRooms: litRoomsOf(state),
    exit: exitOf(state),
    items: itemsOnMap(state, viewer),
    sabotage:
      map.sabotage === undefined || state.sabotage === null
        ? null
        : {
            label: map.sabotage.label,
            hint: map.sabotage.hint,
            endsAt: state.sabotage.endsAt,
            panels: map.sabotage.panels.map((p) => ({
              id: p.id,
              x: p.x,
              y: p.y,
              occupied: state.occupiedPanels.includes(p.id),
            })),
            ...relayPartFor(state, viewer),
          },
  };
}

/**
 * What an audience sees: the whole lab at once, the open puzzle with every
 * side of it and where everybody stands. Spectators cannot act, so
 * revealing everything is the point — watching the halves fail to line up
 * is the fun part.
 */
export interface SpectatorView {
  phase: Phase;
  missionTitle: string;
  difficulty: Difficulty;
  storyText: string;
  deadlineAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  timeLimitSec: number;
  /** the lab's power, as the players see it */
  lights: Lights;
  currentPuzzleIndex: number;
  puzzleCount: number;
  penaltySeq: number;
  /** the alarms so far and how many end the run, as the players see them */
  alarms: PlayerView['alarms'];
  hintsUsed: number;
  pausedFor: string[] | null;
  /** since when the run stands frozen, as the players see it */
  pausedAt: number | null;
  events: RunEvent[];
  grade: Grade | null;
  players: {
    id: string;
    name: string;
    color: string;
    connected: boolean;
    presence: PlayerPresence;
  }[];
  /** who did what this run, by player id */
  credits: Record<string, Credits>;
  map: MapView | null;
  /** the open puzzle from everywhere at once: instance, printed rules and the reader's side */
  puzzle: PuzzleView | null;
  /** the lab's serial, lamps and cells, whether or not anybody has read the sign yet */
  edgework: Edgework | null;
  /** one entry per player; during a relay emergency with that player's console and instruction */
  panels: {
    playerId: string;
    name: string;
    emergency?: RelayView;
  }[];
}

export function viewForSpectator(state: GameState): SpectatorView {
  return {
    phase: state.phase,
    missionTitle: state.mission.title,
    difficulty: state.difficulty,
    storyText: storyText(state),
    deadlineAt: state.deadlineAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    timeLimitSec: state.mission.timeLimitSec,
    lights: lightsOf(state),
    currentPuzzleIndex: state.currentPuzzleIndex,
    puzzleCount: state.mission.puzzles.length,
    penaltySeq: state.penaltySeq,
    alarms: alarmsOf(state),
    hintsUsed: state.hintsUsed,
    pausedFor:
      state.paused === null
        ? null
        : state.players.filter((p) => !p.connected).map((p) => p.name),
    pausedAt: state.paused?.since ?? null,
    events: [...state.events],
    grade: gradeFor(state),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      presence: presenceOf(state, p.id),
    })),
    credits: { ...state.credits },
    map: mapViewFor(state, null),
    puzzle: puzzleViewFor(state, null),
    edgework: state.edgework,
    panels: state.players.map((player) => {
      const relay = relayViewFor(state, player.id);
      return {
        playerId: player.id,
        name: player.name,
        ...(relay === null ? {} : { emergency: relay.view }),
      };
    }),
  };
}

export function viewFor(state: GameState, playerId: string): PlayerView {
  const you = state.players.find((p) => p.id === playerId);
  if (you === undefined) {
    throw new Error(`viewFor: player "${playerId}" is not in this game`);
  }
  const presence = presenceOf(state, playerId);

  return {
    phase: state.phase,
    missionId: state.mission.id,
    missionTitle: state.mission.title,
    difficulty: state.difficulty,
    storyText: storyText(state),
    crewSize: { min: state.mission.players.min, max: state.mission.players.max },
    you: {
      id: you.id,
      name: you.name,
      color: you.color,
      ready: you.ready,
      isHost: you.isHost,
    },
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      ready: p.ready,
      connected: p.connected,
      isHost: p.isHost,
    })),
    palette: CREW_COLORS.map((color) => ({
      color,
      takenByName: state.players.find((p) => p.color === color)?.name ?? null,
    })),
    deadlineAt: state.deadlineAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    timeLimitSec: state.mission.timeLimitSec,
    lights: lightsOf(state),
    currentPuzzleIndex: state.currentPuzzleIndex,
    puzzleCount: state.mission.puzzles.length,
    pausedFor:
      state.paused === null
        ? null
        : state.players.filter((p) => !p.connected).map((p) => p.name),
    pausedAt: state.paused?.since ?? null,
    events: [...state.events],
    grade: gradeFor(state),
    penaltySeq: state.penaltySeq,
    lastPenaltySec: state.lastPenaltySec,
    alarms: alarmsOf(state),
    hintsUsed: state.hintsUsed,
    credits: { ...state.credits },
    edgework: presence.signSeen ? state.edgework : null,
    presence,
    sourcesHere: sourcesHereFor(state, playerId),
    manualsHere: manualsHereFor(state, playerId),
    noteHere: noteHereFor(state, playerId),
    puzzle: puzzleViewFor(state, playerId),
    map: mapViewFor(state, playerId),
    ...(state.roomSeed === null ? {} : { seed: { room: state.roomSeed, run: state.seed } }),
    ...(state.mission.daily ? { daily: { on: state.dailyOn, day: state.daily } } : {}),
    ...achievementsOfRun(state),
    ...(state.mission.next === undefined ? {} : { nextMissionId: state.mission.next }),
    ...introOf(state),
  };
}

/** The Erfolge of a run that is over, read off its report; none while it runs or before it. */
function achievementsOfRun(state: GameState): Pick<PlayerView, 'achievements'> {
  return state.phase === 'won' || state.phase === 'lost'
    ? { achievements: achievementsOf(runReport(state, '')) }
    : {};
}
