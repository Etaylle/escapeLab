import type { Section, SoundRow } from './listing.js';

/** What the board's controls ask the page for. */
export interface BoardActions {
  play(id: string): void;
  toggle(id: string): void;
  envFile(path: string): void;
  copy(): void;
}

/** What the board shows: the listing, what plays, what is ticked, the command and its key file. */
export interface BoardProps {
  readonly sections: readonly Section[];
  /** the sound playing now, by id */
  readonly playing: string | null;
  /** whether the recording `id` is loaded and can be played */
  readonly loaded: (id: string) => boolean;
  readonly selected: ReadonlySet<string>;
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

/** What the page says of a recording's floor once its gain is applied, and whether it is heard. */
function floorFact(row: SoundRow): string {
  if (row.floorDbfs === null) return 'Grundrauschen vom Klang verdeckt';
  if (row.floorDbfs === -Infinity) return 'kein Grundrauschen';
  return `Grundrauschen ${level(row.floorDbfs)}${row.noisy ? ', hörbar' : ''}`;
}

/** What the page says of a sound's recording: its length, its gain, its floor, a loop. */
export function factsOf(row: SoundRow): string {
  const { recording, sound } = row;
  if (recording === null) {
    return 'keine Aufnahme';
  }
  const gain = `Verstärkung ${recording.gain.toFixed(2).replace('.', ',')}×`;
  const parts = [seconds(recording.ms), gain, floorFact(row), sound.loop ? 'Schleife' : null];
  return parts.filter((part) => part !== null).join(' · ');
}

/** One sound: its play button, its id and facts, its prompt, its box to tick for a new take. */
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
        Im Ordner packages/client ausführen. Jede angekreuzte Aufnahme entsteht dreimal neu, Musik
        wie Effekte; das Skript behält die beste Fassung.
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
 * Every sound of the lab, section by section, to be listened to as the game loads it, and the
 * command that makes the ones ticked anew.
 */
export function SoundsBoard(props: BoardProps) {
  return (
    <section className="card sounds">
      <h1>Klänge des Labors</h1>
      <p className="muted">
        Jede Aufnahme so, wie das Spiel sie lädt und einpegelt; Räume und Schleifen laufen, bis
        sie gestoppt werden. Was neu entstehen soll, ankreuzen: unten steht der Befehl dafür.
      </p>
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
