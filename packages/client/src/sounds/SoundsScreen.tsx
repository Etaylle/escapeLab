import { useEffect, useRef, useState } from 'react';
import catalogJson from '../../audio/catalog.json';
import { Icon } from '../screens/Icon.js';
import { sharedAudio } from '../world/audio.js';
import {
  MUSIC_BASE,
  MUSIC_IDS,
  preloadSamples,
  sample,
  SFX_BASE,
  SFX_IDS,
  type SampleEntry,
  type SampleId,
} from '../world/samples.js';
import { commandFor, ENV_FILE, listingOf, soundsOf, type CatalogSound } from './listing.js';
import { SoundsBoard, type BoardActions } from './SoundsBoard.js';

/**
 * The page at /sounds, reached by its address alone: every recording of the catalog, played
 * through the game's own loader at the loudness it brings it to (world/samples.ts) — a room's
 * bed or a loop round and round until it is stopped, everything else once — its prompt beside
 * it, and a box to tick where it should be made anew. The command for what is ticked goes to
 * the clipboard; the page itself asks no service for anything.
 */

const catalog: readonly CatalogSound[] = soundsOf(catalogJson);
const IDS = new Set<string>([...SFX_IDS, ...MUSIC_IDS]);
const isSampleId = (id: string): id is SampleId => IDS.has(id);
/** How loud the page plays a recording at its loudness: half way down, for headroom. */
const AUDITION_LEVEL = 0.5;
/** Where the page keeps the key file the command names, for the next visit. */
const ENV_KEY = 'escapelab-sounds-env-file';

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Both manifests, merged by id. */
async function loadRecordings(): Promise<Record<string, SampleEntry>> {
  const lists = await Promise.all(
    [SFX_BASE, MUSIC_BASE].map(async (base) => {
      const res = await fetch(`${base}manifest.json`);
      if (!res.ok) throw new Error(`${base}manifest.json: HTTP ${res.status}`);
      return (await res.json()) as Record<string, SampleEntry>;
    }),
  );
  return Object.assign({}, ...lists) as Record<string, SampleEntry>;
}

/**
 * Plays the recording `id` — round and round where `loop` says — at AUDITION_LEVEL, and calls
 * `ended` once it has stopped; null where it is not loaded or there is no Web Audio.
 */
function audition(id: string, loop: boolean, ended: () => void): AudioBufferSourceNode | null {
  const ctx = sharedAudio();
  const recording = isSampleId(id) ? sample(id) : null;
  if (ctx === null || recording === null) return null;
  ctx.resume().catch(() => undefined); // the click that asked is the gesture it needs
  const out = ctx.createGain();
  out.gain.value = AUDITION_LEVEL;
  out.connect(ctx.destination);
  const source = ctx.createBufferSource();
  source.buffer = recording.buffer;
  source.loop = loop;
  source.connect(out);
  source.onended = () => {
    out.disconnect();
    ended();
  };
  source.start(ctx.currentTime + 0.01, recording.start);
  return source;
}

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

/** Puts `text` on the clipboard; false where the browser does not let it. */
function toClipboard(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard === undefined) {
    return Promise.resolve(false);
  }
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

/** The board at work: the recordings behind its play buttons, its ticks, its command. */
function Auditions({ recordings }: { recordings: Readonly<Record<string, SampleEntry>> }) {
  const [, setLoaded] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [envFile, setEnvFile] = useState(readEnvFile);
  const [playing, setPlaying] = useState<string | null>(null);
  const [copied, setCopied] = useState<'copied' | 'refused' | null>(null);
  const voice = useRef<AudioBufferSourceNode | null>(null);
  useEffect(() => {
    void preloadSamples().then(() => setLoaded((n) => n + 1));
    return () => voice.current?.stop();
  }, []);
  const ticked = catalog.filter((sound) => selected.has(sound.id)).map((sound) => sound.id);
  const command = commandFor(ticked, envFile);
  const stop = (): void => {
    const current = voice.current;
    voice.current = null;
    current?.stop();
    setPlaying(null);
  };
  const on: BoardActions = {
    play: (id) => {
      const was = playing;
      stop();
      if (was === id) return;
      const loop = catalog.find((sound) => sound.id === id)?.kind === 'bed';
      const source = audition(id, loop, () => {
        if (voice.current === source) stop();
      });
      voice.current = source;
      setPlaying(source === null ? null : id);
    },
    toggle: (id) =>
      setSelected((was) => {
        const next = new Set(was);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    envFile: (path) => {
      setEnvFile(path);
      keepEnvFile(path);
    },
    copy: () => {
      if (command !== null) {
        void toClipboard(command).then((done) => setCopied(done ? 'copied' : 'refused'));
      }
    },
  };
  return (
    <SoundsBoard
      sections={listingOf(catalog, recordings)}
      playing={playing}
      loaded={(id) => isSampleId(id) && sample(id) !== null}
      selected={selected}
      envFile={envFile}
      command={command}
      copied={copied}
      on={on}
    />
  );
}

type Loading =
  | { kind: 'loading' }
  | { kind: 'ready'; recordings: Record<string, SampleEntry> }
  | { kind: 'failed'; error: string };

/** The page: the manifests fetched, then the board. */
export function SoundsScreen() {
  const [loading, setLoading] = useState<Loading>({ kind: 'loading' });
  useEffect(() => {
    loadRecordings().then(
      (recordings) => setLoading({ kind: 'ready', recordings }),
      (err: unknown) => {
        const error = `Die Klangliste ließ sich nicht laden: ${reasonOf(err)}`;
        setLoading({ kind: 'failed', error });
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
        <span className="topbar-mission">Klänge anhören</span>
      </header>
      <main className="content">
        {loading.kind === 'ready' ? (
          <Auditions recordings={loading.recordings} />
        ) : (
          <section className="card sounds">
            <p className="muted">
              {loading.kind === 'failed' ? loading.error : 'Die Klangliste wird geladen …'}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
