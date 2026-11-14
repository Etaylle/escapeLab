import { useEffect, useRef, useState } from 'react';
import { ROSTER } from '@escapelab/core';
import { Icon } from '../screens/Icon.js';
import { ENV_FILE } from '../sounds/listing.js';
import { MANIFEST_URL, VOICE_BASE, type VoiceManifest } from '../world/radioVoice.js';
import {
  linesByMoment,
  loadSamples,
  previewKey,
  previewUrl,
  sampleKey,
  sampleUrl,
  type KeepChoice,
  type SamplesState,
} from './samples.js';
import { VoicesBoard, type VoicesActions } from './VoicesBoard.js';

/**
 * The page at /voices, reached by its address alone: the radio's cast as the roster has it, the
 * library voices offered for each person and their samples from Voice Design where the dev server
 * lists any (samples.ts), and every line the game has rendered, by its moment, in the voice of
 * whoever says it — each played as it was made, plain, without the radio's chain, so that a voice
 * is judged as it is. Choosing a voice shows the command that keeps it; the page itself asks no
 * service for anything and runs neither a preview's fetch, a design, a keep nor a render.
 */

/** Where the page keeps the key file the commands name, for the next visit: as /sounds does. */
const ENV_KEY = 'escapelab-sounds-env-file';

function readEnvFile(): string {
  try {
    return localStorage.getItem(ENV_KEY) ?? ENV_FILE;
  } catch {
    return ENV_FILE;
  }
}

function keepEnvFile(path: string): void {
  try {
    localStorage.setItem(ENV_KEY, path);
  } catch {
    // Storage blocked: the path just does not outlive the visit.
  }
}

/** A recording playing on the page, and how to stop it. */
interface Audition {
  stop(): void;
}

/** Plays the file at `url` once, plain, and calls `ended` once it has stopped. */
function playFile(url: string, ended: () => void): Audition {
  const audio = new Audio(url);
  audio.addEventListener('ended', ended, { once: true });
  audio.play().catch(() => ended());
  return {
    stop: () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}

/**
 * `chosen` with `choice` — a sample, or a library voice — chosen for `slot`; or none of `slot`,
 * where it was the one chosen.
 */
export function chooseVoice(
  chosen: Readonly<Record<string, KeepChoice>>,
  slot: string,
  choice: KeepChoice,
): Record<string, KeepChoice> {
  const others = Object.fromEntries(Object.entries(chosen).filter(([each]) => each !== slot));
  return chosen[slot] === choice ? others : { ...others, [slot]: choice };
}

/** What the board stands on: the recordings' list and the samples, as loaded. */
interface Loaded {
  readonly manifest: VoiceManifest;
  readonly samples: SamplesState;
}

/** The board at work: what plays, the samples chosen, the key file. */
function Auditions({ manifest, samples }: Loaded) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [keeping, setKeeping] = useState<Readonly<Record<string, KeepChoice>>>({});
  const [envFile, setEnvFile] = useState(readEnvFile);
  const sound = useRef<Audition | null>(null);
  useEffect(() => () => sound.current?.stop(), []);
  const stop = (): void => {
    sound.current?.stop();
    sound.current = null;
    setPlaying(null);
  };
  /** Plays `url` under `key`, the one playing stopped — or nothing, where it was that one. */
  const start = (key: string, url: string): void => {
    const was = playing;
    stop();
    if (was === key) return;
    const played = playFile(url, () => {
      if (sound.current === played) stop();
    });
    sound.current = played;
    setPlaying(key);
  };
  const on: VoicesActions = {
    playSample: (dir, n) => start(sampleKey(dir, n), sampleUrl(dir, { file: `${n}.mp3` })),
    playPreview: (voiceId) => start(previewKey(voiceId), previewUrl(voiceId)),
    playLine: (id) => {
      const file = manifest.lines[id]?.file;
      if (file !== undefined) start(id, `${VOICE_BASE}${file}`);
    },
    keep: (slot, choice) => setKeeping((was) => chooseVoice(was, slot, choice)),
    envFile: (path) => {
      setEnvFile(path);
      keepEnvFile(path);
    },
  };
  return (
    <VoicesBoard
      roster={ROSTER}
      samples={samples.kind === 'served' ? samples.samples : {}}
      library={samples.kind === 'served' ? samples.library : []}
      samplesNote={samples.kind === 'unserved' ? samples.why : null}
      lines={linesByMoment(manifest)}
      playing={playing}
      keeping={keeping}
      envFile={envFile}
      on={on}
    />
  );
}

/** The recordings' list, fetched past any copy kept; fails with the address and the status. */
async function loadManifest(): Promise<VoiceManifest> {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${MANIFEST_URL}: HTTP ${res.status}`);
  return (await res.json()) as VoiceManifest;
}

type Loading =
  | { kind: 'loading' }
  | ({ kind: 'ready' } & Loaded)
  | { kind: 'failed'; error: string };

/** The page: the recordings' list and the samples fetched, then the board. */
export function VoicesScreen() {
  const [loading, setLoading] = useState<Loading>({ kind: 'loading' });
  useEffect(() => {
    Promise.all([loadManifest(), loadSamples()]).then(
      ([manifest, samples]) => setLoading({ kind: 'ready', manifest, samples }),
      (err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        setLoading({ kind: 'failed', error: `Die Stimmenliste ließ sich nicht laden: ${reason}` });
      },
    );
  }, []);
  return (
    <div className="app">
      <div className="scanlines" aria-hidden="true" />
      <header className="topbar">
        <span className="logo">
          <Icon name="hex" /> ESCAPELAB
        </span>
        <span className="topbar-mission">Stimmen anhören</span>
      </header>
      <main className="content">
        {loading.kind === 'ready' ? (
          <Auditions manifest={loading.manifest} samples={loading.samples} />
        ) : (
          <section className="card sounds">
            <p className="muted">
              {loading.kind === 'failed' ? loading.error : 'Die Stimmenliste wird geladen …'}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
