import type { Difficulty } from './difficulty.js';
import type { Edgework } from './edgework.js';
import type { ManualKind } from './mission.js';
import { CREW_COLORS, type GameState, type Phase, type RunEvent } from './state.js';
import { moduleFor, type PuzzleView } from './puzzles/index.js';
import type { ManualSection, Viewer, ViewContext } from './puzzles/module.js';
import { relayDefFor, relayModule, type RelayDef, type RelayView } from './puzzles/relay.js';
import { doorOpen, operatorsOf, platePressed, readersOf } from './map.js';

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
  you: {
    id: string;
    name: string;
    roleId: string | null;
    color: string;
    ready: boolean;
    isHost: boolean;
  };
  players: {
    id: string;
    name: string;
    roleId: string | null;
    roleName: string | null;
    color: string;
    ready: boolean;
    connected: boolean;
    isHost: boolean;
  }[];
  /** crew colors and who holds them, for the lobby picker */
  palette: { color: string; takenByName: string | null }[];
  roles: { id: string; name: string; description: string; takenByName: string | null }[];
  deadlineAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  timeLimitSec: number;
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
  /** hints bought from mission control this run; they weigh on the grade */
  hintsUsed: number;
  /** the lab's serial, lamps and cells — only once this player has read the sign */
  edgework: Edgework | null;
  /** where this player stands right now */
  presence: PlayerPresence;
  /** the manual objects this player stands at, with the printed rules of every puzzle they cover */
  manualsHere: ManualHere[];
  puzzle: PuzzleView | null;
  /** tile map while a mission is running; null otherwise */
  map: MapView | null;
}

export interface PlayerPresence {
  /** puzzle id of the station this player stands at */
  stationId: string | null;
  /** id of the manual object this player stands at */
  manualId: string | null;
  /** has walked up to the edgework sign this run */
  signSeen: boolean;
}

/**
 * A manual object as read on the spot. Printed rules are no secret — the
 * Handbuch screen prints them all — so they come whole, in mission order.
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
  }[];
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
  /** this player's spawn tile — the client simulates movement from here */
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
  stations: {
    puzzleId: string;
    x: number;
    y: number;
    title: string;
    status: 'done' | 'armed' | 'locked';
  }[];
  /** books, terminals and wall charts, and the puzzles whose printed rules lie there */
  manuals: {
    id: string;
    kind: ManualKind;
    x: number;
    y: number;
    label: string;
    puzzleIds: string[];
  }[];
  /** the wall sign with the Laborkennung; null on a map without one */
  edgeworkSign: { x: number; y: number } | null;
  labels: { text: string; x: number; y: number }[];
  /** escape hatch; open once every puzzle is solved */
  exit: { x: number; y: number; open: boolean } | null;
  /** carryable objects and where they have to go */
  items: {
    id: string;
    label: string;
    x: number;
    y: number;
    carriedBy: string | null;
    delivered: boolean;
    deliverTo: { x: number; y: number };
    /** title of the station waiting for it, if any */
    requiredForTitle: string | null;
  }[];
  /** emergency panels; `active` only while an emergency is running */
  sabotage: {
    label: string;
    hint: string;
    endsAt: number;
    panels: { id: string; x: number; y: number; occupied: boolean }[];
    /** relay mode only: this role's console and instruction, and the drill as printed */
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
    return { rank: 'A', label: 'Starke Leistung — fast ohne Zwischenfälle' };
  }
  if (alarms <= 3) {
    return { rank: 'B', label: 'Solide — es hat gewackelt, aber ihr seid raus' };
  }
  return { rank: 'C', label: 'Knapp vorbei an der Katastrophe' };
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

/** Views are rebuilt on every change; this is what a module's view may read. */
function viewContext(state: GameState): ViewContext {
  if (state.edgework === null) {
    throw new Error('view: this run has no edgework — was start-mission skipped?');
  }
  return {
    edgework: state.edgework,
    alarms: state.penaltySeq,
    crew: state.players.filter((p) => p.connected).map((p) => p.id),
  };
}

/**
 * Where one player stands. Next to two stations or manual objects at once,
 * the one of the current puzzle wins.
 */
function presenceOf(state: GameState, playerId: string): PlayerPresence {
  const { presence } = state;
  const current = state.mission.puzzles[state.currentPuzzleIndex]?.id;
  const stations = Object.keys(presence.stations).filter((id) =>
    presence.stations[id]?.includes(playerId),
  );
  const manuals = state.mission.map.manuals.filter((m) =>
    presence.manuals[m.id]?.includes(playerId),
  );
  const manual =
    manuals.find((m) => current !== undefined && m.puzzleIds.includes(current)) ?? manuals[0];
  return {
    stationId: stations.find((id) => id === current) ?? stations[0] ?? null,
    manualId: manual?.id ?? null,
    signSeen: presence.signSeen.includes(playerId),
  };
}

function manualsHereFor(state: GameState, playerId: string): ManualHere[] {
  if (state.phase !== 'playing') {
    return [];
  }
  return state.mission.map.manuals
    .filter((m) => state.presence.manuals[m.id]?.includes(playerId))
    .map((m) => ({
      id: m.id,
      label: m.label,
      kind: m.kind,
      sections: state.mission.puzzles.flatMap((def, index) =>
        m.puzzleIds.includes(def.id)
          ? [{ puzzleId: def.id, index, title: def.title, manual: moduleFor(def.type).manual(def) }]
          : [],
      ),
    }));
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
  const viewer: Viewer =
    playerId === null
      ? { playerId: null, operating: true, reading: true }
      : {
          playerId,
          operating: operatorsOf(state, def.id).includes(playerId),
          reading: readersOf(state, def.id).includes(playerId),
        };
  const hintsLeft = def.hints.length - state.hintsRevealed;
  return {
    ...puzzleModule.view(def, state.puzzleState, viewer, viewContext(state)),
    index: state.currentPuzzleIndex,
    total: state.mission.puzzles.length,
    title: def.title,
    manual: viewer.reading ? puzzleModule.manual(def) : null,
    hints: {
      shown: def.hints.slice(0, state.hintsRevealed),
      left: hintsLeft,
      readyAt: hintsLeft > 0 ? state.hintReadyAt : null,
      costSec: state.mission.hintCostSec,
    },
  };
}

/**
 * The running relay emergency as one role sees it, with the def it runs on;
 * null in valves mode and between emergencies.
 */
function relayViewFor(
  state: GameState,
  roleId: string | null,
): { def: RelayDef; view: RelayView } | null {
  const sabotage = state.mission.map.sabotage;
  const emergency = state.sabotage?.emergency;
  if (sabotage === undefined || emergency === undefined) {
    return null;
  }
  const def = relayDefFor(state.mission.roles, sabotage);
  return { def, view: relayModule.view(def, emergency, roleId, viewContext(state)) };
}

/** Relay mode adds the role's console and the printed drill to the sabotage view. */
function relayPartFor(
  state: GameState,
  roleId: string | null,
): Pick<NonNullable<MapView['sabotage']>, 'relay'> {
  const relay = relayViewFor(state, roleId);
  return relay === null ? {} : { relay: { ...relay.view, manual: relayModule.manual(relay.def) } };
}

function mapViewFor(state: GameState, playerId: string, roleId: string | null): MapView | null {
  const map = state.mission.map;
  if (state.phase !== 'playing') {
    return null;
  }
  const you = state.players.find((p) => p.id === playerId);
  const spawn =
    you !== undefined && you.roleId !== null ? map.spawns[you.roleId] : undefined;
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
    stations: map.stations.map((s) => {
      const index = state.mission.puzzles.findIndex((p) => p.id === s.puzzleId);
      const status =
        index < state.currentPuzzleIndex ? 'done' : index === state.currentPuzzleIndex ? 'armed' : 'locked';
      return {
        puzzleId: s.puzzleId,
        x: s.x,
        y: s.y,
        title: state.mission.puzzles[index]?.title ?? s.puzzleId,
        status,
      };
    }),
    manuals: map.manuals.map((m) => ({
      id: m.id,
      kind: m.kind,
      x: m.x,
      y: m.y,
      label: m.label,
      puzzleIds: [...m.puzzleIds],
    })),
    edgeworkSign: map.edgeworkSign === undefined ? null : { ...map.edgeworkSign },
    labels: map.labels.map((l) => ({ text: l.text, x: l.x, y: l.y })),
    exit:
      map.exit === undefined
        ? null
        : {
            x: map.exit.x,
            y: map.exit.y,
            open: state.currentPuzzleIndex >= state.mission.puzzles.length,
          },
    items: map.items.map((def) => {
      const live = state.items[def.id];
      return {
        id: def.id,
        label: def.label,
        x: live?.x ?? def.x + 0.5,
        y: live?.y ?? def.y + 0.5,
        carriedBy: live?.carriedBy ?? null,
        delivered: live?.delivered ?? false,
        deliverTo: { ...def.deliverTo },
        requiredForTitle:
          state.mission.puzzles.find((p) => p.id === def.requiredFor)?.title ?? null,
      };
    }),
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
            ...relayPartFor(state, roleId),
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
  currentPuzzleIndex: number;
  puzzleCount: number;
  penaltySeq: number;
  hintsUsed: number;
  pausedFor: string[] | null;
  events: RunEvent[];
  grade: Grade | null;
  players: {
    id: string;
    name: string;
    roleName: string | null;
    color: string;
    connected: boolean;
    presence: PlayerPresence;
  }[];
  map: MapView | null;
  /** the open puzzle from everywhere at once: instance, printed rules and the reader's side */
  puzzle: PuzzleView | null;
  /** the lab's serial, lamps and cells, whether or not anybody has read the sign yet */
  edgework: Edgework | null;
  /** one entry per role; during a relay emergency with that role's console and instruction */
  panels: {
    roleId: string;
    roleName: string;
    emergency?: RelayView;
  }[];
}

export function viewForSpectator(state: GameState): SpectatorView {
  const roleName = (roleId: string | null): string | null =>
    state.mission.roles.find((r) => r.id === roleId)?.name ?? null;
  return {
    phase: state.phase,
    missionTitle: state.mission.title,
    difficulty: state.difficulty,
    storyText: storyText(state),
    deadlineAt: state.deadlineAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    timeLimitSec: state.mission.timeLimitSec,
    currentPuzzleIndex: state.currentPuzzleIndex,
    puzzleCount: state.mission.puzzles.length,
    penaltySeq: state.penaltySeq,
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
      roleName: roleName(p.roleId),
      color: p.color,
      connected: p.connected,
      presence: presenceOf(state, p.id),
    })),
    map: mapViewFor(state, state.players[0]?.id ?? '', null),
    puzzle: puzzleViewFor(state, null),
    edgework: state.edgework,
    panels: state.mission.roles.map((role) => {
      const relay = relayViewFor(state, role.id);
      return {
        roleId: role.id,
        roleName: role.name,
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
  const roleName = (roleId: string | null): string | null =>
    state.mission.roles.find((r) => r.id === roleId)?.name ?? null;
  const presence = presenceOf(state, playerId);

  return {
    phase: state.phase,
    missionId: state.mission.id,
    missionTitle: state.mission.title,
    difficulty: state.difficulty,
    storyText: storyText(state),
    you: {
      id: you.id,
      name: you.name,
      roleId: you.roleId,
      color: you.color,
      ready: you.ready,
      isHost: you.isHost,
    },
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      roleId: p.roleId,
      roleName: roleName(p.roleId),
      color: p.color,
      ready: p.ready,
      connected: p.connected,
      isHost: p.isHost,
    })),
    palette: CREW_COLORS.map((color) => ({
      color,
      takenByName: state.players.find((p) => p.color === color)?.name ?? null,
    })),
    roles: state.mission.roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      takenByName: state.players.find((p) => p.roleId === r.id)?.name ?? null,
    })),
    deadlineAt: state.deadlineAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    timeLimitSec: state.mission.timeLimitSec,
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
    hintsUsed: state.hintsUsed,
    edgework: presence.signSeen ? state.edgework : null,
    presence,
    manualsHere: manualsHereFor(state, playerId),
    puzzle: puzzleViewFor(state, playerId),
    map: mapViewFor(state, playerId, you.roleId),
  };
}
