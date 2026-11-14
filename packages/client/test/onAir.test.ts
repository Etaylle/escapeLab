import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roleOf, type RadioMoment, type RunEvent } from '@escapelab/core';
import {
  BANNER_MS,
  BANNER_MS_COARSE,
  PA_BANNER_MS,
  SIGN_NOTE_MS,
  type Notice,
} from '../src/radio.js';
import type * as OnAirModule from '../src/world/onAir.js';
import type { VoiceLine, VoiceManifest } from '../src/world/radioVoice.js';
import {
  endAll,
  fakeGraph,
  lastContext,
  type FakeBufferSource,
  type FakeContext,
} from './fakeGraph.js';
import { serveSamples } from './fakeSamples.js';

/** The plant's message as an emergency starts, then mission control's line on it. */
const ALERT = 'Störung im Kühlkreislauf. Relaissteuerung auf Handbetrieb.';
const CALL = 'Notfall an den Relais. Zwei Leute an die Pulte, sofort.';
/** A nudge, long enough to be cut short; a line of the run's story; one without a recording. */
const NUDGE = 'Leitstelle hier. Der Kasten im Maschinenraum wartet noch auf euch.';
const STORY = 'Notstrom steht. Weiter zum Serverraum.';
const UNRECORDED = 'Eine Zeile aus dem Editor.';

/**
 * Each recording: its id, its words, who says them — the plant's voice, Laura on duty for the
 * call, Helmut the rest — the moment, how long it speaks, s.
 */
const LINES = [
  { id: 'anlage-aaaa', text: ALERT, person: 'anlage', moment: 'announce', seconds: 3.1 },
  { id: 'laura-bbbb', text: CALL, person: 'laura', moment: 'emergency', seconds: 2 },
  { id: 'helmut-cccc', text: NUDGE, person: 'helmut', moment: 'nudge', seconds: 4 },
  { id: 'helmut-dddd', text: STORY, person: 'helmut', moment: 'solved', seconds: 2.5 },
] as const;

const MANIFEST: VoiceManifest = {
  lines: Object.fromEntries(
    LINES.map(({ id, text, person, moment, seconds }) => [
      id,
      {
        text,
        ms: seconds * 1000,
        missions: ['blackout'],
        role: roleOf(moment),
        person,
        moment,
        file: `${id}.m4a`,
      },
    ]),
  ),
};

/** Each line as the voice is asked for it: by its words and who says them. */
const asked = (text: string): VoiceLine => ({
  text,
  person: LINES.find((each) => each.text === text)?.person ?? 'helmut',
});

/**
 * What the server answers for `url`: the recordings' list, or a recording — as text the fake
 * context decodes to a buffer of its length, tagged with its id (fakeGraph.ts) — or nothing.
 */
function answer(url: string) {
  const id = /^\/voice\/([\w-]+)\.m4a$/.exec(url)?.[1];
  const entry = LINES.find((recorded) => recorded.id === id);
  const ok = url === '/voice/manifest.json' || entry !== undefined;
  const bytes = new TextEncoder().encode(`sample:${id ?? ''}:${entry?.seconds ?? 0}:1`);
  const json = (): Promise<VoiceManifest> => Promise.resolve(MANIFEST);
  const arrayBuffer = (): Promise<ArrayBuffer> => Promise.resolve(bytes.buffer);
  return { ok, status: ok ? 200 : 404, json, arrayBuffer };
}

/** A line of the run on the bar's queue, as it came in now, said by whoever its event names. */
function line(label: string, moment: RadioMoment = 'nudge'): Notice {
  const speaker = { role: roleOf(moment), person: asked(label).person };
  const kind = moment === 'nudge' ? 'nudge' : 'radio';
  const event: RunEvent = { at: Date.now(), kind, label, seconds: null, moment, speaker };
  return { kind: 'line', event, notBefore: 0 };
}

/** The speech of the recording `id` as it was played on `ctx`, by when it started. */
const speechOf = (ctx: FakeContext, id: string): FakeBufferSource[] =>
  ctx
    .all<FakeBufferSource>('buffer')
    .filter((source) => source.buffer?.tag === id && source.startedAt !== null);

/** How often the radio was keyed with the chirp, or a line's own key went down, on `ctx`. */
const keyed = (ctx: FakeContext): number => speechOf(ctx, 'radio-key').length;

/** A notice that went up: when, ms from the start, and for how long. */
interface Up {
  readonly at: number;
  readonly ms: number | undefined;
}

describe('the objective bar’s lines on the air', () => {
  /** How late a recording's file comes, ms, by its address. */
  let late: Record<string, number> = {};

  beforeEach(() => {
    fakeGraph();
    vi.useFakeTimers();
    late = {};
    serveSamples({}, (url: string) => {
      const wait = late[url] ?? 0;
      return new Promise((resolve) => setTimeout(() => resolve(answer(url)), wait));
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * The bar's sound as a run's page has it: the recordings' list fetched, the squelches loaded,
   * the lab's context made and woken, its clock running with the page's.
   */
  async function onTheAir() {
    vi.resetModules();
    await (await import('../src/world/samples.js')).preloadSamples();
    (await import('../src/world/audio.js')).audioEngine();
    const radio = await import('../src/world/radioVoice.js');
    radio.voiceForRun();
    await vi.advanceTimersByTimeAsync(0);
    const ctx = lastContext();
    const since = Date.now();
    Object.defineProperty(ctx, 'currentTime', { get: () => 10 + (Date.now() - since) / 1000 });
    const air = await import('../src/world/onAir.js');
    const memory = await import('../src/world/audioMemory.js');
    return { radio, air, ctx, memory };
  }

  /**
   * `notices` put up in turn, as the bar's queue puts them up — each once the one before has
   * stayed its time: what went up, as it went.
   */
  function inTurn(air: typeof OnAirModule, notices: readonly Notice[]): Up[] {
    const start = Date.now();
    const up: Up[] = [];
    const next = (i: number): void => {
      const notice = notices[i];
      if (notice === undefined) return;
      air.airNotice(notice, {
        wait: 0,
        coarse: false,
        show: (shown) => up.push({ at: Date.now() - start, ms: upMsOf(shown) }),
        done: () => next(i + 1),
      });
    };
    next(0);
    return up;
  }

  const upMsOf = (notice: Notice): number | undefined =>
    notice.kind === 'line' ? notice.upMs : undefined;

  it('puts a line up as it sounds: the next never speaks over it, however late', async () => {
    const { radio, air, ctx } = await onTheAir();
    // The plant's message over a slow line: its file comes 2 s after it was queued.
    late['/voice/anlage-aaaa.m4a'] = 2000;
    radio.fetchLines([ALERT, CALL].map(asked));
    const up = inTurn(air, [line(ALERT, 'announce'), line(CALL, 'emergency')]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(up).toEqual([]); // nothing up before it sounds
    expect(speechOf(ctx, 'anlage-aaaa')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    // Up as it sounds, for as long as its recording speaks.
    expect(up).toEqual([{ at: 2000, ms: 3100 }]);
    await vi.advanceTimersByTimeAsync(10_000);
    const [message] = speechOf(ctx, 'anlage-aaaa');
    const [call] = speechOf(ctx, 'laura-bbbb');
    expect(message?.startedAt).toBeCloseTo(12.01, 9);
    // The operator keys up once the message has ended, and speaks after the key. (A timer set in
    // another fires a millisecond on under the fake clock: hence „close to".)
    const messageEnds = (message?.startedAt ?? 0) + 3.1;
    expect(up).toEqual([
      { at: 2000, ms: 3100 },
      { at: expect.closeTo(5100, -1), ms: BANNER_MS },
    ]);
    expect(call?.startedAt).toBeGreaterThan(messageEnds);
    // Said whole: what the operator's line cuts of the loudspeakers comes after the message's end.
    expect(message?.stoppedAt).toBeGreaterThan(messageEnds);
  });

  it('puts a line up without a recording late past its wait, keyed; it stays unsaid', async () => {
    const { radio, air, ctx, memory } = await onTheAir();
    expect(air.VOICE_WAIT_MS).toBe(3000);
    late['/voice/laura-bbbb.m4a'] = 10_000;
    radio.fetchLines([asked(CALL)]);
    const up = inTurn(air, [line(CALL, 'emergency')]);
    await vi.advanceTimersByTimeAsync(air.VOICE_WAIT_MS - 1);
    expect(up).toEqual([]);
    expect(keyed(ctx)).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(up).toEqual([{ at: air.VOICE_WAIT_MS, ms: BANNER_MS }]);
    expect(keyed(ctx)).toBe(1); // the chirp
    // The recording comes at last, its line long up: it is never said, nor kept decoded.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(speechOf(ctx, 'laura-bbbb')).toEqual([]);
    expect(memory.decodedBytes().voice).toBe(0);
  });

  it('puts a line without a recording up at once: keyed, the plant’s silent', async () => {
    const { air, ctx } = await onTheAir();
    const up = inTurn(air, [
      line(UNRECORDED, 'cleared'),
      line('Eine Durchsage ohne Aufnahme.', 'announce'),
      { kind: 'sign' },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(up).toEqual([{ at: 0, ms: BANNER_MS }]);
    expect(keyed(ctx)).toBe(1);
    await vi.advanceTimersByTimeAsync(BANNER_MS + 1);
    expect(up[1]).toEqual({ at: expect.closeTo(BANNER_MS, -1), ms: PA_BANNER_MS });
    expect(keyed(ctx)).toBe(1); // the loudspeakers have no chirp
    await vi.advanceTimersByTimeAsync(PA_BANNER_MS + 1);
    expect(up[2]).toEqual({ at: expect.closeTo(BANNER_MS + PA_BANNER_MS, -1), ms: undefined });
    expect(up).toHaveLength(3);
    // On a touch screen a line stays up for less.
    const coarse: number[] = [];
    air.airNotice(line(UNRECORDED, 'cleared'), {
      wait: 0,
      coarse: true,
      show: (shown) => coarse.push(upMsOf(shown) ?? 0),
      done: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(coarse).toEqual([BANNER_MS_COARSE]);
    expect(SIGN_NOTE_MS).toBe(3500);
  });

  it('cuts what the other speaker still says as a line goes up: one line on the air', async () => {
    const { radio, air, ctx } = await onTheAir();
    radio.fetchLines([NUDGE, STORY].map(asked));
    await vi.advanceTimersByTimeAsync(0);
    const quiet = { show: () => undefined, done: () => undefined, coarse: false };
    // A nudge speaks; the plant's message, a call, outranks it — its file 0.5 s late.
    const nudge = air.airNotice(line(NUDGE), { ...quiet, wait: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    late['/voice/anlage-aaaa.m4a'] = 500;
    radio.fetchLines([asked(ALERT)]);
    nudge(); // the bar takes it back
    const message = air.airNotice(line(ALERT, 'announce'), { ...quiet, wait: 0 });
    await vi.advanceTimersByTimeAsync(499);
    expect(speechOf(ctx, 'helmut-cccc')[0]?.stoppedAt).toBeNull(); // on until the message sounds
    await vi.advanceTimersByTimeAsync(1);
    expect(speechOf(ctx, 'helmut-cccc')[0]?.stoppedAt).toBeCloseTo(11.5 + 0.1, 9);
    // A line of the story outranks the message in its turn: it cuts the loudspeakers short.
    await vi.advanceTimersByTimeAsync(500);
    message();
    air.airNotice(line(STORY, 'solved'), { ...quiet, wait: 0 });
    await vi.advanceTimersByTimeAsync(0);
    const [said] = speechOf(ctx, 'anlage-aaaa');
    expect(said?.stoppedAt).toBeCloseTo(12 + 0.06, 9);
    expect(speechOf(ctx, 'helmut-dddd')).toHaveLength(1);
    // A line without a recording keys the chirp alone: the story's voice is cut under it.
    air.airNotice(line(UNRECORDED, 'clock'), { ...quiet, wait: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(speechOf(ctx, 'helmut-dddd')[0]?.stoppedAt).toBeCloseTo(13 + 0.1, 9);
  });

  it('says nothing of a line taken back before its recording came, nor keeps it', async () => {
    const { radio, air, ctx, memory } = await onTheAir();
    late['/voice/anlage-aaaa.m4a'] = 2000;
    late['/voice/laura-bbbb.m4a'] = 2000;
    radio.fetchLines([ALERT, CALL].map(asked));
    const shown: Notice[] = [];
    const done = vi.fn();
    const take = { wait: 0, coarse: false, show: (notice: Notice) => shown.push(notice), done };
    const message = air.airNotice(line(ALERT, 'announce'), take);
    await vi.advanceTimersByTimeAsync(1000);
    message();
    const call = air.airNotice(line(CALL, 'emergency'), take);
    await vi.advanceTimersByTimeAsync(500);
    call();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(speechOf(ctx, 'anlage-aaaa')).toEqual([]);
    expect(speechOf(ctx, 'laura-bbbb')).toEqual([]);
    expect(shown).toEqual([]);
    expect(done).not.toHaveBeenCalled();
    expect(memory.decodedBytes().voice).toBe(0);
  });

  it('decodes a queued line only as it airs: one the queue drops leaves nothing', async () => {
    const { radio, air, ctx, memory } = await onTheAir();
    // A nudge and a line of the story come in; the story's line drops the nudge from the queue.
    radio.fetchLines([NUDGE, STORY].map(asked));
    await vi.advanceTimersByTimeAsync(0);
    expect(memory.decodedBytes().voice).toBe(0); // both files here, nothing decoded
    inTurn(air, [line(STORY, 'solved')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(memory.decodedBytes().voice).toBe(2.5 * 22050 * 4); // the line on the air alone
    endAll(ctx); // said
    expect(memory.decodedBytes().voice).toBe(0);
  });
});
