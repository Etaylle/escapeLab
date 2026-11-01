import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lightWorkText } from './lightwork.mjs';

describe('lightWorkText — the walkthrough’s line on the light’s census', () => {
  it('says the sights a frame, how many in all over how many frames, and the bakes', () => {
    const work = { frames: 118, sights: { p50: 1, p95: 2, max: 3, total: 131 }, bakes: 2 };
    assert.equal(
      lightWorkText(work),
      'sights a frame p50 1 · p95 2 · max 3 (131 over 118 frames drawn); bakes 2',
    );
  });

  it('flags a page that keeps no census', () => {
    assert.match(lightWorkText(null), /^!! no census/);
    assert.match(lightWorkText(undefined), /^!! no census/);
  });
});
