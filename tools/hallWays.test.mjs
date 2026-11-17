import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { HALL_WAYS, unworked, waysMatch } from './hallWays.mjs';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/** The walkthrough's source, read as text: shots.mjs runs its walkthrough as it loads. */
const SHOTS = read('./shots.mjs');
const HALL = JSON.parse(read('../missions/uebungshalle.json'));
const PLAN = JSON.parse(read('./fixtures/hall-plan.json'));

/**
 * The keys of the object literal `const <name> = {` in the walkthrough's source, as its lines at
 * the first level of the literal name them: `  wiring: …`, `  'button-sync': …`.
 */
function keysOf(name) {
  const start = SHOTS.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `shots.mjs has no ${name}`);
  const body = SHOTS.slice(start, SHOTS.indexOf('\n};', start));
  return [...body.matchAll(/^ {2}'?([\w-]+)'?:/gm)].map(([, key]) => key);
}

describe('the hall’s ways', () => {
  it('know a way to work every station type the Übungshalle and its plan have', () => {
    assert.deepEqual(unworked(HALL.puzzles.map((puzzle) => puzzle.type)), []);
    assert.deepEqual(unworked(PLAN.stations.map((station) => station.type)), []);
  });

  it('are the walkthrough’s own tables: controls, drivers and followers', () => {
    const tables = {
      controls: keysOf('HALL_CONTROLS'),
      drivers: keysOf('HALL_DRIVERS'),
      followers: keysOf('HALL_FOLLOWERS'),
    };
    assert.deepEqual(waysMatch(HALL_WAYS, tables), []);
    assert.deepEqual(tables.followers, ['firewall']);
    // the walkthrough holds its tables to the ways as it loads, and checks the hall's types
    assert.match(SHOTS, /waysMatch\(HALL_WAYS, \{/);
    assert.match(SHOTS, /unworked\(HALL_PLAN\.stations\.map/);
  });

  it('name a station type no way works, and each disagreement of a table', () => {
    assert.deepEqual(unworked(['wiring', 'teleporter', 'teleporter']), ['teleporter']);
    const ways = { a: 'control', b: 'follow' };
    assert.deepEqual(waysMatch(ways, { controls: ['a'], drivers: [], followers: ['b'] }), []);
    assert.deepEqual(waysMatch(ways, { controls: ['a', 'b'], drivers: [], followers: [] }), [
      "b is worked by control, but the hall's ways say follow",
      'b should be worked by follow, but that table has no entry for it',
    ]);
    assert.deepEqual(waysMatch(ways, { controls: ['a', 'c'], drivers: [], followers: ['b'] }), [
      "c is worked by control, but the hall's ways say none",
    ]);
  });
});
