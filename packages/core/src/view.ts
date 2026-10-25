import type { Difficulty } from './difficulty.js';
import type { Edgework } from './edgework.js';
import type { DecorKind, ManualDef, ManualKind, RoomKind } from './mission.js';
import { noteKey } from './notes.js';
import { CREW_COLORS, type Credits, type GameState, type Phase, type RunEvent } from './state.js';
import { moduleFor, type PuzzleView } from './puzzles/index.js';
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
   * The mission a won run of this one leads on to, by its catalog id — the
   * end screen offers it; left out where none follows.
   */
  nextMissionId?: string;
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
  /** one entry per spot: a station with two consoles has two, the same puzzle at both */
  stations: {
    puzzleId: string;
    x: number;
    y: number;
    title: string;
    status: 'done' | 'armed' | 'locked';
    /** which console the spot is; left out where the station has one */
    console?: ConsoleId;
    /**
     * a main switch with a lever for each of the crew, or a fuse box — where
     * a wrong cut shorts it out, the world's sparks fly; left out for a console
     */
    look?: 'lever' | 'fusebox';
  }[];
  /**
   * the manual objects the crew has come across so far (the audience sees
   * all of them), where this run placed them, and the puzzles whose printed
   * rules lie there
   */
  manuals: {
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
  }[];
  /**
   * the notes of the last shift the crew has come across so far (the audience
   * sees all of them), where each lies — on a wall or the floor — and
   * whether somebody has read it; never what it says
   */
  notes: { index: number; x: number; y: number; read: boolean }[];
  /** the wall sign with the Laborkennung; null on a map without one */
  edgeworkSign: { x: number; y: number } | null;
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
  /** carryable objects and where they have to go */
  items: {
    id: string;
    label: string;
    x: number;
    y: number;
    carriedBy: string | null;
    delivered: boolean;
    /** a key's is the cabinet it unlocks, once that has been come across; null until then */
    deliverTo: { x: number; y: number } | null;
    /** title of the station waiting for it, if any */
    requiredForTitle: string | null;
  }[];
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
  const used = state.finishedAt - state.startedAt;
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

/** The first note of the map, in map order, that `playerId` stands at; null at none. */
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

/** Who a map view is for: a player, or the audience (null), which sees every manual object. */
type MapViewer = string | null;

/** A station's state on the map: solved, up now — once the lights are out — or still to come. */
function stationStatus(state: GameState, index: number): MapView['stations'][number]['status'] {
  if (index < state.currentPuzzleIndex) {
    return 'done';
  }
  return index === state.currentPuzzleIndex && lightsAreOut(state) ? 'armed' : 'locked';
}

function stationsOnMap(state: GameState): MapView['stations'] {
  return state.mission.map.stations.map((s) => {
    const index = state.mission.puzzles.findIndex((p) => p.id === s.puzzleId);
    const def = state.mission.puzzles[index];
    const lever = def?.type === 'button-sync' && def.style === 'lever';
    // The fuse box is where the wires are cut: console a, the meter stands at b.
    const fusebox = def?.type === 'circuit' && s.console !== 'b';
    const look = lever ? 'lever' : fusebox ? 'fusebox' : null;
    return {
      puzzleId: s.puzzleId,
      x: s.x,
      y: s.y,
      title: def?.title ?? s.puzzleId,
      status: stationStatus(state, index),
      ...(s.console === undefined ? {} : { console: s.console }),
      ...(look === null ? {} : { look }),
    };
  });
}

/** Whether a manual object shows on this viewer's map: once found by the crew, always for the audience. */
function foundBy(state: GameState, viewer: MapViewer): (manualId: string) => boolean {
  return (manualId) => viewer === null || state.discovered.includes(manualId);
}

function manualsOnMap(state: GameState, viewer: MapViewer): MapView['manuals'] {
  const found = foundBy(state, viewer);
  return state.mission.map.manuals.flatMap((m) => {
    const place = state.places[m.id];
    return place === undefined || !found(m.id)
      ? []
      : [
          {
            id: m.id,
            kind: m.kind,
            x: place.x,
            y: place.y,
            label: m.label,
            puzzleIds: [...m.puzzleIds],
            opened: sourceOpen(state, m),
            needsKey: m.needsKey ?? null,
          },
        ];
  });
}

/** The notes the crew has come across, or every one for the audience — where, and whether read. */
function notesOnMap(state: GameState, viewer: MapViewer): MapView['notes'] {
  return state.mission.map.notes.flatMap((note, index) =>
    viewer === null || state.notesFound.includes(index)
      ? [{ index, x: note.x, y: note.y, read: state.notesRead.includes(index) }]
      : [],
  );
}

function itemsOnMap(state: GameState, viewer: MapViewer): MapView['items'] {
  const map = state.mission.map;
  const found = foundBy(state, viewer);
  return map.items.map((def) => {
    const live = state.items[def.id];
    const lock = map.manuals.find((m) => m.needsKey === def.id);
    const lockAt = lock !== undefined && found(lock.id) ? state.places[lock.id] : undefined;
    const goal = def.deliverTo ?? lockAt;
    return {
      id: def.id,
      label: def.label,
      x: live?.x ?? def.x + 0.5,
      y: live?.y ?? def.y + 0.5,
      carriedBy: live?.carriedBy ?? null,
      delivered: live?.delivered ?? false,
      deliverTo: goal === undefined ? null : { x: goal.x, y: goal.y },
      requiredForTitle:
        state.mission.puzzles.find((p) => p.id === def.requiredFor)?.title ?? null,
    };
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
    stations: stationsOnMap(state),
    manuals: manualsOnMap(state, viewer),
    notes: notesOnMap(state, viewer),
    edgeworkSign: map.edgeworkSign === undefined ? null : { ...map.edgeworkSign },
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
    ...(state.mission.next === undefined ? {} : { nextMissionId: state.mission.next }),
  };
}
