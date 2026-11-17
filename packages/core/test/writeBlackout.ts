import { writeFileSync } from 'node:fs';
import { blackoutPlans } from './blackoutPlan.js';
import { jsonOf } from './jsonOf.js';

/**
 * Writes the walkthrough's plans for Blackout (tools/fixtures/blackout-plan.json) anew from the
 * mission, the draw and the solvers, as blackoutPlan.test.ts holds them: after Blackout or one
 * of its modules changed. Run from packages/server, which has tsx:
 *
 *   node --import tsx ../core/test/writeBlackout.ts
 */

const file = new URL('../../../tools/fixtures/blackout-plan.json', import.meta.url);
writeFileSync(file, `${jsonOf(blackoutPlans())}\n`);
console.log('wrote tools/fixtures/blackout-plan.json');
