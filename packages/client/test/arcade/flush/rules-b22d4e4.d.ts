/**
 * The frozen original rules of „Ferret Flush" (commit b22d4e4 of Uros's game), the oracle its
 * Classic port is replayed against (classic.test.ts); typed as far as the test reads them.
 */
export const W: number;
export const H: number;
export const FIELD: { left: number; right: number; top: number; bottom: number };
export interface OracleBird {
  x: number;
  y: number;
  state: string;
}
export interface OracleGame {
  screen: string;
  mode: string;
  round: number;
  birds: OracleBird[];
  events: { type: string; value?: number }[];
}
export function createGame(options?: { rng?: () => number }): OracleGame;
export function update(
  game: OracleGame,
  dt: number,
  input: { x: number; y: number; fire: boolean; choose: string | null },
): void;
