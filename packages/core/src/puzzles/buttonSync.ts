import type { ButtonSyncPuzzleDef } from '../mission.js';

/** Runtime state of a button-sync puzzle. Timestamps are epoch ms taken from actions. */
export interface ButtonSyncState {
  type: 'button-sync';
  /** roleId -> epoch ms of the (still valid) press */
  pressed: Record<string, number>;
  attempts: number;
  lastResult: 'missed-window' | null;
}

export function initButtonSync(): ButtonSyncState {
  return { type: 'button-sync', pressed: {}, attempts: 0, lastResult: null };
}

export interface ButtonSyncResult {
  state: ButtonSyncState;
  solved: boolean;
}

/**
 * Apply a press by `roleId` at time `at`. With a window configured, presses
 * older than `windowMs` relative to `at` expire; expiring a press counts as a
 * failed attempt and is surfaced via `lastResult`.
 */
export function pressButton(
  def: ButtonSyncPuzzleDef,
  state: ButtonSyncState,
  roleId: string,
  at: number,
): ButtonSyncResult {
  const pressed: Record<string, number> = {};
  let expired = false;
  for (const [role, time] of Object.entries(state.pressed)) {
    if (def.windowMs !== undefined && at - time > def.windowMs) {
      expired = true;
    } else {
      pressed[role] = time;
    }
  }
  pressed[roleId] = at;

  const solved = def.buttons.every((b) => pressed[b.roleId] !== undefined);
  return {
    state: {
      type: 'button-sync',
      pressed,
      attempts: expired ? state.attempts + 1 : state.attempts,
      lastResult: expired ? 'missed-window' : null,
    },
    solved,
  };
}
