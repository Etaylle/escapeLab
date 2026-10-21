import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  isCustomMissionId,
  moduleFor,
  parseMission,
  type Mission,
  type MissionInfo,
  type MissionManual,
} from '@escapelab/core';

/** Every mission file in a directory, by name, in a stable order. */
function missionFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

/**
 * All missions from a directory, sorted for the picker. Fails fast on bad
 * files. Missions made in the editor live in a directory of their own
 * (`customDir`, missions/custom/ on the server): read at the start and again
 * after every save or delete, listed after the shipped ones. A custom file
 * that does not hold up is left out with a warning on the console — it is
 * somebody's draft, not a reason for the server to stay down.
 */
export class MissionCatalog {
  private readonly builtIn = new Map<string, Mission>();
  private custom = new Map<string, Mission>();
  private sorted: Mission[] = [];

  constructor(
    dir: string,
    readonly customDir: string | null = null,
  ) {
    const files = missionFiles(dir);
    if (files.length === 0) {
      throw new Error(`No mission files (*.json) found in ${dir}`);
    }
    for (const file of files) {
      const mission = parseMission(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      if (this.builtIn.has(mission.id)) {
        throw new Error(`Duplicate mission id "${mission.id}" (${file})`);
      }
      this.builtIn.set(mission.id, mission);
    }
    for (const mission of this.builtIn.values()) {
      if (mission.next !== undefined && !this.builtIn.has(mission.next)) {
        throw new Error(
          `Mission "${mission.id}" leads on to "${mission.next}", which is no mission in ` +
            `${dir} — name a shipped mission in "next", or leave it out`,
        );
      }
    }
    this.reloadCustom();
  }

  /** The shipped missions by listOrder and title, then the custom ones the same way. */
  get all(): Mission[] {
    return this.sorted;
  }

  get(id: string): Mission {
    const mission = this.find(id);
    if (mission === undefined) {
      throw new Error(`Mission "${id}" gibt es nicht.`);
    }
    return mission;
  }

  /** The mission with this id, shipped or custom; undefined when there is none. */
  find(id: string): Mission | undefined {
    return this.builtIn.get(id) ?? this.custom.get(id);
  }

  isCustom(id: string): boolean {
    return this.custom.has(id);
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
      players: { min: m.players.min, max: m.players.max },
      timeLimitSec: m.timeLimitSec,
      puzzleCount: m.puzzles.length,
      tiles: m.map.tiles,
      ...(this.isCustom(m.id) ? { custom: true } : {}),
    }));
  }

  /**
   * Writes a validated custom mission to `<customDir>/<id>.json` — through a
   * temporary file, so a crash never leaves half a mission behind — and reads
   * the custom missions again, so a new room can pick it at once. Replaces
   * the file of the same id.
   */
  saveCustom(mission: Mission): void {
    const dir = this.requireCustomDir();
    if (!isCustomMissionId(mission.id)) {
      throw new Error(`"${mission.id}" is not a custom mission id`);
    }
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${mission.id}.json`);
    const draft = `${file}.tmp`;
    writeFileSync(draft, `${JSON.stringify(mission, null, 2)}\n`);
    renameSync(draft, file);
    this.reloadCustom();
  }

  /** Removes a custom mission's file and reads the rest again; false when there was none. */
  deleteCustom(id: string): boolean {
    const dir = this.requireCustomDir();
    if (!isCustomMissionId(id) || !this.custom.has(id)) {
      return false;
    }
    rmSync(join(dir, `${id}.json`), { force: true });
    this.reloadCustom();
    return true;
  }

  /** Reads every custom mission again; a file that does not hold up is left out, with a warning. */
  reloadCustom(): void {
    const custom = new Map<string, Mission>();
    const dir = this.customDir;
    if (dir !== null && existsSync(dir)) {
      for (const file of missionFiles(dir)) {
        const loaded = this.readCustom(join(dir, file), file);
        if (typeof loaded === 'string') {
          console.warn(`[escapelab] custom mission ${file} left out: ${loaded}`);
        } else {
          custom.set(loaded.id, loaded);
        }
      }
    }
    const known = (id: string): boolean => this.builtIn.has(id) || custom.has(id);
    for (const [id, mission] of custom) {
      if (mission.next !== undefined && !known(mission.next)) {
        console.warn(
          `[escapelab] custom mission ${id}.json left out: it leads on to "${mission.next}", ` +
            'which the catalog does not have',
        );
        custom.delete(id);
      }
    }
    this.custom = custom;
    const byOrder = (a: Mission, b: Mission): number =>
      a.listOrder - b.listOrder || a.title.localeCompare(b.title);
    const shipped = [...this.builtIn.values()].sort(byOrder);
    this.sorted = [...shipped, ...[...custom.values()].sort(byOrder)];
  }

  /** One custom file: its mission, or why it cannot be one. */
  private readCustom(path: string, file: string): Mission | string {
    let mission: Mission;
    try {
      mission = parseMission(JSON.parse(readFileSync(path, 'utf8')));
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    if (!isCustomMissionId(mission.id) || file !== `${mission.id}.json`) {
      return `its id "${mission.id}" has to start with "custom-" and name the file`;
    }
    if (this.builtIn.has(mission.id)) {
      return `a shipped mission is called "${mission.id}" already`;
    }
    return mission;
  }

  private requireCustomDir(): string {
    if (this.customDir === null) {
      throw new Error('This catalog keeps no custom missions: it was made without a customDir.');
    }
    return this.customDir;
  }

  /** Every station's printed rules in mission order; null for an unknown id. */
  manual(id: string): MissionManual | null {
    const mission = this.find(id);
    if (mission === undefined) {
      return null;
    }
    return {
      missionTitle: mission.title,
      hintCostSec: mission.hintCostSec,
      stations: mission.puzzles.map((def, index) => {
        const puzzleModule = moduleFor(def.type);
        return {
          index,
          title: def.title,
          readAt: [
            ...new Set(
              mission.map.manuals.filter((m) => m.puzzleIds.includes(def.id)).map((m) => m.label),
            ),
          ],
          usesEdgework: puzzleModule.usesEdgework,
          manual: puzzleModule.manual(def),
        };
      }),
    };
  }
}
