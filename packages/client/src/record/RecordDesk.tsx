import type { RadioMoment } from '@escapelab/core';
import { busy, takeOf, unreplaced, type Desk, type Phase, type Take } from './desk.js';
import { UPLOAD_ACCEPT, type Recording, type RecordLine, type Source } from './lines.js';

/** What the desk's buttons ask the page for. */
export interface DeskActions {
  record(): void;
  stop(): void;
  save(): void;
  go(index: number): void;
  playTake(take: Take): void;
  playRecording(recording: Recording): void;
  copy(): void;
  upload(file: File): void;
}

/** A length in seconds as the page writes it: „4,2 s". */
export function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')} s`;
}

/** When a line comes over the air, as the page names it; a station's lines name the station. */
const MOMENTS: Readonly<Record<RadioMoment, string>> = {
  start: 'Start',
  nudge: 'Hinweis',
  solved: 'Gelöst',
  escape: 'Notausgang',
};

const momentOf = (line: RecordLine): string =>
  [MOMENTS[line.when], line.station].filter((part) => part !== null).join(' · ');

/** Who made a recording, as the page names it. */
const SOURCES: Readonly<Record<Source, string>> = {
  synthetic: 'synthetisch',
  human: 'Mensch',
  upload: 'Datei',
};

/** What the line has so far. */
function sofar(line: RecordLine): string {
  const { recording } = line;
  if (recording === null) {
    return 'Bisher keine Aufnahme';
  }
  return `Bisher: ${SOURCES[recording.source]}, ${seconds(recording.ms)}`;
}

type Said<K extends Phase['kind']> = (phase: Extract<Phase, { kind: K }>, now: number) => string;

/** What the desk is doing, in a line, by phase; `now` on the page's clock, ms. */
const PHASE_TEXT: { readonly [K in Phase['kind']]: Said<K> } = {
  idle: () => 'Bereit zur Aufnahme.',
  arming: () => 'Mikrofon wird geöffnet …',
  recording: ({ since }, now) => `Aufnahme läuft · ${seconds(now - since)}`,
  processing: () => 'Stille an den Enden wird geschnitten …',
  review: ({ take }) => `Neue Aufnahme · ${seconds(take.ms)}, Stille an beiden Enden geschnitten.`,
  saving: () => 'Wird gespeichert …',
  uploading: ({ name }) => `„${name}“ wird übertragen …`,
  saved: () => 'Gespeichert: Das Spiel spielt ab jetzt diese Aufnahme.',
  failed: ({ error }) => error,
};

export function phaseText(phase: Phase, now: number): string {
  return (PHASE_TEXT[phase.kind] as (phase: Phase, now: number) => string)(phase, now);
}

/** Record or stop, listen, save: always the same three, enabled as the phase allows. */
function Controls({ desk, on }: { desk: Desk; on: DeskActions }) {
  const { phase } = desk;
  const line = desk.lines[desk.index];
  const take = takeOf(phase);
  const working = busy(phase);
  const recording = phase.kind === 'recording';
  const kept = line?.recording ?? null;
  const listen = (): void => {
    if (take !== null) on.playTake(take);
    else if (kept !== null) on.playRecording(kept);
  };
  const looks = [take === null ? 'primary' : '', 'record-take', recording ? 'record-rolling' : ''];
  return (
    <div className="record-controls">
      <button
        className={looks.filter((name) => name !== '').join(' ')}
        disabled={working && !recording}
        onClick={recording ? on.stop : on.record}
      >
        {recording ? 'Stopp' : kept === null && take === null ? 'Aufnehmen' : 'Neu aufnehmen'}
      </button>
      <button disabled={working || (take === null && kept === null)} onClick={listen}>
        Anhören
      </button>
      <button className="primary" disabled={working || take === null} onClick={on.save}>
        Speichern
      </button>
    </div>
  );
}

/** The line's text for another tool: to the clipboard, or marked in a field to be copied. */
function CopyText({ desk, on }: { desk: Desk; on: DeskActions }) {
  const line = desk.lines[desk.index];
  return (
    <div className="record-copy">
      <button className="link" onClick={on.copy}>
        Text kopieren
      </button>
      {desk.copy === 'done' && <span className="muted">Text kopiert.</span>}
      {desk.copy === 'manual' && line !== undefined && (
        <label className="record-copy-field">
          Kopieren ging nicht: Der Text ist markiert, ⌘C kopiert ihn.
          <textarea
            readOnly
            autoFocus
            rows={3}
            value={line.text}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}

/** A file for the line, dropped on the zone or picked from it: mp3, m4a or wav. */
function DropZone({ desk, on }: { desk: Desk; on: DeskActions }) {
  const off = busy(desk.phase);
  const pick = (files: FileList | null): void => {
    const file = files?.[0];
    if (file !== undefined && !off) on.upload(file);
  };
  return (
    <label
      className={`record-drop${off ? ' record-drop--off' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        pick(event.dataTransfer.files);
      }}
    >
      <input
        type="file"
        accept={UPLOAD_ACCEPT}
        disabled={off}
        onChange={(event) => {
          pick(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <span className="record-drop-title">Audiodatei ablegen</span>
      <span className="record-drop-hint">
        oder hier auswählen · mp3, m4a oder wav, bis 8 MB · WebM kann afconvert nicht lesen
      </span>
    </label>
  );
}

const TAGS = { human: 'Mensch', upload: 'Datei', synthetic: 'synthetisch', missing: 'fehlt' };

const tagOf = (line: RecordLine): keyof typeof TAGS => line.recording?.source ?? 'missing';

/** The lines by the mission that says them first, in their order, each with its place. */
function byMission(lines: readonly RecordLine[]): [string, [RecordLine, number][]][] {
  const groups: [string, [RecordLine, number][]][] = [];
  lines.forEach((line, i) => {
    const mission = line.missions[0] ?? '';
    const last = groups.at(-1);
    if (last !== undefined && last[0] === mission) last[1].push([line, i]);
    else groups.push([mission, [[line, i]]]);
  });
  return groups;
}

/**
 * Every line under its mission, with its number and what its recording is, the one on screen
 * marked; a click moves to it while nothing is under way.
 */
function LineList({ desk, on }: { desk: Desk; on: DeskActions }) {
  const working = busy(desk.phase);
  return (
    <div className="record-list">
      {byMission(desk.lines).map(([mission, lines]) => (
        <section key={lines[0]?.[0].id ?? mission}>
          <h2 className="record-group">{mission}</h2>
          <ol>
            {lines.map(([line, i]) => (
              <li key={line.id} className={i === desk.index ? 'record-item--on' : undefined}>
                <button
                  className="link"
                  disabled={working}
                  aria-current={i === desk.index ? 'true' : undefined}
                  onClick={() => on.go(i)}
                >
                  <span className="record-number">{i + 1}</span>
                  <span className={`record-tag record-tag--${tagOf(line)}`}>
                    {TAGS[tagOf(line)]}
                  </span>
                  <span>{line.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/**
 * The desk: the line on screen big, where it comes over the air and what it has so far, its
 * text to copy, what is going on, the buttons, a zone for a file, the way to the line before and
 * after, and every line below.
 */
export function RecordDesk({ desk, now, on }: { desk: Desk; now: number; on: DeskActions }) {
  const line = desk.lines[desk.index];
  if (line === undefined) {
    return (
      <section className="card record">
        <p className="muted">Keine Funksprüche gefunden.</p>
      </section>
    );
  }
  const working = busy(desk.phase);
  const replaced = desk.lines.filter((each) => !unreplaced(each)).length;
  return (
    <section className="card record">
      <p className="kicker">
        FUNKSPRUCH {desk.index + 1} VON {desk.lines.length} · {line.missions.join(', ')}
      </p>
      <p className="record-moment">{momentOf(line)}</p>
      <blockquote className="record-line">{line.text}</blockquote>
      <CopyText desk={desk} on={on} />
      <p className="record-sofar">
        {sofar(line)} · Kennung {line.id}
      </p>
      <p className={`record-phase record-phase--${desk.phase.kind}`} role="status">
        {phaseText(desk.phase, now)}
      </p>
      <Controls desk={desk} on={on} />
      <DropZone desk={desk} on={on} />
      <nav className="record-nav">
        <button disabled={working || desk.index === 0} onClick={() => on.go(desk.index - 1)}>
          Zurück
        </button>
        <span className="muted">
          {replaced} von {desk.lines.length} ersetzt
        </span>
        <button
          disabled={working || desk.index === desk.lines.length - 1}
          onClick={() => on.go(desk.index + 1)}
        >
          Weiter
        </button>
      </nav>
      <LineList desk={desk} on={on} />
    </section>
  );
}
