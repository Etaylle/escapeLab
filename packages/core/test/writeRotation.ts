import { writeFileSync } from 'node:fs';
import { jsonOf } from './jsonOf.js';
import { rotationPlan } from './rotationPlan.js';

/**
 * Writes the walkthrough's plan for the Wechselprobe (tools/fixtures/rotation-plan.json) anew
 * from the probe, the draw and the solvers, as rotation.test.ts holds it: after the probe, the
 * draw or one of its modules changed. Run from packages/server, which has tsx:
 *
 *   node --import tsx ../core/test/writeRotation.ts
 */

const file = new URL('../../../tools/fixtures/rotation-plan.json', import.meta.url);
writeFileSync(file, `${jsonOf(rotationPlan())}\n`);
console.log('wrote tools/fixtures/rotation-plan.json');
