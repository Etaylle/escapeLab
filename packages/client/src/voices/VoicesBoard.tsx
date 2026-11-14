import {
  personOf,
  ROLES,
  speakingFor,
  type RadioMoment,
  type Role,
  type Roster,
} from '@escapelab/core';
import { MOMENTS } from '../record/RecordDesk.js';
import {
  designCommandFor,
  keepCommandFor,
  previewKey,
  previewsCommandFor,
  renderCommandFor,
  sampleKey,
  slotsOf,
  type KeepChoice,
  type LibraryVoice,
  type Rendered,
  type SampleInfo,
  type SamplesByDir,
  type Slot,
} from './samples.js';

/** What the board's controls ask the page for. */
export interface VoicesActions {
  /** play sample `n` of the person whose folder is `dir`, or stop it where it plays */
  playSample(dir: string, n: number): void;
  /** play the preview of the library voice `voiceId`, or stop it where it plays */
  playPreview(voiceId: string): void;
  /** play the rendered line `id`, or stop it where it plays */
  playLine(id: string): void;
  /** choose `choice` — a sample, or a library voice — to be kept for the person `slot` names */
  keep(slot: string, choice: KeepChoice): void;
  envFile(path: string): void;
}

/**
 * What the board shows: the cast as the roster has it, each person's samples and the library
 * voices offered for them, every rendered line by its moment, what plays, the voice chosen to be
 * kept of each person, the key file the commands name.
 */
export interface VoicesBoardProps {
  readonly roster: Roster;
  readonly samples: SamplesByDir;
  readonly library: readonly LibraryVoice[];
  /** why no sample can be heard: the dev server serves none, or their lists did not load */
  readonly samplesNote: string | null;
  readonly lines: readonly { readonly moment: RadioMoment; readonly lines: readonly Rendered[] }[];
  /** what plays now: a sample or a preview by its key (`sampleKey`, `previewKey`), a line by id */
  readonly playing: string | null;
  /** the voice chosen to be kept, by the person's name on the command line */
  readonly keeping: Readonly<Record<string, KeepChoice>>;
  readonly envFile: string;
  readonly on: VoicesActions;
}

/** What a row of the board is drawn for: a person of the cast, on the board. */
interface OfSlot {
  readonly slot: Slot;
  readonly board: VoicesBoardProps;
}

/** What the page calls each role, and where it is heard. */
const ROLE_TITLES: Readonly<Record<Role, string>> = {
  pa: 'Durchsage · die Lautsprecher der Anlage',
  operator: 'Leitstelle · der Dienst am Funk',
  lead: 'Schichtleitung · die zweite Stimme, wenn es ernst wird',
};

/** A length in seconds as the page writes it: „9,4 s". */
function seconds(s: number): string {
  return `${Math.max(0, s).toFixed(1).replace('.', ',')} s`;
}

/** What the page says of a person's voice: kept, and what it reads with; or none yet. */
function voiceFact(slot: Slot): string {
  const { voiceId, model } = slot.person;
  return voiceId === undefined ? 'noch ohne Stimme' : `besetzt · ${model ?? 'Standardmodell'}`;
}

/** A button that plays a recording, or stops it where it plays. */
function PlayButton({ playing, onClick }: { playing: boolean; onClick: () => void }) {
  return (
    <button type="button" className="sounds-play" aria-pressed={playing} onClick={onClick}>
      {playing ? 'Stopp' : 'Abspielen'}
    </button>
  );
}

/** The button that chooses `choice` to be kept for a person, showing the command that keeps it. */
function KeepButton({ slot, board, choice }: OfSlot & { choice: KeepChoice }) {
  return (
    <button
      type="button"
      className="sounds-keep"
      aria-pressed={board.keeping[slot.name] === choice}
      onClick={() => board.on.keep(slot.name, choice)}
    >
      Diese Stimme besetzen
    </button>
  );
}

/** A sample of a person's voice: its play button, its number and length, the choice to keep it. */
function SampleRow({ slot, board, sample, kept }: OfSlot & { sample: SampleInfo; kept: boolean }) {
  const playing = board.playing === sampleKey(slot.dir, sample.n);
  return (
    <li className="sounds-take">
      <PlayButton playing={playing} onClick={() => board.on.playSample(slot.dir, sample.n)} />
      <span className="sounds-take-name">{`Probe ${sample.n}`}</span>
      <span className="sounds-facts">
        {kept ? `${seconds(sample.seconds)} · besetzt` : seconds(sample.seconds)}
      </span>
      <KeepButton slot={slot} board={board} choice={sample.n} />
    </li>
  );
}

/**
 * A library voice offered for a person: its preview's play button, or that it has none yet; its
 * name and what it is; the choice to keep it, but where it is their voice already.
 */
function LibraryRow({ slot, board, voice }: OfSlot & { voice: LibraryVoice }) {
  const playing = board.playing === previewKey(voice.voiceId);
  const kept = slot.person.voiceId === voice.voiceId;
  return (
    <li className="sounds-take">
      {voice.preview ? (
        <PlayButton playing={playing} onClick={() => board.on.playPreview(voice.voiceId)} />
      ) : (
        <span className="sounds-missing">Hörprobe fehlt</span>
      )}
      <span className="sounds-take-name">{voice.name}</span>
      <span className="sounds-facts">{kept ? `${voice.about} · besetzt` : voice.about}</span>
      {kept ? null : <KeepButton slot={slot} board={board} choice={voice.voiceId} />}
    </li>
  );
}

/** The library voices offered for a person, and the command that fetches missing previews. */
function LibraryList({ slot, board }: OfSlot) {
  const offered = board.library.filter((voice) => voice.slot === slot.name);
  if (offered.length === 0) return null;
  const missing = offered.some((voice) => !voice.preview);
  return (
    <>
      <ol className="sounds-take-list" aria-label={`Bibliotheksstimmen für ${slot.person.name}`}>
        {offered.map((voice) => (
          <LibraryRow key={voice.voiceId} slot={slot} board={board} voice={voice} />
        ))}
      </ol>
      {missing ? (
        <div className="sounds-keep-command">
          <p className="muted">Hörproben der Bibliothek holt dieser Befehl, ohne Credits:</p>
          <pre className="sounds-cli">{previewsCommandFor(board.envFile)}</pre>
        </div>
      ) : null}
    </>
  );
}

/** A person's samples from Voice Design, or the command that makes three. */
function SampleList({ slot, board }: OfSlot) {
  const list = board.samples[slot.dir];
  if (list === undefined) {
    return (
      <div className="sounds-keep-command">
        <p className="muted">Noch keine Proben aus Voice Design. Drei macht dieser Befehl:</p>
        <pre className="sounds-cli">{designCommandFor(slot.name, board.envFile)}</pre>
      </div>
    );
  }
  return (
    <ol className="sounds-take-list" aria-label={`Proben von ${slot.person.name}`}>
      {list.samples.map((sample) => (
        <SampleRow
          key={sample.n}
          slot={slot}
          board={board}
          sample={sample}
          kept={list.kept === sample.n}
        />
      ))}
    </ol>
  );
}

/** What the page names a voice chosen by: a sample by its number, a library voice by its name. */
function chosenName(choice: KeepChoice, library: readonly LibraryVoice[]): string {
  if (typeof choice === 'number') return `Probe ${choice}`;
  return `„${library.find((voice) => voice.voiceId === choice)?.name ?? choice}“`;
}

/** How many takes of the person `slot` names a voice made: a new voice makes them stale. */
function takesOf({ slot, board }: OfSlot): number {
  const { id } = slot.person;
  const all = board.lines.flatMap((group) => group.lines);
  return all.filter(({ entry }) => entry.person === id && entry.source === undefined).length;
}

/** The command that keeps the voice chosen, and the one that has the lines made after it. */
function KeepCommand({ slot, board, choice }: OfSlot & { choice: KeepChoice }) {
  const { name } = slot.person;
  const where =
    typeof choice === 'number'
      ? 'im Konto und in der Besetzung — ohne Credits, aber mit einem Stimmplatz des Kontos:'
      : 'in der Besetzung — ohne Credits, die Stimme ist schon im Konto:';
  const stale = takesOf({ slot, board });
  const command = keepCommandFor(slot.name, choice, board.envFile, stale > 0);
  return (
    <div className="sounds-keep-command">
      <p className="muted">
        {`Im Ordner packages/client macht dieser Befehl ${chosenName(choice, board.library)} ` +
          `zur Stimme von ${name}, ${where}`}
      </p>
      <pre className="sounds-cli">{command}</pre>
      {stale > 0 ? (
        <p className="muted">
          {`Mit --replace gibt ${name} die ${stale} Aufnahmen der bisherigen Stimme ab; der ` +
            'Befehl darunter macht sie in der neuen.'}
        </p>
      ) : null}
      <p className="muted">
        {`Mit dieser Besetzung hat ${name} Dienst; die Zeilen dazu macht vor dem Einchecken ` +
          'dieser Befehl:'}
      </p>
      <pre className="sounds-cli">{renderCommandFor(board.envFile)}</pre>
    </div>
  );
}

/** What the page says of a role nobody of which has a voice: who speaks its lines meanwhile. */
const STANDING_IN =
  'Bis hier eine Stimme besetzt ist, spricht die Leitstelle im Dienst diese Zeilen.';

/** A person of the cast: who they are, their voice, the voices to choose from for it. */
function PersonRow({ slot, board }: OfSlot) {
  const chosen = board.keeping[slot.name];
  const { name, character } = slot.person;
  const standsIn = speakingFor(slot.role, board.roster) !== slot.role;
  return (
    <li className="sounds-row">
      <div className="sounds-what">
        <code className="sounds-id">{slot.name}</code>
        <span className="sounds-facts">{voiceFact(slot)}</span>
        <p>{`${name}: ${character}`}</p>
        {standsIn ? <p className="muted">{STANDING_IN}</p> : null}
      </div>
      <div className="sounds-takes">
        <LibraryList slot={slot} board={board} />
        <SampleList slot={slot} board={board} />
        {chosen === undefined ? null : <KeepCommand slot={slot} board={board} choice={chosen} />}
      </div>
    </li>
  );
}

/** A role: its title, and every person who can fill it. */
function RoleBlock({ role, board }: { role: Role; board: VoicesBoardProps }) {
  const slots = slotsOf(board.roster).filter((slot) => slot.role === role);
  return (
    <section className="sounds-section" aria-label={ROLE_TITLES[role]}>
      <h2>{ROLE_TITLES[role]}</h2>
      <ul className="sounds-list">
        {slots.map((slot) => (
          <PersonRow key={slot.name} slot={slot} board={board} />
        ))}
      </ul>
    </section>
  );
}

/** What the page says of a rendered line: its length, and the model or the person that made it. */
function lineFacts({ entry }: Rendered): string {
  const made = entry.model ?? (entry.source === undefined ? 'synthetisch' : 'Mensch');
  return `${seconds(entry.ms / 1000)} · ${made}`;
}

/** One rendered line: its play button, who says it, its facts and its words. */
function LineRow({ line, board }: { line: Rendered; board: VoicesBoardProps }) {
  const playing = board.playing === line.id;
  const name = personOf(line.entry.person, board.roster)?.name ?? line.entry.person;
  return (
    <li className="sounds-row">
      <PlayButton playing={playing} onClick={() => board.on.playLine(line.id)} />
      <div className="sounds-what">
        <code className="sounds-id">{name}</code>
        <span className="sounds-facts">{lineFacts(line)}</span>
        <p className="sounds-prompt">{line.entry.text}</p>
      </div>
    </li>
  );
}

/** Every rendered line by its moment, each with who says it. */
function LinesBlock({ board }: { board: VoicesBoardProps }) {
  const count = board.lines.reduce((sum, group) => sum + group.lines.length, 0);
  return (
    <section className="sounds-section" aria-label="Gesprochene Zeilen">
      <h2>
        Gesprochene Zeilen <span className="muted">({count})</span>
      </h2>
      {board.lines.map(({ moment, lines }) => (
        <section key={moment} aria-label={MOMENTS[moment]}>
          <h3>{MOMENTS[moment]}</h3>
          <ul className="sounds-list">
            {lines.map((line) => (
              <LineRow key={line.id} line={line} board={board} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

/**
 * The cast before and after its render: each role and the persons who can fill it, the library
 * voices offered for each and the samples of a designed voice to choose from, with the command
 * that keeps one, then every line the game has, by its moment, in the voice of whoever says it.
 */
export function VoicesBoard(board: VoicesBoardProps) {
  return (
    <section className="card sounds">
      <h1>Stimmen der Besetzung</h1>
      <p className="muted">
        Jede Rolle mit allen, die sie besetzen können: die Stimmen aus der Bibliothek des Kontos
        und die Proben aus Voice Design, ehe eine besetzt ist, und jede gesprochene Zeile, wie das
        Spiel sie spielt. Besetzt wird eine Stimme erst mit dem Befehl unter der gewählten.
      </p>
      {board.samplesNote === null ? null : <p className="muted sounds-note">{board.samplesNote}</p>}
      <label className="sounds-env">
        Schlüsseldatei{' '}
        <input value={board.envFile} onChange={(e) => board.on.envFile(e.currentTarget.value)} />
      </label>
      {ROLES.map((role) => (
        <RoleBlock key={role} role={role} board={board} />
      ))}
      <LinesBlock board={board} />
    </section>
  );
}
