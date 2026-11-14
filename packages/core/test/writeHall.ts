import { writeFileSync } from 'node:fs';
import { hallMission } from './hall.js';
import { hallPlan } from './hallPlan.js';

/**
 * Writes the Übungshalle (missions/uebungshalle.json) and the walkthrough's plan for it
 * (tools/fixtures/hall-plan.json) anew from the module registry, as hall.test.ts holds them:
 * after a module is added or changed. Run from packages/server, which has tsx:
 *
 *   node --import tsx ../core/test/writeHall.ts
 */

/** How wide a line of the files may run before an object or a list breaks over lines. */
const WIDTH = 100;

/**
 * `value` as the mission files are set: two spaces a level, an object or a list on one line
 * where it fits — `{ "x": 3, "y": 4 }` — and one entry a line where it does not.
 */
function jsonOf(value: unknown, indent = ''): string {
  const flat = JSON.stringify(value, null, 1)?.replace(/\n\s*/g, ' ') ?? 'null';
  const tidy = flat.replace(/\[ /g, '[').replace(/ \]/g, ']');
  if (typeof value !== 'object' || value === null || indent.length + tidy.length <= WIDTH) {
    return tidy;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${jsonOf(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) => `${inner}${JSON.stringify(key)}: ${jsonOf(item, inner)}`,
  );
  return `{\n${entries.join(',\n')}\n${indent}}`;
}

const write = (path: string, data: unknown): void =>
  writeFileSync(new URL(path, import.meta.url), `${jsonOf(data)}\n`);

write('../../../missions/uebungshalle.json', hallMission());
write('../../../tools/fixtures/hall-plan.json', hallPlan());
console.log('wrote missions/uebungshalle.json and tools/fixtures/hall-plan.json');
