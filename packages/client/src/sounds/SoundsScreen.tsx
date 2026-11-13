import { useEffect, useRef, useState } from 'react';
import catalogJson from '../../audio/catalog.json';
import { Icon } from '../screens/Icon.js';
import { sharedAudio } from '../world/audio.js';
import { closeStream, openStream, startStream } from '../world/audioStream.js';
import {
  loadSample,
  MUSIC_BASE,
  MUSIC_IDS,
  SFX_BASE,
  SFX_IDS,
  type MusicId,
  type SampleEntry,
  type SfxId,
} from '../world/samples.js';
import { commandFor, ENV_FILE, listingOf, soundsOf, type CatalogSound } from './listing.js';
import { SoundsBoard, type BoardActions } from './SoundsBoard.js';
import {
  chooseTake,
  loadTakes,
  takeKey,
  takeUrl,
  type Keeping,
  type TakeInfo,
  type TakesState,
} from './takes.js';

/**
 * The page at /sounds, reached by its address alone: every recording of the catalog, played as
 * the game plays it at the loudness it brings it to — an effect or a bed through the game's own
 * loader (world/samples.ts), decoded as it is first played, the music streamed from its file
 * (world/audioStream.ts) — a room's bed, a loop or a stem round and round until it is stopped,
 * everything else once; its prompt beside it, and a box to tick where it should be made anew.
 * Under a piece of music stand its takes, where the dev server lists any (takes.ts), each
 * streamed at the gain the game would give it, and the command that keeps the one chosen. The
 * commands go to the clipboard or are shown; the page itself asks no service for anything and
 * runs neither a render nor a keep.
 */

const catalog: readonly CatalogSound[] = soundsOf(catalogJson);
const EFFECTS = new Set<string>(SFX_IDS);
const MUSIC = new Set<string>(MUSIC_IDS);
const isEffect = (id: string): id is SfxId => EFFECTS.has(id);
const isMusic = (id: string): id is MusicId => MUSIC.has(id);
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

/** A recording playing on the page, and how to stop it. */
interface Audition {
  stop(): void;
}

/**
 * Plays the effect `id` — round and round where `loop` says — at AUDITION_LEVEL once it is
 * loaded, and calls `ended` once it has stopped; nothing where it cannot be had.
 */
function playEffect(ctx: AudioContext, id: SfxId, loop: boolean, ended: () => void): Audition {
  let source: AudioBufferSourceNode | null = null;
  let stopped = false;
  void loadSample(id).then((recording) => {
    if (recording === null || stopped) {
      if (!stopped) ended();
      return;
    }
    const out = ctx.createGain();
    out.gain.value = AUDITION_LEVEL;
    out.connect(ctx.destination);
    source = ctx.createBufferSource();
    source.buffer = recording.buffer;
    source.loop = loop;
    source.connect(out);
    source.onended = () => {
      out.disconnect();
      ended();
    };
    source.start(ctx.currentTime + 0.01, recording.start);
  });
  return {
    stop: () => {
      stopped = true;
      source?.stop();
    },
  };
}

/**
 * Streams the piece of music at `url` — a stem round and round — at AUDITION_LEVEL times its
 * `gain`, and calls `ended` once it has stopped.
 */
function playStream(
  ctx: AudioContext,
  url: string,
  sound: { readonly gain: number; readonly loop: boolean },
  ended: () => void,
): Audition {
  const { gain, loop } = sound;
  const stream = openStream(ctx, url, ctx.destination, 0);
  stream.out.gain.value = AUDITION_LEVEL * gain;
  stream.element.loop = loop;
  stream.element.addEventListener('ended', () => {
    closeStream(stream);
    ended();
  });
  startStream(stream, ctx, ctx.currentTime + 0.01);
  return {
    stop: () => {
      closeStream(stream);
      ended();
    },
  };
}

/**
 * Plays the recording `id` — round and round where `loop` says — and calls `ended` once it has
 * stopped; null where there is no Web Audio or no such recording.
 */
function audition(
  id: string,
  recordings: Readonly<Record<string, SampleEntry>>,
  loop: boolean,
  ended: () => void,
): Audition | null {
  const ctx = sharedAudio();
  const entry = recordings[id];
  if (ctx === null || entry === undefined) return null;
  ctx.resume().catch(() => undefined); // the click that asked is the gesture it needs
  if (isMusic(id)) {
    return playStream(ctx, `${MUSIC_BASE}${entry.file}`, { gain: entry.gain, loop }, ended);
  }
  return isEffect(id) ? playEffect(ctx, id, loop, ended) : null;
}

/**
 * Streams take `take` of the piece `id` from the dev server — round and round where `loop`
 * says — at the gain the game would give it, and calls `ended` once it has stopped; null where
 * there is no Web Audio.
 */
function auditionTake(
  id: string,
  take: TakeInfo,
  loop: boolean,
  ended: () => void,
): Audition | null {
  const ctx = sharedAudio();
  if (ctx === null) return null;
  ctx.resume().catch(() => undefined); // the click that asked is the gesture it needs
  return playStream(ctx, takeUrl(id, take), { gain: take.gain, loop }, ended);
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

/** Whether the catalog plays `id` round and round. */
const loops = (id: string): boolean => catalog.find((sound) => sound.id === id)?.loop === true;

/** What the board stands on: the recordings behind its play buttons, and the takes as loaded. */
interface Loaded {
  readonly recordings: Readonly<Record<string, SampleEntry>>;
  readonly takes: TakesState;
}

/**
 * The board at work: the recordings and the takes behind its play buttons, its ticks, its
 * command, and the take chosen to be kept of each piece.
 */
function Auditions({ recordings, takes }: Loaded) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [envFile, setEnvFile] = useState(readEnvFile);
  const [playing, setPlaying] = useState<string | null>(null);
  const [copied, setCopied] = useState<'copied' | 'refused' | null>(null);
  const [keeping, setKeeping] = useState<Keeping>({});
  const voice = useRef<Audition | null>(null);
  useEffect(() => () => voice.current?.stop(), []);
  const ticked = catalog.filter((sound) => selected.has(sound.id)).map((sound) => sound.id);
  const command = commandFor(ticked, envFile);
  const listed = takes.kind === 'served' ? takes.takes : {};
  const stop = (): void => {
    const current = voice.current;
    voice.current = null;
    current?.stop();
    setPlaying(null);
  };
  /** Plays what `begin` starts under `key`, the one playing stopped — or nothing, where it was. */
  const start = (key: string, begin: (ended: () => void) => Audition | null): void => {
    const was = playing;
    stop();
    if (was === key) return;
    const played: Audition | null = begin(() => {
      if (voice.current === played) stop();
    });
    voice.current = played;
    setPlaying(played === null ? null : key);
  };
  const on: BoardActions = {
    play: (id) => start(id, (ended) => audition(id, recordings, loops(id), ended)),
    playTake: (id, n) => {
      const take = listed[id]?.find((each) => each.n === n);
      if (take === undefined) return;
      start(takeKey(id, n), (ended) => auditionTake(id, take, loops(id), ended));
    },
    toggle: (id) =>
      setSelected((was) => {
        const next = new Set(was);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    keep: (id, n) => setKeeping((was) => chooseTake(was, id, n)),
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
      takes={listed}
      takesNote={takes.kind === 'unserved' ? takes.why : null}
      playing={playing}
      loaded={(id) => recordings[id] !== undefined}
      selected={selected}
      keeping={keeping}
      envFile={envFile}
      command={command}
      copied={copied}
      on={on}
    />
  );
}

type Loading =
  | { kind: 'loading' }
  | ({ kind: 'ready' } & Loaded)
  | { kind: 'failed'; error: string };

/** The page: the manifests and the takes fetched, then the board. */
export function SoundsScreen() {
  const [loading, setLoading] = useState<Loading>({ kind: 'loading' });
  useEffect(() => {
    Promise.all([loadRecordings(), loadTakes()]).then(
      ([recordings, takes]) => setLoading({ kind: 'ready', recordings, takes }),
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
          <Auditions recordings={loading.recordings} takes={loading.takes} />
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
