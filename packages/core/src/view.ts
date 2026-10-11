import type { Difficulty } from './difficulty.js';
import type { Edgework } from './edgework.js';
import { CREW_COLORS, type GameState, type Phase, type RunEvent } from './state.js';
import { moduleFor, type PuzzleDef, type PuzzleView } from './puzzles/index.js';
import type { ViewContext } from './puzzles/module.js';
import { doorOpen, platePressed } from './map.js';

/**
 * What a single player is allowed to see. Asymmetric information is enforced
 * here, on the server side — private texts and layouts of other roles never
 * reach a client, so no amount of DevTools digging can leak them.
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
  /** the lab's serial, lamps and cells — only for roles that see them */
  edgework: Edgework | null;
  puzzle: PuzzleView | null;
  /** tile map while a mapped mission is running; null otherwise */
  map: MapView | null;
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
  plates: { id: string; x: number; y: number; label: string; pressed: boolean }[];
  stations: { x: number; y: number; title: string; status: 'done' | 'armed' | 'locked' }[];
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

/** Only the edgework-reading roles get it, the audience on exactly their panels. */
function edgeworkFor(state: GameState, roleId: string | null): Edgework | null {
  const seesIt = state.mission.roles.some((r) => r.id === roleId && r.seesEdgework);
  return seesIt ? state.edgework : null;
}

/** The role that holds the printed rules; button-sync has none. */
function manualRoleOf(def: PuzzleDef): string | null {
  return 'manualRoleId' in def ? def.manualRoleId : null;
}

function puzzleViewFor(state: GameState, roleId: string | null): PuzzleView | null {
  if (state.phase !== 'playing' || state.puzzleState === null) {
    return null;
  }
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    return null;
  }
  if (state.edgework === null) {
    throw new Error('puzzle view: this run has no edgework — was start-mission skipped?');
  }
  const puzzleModule = moduleFor(def.type);
  const ctx: ViewContext = { edgework: state.edgework, alarms: state.penaltySeq };
  const hintsLeft = def.hints.length - state.hintsRevealed;
  return {
    ...puzzleModule.view(def, state.puzzleState, roleId, ctx),
    index: state.currentPuzzleIndex,
    total: state.mission.puzzles.length,
    title: def.title,
    prompt: def.prompt,
    info: def.infos.find((i) => i.roleId === roleId)?.text ?? null,
    manual: roleId !== null && roleId === manualRoleOf(def) ? puzzleModule.manual(def) : null,
    hints: {
      shown: def.hints.slice(0, state.hintsRevealed),
      left: hintsLeft,
      readyAt: hintsLeft > 0 ? state.hintReadyAt : null,
      costSec: state.mission.hintCostSec,
    },
  };
}

function mapViewFor(state: GameState, playerId: string): MapView | null {
  const map = state.mission.map;
  if (map === undefined || state.phase !== 'playing') {
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
    })),
    stations: map.stations.map((s) => {
      const index = state.mission.puzzles.findIndex((p) => p.id === s.puzzleId);
      const status =
        index < state.currentPuzzleIndex ? 'done' : index === state.currentPuzzleIndex ? 'armed' : 'locked';
      return {
        x: s.x,
        y: s.y,
        title: state.mission.puzzles[index]?.title ?? s.puzzleId,
        status,
      };
    }),
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
          },
  };
}

/**
 * What an audience sees: the whole lab at once and every role's private
 * panel side by side. Spectators cannot act, so revealing everything is the
 * point — watching the two halves fail to line up is the fun part.
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
  }[];
  map: MapView | null;
  /** one entry per role, puzzle and edgework exactly as that role sees them */
  panels: {
    roleId: string;
    roleName: string;
    puzzle: PuzzleView | null;
    edgework: Edgework | null;
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
    })),
    map: mapViewFor(state, state.players[0]?.id ?? ''),
    panels: state.mission.roles.map((role) => ({
      roleId: role.id,
      roleName: role.name,
      puzzle: puzzleViewFor(state, role.id),
      edgework: edgeworkFor(state, role.id),
    })),
  };
}

export function viewFor(state: GameState, playerId: string): PlayerView {
  const you = state.players.find((p) => p.id === playerId);
  if (you === undefined) {
    throw new Error(`viewFor: player "${playerId}" is not in this game`);
  }
  const roleName = (roleId: string | null): string | null =>
    state.mission.roles.find((r) => r.id === roleId)?.name ?? null;

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
    edgework: edgeworkFor(state, you.roleId),
    puzzle: puzzleViewFor(state, you.roleId),
    map: mapViewFor(state, playerId),
  };
}
