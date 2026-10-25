import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import {
  accountVoices,
  ELEVEN_FORMAT,
  ELEVEN_GAP_MS,
  ELEVEN_MODEL,
  ELEVEN_RETRIES,
  ELEVEN_VOICE,
  ENV_FILE,
  loadApiKey,
  oneByOne,
  resolveVoice,
  retryAfterMs,
  sampleFile,
  samplesDir,
  speakEleven,
  speechRequest,
  voiceRow,
  type SpeechClient,
  type VoiceInfo,
} from '../scripts/elevenlabs.js';

/**
 * The ElevenLabs engine against a client of the tests' own: no request ever leaves, and the
 * repo's .env.local is never read — the key tests read files of their own.
 */

const VOICES: VoiceInfo[] = [
  {
    voiceId: ELEVEN_VOICE,
    name: 'Helmut - German Epic Trailer Voice',
    category: 'professional',
    labels: { language: 'de', gender: 'male', age: 'old' },
  },
  { voiceId: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', category: 'premade', labels: {} },
  { voiceId: 'nameless0000000000aa' },
];

const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x44, 1, 2, 3]);

/** A client that lists VOICES and answers every request with `answers`, one after another. */
function clientOf(...answers: (Uint8Array<ArrayBuffer> | Error)[]) {
  const requests: [string, ElevenLabs.BodyTextToSpeechFull][] = [];
  const client: SpeechClient = {
    voices: { getAll: () => Promise.resolve({ voices: VOICES }) },
    textToSpeech: {
      convert: (voiceId, request) => {
        requests.push([voiceId, request]);
        const answer = answers.shift() ?? new Error('no answer left');
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(new Blob([answer]).stream());
      },
    },
  };
  return { client, requests };
}

/** An error as the SDK throws it for a status, with the headers it came with. */
function refusal(statusCode: number, headers: Record<string, string> = {}, body?: unknown): Error {
  return Object.assign(new Error(`Status code: ${statusCode}`), {
    statusCode,
    body,
    rawResponse: { headers: new Headers(headers) },
  });
}

const noWait = (): Promise<void> => Promise.resolve();

describe('the key', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'escapelab-key-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is looked for in the repo’s .env.local', () => {
    expect(ENV_FILE).toBe(fileURLToPath(new URL('../../../.env.local', import.meta.url)));
  });

  it('comes from the environment first, trimmed, and then the file is not read', () => {
    const file = join(dir, '.env.local');
    writeFileSync(file, 'ELEVENLABS_API_KEY=from-the-file\n');
    const env: NodeJS.ProcessEnv = { ELEVENLABS_API_KEY: '  from-the-shell \n' };
    loadApiKey(env, file);
    expect(env['ELEVENLABS_API_KEY']).toBe('from-the-shell');
  });

  it('else from the env file, that one value alone, trimmed, into the environment', () => {
    const file = join(dir, '.env.local');
    writeFileSync(file, '# ElevenLabs\nOTHER=1\nELEVENLABS_API_KEY="  sk_from_the_file  "\n');
    const env: NodeJS.ProcessEnv = {};
    loadApiKey(env, file);
    expect(env).toEqual({ ELEVENLABS_API_KEY: 'sk_from_the_file' });
  });

  it('fails naming both places where neither has one', () => {
    const empty = join(dir, '.env.local');
    writeFileSync(empty, 'OTHER=1\n');
    for (const file of [empty, join(dir, 'missing.env')]) {
      expect(() => loadApiKey({ ELEVENLABS_API_KEY: ' ' }, file)).toThrow(
        /ELEVENLABS_API_KEY.*\.env\.local.*ELEVENLABS_API_KEY in the environment/,
      );
    }
  });
});

describe('the account’s voices', () => {
  it('are listed by name, id, kind and labels', async () => {
    const { client } = clientOf();
    const rows = (await accountVoices(client)).map(voiceRow);
    expect(rows).toEqual([
      `Helmut - German Epic Trailer Voice  ·  ${ELEVEN_VOICE}  ·  professional  ·  ` +
        'language de, gender male, age old',
      'George  ·  JBFqnCBsd6RMkjVDRZzb  ·  premade',
      '(no name)  ·  nameless0000000000aa',
    ]);
  });

  it('give the voice by its id or its exact name, Helmut by default', () => {
    expect(resolveVoice(VOICES, ELEVEN_VOICE).name).toBe('Helmut - German Epic Trailer Voice');
    expect(resolveVoice(VOICES, 'George').voiceId).toBe('JBFqnCBsd6RMkjVDRZzb');
    expect(ELEVEN_VOICE).toBe('g1jpii0iyvtRs8fqXsd1');
  });

  it('refuse a name that is not exact, naming every voice there is', () => {
    expect(() => resolveVoice(VOICES, 'Helmut')).toThrow(
      /no voice "Helmut".*"Helmut - German Epic Trailer Voice", "George", "nameless0000000000aa"/,
    );
    expect(() => resolveVoice([], 'George')).toThrow(/has none/);
  });
});

describe('a request for speech', () => {
  it('asks Eleven v4 for German MP3 at 96 kbit/s, held with stability and similarity alone', () => {
    expect(ELEVEN_MODEL).toBe('eleven_v4');
    expect(speechRequest('Reaktor läuft.', ELEVEN_MODEL)).toEqual({
      text: 'Reaktor läuft.',
      modelId: 'eleven_v4',
      outputFormat: 'mp3_44100_96',
      languageCode: 'de',
      voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
    });
  });

  it('gives an older model style and speaker boost, and multilingual v2 no language code', () => {
    expect(speechRequest('Los.', 'eleven_multilingual_v2')).toEqual({
      text: 'Los.',
      modelId: 'eleven_multilingual_v2',
      outputFormat: ELEVEN_FORMAT,
      voiceSettings: { stability: 0.5, similarityBoost: 0.75, style: 0.2, useSpeakerBoost: true },
    });
    expect(speechRequest('Los.', 'eleven_v3').languageCode).toBe('de');
  });
});

describe('a line read by ElevenLabs', () => {
  it('comes back as the MP3 the voice made, from one request for its text', async () => {
    const { client, requests } = clientOf(MP3);
    const voice = { client, voiceId: ELEVEN_VOICE, model: ELEVEN_MODEL };
    const dir = mkdtempSync(join(tmpdir(), 'escapelab-mp3-'));
    try {
      const file = join(dir, 'abc.mp3');
      writeFileSync(file, await speakEleven(voice, 'Reaktor läuft.', noWait));
      expect([...readFileSync(file)]).toEqual([...MP3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(requests).toEqual([[ELEVEN_VOICE, speechRequest('Reaktor läuft.', ELEVEN_MODEL)]]);
  });

  it('waits the seconds a 429’s retry-after asks, and goes again', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const waits: number[] = [];
    const wait = (ms: number): Promise<void> => {
      waits.push(ms);
      return Promise.resolve();
    };
    const busy = refusal(429, { 'retry-after': '2' });
    const { client, requests } = clientOf(busy, refusal(429), MP3);
    const voice = { client, voiceId: ELEVEN_VOICE, model: ELEVEN_MODEL };
    const mp3 = await speakEleven(voice, 'Reaktor läuft.', wait);
    expect([...mp3]).toEqual([...MP3]);
    expect(waits).toEqual([2000, 1000]);
    expect(requests).toHaveLength(3);
    expect(said).toHaveBeenCalledTimes(2);
    said.mockRestore();
  });

  it('gives up after ELEVEN_RETRIES pauses, and at once on any other refusal', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const always = Array.from({ length: ELEVEN_RETRIES + 1 }, () => refusal(429));
    const busy = clientOf(...always);
    const voice = { client: busy.client, voiceId: ELEVEN_VOICE, model: ELEVEN_MODEL };
    await expect(speakEleven(voice, 'Los.', noWait)).rejects.toThrow(/"Los\." \(429\)/);
    expect(busy.requests).toHaveLength(ELEVEN_RETRIES + 1);
    const denied = clientOf(refusal(401, {}, { detail: { status: 'invalid_api_key' } }));
    const locked = { ...voice, client: denied.client };
    await expect(speakEleven(locked, 'Los.', noWait)).rejects.toThrow(/\(401\).*invalid_api_key/);
    expect(denied.requests).toHaveLength(1);
    said.mockRestore();
  });

  it('reads the pause only off a 429', () => {
    expect(retryAfterMs(refusal(429, { 'retry-after': '3' }))).toBe(3000);
    expect(retryAfterMs(refusal(429, { 'retry-after': 'soon' }))).toBe(1000);
    expect(retryAfterMs(refusal(500, { 'retry-after': '3' }))).toBeNull();
    expect(retryAfterMs(new Error('offline'))).toBeNull();
    expect(retryAfterMs('nothing')).toBeNull();
  });
});

describe('requests one after the other', () => {
  it('go ELEVEN_GAP_MS apart, never at once, in order', async () => {
    const events: string[] = [];
    const wait = (ms: number): Promise<void> => {
      events.push(`wait ${ms}`);
      return Promise.resolve();
    };
    const job = (name: string) => async (): Promise<string> => {
      events.push(`start ${name}`);
      await Promise.resolve();
      events.push(`end ${name}`);
      return name;
    };
    expect(await oneByOne([job('a'), job('b'), job('c')], ELEVEN_GAP_MS, wait)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(ELEVEN_GAP_MS).toBe(300);
    expect(events).toEqual([
      'start a',
      'end a',
      'wait 300',
      'start b',
      'end b',
      'wait 300',
      'start c',
      'end c',
    ]);
  });

  it('wait not at all without a gap, and stop at the first that fails', async () => {
    const wait = vi.fn(noWait);
    const ran: string[] = [];
    const ok = (name: string) => (): Promise<void> => {
      ran.push(name);
      return Promise.resolve();
    };
    const broken = (): Promise<void> => Promise.reject(new Error('quota'));
    await expect(oneByOne([ok('a'), broken, ok('c')], 0, wait)).rejects.toThrow('quota');
    expect(ran).toEqual(['a']);
    expect(wait).not.toHaveBeenCalled();
  });
});

describe('a sample', () => {
  it('goes to VOICE_SAMPLES_DIR, else the system’s temp, named after the voice asked for', () => {
    expect(samplesDir({ VOICE_SAMPLES_DIR: '/tmp/samples' })).toBe('/tmp/samples');
    expect(samplesDir({})).toBe(join(tmpdir(), 'escapelab-voice-samples'));
    expect(sampleFile('Helmut - German Epic Trailer Voice')).toBe(
      'Helmut-German-Epic-Trailer-Voice.mp3',
    );
    expect(sampleFile(ELEVEN_VOICE)).toBe(`${ELEVEN_VOICE}.mp3`);
    expect(sampleFile('../..')).toBe('voice.mp3');
  });
});
