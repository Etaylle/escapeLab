import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission } from '@escapelab/core';
import {
  afconvert,
  audioKind,
  decodedMs,
  MAX_RECORDING_BYTES,
  recordingAllowed,
  serveVoiceRecording,
  voiceId,
  VoiceDesk,
  wavLength,
  type Convert,
  type Measure,
} from '../src/voiceRecording.js';

const SHIPPED = fileURLToPath(new URL('../../../missions', import.meta.url));
const missions: Mission[] = readdirSync(SHIPPED)
  .filter((name) => name.endsWith('.json'))
  .map((name) => parseMission(JSON.parse(readFileSync(join(SHIPPED, name), 'utf8'))));
const blackout = missions.find((mission) => mission.id === 'blackout');
const START = blackout?.radio.start ?? '';
const NUDGE = blackout?.puzzles[0]?.nudges[0] ?? '';

/** 0.75 s of a 440 Hz tone as an MP3 (64 kbit/s, made once with LAME): 0.784 s decoded. */
const TONE_MP3 = readFileSync(new URL('fixtures/tone.mp3', import.meta.url));

/** Whether this machine converts for real: afconvert comes with macOS, CI's Linux has none. */
const HAS_AFCONVERT = existsSync('/usr/bin/afconvert');

/** A stand-in for afconvert where there is none: it writes what an .m4a starts with. */
const fakeConvert: Convert = (wav, m4a) => {
  writeFileSync(m4a, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A ')]));
  return Promise.resolve();
};

/** A stand-in for decoding where afconvert is missing: every file speaks 1234 ms. */
const fakeMeasure: Measure = () => Promise.resolve(1234);

/** A WAV of `seconds` of a 440 Hz tone: 16-bit PCM, one channel, at `rate`. */
function toneWav(seconds: number, rate = 44100): Buffer {
  const samples = Math.round(seconds * rate);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // one channel
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  }
  return wav;
}

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

/** A request as the server sees one; its body declared by length unless `declared` is false. */
function request(
  method: string,
  url: string,
  body: Buffer[] = [],
  declared = true,
): IncomingMessage {
  const length = body.reduce((sum, chunk) => sum + chunk.length, 0);
  const headers = declared && body.length > 0 ? { 'content-length': String(length) } : {};
  return Object.assign(Readable.from(body), {
    method,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage;
}

/** Sends a request to the route and waits for its answer; null when the route leaves it alone. */
async function ask(desk: VoiceDesk | null, req: IncomingMessage): Promise<Answer | null> {
  let answered: (answer: Answer) => void = () => undefined;
  const done = new Promise<Answer>((resolve) => (answered = resolve));
  let status = 0;
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(text: string) {
      answered({ status, body: JSON.parse(text) as Record<string, unknown> });
    },
  };
  return serveVoiceRecording(desk, req, res as unknown as ServerResponse) ? done : null;
}

const post = (id: string, wav: Buffer): IncomingMessage => request('POST', `/voice/${id}`, [wav]);
const upload = (id: string, file: Buffer): IncomingMessage =>
  request('POST', `/voice/${id}?source=upload`, [file]);

let dir = '';
const manifestFile = (): string => join(dir, 'manifest.json');
const manifest = (): Record<string, Record<string, unknown>> =>
  JSON.parse(readFileSync(manifestFile(), 'utf8')) as Record<string, Record<string, unknown>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'escapelab-voice-test-'));
  const start = voiceId(START);
  const entries = {
    [start]: { text: START, ms: 9000, missions: ['blackout'], opens: true, file: `${start}.m4a` },
    ffffffffffff: {
      text: 'Eine andere Zeile.',
      ms: 1200,
      missions: ['systemcheck'],
      file: 'ffffffffffff.m4a',
    },
  };
  writeFileSync(manifestFile(), `${JSON.stringify(entries, null, 2)}\n`);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const desk = (
  convert: Convert = HAS_AFCONVERT ? afconvert : fakeConvert,
  measure: Measure = HAS_AFCONVERT ? decodedMs : fakeMeasure,
): VoiceDesk => new VoiceDesk(dir, () => missions, convert, measure);

describe('the switch for recordings', () => {
  it('is on with ALLOW_RECORD=1 alone, off unset or 0, and refuses anything else', () => {
    expect(recordingAllowed({ ALLOW_RECORD: '1' })).toBe(true);
    expect(recordingAllowed({})).toBe(false);
    expect(recordingAllowed({ ALLOW_RECORD: '' })).toBe(false);
    expect(recordingAllowed({ ALLOW_RECORD: '0' })).toBe(false);
    expect(() => recordingAllowed({ ALLOW_RECORD: 'yes' })).toThrow(/ALLOW_RECORD=yes/);
  });

  it('answers 404 to a recording or a file while it is off, and leaves the folder be', async () => {
    for (const req of [post(voiceId(START), toneWav(0.5)), upload(voiceId(START), TONE_MP3)]) {
      const answer = await ask(null, req);
      expect(answer?.status).toBe(404);
      expect(String(answer?.body['error'])).toMatch(/ALLOW_RECORD=1/);
    }
    expect(readdirSync(dir)).toEqual(['manifest.json']);
  });

  it('takes only POST /voice/:id: the recordings themselves stay the static site’s', async () => {
    expect(await ask(desk(), request('GET', `/voice/${voiceId(START)}.m4a`))).toBeNull();
    expect(await ask(desk(), request('GET', '/voice/manifest.json'))).toBeNull();
    expect(await ask(desk(), request('POST', '/missions/custom', [toneWav(0.1)]))).toBeNull();
    const deeper = request('POST', `/voice/${voiceId(START)}/x`, [toneWav(0.1)]);
    expect(await ask(null, deeper)).toBeNull();
  });
});

describe('a take recorded on the page', () => {
  it('is converted into the folder under its line’s id, the manifest naming a person', async () => {
    const id = voiceId(START);
    const answer = await ask(desk(), post(id, toneWav(0.6)));
    expect(answer).toEqual({
      status: 200,
      body: { id, ms: 600, source: 'human', file: `${id}.m4a` },
    });
    const m4a = readFileSync(join(dir, `${id}.m4a`));
    expect(m4a.toString('ascii', 4, 8)).toBe('ftyp');
    if (HAS_AFCONVERT) {
      const info = execFileSync('afinfo', [join(dir, `${id}.m4a`)], { encoding: 'utf8' });
      expect(info).toMatch(/aac/i);
      expect(Number(/estimated duration:\s*([\d.]+)/.exec(info)?.[1])).toBeCloseTo(0.6, 1);
    }
    expect(manifest()[id]).toEqual({
      text: START,
      ms: 600,
      missions: ['blackout'],
      opens: true,
      source: 'human',
      file: `${id}.m4a`,
    });
    expect(manifest()['ffffffffffff']).toEqual({
      text: 'Eine andere Zeile.',
      ms: 1200,
      missions: ['systemcheck'],
      file: 'ffffffffffff.m4a',
    });
    expect(readdirSync(dir).sort()).toEqual([`${id}.m4a`, 'manifest.json']);
  });

  it('enters a shipped line the manifest does not list yet, in the order of the ids', async () => {
    const id = voiceId(NUDGE);
    const answer = await ask(desk(fakeConvert), post(id, toneWav(1.25)));
    expect(answer?.status).toBe(200);
    expect(manifest()[id]).toEqual({
      text: NUDGE,
      ms: 1250,
      missions: ['blackout'],
      source: 'human',
      file: `${id}.m4a`,
    });
    const ids = Object.keys(manifest());
    expect(ids).toEqual([...ids].sort());
    expect(readFileSync(manifestFile(), 'utf8')).toMatch(/\n$/);
  });

  it('refuses an id or a source that is none, and a line no shipped mission says', async () => {
    for (const wrong of ['manifest.json', voiceId(START).toUpperCase(), '..']) {
      expect((await ask(desk(), post(wrong, toneWav(0.2))))?.status, wrong).toBe(400);
    }
    const strange = request('POST', `/voice/${voiceId(START)}?source=robot`, [toneWav(0.2)]);
    const refused = await ask(desk(), strange);
    expect(refused?.status).toBe(400);
    expect(String(refused?.body['error'])).toMatch(/source=robot.*source=upload/);
    const nobody = await ask(desk(), post('0123456789ab', toneWav(0.2)));
    expect(nobody?.status).toBe(404);
    expect(String(nobody?.body['error'])).toMatch(/0123456789ab/);
    expect(readdirSync(dir)).toEqual(['manifest.json']);
  });

  it('refuses more than 8 MB, as declared or as it streams in', async () => {
    const id = voiceId(START);
    const big = Buffer.alloc(MAX_RECORDING_BYTES + 1);
    expect((await ask(desk(), request('POST', `/voice/${id}`, [big])))?.status).toBe(413);
    const halves = [big.subarray(0, 5_000_000), big.subarray(5_000_000)];
    const streamed = await ask(desk(), request('POST', `/voice/${id}`, halves, false));
    expect(streamed?.status).toBe(413);
    expect(String(streamed?.body['error'])).toMatch(/8 MB/);
    const file = request('POST', `/voice/${id}?source=upload`, [big]);
    expect((await ask(desk(), file))?.status).toBe(413);
    expect(manifest()[id]?.['source']).toBeUndefined();
  });

  it('refuses a WAV that is no PCM, saying what is wrong', async () => {
    const id = voiceId(START);
    const float = toneWav(0.2);
    float.writeUInt16LE(3, 20);
    const empty = toneWav(0);
    const answers = await Promise.all([float, empty].map((wav) => ask(desk(), post(id, wav))));
    expect(answers.map((answer) => answer?.status)).toEqual([400, 400]);
    expect(answers.map((answer) => answer?.body['error'])).toEqual([
      'Keine PCM-Aufnahme: Angenommen wird nur unkomprimiertes WAV.',
      'Die Aufnahme ist leer.',
    ]);
  });

  it('leaves nothing behind where the conversion fails, and says why', async () => {
    const broken: Convert = (_wav, m4a) => {
      writeFileSync(m4a, 'half');
      return Promise.reject(new Error('afconvert: Fehler -50'));
    };
    const before = readFileSync(manifestFile(), 'utf8');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const answer = await ask(desk(broken), post(voiceId(START), toneWav(0.3)));
    expect(answer?.status).toBe(500);
    expect(String(answer?.body['error'])).toMatch(/Fehler -50/);
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/POST \/voice\/\w+ failed/));
    logged.mockRestore();
    expect(readdirSync(dir)).toEqual(['manifest.json']);
    expect(readFileSync(manifestFile(), 'utf8')).toBe(before);
  });

  it('saves two recordings sent at once one after the other: the manifest keeps both', async () => {
    const shared = desk(fakeConvert);
    const [a, b] = await Promise.all([
      ask(shared, post(voiceId(START), toneWav(0.4))),
      ask(shared, post(voiceId(NUDGE), toneWav(0.5))),
    ]);
    expect([a?.status, b?.status]).toEqual([200, 200]);
    expect(manifest()[voiceId(START)]?.['ms']).toBe(400);
    expect(manifest()[voiceId(NUDGE)]?.['ms']).toBe(500);
  });
});

describe('a file put on the page', () => {
  it('keeps an MP3 as it came, its decoded length noted, the line’s earlier M4A gone', async () => {
    const id = voiceId(START);
    writeFileSync(join(dir, `${id}.m4a`), 'the synthetic voice');
    const answer = await ask(desk(), upload(id, TONE_MP3));
    const ms = HAS_AFCONVERT ? 784 : 1234;
    expect(answer).toEqual({ status: 200, body: { id, ms, source: 'upload', file: `${id}.mp3` } });
    expect(readFileSync(join(dir, `${id}.mp3`)).equals(TONE_MP3)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual([`${id}.mp3`, 'manifest.json']);
    expect(manifest()[id]).toEqual({
      text: START,
      ms,
      missions: ['blackout'],
      opens: true,
      source: 'upload',
      file: `${id}.mp3`,
    });
  });

  it('keeps an M4A as it came, and lets go of an MP3 the line had before', async () => {
    const id = voiceId(NUDGE);
    const work = mkdtempSync(join(tmpdir(), 'escapelab-m4a-'));
    try {
      const wav = join(work, 'tone.wav');
      const m4a = join(work, 'tone.m4a');
      writeFileSync(wav, toneWav(0.5));
      await (HAS_AFCONVERT ? afconvert : fakeConvert)(wav, m4a);
      writeFileSync(join(dir, `${id}.mp3`), 'an earlier file');
      const sent = readFileSync(m4a);
      const answer = await ask(desk(), upload(id, sent));
      expect(answer?.status).toBe(200);
      expect(answer?.body['file']).toBe(`${id}.m4a`);
      expect(readFileSync(join(dir, `${id}.m4a`)).equals(sent)).toBe(true);
      expect(existsSync(join(dir, `${id}.mp3`))).toBe(false);
      const ms = Number(answer?.body['ms']);
      expect(HAS_AFCONVERT ? Math.abs(ms - 500) <= 30 : ms === 1234, `${ms} ms`).toBe(true);
      expect(manifest()[id]?.['source']).toBe('upload');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('converts a WAV, as a take, but names it a file put there', async () => {
    const id = voiceId(START);
    const answer = await ask(desk(fakeConvert), upload(id, toneWav(0.8)));
    expect(answer?.body).toEqual({ id, ms: 800, source: 'upload', file: `${id}.m4a` });
  });

  it('turns away WebM, which afconvert cannot read, and whatever is no audio', async () => {
    const id = voiceId(START);
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
    const answers = await Promise.all(
      [webm, Buffer.from('not audio at all')].map((bytes) => ask(desk(), upload(id, bytes))),
    );
    expect(answers.map((answer) => answer?.status)).toEqual([415, 415]);
    expect(answers.map((answer) => answer?.body['error'])).toEqual([
      'WebM kann afconvert nicht lesen: Angenommen werden mp3, m4a oder wav.',
      'Keine Audiodatei: Angenommen werden mp3, m4a oder wav.',
    ]);
    expect(readdirSync(dir)).toEqual(['manifest.json']);
  });

  it('turns away an MP3 that does not decode, and leaves nothing behind', async () => {
    const before = readFileSync(manifestFile(), 'utf8');
    const deaf: Measure = () => Promise.reject(new Error('Couldn’t open input file'));
    const broken = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);
    const answer = await ask(desk(fakeConvert, deaf), upload(voiceId(START), broken));
    expect(answer?.status).toBe(400);
    expect(answer?.body['error']).toBe('Die Datei ließ sich nicht lesen: Couldn’t open input file');
    expect(readdirSync(dir)).toEqual(['manifest.json']);
    expect(readFileSync(manifestFile(), 'utf8')).toBe(before);
  });
});

describe('the kind of a file', () => {
  it('is told by its first bytes', () => {
    expect(audioKind(toneWav(0.01))).toBe('wav');
    expect(audioKind(TONE_MP3)).toBe('mp3');
    expect(audioKind(Buffer.from('ID3\u0004\u0000'))).toBe('mp3');
    expect(audioKind(Buffer.from([0, 0, 0, 32, ...Buffer.from('ftypM4A ')]))).toBe('m4a');
    expect(audioKind(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe('webm');
  });

  it('is none for AAC without a box, for text, and for too little', () => {
    expect(audioKind(Buffer.from([0xff, 0xf1, 0x50, 0x80]))).toBeNull();
    expect(audioKind(Buffer.from('RIFF....AVI LIST'))).toBeNull();
    expect(audioKind(Buffer.from('hello'))).toBeNull();
    expect(audioKind(Buffer.alloc(0))).toBeNull();
  });
});


describe('a WAV’s length', () => {
  it('comes from its byte rate and its data, the chunks in any order', () => {
    expect(wavLength(toneWav(1.5))).toEqual({ ok: true, ms: 1500 });
    expect(wavLength(toneWav(0.25, 22050))).toEqual({ ok: true, ms: 250 });
    const tone = toneWav(0.5);
    // A chunk of three bytes, padded to four: the walk has to step over the pad.
    const odd = Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0, 97, 98, 99, 0])]);
    const fmt = tone.subarray(12, 36);
    const data = tone.subarray(36);
    const reordered = Buffer.concat([tone.subarray(0, 12), odd, data, fmt]);
    expect(wavLength(reordered)).toEqual({ ok: true, ms: 500 });
  });

  it('reads PCM in the extensible format, as afconvert writes a decoded AAC, and no float', () => {
    /** The tone with a 40-byte fmt chunk: format 0xFFFE, the sub-format's first word `sub`. */
    const extensible = (sub: number): Buffer => {
      const tone = toneWav(0.5);
      const fmt = Buffer.alloc(48);
      fmt.write('fmt ', 0, 'ascii');
      fmt.writeUInt32LE(40, 4);
      tone.copy(fmt, 8, 20, 36);
      fmt.writeUInt16LE(0xfffe, 8);
      fmt.writeUInt16LE(22, 24);
      fmt.writeUInt16LE(sub, 32);
      const filler = Buffer.concat([Buffer.from('FLLR'), Buffer.from([4, 0, 0, 0, 0, 0, 0, 0])]);
      return Buffer.concat([tone.subarray(0, 12), fmt, filler, tone.subarray(36)]);
    };
    expect(wavLength(extensible(1))).toEqual({ ok: true, ms: 500 });
    expect(wavLength(extensible(3)).ok).toBe(false);
  });

  it('counts only the data that came, where the header promises more', () => {
    const cut = toneWav(1).subarray(0, 44 + 44100);
    expect(wavLength(cut)).toEqual({ ok: true, ms: 500 });
  });
});
