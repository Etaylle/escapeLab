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

/** Role ids that differ from the role names, so the test can tell which one is served. */
const probe = {
  id: 'probe',
  title: 'Probe',
  story: { intro: '', win: '', lose: '' },
  timeLimitSec: 600,
  roles: [
    { id: 'pult', name: 'Steuerpult', description: '' },
    { id: 'buch', name: 'Anleitung', description: '' },
  ],
  puzzles: [
    {
      type: 'maze',
      id: 'netz',
      title: 'Leitungsnetz',
      prompt: '',
      operatorRoleId: 'pult',
      manualRoleId: 'buch',
    },
    {
      type: 'button-sync',
      id: 'start',
      title: 'Start',
      prompt: '',
      buttons: [
        { roleId: 'buch', label: 'A' },
        { roleId: 'pult', label: 'B' },
      ],
    },
  ],
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

  it('names the roles at each station, and nobody as reader where every role presses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'escapelab-manual-'));
    try {
      writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
      const manual = manualOf(new MissionCatalog(dir), 'probe');
      expect(
        manual.stations.map(({ operatorRoleName, manualRoleName }) => ({
          operatorRoleName,
          manualRoleName,
        })),
      ).toEqual([
        { operatorRoleName: 'Steuerpult', manualRoleName: 'Anleitung' },
        { operatorRoleName: 'Anleitung, Steuerpult', manualRoleName: null },
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
