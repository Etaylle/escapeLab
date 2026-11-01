import { describe, expect, it, vi } from 'vitest';
import { FakeBuffer } from './fakeGraph.js';

/** What the page keeps of its sound as PCM, counted (world/audioMemory.ts). */

async function memory() {
  vi.resetModules();
  return import('../src/world/audioMemory.js');
}

const buffer = (length: number, channels = 1): AudioBuffer =>
  new FakeBuffer(length, 44100, channels) as unknown as AudioBuffer;

describe('the PCM a page keeps', () => {
  it('counts four bytes a sample, every channel', async () => {
    const { bytesOf } = await memory();
    expect(bytesOf({ length: 44100, numberOfChannels: 1 })).toBe(176_400);
    expect(bytesOf({ length: 32000, numberOfChannels: 2 })).toBe(256_000);
  });

  it('sums what each holder keeps, a buffer two hold counted once', async () => {
    const { decodedBytes, hold } = await memory();
    expect(decodedBytes()).toEqual({ total: 0, effects: 0, beds: 0, voice: 0, made: 0 });
    const step = buffer(1000);
    hold('sample:step-concrete-1', 'effects', step);
    hold('sample:step-lino-1', 'effects', step); // borrows the same recording
    hold('sample:bed-lab', 'beds', buffer(1000, 2));
    hold('voice:a', 'voice', buffer(500));
    hold('noise', 'made', buffer(250));
    expect(decodedBytes()).toEqual({
      total: 4000 + 8000 + 2000 + 1000,
      effects: 4000,
      beds: 8000,
      voice: 2000,
      made: 1000,
    });
  });

  it('drops what is let go, and keeps one buffer a key at a time', async () => {
    const { decodedBytes, hold, letGo } = await memory();
    hold('voice:a', 'voice', buffer(500));
    hold('voice:a', 'voice', buffer(100)); // the same key held anew
    expect(decodedBytes().voice).toBe(400);
    letGo('voice:a');
    letGo('voice:never-held');
    expect(decodedBytes().total).toBe(0);
  });

  it('holds a page to 30 MB', async () => {
    const { DECODED_BUDGET } = await memory();
    expect(DECODED_BUDGET).toBe(30 * 1024 * 1024);
  });
});
