import { writeFileSync } from 'node:fs';
import { hallMission } from './hall.js';
import { hallPlan } from './hallPlan.js';
import { jsonOf } from './jsonOf.js';

/**
 * Writes the Übungshalle (missions/uebungshalle.json) and the walkthrough's plan for it
 * (tools/fixtures/hall-plan.json) anew from the module registry, as hall.test.ts holds them:
 * after a module is added or changed. Run from packages/server, which has tsx:
 *
 *   node --import tsx ../core/test/writeHall.ts
 */

const write = (path: string, data: unknown): void =>
  writeFileSync(new URL(path, import.meta.url), `${jsonOf(data)}\n`);

write('../../../missions/uebungshalle.json', hallMission());
write('../../../tools/fixtures/hall-plan.json', hallPlan());
console.log('wrote missions/uebungshalle.json and tools/fixtures/hall-plan.json');
