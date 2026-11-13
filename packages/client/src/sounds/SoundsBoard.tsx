import type { Section, SoundRow } from './listing.js';
import {
  keepCommandFor,
  takeFails,
  takeFloor,
  takeKey,
  type Keeping,
  type TakeInfo,
  type Takes,
} from './takes.js';

/** What the board's controls ask the page for. */
export interface BoardActions {
  play(id: string): void;
  playTake(id: string, n: number): void;
  toggle(id: string): void;
  /** choose take `n` of `id` to be kept, or let the choice go where it is the one chosen */
  keep(id: string, n: number): void;
  envFile(path: string): void;
  copy(): void;
}

/**
 * What the board shows: the listing, the music's takes, what plays, what is ticked, the command
 * and its key file, and the take chosen to be kept of each entry.
 */
export interface BoardProps {
  readonly sections: readonly Section[];
  /** each entry's takes, by its id: the music's, waiting for the ear */
  readonly takes: Takes;
  /** why no take can be heard: the dev server serves none, or their lists did not load */
  readonly takesNote: string | null;
  /** the sound playing now, by id, or a take by its key (`takeKey`) */
  readonly playing: string | null;
  /** whether the recording `id` is loaded and can be played */
  readonly loaded: (id: string) => boolean;
  readonly selected: ReadonlySet<string>;
  /** the take chosen to be kept, by its entry's id */
  readonly keeping: Keeping;
  readonly envFile: string;
  readonly command: string | null;
  /** what the copy button last did: copied, or the browser kept the clipboard shut */
  readonly copied: 'copied' | 'refused' | null;
  readonly on: BoardActions;
}

/** A length in seconds as the page writes it: „0,5 s". */
function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')} s`;
}

/** A level as the page writes it: „−45,7 dBFS". */
function level(dbfs: number): string {
  return `${dbfs.toFixed(1).replace('-', '−').replace('.', ',')} dBFS`;
}

/** A gain as the page writes it: „Verstärkung 1,45×". */
function gainFact(gain: number): string {
  return `Verstärkung ${gain.toFixed(2).replace('.', ',')}×`;
}

/** What the page says of a recording's floor once its gain is applied, and whether it is heard. */
function floorFact(floor: { readonly floorDbfs: number | null; readonly noisy: boolean }): string {
  if (floor.floorDbfs === null) return 'Grundrauschen vom Klang verdeckt';
  if (floor.floorDbfs === -Infinity) return 'kein Grundrauschen';
  return `Grundrauschen ${level(floor.floorDbfs)}${floor.noisy ? ', hörbar' : ''}`;
}

/** What the page says of a sound's recording: its length, its gain, its floor, a loop. */
export function factsOf(row: SoundRow): string {
  const { recording, sound } = row;
  if (recording === null) {
    return 'keine Aufnahme';
  }
  const parts = [seconds(recording.ms), gainFact(recording.gain), floorFact(row)];
  return [...parts, ...(sound.loop ? ['Schleife'] : [])].join(' · ');
}

/** The script's rules a take can miss (scripts/sfx.ts PICK), as the page names them. */
const RULES: Readonly<Record<string, string>> = {
  peak: 'Spitze',
  start: 'Einsatz',
  silence: 'Stille',
  length: 'Länge',
  floor: 'Grundrauschen',
};

const dbfsOf = (linear: number): number => 20 * Math.log10(linear);

/**
 * What the page says of a take, in one line: its length, its gain, its peak and RMS before the
 * gain, its floor once the gain is applied, its silence, where its sound starts, the rules it
 * misses.
 */
export function takeFactsOf(take: TakeInfo): string {
  const parts = [
    seconds(take.ms),
    gainFact(take.gain),
    `Spitze ${level(dbfsOf(take.peak))}`,
    `RMS ${level(dbfsOf(take.rms))}`,
    floorFact(takeFloor(take)),
    `Stille ${Math.round(take.silence * 100)} %`,
  ];
  const start = take.startMs > 0 ? [`Einsatz nach ${seconds(take.startMs)}`] : [];
  const missed = take.misses.map((rule) => RULES[rule] ?? rule);
  const rules = missed.length > 0 ? [`Regeln verfehlt: ${missed.join(', ')}`] : [];
  return [...parts, ...start, ...rules].join(' · ');
}

/** One take of the entry `id`: its play button, its number and facts, and the choice to keep it. */
function TakeRow({ id, take, props }: { id: string; take: TakeInfo; props: BoardProps }) {
  const playing = props.playing === takeKey(id, take.n);
  const chosen = props.keeping[id] === take.n;
  return (
    <li className={takeFails(take) ? 'sounds-take sounds-take--fails' : 'sounds-take'}>
      <button
        type="button"
        className="sounds-play"
        aria-pressed={playing}
        onClick={() => props.on.playTake(id, take.n)}
      >
        {playing ? 'Stopp' : 'Abspielen'}
      </button>
      <span className="sounds-take-name">{`Take ${take.n}`}</span>
      <span className="sounds-facts">{takeFactsOf(take)}</span>
      <button
        type="button"
        className="sounds-keep"
        aria-pressed={chosen}
        onClick={() => props.on.keep(id, take.n)}
      >
        Diesen Take behalten
      </button>
    </li>
  );
}

/** The command that keeps take `n` of the entry `id`, and what it does. */
function KeepCommand({ id, n }: { id: string; n: number }) {
  return (
    <div className="sounds-keep-command">
      <p className="muted">
        {`Im Ordner packages/client behält dieser Befehl Take ${n} und löscht die übrigen:`}
      </p>
      <pre className="sounds-cli">{keepCommandFor(id, n)}</pre>
    </div>
  );
}

/** The takes of the entry `id`, and the command that keeps the one chosen; none, nothing. */
function TakesOf({ id, props }: { id: string; props: BoardProps }) {
  const takes = props.takes[id] ?? [];
  if (takes.length === 0) {
    return null;
  }
  const chosen = props.keeping[id];
  return (
    <div className="sounds-takes">
      <ol className="sounds-take-list" aria-label={`Takes von ${id}`}>
        {takes.map((take) => (
          <TakeRow key={take.n} id={id} take={take} props={props} />
        ))}
      </ol>
      {chosen === undefined ? null : <KeepCommand id={id} n={chosen} />}
    </div>
  );
}

/**
 * One sound: its play button, its id and facts, its prompt, its box to tick for a new take, and
 * the takes of it that wait for the ear.
 */
function Row({ row, props }: { row: SoundRow; props: BoardProps }) {
  const { id, prompt } = row.sound;
  const playing = props.playing === id;
  return (
    <li className={row.noisy ? 'sounds-row sounds-row--noisy' : 'sounds-row'}>
      <button
        type="button"
        className="sounds-play"
        aria-pressed={playing}
        disabled={!props.loaded(id)}
        onClick={() => props.on.play(id)}
      >
        {playing ? 'Stopp' : 'Abspielen'}
      </button>
      <div className="sounds-what">
        <code className="sounds-id">{id}</code>
        <span className="sounds-facts">{factsOf(row)}</span>
        <p className="sounds-prompt">{prompt}</p>
      </div>
      <label className="sounds-pick">
        <input
          type="checkbox"
          checked={props.selected.has(id)}
          onChange={() => props.on.toggle(id)}
        />{' '}
        neu rendern
      </label>
      <TakesOf id={id} props={props} />
    </li>
  );
}

/** The box with the command for what is ticked, and the key file it names. */
function CommandBox(props: BoardProps) {
  const said =
    props.copied === 'copied'
      ? 'Kopiert.'
      : props.copied === 'refused'
        ? 'Der Browser lässt nicht in die Zwischenablage: Befehl markieren und kopieren.'
        : '';
  return (
    <section className="sounds-command" aria-label="Befehl">
      <h2>Befehl</h2>
      <label className="sounds-env">
        Schlüsseldatei{' '}
        <input value={props.envFile} onChange={(e) => props.on.envFile(e.currentTarget.value)} />
      </label>
      <p className="muted">
        Im Ordner packages/client ausführen. Jede angekreuzte Aufnahme entsteht dreimal neu: von
        einem Effekt behält das Skript die beste Fassung, ein Musikstück wartet in drei Takes, die
        mit pnpm dev hier unter ihm erscheinen.
      </p>
      {props.command === null ? (
        <p className="muted">Nichts angekreuzt.</p>
      ) : (
        <pre className="sounds-cli">{props.command}</pre>
      )}
      <button type="button" disabled={props.command === null} onClick={props.on.copy}>
        Befehl kopieren
      </button>
      <span className="muted sounds-copied">{said}</span>
    </section>
  );
}

/**
 * Every sound of the lab, section by section, to be listened to as the game loads it, the takes
 * of the music under their piece, and the command that makes the ones ticked anew.
 */
export function SoundsBoard(props: BoardProps) {
  const anyTakes = Object.keys(props.takes).length > 0;
  return (
    <section className="card sounds">
      <h1>Klänge des Labors</h1>
      <p className="muted">
        Jede Aufnahme so, wie das Spiel sie lädt und einpegelt; Räume und Schleifen laufen, bis
        sie gestoppt werden. Was neu entstehen soll, ankreuzen: unten steht der Befehl dafür.
      </p>
      {anyTakes ? (
        <p className="muted">
          Neue Takes der Musik stehen unter ihrem Stück, jeder so laut, wie das Spiel ihn
          einpegeln würde; behalten wird einer erst mit dem Befehl, der unter ihm erscheint.
        </p>
      ) : null}
      {props.takesNote === null ? null : <p className="muted sounds-note">{props.takesNote}</p>}
      {props.sections.map((section) => (
        <section key={section.kind} className="sounds-section" aria-label={section.title}>
          <h2>
            {section.title} <span className="muted">({section.rows.length})</span>
          </h2>
          <ul className="sounds-list">
            {section.rows.map((row) => (
              <Row key={row.sound.id} row={row} props={props} />
            ))}
          </ul>
        </section>
      ))}
      <CommandBox {...props} />
    </section>
  );
}
