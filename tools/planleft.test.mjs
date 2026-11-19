import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { lineOfMove, movesTaken } from './planleft.mjs';

/** Blackout's Serverraum as the plan of the pinned seed plays it. */
const PLAN = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/blackout-plan.json', import.meta.url)), 'utf8'),
);
const { moves } = PLAN.runs[0].subsysteme;

/** The log after the first `taken` moves: `before` lines of the crashes, then a line a move. */
function logAfter(taken, before = 3, last = 8) {
  const crashes = Array.from({ length: before }, (_, i) => `dienst-${i} abgestürzt: E11`);
  const lines = [...crashes, ...moves.slice(0, taken).map(lineOfMove)];
  return lines.map((text, i) => ({ n: i + 1, tag: 'info', text })).slice(-last);
}

describe('the line a move leaves in the log', () => {
  it('names the switch, the start or the restart', () => {
    assert.deepEqual(moves.slice(0, 3).map(lineOfMove), [
      'mail: Strom aus',
      'netz: Strom an',
      'netz läuft',
    ]);
    assert.equal(lineOfMove({ input: { cmd: 'restart', service: 'netz' } }), 'netz neu gestartet');
  });
});

describe('the moves a Serverraum has taken, by its log', () => {
  it('are none before the first, and every one after the last', () => {
    assert.equal(movesTaken(moves, []), 0);
    assert.equal(movesTaken(moves, logAfter(0)), 0);
    assert.equal(movesTaken(moves, logAfter(moves.length)), moves.length);
  });

  it('are counted at every place in the plan, the log whole or cut at its head', () => {
    for (let taken = 0; taken <= moves.length; taken++) {
      assert.equal(movesTaken(moves, logAfter(taken)), taken, `${taken} taken, three crashes`);
      assert.equal(movesTaken(moves, logAfter(taken, 0)), taken, `${taken} taken, no crash`);
    }
  });

  it('count a move the station took though nobody saw it land', () => {
    // the rack's switch was thrown as the emergency came: the log has its line, the page had not
    const seen = 3;
    assert.equal(movesTaken(moves, logAfter(seen + 1)), seen + 1);
  });

  it('pass over a crash between two moves', () => {
    const log = logAfter(6);
    log.splice(-1, 0, { n: 0, tag: 'warn', text: 'dns abgestürzt: E11' });
    assert.equal(movesTaken(moves, log.map((line, i) => ({ ...line, n: i + 1 }))), 6);
  });

  it('throw rather than guess where a cut log fits two places or none', () => {
    // „dns läuft" stands twice in the plan: alone at the end of a cut log it says too little
    const twice = [{ n: 9, tag: 'ok', text: 'dns läuft' }];
    assert.throws(() => movesTaken(moves, twice), /fits 2 places/);
    const wrong = [
      { n: 1, tag: 'info', text: 'netz: Strom an' },
      { n: 2, tag: 'info', text: 'mail: Strom aus' },
    ];
    assert.throws(() => movesTaken(moves, wrong), /fits 0 places/);
  });
});
