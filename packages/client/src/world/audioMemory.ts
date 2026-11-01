/**
 * audioMemory.ts: what the page keeps of its sound as PCM, counted. Every buffer of samples the
 * lab holds is registered here by whoever holds it — a recording decoded (samples.ts), a line of
 * mission control's (radioVoice.ts), a room's impulse response or the radio's noise, made here
 * (reverb.ts, audio.ts) — and let go as it is dropped, so that the walkthrough can read how much
 * a page keeps (`window.__escapelab.audio.decodedBytes`) and hold it to its budget. A buffer two
 * holders share is counted once. What streams from its file (the music, the opening's cue, the
 * end card's stings: audioStream.ts) is decoded a little at a time by the browser and kept by
 * none of them: it is not counted, and neither is the convolver's own copy of a response.
 */

/** Who holds a buffer: the effects and the loops, the rooms' beds, the voice, what is made. */
export type Holder = 'effects' | 'beds' | 'voice' | 'made';

/** What a page may keep decoded at most, bytes: the walkthrough fails a page over it. */
export const DECODED_BUDGET = 30 * 1024 * 1024;

/** A buffer's samples as kept: four bytes each, every channel. */
export function bytesOf(buffer: Pick<AudioBuffer, 'length' | 'numberOfChannels'>): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

const held = new Map<string, { readonly holder: Holder; readonly buffer: AudioBuffer }>();

/** `buffer` is kept under `key` by `holder`, in place of whatever was kept under it before. */
export function hold(key: string, holder: Holder, buffer: AudioBuffer): void {
  held.set(key, { holder, buffer });
}

/** Whatever was kept under `key` is dropped. */
export function letGo(key: string): void {
  held.delete(key);
}

/** How much the page keeps now, bytes: in all, and by holder; a shared buffer counted once. */
export function decodedBytes(): { total: number } & Record<Holder, number> {
  const counted = new Set<AudioBuffer>();
  const sums = { total: 0, effects: 0, beds: 0, voice: 0, made: 0 };
  for (const { holder, buffer } of held.values()) {
    if (counted.has(buffer)) continue;
    counted.add(buffer);
    sums[holder] += bytesOf(buffer);
    sums.total += bytesOf(buffer);
  }
  return sums;
}
