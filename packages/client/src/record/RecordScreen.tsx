import { useEffect, useReducer, useRef, useState } from 'react';
import { Icon } from '../screens/Icon.js';
import { openDesk, step, takeOf, type Take } from './desk.js';
import { loadLines, recordingUrl, saveTake, type RecordLine } from './lines.js';
import { RecordDesk, type DeskActions } from './RecordDesk.js';
import { startRecording, type Rolling } from './recorder.js';
import { encodeWav, RATE, trimSilence } from './wav.js';

/**
 * The page at /record, reached by its address alone: a person speaks mission control's lines
 * one by one, and each one saved replaces the synthetic voice's recording of it in the game.
 * The microphone, the playback and the server are its effects; what they do to the page is the
 * desk's (desk.ts), what it shows RecordDesk's. Saving takes a server with ALLOW_RECORD=1, as
 * `pnpm dev` runs it.
 */

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A take from what the microphone heard: trimmed, as a WAV, with an address to play it. */
function takeFrom(samples: Float32Array): Take | null {
  const trimmed = trimSilence(samples, RATE);
  if (trimmed.length === 0) {
    return null;
  }
  const wav = new Blob([encodeWav(trimmed, RATE)], { type: 'audio/wav' });
  return { wav, url: URL.createObjectURL(wav), ms: Math.round((trimmed.length / RATE) * 1000) };
}

/** The page's clock while `running`, ms, read ten times a second; it stands still otherwise. */
function useClock(running: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/** The desk at work: the microphone, the playback and the server behind its buttons. */
function Recorder({ lines }: { lines: readonly RecordLine[] }) {
  const [desk, dispatch] = useReducer(step, lines, openDesk);
  const rolling = useRef<Rolling | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const now = useClock(desk.phase.kind === 'recording');
  const take = takeOf(desk.phase);
  // A take let go — taken again, saved, left behind — gives its address back.
  useEffect(() => (take === null ? undefined : () => URL.revokeObjectURL(take.url)), [take]);
  useEffect(
    () => () => {
      rolling.current?.cancel();
      player.current?.pause();
    },
    [],
  );
  const fail = (error: string): void => dispatch({ kind: 'fail', error });
  const play = (url: string): void => {
    player.current?.pause();
    const audio = new Audio(url);
    player.current = audio;
    audio.play().catch((err: unknown) => fail(`Abspielen ging nicht: ${reasonOf(err)}`));
  };
  const stop = (started: Rolling): void => {
    dispatch({ kind: 'stop' });
    started.stop().then((samples) => {
      const made = takeFrom(samples);
      if (made === null) fail('Nichts zu hören: Die Aufnahme ist still.');
      else dispatch({ kind: 'took', take: made });
    }, (err: unknown) => fail(reasonOf(err)));
  };
  const on: DeskActions = {
    record: () => {
      player.current?.pause();
      dispatch({ kind: 'record' });
      startRecording().then((started) => {
        rolling.current = started;
        dispatch({ kind: 'rolling', at: performance.now() });
      }, (err: unknown) => fail(reasonOf(err)));
    },
    stop: () => {
      const started = rolling.current;
      rolling.current = null;
      if (started !== null) stop(started);
    },
    save: () => {
      const line = desk.lines[desk.index];
      if (take === null || line === undefined) return;
      dispatch({ kind: 'save' });
      saveTake(line.id, take.wav).then(
        (ms) => dispatch({ kind: 'saved', ms }),
        (err: unknown) => fail(reasonOf(err)),
      );
    },
    go: (index) => {
      player.current?.pause();
      dispatch({ kind: 'go', index });
    },
    playTake: (made) => play(made.url),
    playRecording: (line) => play(recordingUrl(line, Date.now())),
  };
  return <RecordDesk desk={desk} now={now} on={on} />;
}

type Loading =
  | { kind: 'loading' }
  | { kind: 'ready'; lines: RecordLine[] }
  | { kind: 'failed'; error: string };

/** The page: the lines fetched, then the desk. */
export function RecordScreen() {
  const [loading, setLoading] = useState<Loading>({ kind: 'loading' });
  useEffect(() => {
    loadLines().then(
      (lines) => setLoading({ kind: 'ready', lines }),
      (err: unknown) => {
        const error = `Die Funksprüche ließen sich nicht laden: ${reasonOf(err)}`;
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
        <span className="topbar-mission">Funksprüche aufnehmen</span>
      </header>
      <main className="content">
        {loading.kind === 'ready' ? (
          <Recorder lines={loading.lines} />
        ) : (
          <section className="card record">
            {loading.kind === 'failed' ? (
              <p className="record-phase record-phase--failed">{loading.error}</p>
            ) : (
              <p className="muted">Die Funksprüche werden geladen …</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
