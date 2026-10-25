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
  MAX_RECORDING_BYTES,
  recordingAllowed,
  serveVoiceRecording,
  voiceId,
  VoiceDesk,
  wavLength,
  type Convert,
} from '../src/voiceRecording.js';

const SHIPPED = fileURLToPath(new URL('../../../missions', import.meta.url));
const missions: Mission[] = readdirSync(SHIPPED)
  .filter((name) => name.endsWith('.json'))
  .map((name) => parseMission(JSON.parse(readFileSync(join(SHIPPED, name), 'utf8'))));
const blackout = missions.find((mission) => mission.id === 'blackout');
const START = blackout?.radio.start ?? '';
const NUDGE = blackout?.puzzles[0]?.nudges[0] ?? '';

/** Whether this machine converts for real: afconvert comes with macOS, CI's Linux has none. */
const HAS_AFCONVERT = existsSync('/usr/bin/afconvert');

/** A stand-in for afconvert where there is none: it writes what an .m4a starts with. */
const fakeConvert: Convert = (wav, m4a) => {
  writeFileSync(m4a, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A ')]));
  return Promise.resolve();
};

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

let dir = '';
const manifestFile = (): string => join(dir, 'manifest.json');
const manifest = (): Record<string, Record<string, unknown>> =>
  JSON.parse(readFileSync(manifestFile(), 'utf8')) as Record<string, Record<string, unknown>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'escapelab-voice-test-'));
  const entries = {
    [voiceId(START)]: { text: START, ms: 9000, missions: ['blackout'], opens: true },
    ffffffffffff: { text: 'Eine andere Zeile.', ms: 1200, missions: ['systemcheck'] },
  };
  writeFileSync(manifestFile(), `${JSON.stringify(entries, null, 2)}\n`);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const desk = (convert: Convert = HAS_AFCONVERT ? afconvert : fakeConvert): VoiceDesk =>
  new VoiceDesk(dir, () => missions, convert);

describe('the switch for recordings', () => {
  it('is on with ALLOW_RECORD=1 alone, off unset or 0, and refuses anything else', () => {
    expect(recordingAllowed({ ALLOW_RECORD: '1' })).toBe(true);
    expect(recordingAllowed({})).toBe(false);
    expect(recordingAllowed({ ALLOW_RECORD: '' })).toBe(false);
    expect(recordingAllowed({ ALLOW_RECORD: '0' })).toBe(false);
    expect(() => recordingAllowed({ ALLOW_RECORD: 'yes' })).toThrow(/ALLOW_RECORD=yes/);
  });

  it('answers 404 to a recording while it is off, and leaves the folder be', async () => {
    const answer = await ask(null, post(voiceId(START), toneWav(0.5)));
    expect(answer?.status).toBe(404);
    expect(String(answer?.body['error'])).toMatch(/ALLOW_RECORD=1/);
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

describe('a recording sent in', () => {
  it('is converted into the folder under its line’s id, the manifest naming a person', async () => {
    const id = voiceId(START);
    const answer = await ask(desk(), post(id, toneWav(0.6)));
    expect(answer).toEqual({ status: 200, body: { id, ms: 600, source: 'human' } });
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
    });
    expect(manifest()['ffffffffffff']).toEqual({
      text: 'Eine andere Zeile.',
      ms: 1200,
      missions: ['systemcheck'],
    });
    expect(readdirSync(dir).sort()).toEqual([`${id}.m4a`, 'manifest.json']);
  });

  it('enters a shipped line the manifest does not list yet, in the order of the ids', async () => {
    const id = voiceId(NUDGE);
    const answer = await ask(desk(fakeConvert), post(id, toneWav(1.25)));
    expect(answer?.status).toBe(200);
    const entry = { text: NUDGE, ms: 1250, missions: ['blackout'], source: 'human' };
    expect(manifest()[id]).toEqual(entry);
    const ids = Object.keys(manifest());
    expect(ids).toEqual([...ids].sort());
    expect(readFileSync(manifestFile(), 'utf8')).toMatch(/\n$/);
  });

  it('refuses an id that is none, and a line no shipped mission says', async () => {
    for (const wrong of ['manifest.json', voiceId(START).toUpperCase(), '..']) {
      expect((await ask(desk(), post(wrong, toneWav(0.2))))?.status, wrong).toBe(400);
    }
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
    expect(manifest()[id]?.['source']).toBeUndefined();
  });

  it('refuses what is no PCM WAV, saying what is wrong', async () => {
    const id = voiceId(START);
    const float = toneWav(0.2);
    float.writeUInt16LE(3, 20);
    const empty = toneWav(0);
    const answers = await Promise.all(
      [Buffer.from('ID3 not a wave at all'), float, empty].map((wav) => ask(desk(), post(id, wav))),
    );
    expect(answers.map((answer) => answer?.status)).toEqual([400, 400, 400]);
    expect(answers.map((answer) => answer?.body['error'])).toEqual([
      'Keine WAV-Datei: Der RIFF-Kopf fehlt.',
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

  it('counts only the data that came, where the header promises more', () => {
    const cut = toneWav(1).subarray(0, 44 + 44100);
    expect(wavLength(cut)).toEqual({ ok: true, ms: 500 });
  });
});
