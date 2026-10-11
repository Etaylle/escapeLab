/** Rejected action: the message is shown to the acting player. */
export class GameError extends Error {}

export function fail(message: string): never {
  throw new GameError(message);
}
