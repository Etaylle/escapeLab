import { describe, expect, it } from 'vitest';
import { MODULES } from '@escapelab/core';
import { PANELS } from '../src/puzzles/index.js';

describe('panel registry', () => {
  it('has a panel for every core module and none for a module the core does not know', () => {
    const core = MODULES.map((m) => m.type).sort();
    expect(Object.keys(PANELS).sort()).toEqual(core);
  });
});
