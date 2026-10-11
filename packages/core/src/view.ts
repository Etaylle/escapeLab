import { CREW_COLORS, type GameState, type Phase } from './state.js';
import type { PuzzleDef } from './mission.js';
import type { PuzzleState } from './state.js';
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
  storyText: string;
  you: { id: string; name: string; roleId: string | null; color: string; isHost: boolean };
  players: {
    id: string;
    name: string;
    roleId: string | null;
    roleName: string | null;
    color: string;
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
  /** increments on every penalty; clients key alarm effects off it */
  penaltySeq: number;
  lastPenaltySec: number | null;
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
  /** emergency panels; `active` only while an emergency is running */
  sabotage: {
    label: string;
    hint: string;
    endsAt: number;
    panels: { id: string; x: number; y: number; occupied: boolean }[];
  } | null;
}

interface PuzzleViewCommon {
  index: number;
  total: number;
  title: string;
  prompt: string;
  /** private text for this player's role, if the puzzle defines one */
  info: string | null;
}

export type PuzzleView = PuzzleViewCommon &
  (
    | {
        kind: 'button-sync';
        buttonLabel: string | null;
        youPressed: boolean;
        pressedCount: number;
        requiredCount: number;
        attempts: number;
        lastResult: 'missed-window' | null;
      }
    | {
        kind: 'wiring';
        /** wire layout — only the cutter role gets it, everyone else sees null */
        wires: { id: string; color: string; left: string; right: string; cut: boolean }[] | null;
        cutsDone: number;
        cutsNeeded: number;
        lastWrongWireId: string | null;
      }
    | {
        kind: 'keypad';
        /** keypad layout — only the input role gets it */
        grid: { symbol: string; done: boolean }[] | null;
        progress: number;
        codeLength: number;
        lastWrongIndex: number | null;
      }
    | {
        kind: 'switches';
        /** switch bank — only the panel role gets it */
        switches: { symbol: string; on: boolean }[] | null;
        /** symbols that must be ON — only the target role gets it */
        target: string[] | null;
        targetCount: number;
        lastResult: 'wrong' | null;
      }
    | {
        kind: 'simon';
        /** flashing color sequence — only the display role gets it */
        sequence: string[] | null;
        /** symbol buttons in panel order — only the display role gets them */
        buttons: string[] | null;
        /** color→symbol legend — only the legend role gets it */
        legend: { color: string; symbol: string }[] | null;
        progress: number;
        seqLength: number;
        lastWrongIndex: number | null;
      }
  );

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

function buildPuzzleView(
  def: PuzzleDef,
  puzzleState: PuzzleState,
  common: PuzzleViewCommon,
  roleId: string | null,
): PuzzleView | null {
  if (def.type === 'button-sync' && puzzleState.type === 'button-sync') {
    const button = def.buttons.find((b) => b.roleId === roleId);
    return {
      ...common,
      kind: 'button-sync',
      buttonLabel: button?.label ?? null,
      youPressed: roleId !== null && puzzleState.pressed[roleId] !== undefined,
      pressedCount: Object.keys(puzzleState.pressed).length,
      requiredCount: def.buttons.length,
      attempts: puzzleState.attempts,
      lastResult: puzzleState.lastResult,
    };
  }
  if (def.type === 'wiring' && puzzleState.type === 'wiring') {
    const isCutter = roleId === def.cutterRoleId;
    return {
      ...common,
      kind: 'wiring',
      wires: isCutter ? puzzleState.wires : null,
      cutsDone: puzzleState.cutsDone,
      cutsNeeded: def.pairsToCut.length,
      lastWrongWireId: isCutter ? puzzleState.lastWrongWireId : null,
    };
  }
  if (def.type === 'keypad' && puzzleState.type === 'keypad') {
    const isInput = roleId === def.inputRoleId;
    const done = new Set(def.code.slice(0, puzzleState.progress));
    return {
      ...common,
      kind: 'keypad',
      grid: isInput
        ? puzzleState.grid.map((symbol) => ({ symbol, done: done.has(symbol) }))
        : null,
      progress: puzzleState.progress,
      codeLength: def.code.length,
      lastWrongIndex: isInput ? puzzleState.lastWrongIndex : null,
    };
  }
  if (def.type === 'switches' && puzzleState.type === 'switches') {
    const isPanel = roleId === def.panelRoleId;
    return {
      ...common,
      kind: 'switches',
      switches: isPanel
        ? puzzleState.order.map((symbol, i) => ({ symbol, on: puzzleState.on[i] === true }))
        : null,
      target: roleId === def.targetRoleId ? puzzleState.target : null,
      targetCount: def.onCount,
      lastResult: isPanel ? puzzleState.lastResult : null,
    };
  }
  if (def.type === 'simon' && puzzleState.type === 'simon') {
    const isDisplay = roleId === def.displayRoleId;
    return {
      ...common,
      kind: 'simon',
      sequence: isDisplay ? [...puzzleState.sequence] : null,
      buttons: isDisplay ? [...puzzleState.buttonOrder] : null,
      legend:
        roleId === def.legendRoleId
          ? Object.entries(puzzleState.mapping).map(([color, symbol]) => ({ color, symbol }))
          : null,
      progress: puzzleState.progress,
      seqLength: puzzleState.sequence.length,
      lastWrongIndex: isDisplay ? puzzleState.lastWrongIndex : null,
    };
  }
  return null;
}

function puzzleViewFor(state: GameState, roleId: string | null): PuzzleView | null {
  if (state.phase !== 'playing' || state.puzzleState === null) {
    return null;
  }
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    return null;
  }
  const common: PuzzleViewCommon = {
    index: state.currentPuzzleIndex,
    total: state.mission.puzzles.length,
    title: def.title,
    prompt: def.prompt,
    info: def.infos.find((i) => i.roleId === roleId)?.text ?? null,
  };
  return buildPuzzleView(def, state.puzzleState, common, roleId);
}

function mapViewFor(state: GameState, playerId: string): MapView | null {
  const map = state.mission.map;
  if (map === undefined || state.phase !== 'playing') {
    return null;
  }
  const you = state.players.find((p) => p.id === playerId);
  const spawn = you?.roleId !== null && you !== undefined ? map.spawns[you.roleId] : undefined;
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
    storyText: storyText(state),
    you: {
      id: you.id,
      name: you.name,
      roleId: you.roleId,
      color: you.color,
      isHost: you.isHost,
    },
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      roleId: p.roleId,
      roleName: roleName(p.roleId),
      color: p.color,
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
    penaltySeq: state.penaltySeq,
    lastPenaltySec: state.lastPenaltySec,
    puzzle: puzzleViewFor(state, you.roleId),
    map: mapViewFor(state, playerId),
  };
}
