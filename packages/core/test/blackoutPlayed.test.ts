import { readFileSync } from 'node:fs';
import { parseMission } from '../src/index.js';
import { describeMissionsPlayed } from './missionsPlayed.js';

/**
 * Blackout won through the reducer on 200 seeds, for two and for three, in every draw of its
 * Wechselplatz — in a file of its own: the Anlaufsteuerung's pulses and the Paketfilter's wave
 * run on the clock, a second a round, which makes these two runs the suite's longest by far
 * (some 15 s each on a CI runner), and a worker that holds them beside the Übungshalle's two
 * falls silent long enough for vitest to give it up.
 */
const blackout = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

describeMissionsPlayed([blackout]);
