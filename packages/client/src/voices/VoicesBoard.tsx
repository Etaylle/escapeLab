import { personOf, ROLES, type RadioMoment, type Role, type Roster } from '@escapelab/core';
import { MOMENTS } from '../record/RecordDesk.js';
import {
  designCommandFor,
  keepCommandFor,
  renderCommandFor,
  sampleKey,
  slotsOf,
  type Rendered,
  type SampleInfo,
  type SamplesByDir,
  type Slot,
} from './samples.js';

/** What the board's controls ask the page for. */
export interface VoicesActions {
  /** play sample `n` of the person whose folder is `dir`, or stop it where it plays */
  playSample(dir: string, n: number): void;
  /** play the rendered line `id`, or stop it where it plays */
  playLine(id: string): void;
  /** choose sample `n` of the person `slot` names to be kept, or let the choice go */
  keep(slot: string, n: number): void;
  envFile(path: string): void;
}

/**
 * What the board shows: the cast as the roster has it, each person's samples, every rendered
 * line by its moment, what plays, the sample chosen to be kept of each person, the key file the
 * commands name.
 */
export interface VoicesBoardProps {
  readonly roster: Roster;
  readonly samples: SamplesByDir;
  /** why no sample can be heard: the dev server serves none, or their lists did not load */
  readonly samplesNote: string | null;
  readonly lines: readonly { readonly moment: RadioMoment; readonly lines: readonly Rendered[] }[];
  /** what plays now: a sample by its key (`sampleKey`), or a line by its id */
  readonly playing: string | null;
  /** the sample chosen to be kept, by the person's name on the command line */
  readonly keeping: Readonly<Record<string, number>>;
  readonly envFile: string;
  readonly on: VoicesActions;
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

/** A sample as its row shows it: whose, which, whether it is the one kept, on which board. */
interface SampleProps {
  readonly slot: Slot;
  readonly sample: SampleInfo;
  readonly kept: boolean;
  readonly board: VoicesBoardProps;
}

/** A sample of a person's voice: its play button, its number and length, the choice to keep it. */
function SampleRow({ slot, sample, kept, board }: SampleProps) {
  const playing = board.playing === sampleKey(slot.dir, sample.n);
  const chosen = board.keeping[slot.name] === sample.n;
  return (
    <li className="sounds-take">
      <button
        type="button"
        className="sounds-play"
        aria-pressed={playing}
        onClick={() => board.on.playSample(slot.dir, sample.n)}
      >
        {playing ? 'Stopp' : 'Abspielen'}
      </button>
      <span className="sounds-take-name">{`Probe ${sample.n}`}</span>
      <span className="sounds-facts">
        {kept ? `${seconds(sample.seconds)} · besetzt` : seconds(sample.seconds)}
      </span>
      <button
        type="button"
        className="sounds-keep"
        aria-pressed={chosen}
        onClick={() => board.on.keep(slot.name, sample.n)}
      >
        Diese Stimme besetzen
      </button>
    </li>
  );
}

/** The command that keeps the sample chosen, and the one that has the lines made after it. */
function KeepCommand({ slot, n, envFile }: { slot: Slot; n: number; envFile: string }) {
  const { name } = slot.person;
  return (
    <div className="sounds-keep-command">
      <p className="muted">
        {`Im Ordner packages/client macht dieser Befehl Probe ${n} zur Stimme von ${name}, ` +
          'im Konto und in der Besetzung — ohne Credits, aber mit einem Stimmplatz des Kontos:'}
      </p>
      <pre className="sounds-cli">{keepCommandFor(slot.name, n, envFile)}</pre>
      <p className="muted">
        {`Dienst hat ${name} erst mit den eigenen Zeilen; dieser Befehl macht sie:`}
      </p>
      <pre className="sounds-cli">{renderCommandFor(envFile)}</pre>
    </div>
  );
}

/** A person of the cast: who they are, how their voice is asked for, its samples. */
function PersonRow({ slot, board }: { slot: Slot; board: VoicesBoardProps }) {
  const list = board.samples[slot.dir];
  const chosen = board.keeping[slot.name];
  const { name, character, prompt } = slot.person;
  return (
    <li className="sounds-row">
      <div className="sounds-what">
        <code className="sounds-id">{slot.name}</code>
        <span className="sounds-facts">{voiceFact(slot)}</span>
        <p>{`${name}: ${character}`}</p>
        <p className="sounds-prompt">{prompt}</p>
      </div>
      {list === undefined ? (
        <div className="sounds-keep-command">
          <p className="muted">Noch keine Proben dieser Stimme. Drei macht dieser Befehl:</p>
          <pre className="sounds-cli">{designCommandFor(slot.name, board.envFile)}</pre>
        </div>
      ) : (
        <div className="sounds-takes">
          <ol className="sounds-take-list" aria-label={`Proben von ${name}`}>
            {list.samples.map((sample) => (
              <SampleRow
                key={sample.n}
                slot={slot}
                sample={sample}
                kept={list.kept === sample.n}
                board={board}
              />
            ))}
          </ol>
          {chosen === undefined ? null : (
            <KeepCommand slot={slot} n={chosen} envFile={board.envFile} />
          )}
        </div>
      )}
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
      <button
        type="button"
        className="sounds-play"
        aria-pressed={playing}
        onClick={() => board.on.playLine(line.id)}
      >
        {playing ? 'Stopp' : 'Abspielen'}
      </button>
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
 * The cast before and after its render: each role and the persons who can fill it, the samples
 * of a voice to choose from and the command that keeps one, then every line the game has, by
 * its moment, in the voice of whoever says it.
 */
export function VoicesBoard(board: VoicesBoardProps) {
  return (
    <section className="card sounds">
      <h1>Stimmen der Besetzung</h1>
      <p className="muted">
        Jede Rolle mit allen, die sie besetzen können: die Proben einer Stimme aus Voice Design,
        ehe sie besetzt ist, und jede gesprochene Zeile, wie das Spiel sie spielt. Besetzt wird
        eine Stimme erst mit dem Befehl unter der gewählten Probe.
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
