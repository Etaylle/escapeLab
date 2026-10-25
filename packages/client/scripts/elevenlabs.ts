/**
 * The voice script's ElevenLabs engine (VOICE_ENGINE=elevenlabs): mission control's lines read
 * by an ElevenLabs voice through the official SDK, @elevenlabs/elevenlabs-js — a dev dependency
 * that never ships — as ElevenLabs' text-to-speech skill shows it. The SDK reads the key from
 * ELEVENLABS_API_KEY: set in the environment, or kept in the repo's .env.local, which the
 * ElevenLabs CLI writes and git ignores. The script puts it from there into the environment and
 * nowhere else; it never prints it.
 *
 * Runs on Node's own TypeScript, as the voice script does. The SDK is imported only once a client
 * is made, so the tests, which hand in a client of their own, never load it and never call out.
 */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repo's env file, where the ElevenLabs CLI keeps the key. */
export const ENV_FILE = resolve(HERE, '../../../.env.local');
/**
 * The model where ELEVENLABS_MODEL names none: Eleven v4, ElevenLabs' newest and the skill's
 * default, which speaks German among 90 languages and more.
 */
export const ELEVEN_MODEL = 'eleven_v4';
/** The voice where ELEVENLABS_VOICE names none: „Helmut - German Epic Trailer Voice". */
export const ELEVEN_VOICE = 'g1jpii0iyvtRs8fqXsd1';
/** MP3 at 44.1 kHz and 96 kbit/s, 12 kB a second: a line of 12 s still fits in 150 kB. */
export const ELEVEN_FORMAT = 'mp3_44100_96';
/** The pause between two requests, ms: they go one after the other. */
export const ELEVEN_GAP_MS = 300;
/** How often a request turned away as one too many (429) goes again. */
export const ELEVEN_RETRIES = 5;

/** A voice of the account, as GET /v1/voices lists it. */
export interface VoiceInfo {
  readonly voiceId: string;
  readonly name?: string | undefined;
  readonly category?: string | undefined;
  readonly labels?: Readonly<Record<string, string>> | undefined;
}

/** What the script asks of the SDK's client: the account's voices, and speech. */
export interface SpeechClient {
  readonly voices: { getAll(): PromiseLike<{ readonly voices: readonly VoiceInfo[] }> };
  readonly textToSpeech: {
    convert(
      voiceId: string,
      request: ElevenLabs.BodyTextToSpeechFull,
    ): PromiseLike<ReadableStream<Uint8Array>>;
  };
}

/** Who reads: the client, the voice by id, the model. */
export interface ElevenVoice {
  readonly client: SpeechClient;
  readonly voiceId: string;
  readonly model: string;
}

/**
 * Puts ELEVENLABS_API_KEY into `env` from `file`, the repo's .env.local, where `env` has none —
 * that one value alone, said to nobody. Fails naming both places where neither has a key.
 */
export function loadApiKey(env: NodeJS.ProcessEnv = process.env, file = ENV_FILE): void {
  const set = env['ELEVENLABS_API_KEY']?.trim();
  if (set) {
    env['ELEVENLABS_API_KEY'] = set;
    return;
  }
  const kept = existsSync(file) ? parseEnv(readFileSync(file, 'utf8'))['ELEVENLABS_API_KEY'] : '';
  if (kept?.trim()) {
    env['ELEVENLABS_API_KEY'] = kept.trim();
    return;
  }
  throw new Error(
    'voice: no ElevenLabs key — put ELEVENLABS_API_KEY into the repo’s .env.local ' +
      '(`npx -y @elevenlabs/cli@latest onboard init` in the repo does), or set ' +
      'ELEVENLABS_API_KEY in the environment',
  );
}

/** The SDK's client, which takes the key from the environment and leaves retrying to us. */
export async function elevenClient(): Promise<SpeechClient> {
  const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
  return new ElevenLabsClient({ maxRetries: 0 });
}

/** The account's voices: GET /v1/voices. */
export async function accountVoices(client: SpeechClient): Promise<readonly VoiceInfo[]> {
  return (await client.voices.getAll()).voices;
}

/** A voice as --list-voices prints it: its name, its id, what kind it is and its labels. */
export function voiceRow(voice: VoiceInfo): string {
  const labels = Object.entries(voice.labels ?? {}).map(([key, value]) => `${key} ${value}`);
  const parts = [voice.name ?? '(no name)', voice.voiceId, voice.category, labels.join(', ')];
  return parts.filter((part) => part !== undefined && part !== '').join('  ·  ');
}

/** The voice `wanted` names — by its id, or by its name exactly — among `voices`. */
export function resolveVoice(voices: readonly VoiceInfo[], wanted: string): VoiceInfo {
  const found =
    voices.find((voice) => voice.voiceId === wanted) ??
    voices.find((voice) => voice.name === wanted);
  if (found === undefined) {
    const names = voices.map((voice) => `"${voice.name ?? voice.voiceId}"`).join(', ');
    throw new Error(
      `voice: the account has no voice "${wanted}" — it has ${names || 'none'}; ` +
        'ELEVENLABS_VOICE takes a voice id or a name exactly as --list-voices prints it',
    );
  }
  return found;
}

/** How the voice holds: Eleven v4 takes stability and similarity alone, older models more. */
export function voiceSettings(model: string): ElevenLabs.VoiceSettings {
  const held = { stability: 0.5, similarityBoost: 0.75 };
  return model.startsWith('eleven_v4') ? held : { ...held, style: 0.2, useSpeakerBoost: true };
}

/** What ElevenLabs is asked to read: German enforced where the model takes it. */
export function speechRequest(text: string, model: string): ElevenLabs.BodyTextToSpeechFull {
  const german = model.startsWith('eleven_multilingual') ? {} : { languageCode: 'de' };
  return {
    text,
    modelId: model,
    outputFormat: ELEVEN_FORMAT,
    ...german,
    voiceSettings: voiceSettings(model),
  };
}

/** A request turned away by the SDK: its status, its body, the headers it came with. */
interface Refusal {
  readonly statusCode?: number;
  readonly body?: unknown;
  readonly rawResponse?: { readonly headers?: { get(name: string): string | null } };
}

const refusalOf = (error: unknown): Refusal =>
  typeof error === 'object' && error !== null ? (error as Refusal) : {};

/** How long ElevenLabs asks to wait before the next try, ms: a 429's retry-after, else null. */
export function retryAfterMs(error: unknown): number | null {
  const refusal = refusalOf(error);
  if (refusal.statusCode !== 429) {
    return null;
  }
  const seconds = Number(refusal.rawResponse?.headers?.get('retry-after') ?? '');
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}

/** What went wrong, in a sentence: the line, the status, what ElevenLabs said. */
function refused(error: unknown, text: string): Error {
  const refusal = refusalOf(error);
  const said = refusal.body === undefined ? String(error) : JSON.stringify(refusal.body);
  const status = refusal.statusCode ?? 'no answer';
  return new Error(`voice: ElevenLabs did not read "${text}" (${status}): ${said}`);
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Has `voice` read `text` and returns the MP3. A request turned away as one too many (429)
 * waits the seconds its retry-after asks and goes again, ELEVEN_RETRIES times at most.
 */
export async function speakEleven(
  voice: ElevenVoice,
  text: string,
  wait: (ms: number) => Promise<void> = pause,
): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const request = speechRequest(text, voice.model);
      const audio = await voice.client.textToSpeech.convert(voice.voiceId, request);
      return Buffer.from(await new Response(audio).arrayBuffer());
    } catch (error) {
      const delay = retryAfterMs(error);
      if (delay === null || attempt >= ELEVEN_RETRIES) {
        throw refused(error, text);
      }
      console.log(`voice: ElevenLabs asks for a pause (429), going again in ${delay / 1000} s`);
      await wait(delay);
    }
  }
}

/**
 * Runs `jobs` one after the other, `gapMs` apart — never two requests at once — and returns
 * what each gave.
 */
export async function oneByOne<T>(
  jobs: readonly (() => Promise<T>)[],
  gapMs: number,
  wait: (ms: number) => Promise<void> = pause,
): Promise<T[]> {
  const done: T[] = [];
  for (const [i, job] of jobs.entries()) {
    if (i > 0 && gapMs > 0) await wait(gapMs);
    done.push(await job());
  }
  return done;
}

/** Where --sample puts its line: VOICE_SAMPLES_DIR, or a folder in the system's temp. */
export function samplesDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['VOICE_SAMPLES_DIR'] || join(tmpdir(), 'escapelab-voice-samples');
}

/** The file a sample of the voice `wanted` goes to: its name or id, as a file name can take it. */
export function sampleFile(wanted: string): string {
  const name = wanted.replace(/[^\p{L}\p{N}_]+/gu, '-').replace(/^-|-$/g, '');
  return `${name || 'voice'}.mp3`;
}
