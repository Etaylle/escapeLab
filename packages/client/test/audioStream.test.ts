import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeStream,
  lagOf,
  ON_TIME_S,
  openStream,
  rewindStream,
  startStream,
  steer,
  STEER_MAX,
  STEER_S,
  streamReady,
} from '../src/world/audioStream.js';
import { FakeContext, fakeGraph, type FakeGain, type FakeNode } from './fakeGraph.js';
import { elements, FakeAudio, fakeMedia } from './fakeMedia.js';

/**
 * A recording streamed from its file (world/audioStream.ts) against a fake <audio> element and
 * the fake graph: when it is started, how it is steered back on time, rewound and let go, and
 * what it does when the browser holds it back.
 */

const ctx = (): AudioContext => new FakeContext() as unknown as AudioContext;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('a recording streamed from its file', () => {
  beforeEach(() => {
    fakeGraph();
    fakeMedia();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('streams its file into the graph through a level of its own, nothing decoded', () => {
    const live = ctx();
    const dest = live.createGain();
    const stream = openStream(live, '/music/calm.mp3', dest, 0.4);
    const [element] = elements;
    expect([element?.src, element?.preload]).toEqual(['/music/calm.mp3', 'auto']);
    const source = stream.source as unknown as FakeNode;
    expect(source.kind).toBe('media');
    expect(source.outputs).toEqual([stream.out]);
    expect((stream.out as unknown as FakeGain).outputs).toEqual([dest]);
    expect(stream.out.gain.value).toBe(0.4);
    expect([stream.state, stream.zero]).toEqual(['idle', null]);
    expect(streamReady(stream)).toBe(true);
    (element as FakeAudio).readyState = 2;
    expect(streamReady(stream)).toBe(false);
  });

  it('starts from its file’s start as its moment comes on the audio clock', async () => {
    const live = ctx();
    const stream = openStream(live, '/music/calm.mp3', live.destination, 1);
    const element = elements[0] as FakeAudio;
    startStream(stream, live, 10.5); // the context's clock stands at 10
    vi.advanceTimersByTime(499);
    expect(element.plays).toBe(0);
    vi.advanceTimersByTime(1);
    expect(element.plays).toBe(1);
    await settle();
    expect(stream.state).toBe('playing');
    expect(element.currentTime).toBe(0); // no seek: from its start
  });

  it('measures how late it came in, and catches up, at most 3 % faster', async () => {
    const live = ctx();
    const stream = openStream(live, '/music/calm.mp3', live.destination, 1);
    const element = elements[0] as FakeAudio;
    startStream(stream, live, 10);
    vi.advanceTimersByTime(0);
    (live as unknown as { currentTime: number }).currentTime = 10.02; // it plays 20 ms late
    await settle();
    expect(stream.lateBy).toBeCloseTo(0.02, 9);
    (live as unknown as { currentTime: number }).currentTime = 11.02;
    element.currentTime = 1.01; // a second in, 10 ms behind: 2 % faster
    expect(lagOf(stream, live)).toBeCloseTo(0.01, 9);
    expect(steer(stream, live)).toBeCloseTo(0.01, 9);
    expect(element.playbackRate).toBeCloseTo(1 + 0.01 / STEER_S, 9);
    element.currentTime = 0.7; // 320 ms behind: as fast as it may go
    steer(stream, live);
    expect(element.playbackRate).toBeCloseTo(1 + STEER_MAX, 9);
    element.currentTime = 1.08; // 60 ms ahead: slower
    steer(stream, live);
    expect(element.playbackRate).toBeCloseTo(1 - STEER_MAX, 9);
    element.currentTime = 1.02 - ON_TIME_S / 2; // on time: its own speed again
    steer(stream, live);
    expect(element.playbackRate).toBe(1);
  });

  it('comes in further on where it is asked to, and plays at once', async () => {
    const live = ctx();
    const stream = openStream(live, '/intro/title.mp3', live.destination, 1);
    const element = elements[0] as FakeAudio;
    startStream(stream, live, 10 - 3.5, 3.5);
    expect(element.currentTime).toBe(3.5);
    vi.advanceTimersByTime(0);
    await settle();
    expect(stream.state).toBe('playing');
  });

  it('stops at its moment and stands at its start again, ready for its next pass', () => {
    const live = ctx();
    const stream = openStream(live, '/music/calm.mp3', live.destination, 1);
    const element = elements[0] as FakeAudio;
    startStream(stream, live, 10);
    vi.advanceTimersByTime(0);
    element.currentTime = 64;
    element.playbackRate = 1.02;
    rewindStream(stream, live, 10.3);
    vi.advanceTimersByTime(299);
    expect(element.paused).toBe(false);
    vi.advanceTimersByTime(1);
    expect([element.paused, element.currentTime, element.playbackRate]).toEqual([true, 0, 1]);
    expect([stream.state, stream.zero]).toEqual(['idle', null]);
  });

  it('lets its file and its nodes go when closed, its timer with them', () => {
    const live = ctx();
    const stream = openStream(live, '/music/calm.mp3', live.destination, 1);
    const element = elements[0] as FakeAudio;
    startStream(stream, live, 11);
    closeStream(stream);
    vi.advanceTimersByTime(2000);
    expect(element.plays).toBe(0);
    expect([element.src, element.paused, stream.state]).toEqual(['', true, 'closed']);
    expect((stream.source as unknown as FakeNode).disconnected).toBe(true);
    expect((stream.out as unknown as FakeNode).disconnected).toBe(true);
  });

  it('waits for a click or a key where the browser holds it back, and plays then', async () => {
    const handlers = new Map<string, () => void>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, handler: () => void) => handlers.set(type, handler),
    });
    FakeAudio.blocked = true;
    const live = ctx();
    const stream = openStream(live, '/music/won.mp3', live.destination, 1);
    const element = elements[0] as FakeAudio;
    startStream(stream, live, 10);
    vi.advanceTimersByTime(0);
    await settle();
    expect(stream.state).toBe('blocked');
    expect([...handlers.keys()].sort()).toEqual(['keydown', 'pointerdown', 'touchend']);
    FakeAudio.blocked = false;
    handlers.get('pointerdown')?.();
    await settle();
    expect([stream.state, element.plays]).toEqual(['playing', 2]);
    handlers.get('keydown')?.(); // the other listeners find it playing: nothing more
    expect(element.plays).toBe(2);
  });
});
