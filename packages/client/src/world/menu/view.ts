import {
  applyAction,
  initialState,
  viewFor,
  type DronePosition,
  type GameState,
  type Mission,
  type PlayerView,
} from '@escapelab/core';

/**
 * What the menu's scene draws a mission's lab from (world/menu/scene.ts): a run of it started
 * in the page alone by core's own reducer — no server, no room — for the least crew it takes,
 * its power on whatever the mission's start does, as the opening shows it to the first of that
 * crew, who has found nothing yet: every console, source and note glimpsed in the lit lab,
 * none of them named. The drones stand parked where the server parks them before they wake.
 * The mission's definition is public (GET /missions/:id), and the scene's run is a draw of its
 * own (SCENE_SEED): nothing of a room's run is in it.
 */

/** The seed the scene lays a mission's lab out by — where its sources lie — every time alike. */
export const SCENE_SEED = 1;

/** The scene's crew, by player id: as many as the mission takes at the least. */
function crewOf(mission: Mission): string[] {
  return Array.from({ length: Math.max(1, mission.players.min) }, (_, i) => `scene-${i + 1}`);
}

/** The scene's run of `mission`: started at 0 for its least crew, the host the first of them. */
function sceneRun(mission: Mission): { state: GameState; host: string } {
  const crew = crewOf(mission);
  const host = crew[0] ?? 'scene-1';
  let state = initialState(mission, SCENE_SEED);
  for (const playerId of crew) {
    state = applyAction(state, { type: 'player-join', playerId, name: playerId });
  }
  for (const playerId of crew.slice(1)) {
    state = applyAction(state, { type: 'set-ready', playerId, ready: true });
  }
  state = applyAction(state, { type: 'start-mission', playerId: host, at: 0, seed: SCENE_SEED });
  return { state, host };
}

/** The view the scene draws `mission`'s lab from: its run's first view, the power on. */
export function sceneViewOf(mission: Mission): PlayerView {
  const { state, host } = sceneRun(mission);
  return viewFor({ ...state, lightsOutAt: null }, host);
}

/**
 * Every drone of `mission` parked as the server parks it before it wakes (server drones.ts
 * `reset`): over its first waypoint's middle, facing east, its cone its own.
 */
export function parkedDrones(mission: Mission): Record<string, DronePosition> {
  const parked: Record<string, DronePosition> = {};
  for (const drone of mission.map.drones) {
    const start = drone.waypoints[0];
    if (start !== undefined) {
      parked[drone.id] = {
        x: start.x + 0.5,
        y: start.y + 0.5,
        facing: 0,
        range: drone.range,
        halfAngleDeg: drone.halfAngleDeg,
        alerted: false,
        frozen: false,
      };
    }
  }
  return parked;
}
