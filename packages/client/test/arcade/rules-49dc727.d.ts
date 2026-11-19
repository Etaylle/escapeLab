/**
 * The frozen original simulation of „Ferret vs Ducks" (commit 49dc727 of Uros's game), the
 * oracle the machine's Classic rules are replayed against (classic.test.ts). Its state is the
 * original's plain objects, typed as far as the tests read them.
 */
export const WIDTH: number;
export const HEIGHT: number;
export const DEFENSE: number;
export interface OracleDuck {
  x: number;
  y: number;
  alive: boolean;
}
export interface OraclePlayer {
  x: number;
  wave: number;
  dead: boolean;
  ducks: OracleDuck[];
}
export interface OracleGame {
  state: string;
  time: number;
  active: number;
  players: OraclePlayer[];
  random: () => number;
}
export function createGame(difficulty: string, count: number): OracleGame;
export function step(
  game: OracleGame,
  input: { left?: boolean; right?: boolean; fire?: boolean },
  dt: number,
): void;
export function exposed(player: OraclePlayer): OracleDuck[];
