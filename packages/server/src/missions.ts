import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  moduleFor,
  parseMission,
  type Mission,
  type MissionInfo,
  type MissionManual,
  type MissionManualStation,
  type PuzzleDef,
} from '@escapelab/core';

/** All missions from a directory, sorted for the picker. Fails fast on bad files. */
export class MissionCatalog {
  private readonly byId = new Map<string, Mission>();
  readonly all: Mission[];

  constructor(dir: string) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      throw new Error(`No mission files (*.json) found in ${dir}`);
    }
    for (const file of files) {
      const mission = parseMission(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      if (this.byId.has(mission.id)) {
        throw new Error(`Duplicate mission id "${mission.id}" (${file})`);
      }
      this.byId.set(mission.id, mission);
    }
    this.all = [...this.byId.values()].sort(
      (a, b) => a.listOrder - b.listOrder || a.title.localeCompare(b.title),
    );
  }

  get(id: string): Mission {
    const mission = this.byId.get(id);
    if (mission === undefined) {
      throw new Error(`Mission "${id}" gibt es nicht.`);
    }
    return mission;
  }

  get default(): Mission {
    const first = this.all[0];
    if (first === undefined) {
      throw new Error('Mission catalog is empty.');
    }
    return first;
  }

  infos(): MissionInfo[] {
    return this.all.map((m) => ({
      id: m.id,
      title: m.title,
      subtitle: m.subtitle,
      roles: m.roles.map((r) => r.name),
      timeLimitSec: m.timeLimitSec,
      puzzleCount: m.puzzles.length,
      tiles: m.map?.tiles ?? [],
    }));
  }

  /** Every station's printed rules in mission order; null for an unknown id. */
  manual(id: string): MissionManual | null {
    const mission = this.byId.get(id);
    if (mission === undefined) {
      return null;
    }
    const roleName = (roleId: string): string =>
      mission.roles.find((r) => r.id === roleId)?.name ?? roleId;
    return {
      missionTitle: mission.title,
      hintCostSec: mission.hintCostSec,
      stations: mission.puzzles.map((def, index) => {
        const puzzleModule = moduleFor(def.type);
        return {
          index,
          title: def.title,
          ...stationRoles(def, roleName),
          usesEdgework: puzzleModule.usesEdgework,
          manual: puzzleModule.manual(def),
        };
      }),
    };
  }
}

/** Who works a station and who reads its rules; at a button-sync every listed role presses. */
function stationRoles(
  def: PuzzleDef,
  roleName: (roleId: string) => string,
): Pick<MissionManualStation, 'operatorRoleName' | 'manualRoleName'> {
  if (def.type === 'button-sync') {
    return {
      operatorRoleName: def.buttons.map((b) => roleName(b.roleId)).join(', '),
      manualRoleName: null,
    };
  }
  if (!('operatorRoleId' in def)) {
    // An emergency module never stands at a station; mission validation rejects that.
    throw new Error(`"${def.type}" is not a station module`);
  }
  return {
    operatorRoleName: roleName(def.operatorRoleId),
    manualRoleName: roleName(def.manualRoleId),
  };
}
