import { vi } from 'vitest';

/**
 * Just enough of an <audio> element for the streams (world/audioStream.ts): its file, where it
 * plays — `currentTime`, which a test moves as the audio clock moves — how fast, whether it
 * plays, and its listeners. play() resolves, or rejects where the test holds the page's autoplay
 * back (`FakeAudio.blocked`). Every element made is kept in `elements`.
 */

type Listener = { readonly listener: () => void; readonly once: boolean };

export class FakeAudio {
  /** whether play() is refused, as the autoplay rule refuses it before a gesture */
  static blocked = false;
  src = '';
  preload = '';
  loop = false;
  currentTime = 0;
  playbackRate = 1;
  readyState = 4;
  paused = true;
  /** how often play() was asked for */
  plays = 0;
  private readonly listeners = new Map<string, Listener[]>();
  constructor() {
    elements.push(this);
  }
  play(): Promise<void> {
    this.plays += 1;
    if (FakeAudio.blocked) return Promise.reject(new DOMException('held back', 'NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  load(): void {}
  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void {
    const list = this.listeners.get(type) ?? [];
    list.push({ listener, once: options?.once === true });
    this.listeners.set(type, list);
  }
  /** What the browser would tell it: `type` fired. */
  fire(type: string): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((each) => !each.once),
    );
    for (const { listener } of list) listener();
  }
}

/** Every element made since `fakeMedia`, the newest last. */
export const elements: FakeAudio[] = [];

/** Hands the next streams fake elements, and forgets those made. */
export function fakeMedia(): void {
  elements.length = 0;
  FakeAudio.blocked = false;
  vi.stubGlobal('Audio', FakeAudio);
}

/** The elements playing `file` (its address as the stream was opened on it). */
export function playingFile(file: string): FakeAudio[] {
  return elements.filter((element) => element.src.includes(file) && !element.paused);
}
