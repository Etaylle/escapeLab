import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moduleFor, type MissionManual } from '@escapelab/core';
import { apiResponse } from '../src/api.js';
import { MissionCatalog } from '../src/missions.js';

const shipped = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

function manualOf(catalog: MissionCatalog, id: string): MissionManual {
  const res = apiResponse(catalog, `/missions/${id}/manual`);
  expect(res?.status).toBe(200);
  return res?.body as MissionManual;
}

/** A maze read at two places and a whole-crew press nobody reads for. */
const probe = {
  id: 'probe',
  title: 'Probe',
  story: { intro: '', win: '', lose: '' },
  timeLimitSec: 600,
  players: { min: 2, max: 2 },
  puzzles: [
    { type: 'maze', id: 'netz', title: 'Leitungsnetz' },
    { type: 'button-sync', id: 'start', title: 'Start' },
  ],
  map: {
    tiles: ['#######', '#.....#', '#######'],
    spawns: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    stations: [
      { puzzleId: 'netz', x: 3, y: 1 },
      { puzzleId: 'start', x: 4, y: 1 },
    ],
    manuals: [
      {
        id: 'plan',
        kind: 'terminal',
        label: 'SCHALTPLAN',
        puzzleIds: ['netz'],
        spots: [{ x: 5, y: 1 }],
      },
      {
        id: 'tafel',
        kind: 'chart',
        label: 'WANDTAFEL',
        puzzleIds: ['netz'],
        spots: [{ x: 1, y: 1 }],
      },
    ],
  },
};

describe('GET /missions/:id/manual', () => {
  it('has one chapter per puzzle, in mission order, for every shipped mission', () => {
    for (const mission of shipped.all) {
      const manual = manualOf(shipped, mission.id);
      expect(manual.missionTitle).toBe(mission.title);
      expect(manual.hintCostSec).toBe(mission.hintCostSec);
      expect(manual.stations).toHaveLength(mission.puzzles.length);
      for (const [i, def] of mission.puzzles.entries()) {
        const station = manual.stations[i];
        expect(station?.index).toBe(i);
        expect(station?.title).toBe(def.title);
        expect(station?.usesEdgework).toBe(moduleFor(def.type).usesEdgework);
        expect(station?.manual).toEqual(moduleFor(def.type).manual(def));
      }
    }
  });

  it('names where in the lab each station\'s rules lie, and nowhere where everyone presses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'escapelab-manual-'));
    try {
      writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
      const manual = manualOf(new MissionCatalog(dir), 'probe');
      expect(manual.stations.map(({ readAt }) => readAt)).toEqual([
        ['SCHALTPLAN', 'WANDTAFEL'],
        [],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers an unknown or garbled mission id with 404 and a message', () => {
    for (const id of ['gibt-es-nicht', '%E0%A4%A']) {
      const res = apiResponse(shipped, `/missions/${id}/manual`);
      expect(res?.status).toBe(404);
      expect(res?.body).toEqual({ error: expect.stringContaining('gibt es nicht') });
    }
  });

  it('leaves every other path to the static site', () => {
    expect(apiResponse(shipped, '/')).toBeNull();
    expect(apiResponse(shipped, '/missions/blackout')).toBeNull();
    expect(apiResponse(shipped, '/missions/blackout/manual/extra')).toBeNull();
  });
});
