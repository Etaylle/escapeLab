import { linked } from '../screens/linked.js';
import { crossfadePeriod, isScore, playedOnce, type Slot } from '../world/packFile.js';
import {
  packKey,
  type CatalogSuite,
  type PackListing,
  type PackRow,
  type PieceRow,
  type Section,
  type SoundRow,
  type SuiteListing,
} from './listing.js';
import {
  keepCommandFor,
  pieceFails,
  pieceKey,
  takeFails,
  takeFloor,
  takeKey,
  type Keeping,
  type PieceInfo,
  type TakeInfo,
  type Takes,
} from './takes.js';

/** What the board's controls ask the page for. */
export interface BoardActions {
  play(id: string): void;
  playTake(id: string, n: number): void;
  /** play the piece `piece` of take `n` of the suite `id`, where the plan cuts it */
  playPiece(id: string, n: number, piece: string): void;
  /** play the piece of the place `slot` in the music pack `pack` */
  playPack(pack: string, slot: Slot): void;
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
  /** the catalog's suites, each with its pieces as the game plays them now */
  readonly suites: readonly SuiteListing[];
  /** the music packs the game ships, each with its piece for every place */
  readonly packs: readonly PackListing[];
  /** each entry's takes, by its id: the music's, waiting for the ear */
  readonly takes: Takes;
  /** why no take can be heard: the dev server serves none, or their lists did not load */
  readonly takesNote: string | null;
  /** the sound playing now, by id, a take by its key (`takeKey`), a pack's piece by `packKey` */
  readonly playing: string | null;
  /** whether the recording `id` is loaded and can be played */
  readonly loaded: (id: string) => boolean;
  readonly selected: ReadonlySet<string>;
  /** the take chosen to be kept, by its entry's id */
  readonly keeping: Keeping;
  readonly envFile: string;
  /** the commands for what is ticked: the sounds', and each suite's */
  readonly commands: readonly string[];
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

/** What the page says of a recording: its length, its gain, its floor, and that it loops. */
function recordingFacts(
  row: Pick<SoundRow, 'recording' | 'floorDbfs' | 'noisy'>,
  loop: boolean,
): string {
  const { recording } = row;
  if (recording === null) {
    return 'keine Aufnahme';
  }
  const parts = [seconds(recording.ms), gainFact(recording.gain), floorFact(row)];
  return [...parts, ...(loop ? ['Schleife'] : [])].join(' · ');
}

/** What the page says of a sound's recording: its length, its gain, its floor, a loop. */
export function factsOf(row: SoundRow): string {
  return recordingFacts(row, row.sound.loop);
}

/** What the page says of a piece of a suite as the game plays it now. */
export function pieceRowFactsOf(row: PieceRow): string {
  return recordingFacts(row, row.piece.loop);
}

/** What the page says of a suite: its key, its tempo and its pieces. */
export function suiteFactsOf(suite: CatalogSuite): string {
  return `${suite.key} · ${suite.bpm} bpm · ${suite.sections.length} Stücke`;
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

/** The rules `misses` names, as the page says them; none, nothing. */
function rulesMissed(misses: readonly string[]): string[] {
  const missed = misses.map((rule) => RULES[rule] ?? rule);
  return missed.length > 0 ? [`Regeln verfehlt: ${missed.join(', ')}`] : [];
}

/** What the page says of a suite's take as a whole: its length, its pieces, its plan missed. */
export function suiteTakeFactsOf(take: TakeInfo): string {
  const pieces = `${take.pieces?.length ?? 0} Stücke`;
  return [seconds(take.ms), pieces, ...rulesMissed(take.misses)].join(' · ');
}

/**
 * What the page says of a piece of a suite's take, in one line: its length, its gain, its
 * loudness before the gain, its floor once the gain is applied, its silence, the rules it misses.
 */
export function pieceFactsOf(piece: PieceInfo): string {
  const parts = [
    seconds(piece.ms),
    gainFact(piece.gain),
    loudnessFact(piece.loudness),
    floorFact(takeFloor(piece)),
    `Stille ${Math.round(piece.silence * 100)} %`,
    ...(piece.loop ? ['Schleife'] : []),
  ];
  return [...parts, ...rulesMissed(piece.misses)].join(' · ');
}

/** A loudness before the gain as the page writes it: „Lautheit −22,3 LUFS", or still. */
function loudnessFact(lufs: number | null): string {
  if (lufs === null) return 'Lautheit: still';
  return `Lautheit ${lufs.toFixed(1).replace('-', '−').replace('.', ',')} LUFS`;
}

/** How a piece of a pack goes round in the game: once, on bars, or by a crossfade at its seam. */
function packLoopFact(row: PackRow): string {
  const { piece } = row;
  if (playedOnce(row.slot)) return 'einmal';
  if (isScore(piece)) return 'Schleife auf Takten';
  const { loop } = piece;
  if (loop === null) return 'einmal';
  if ('bars' in loop) return `Schleife: ${loop.bars.count} Takte zu ${loop.bars.bpm} bpm`;
  const { startMs, fadeMs } = loop.crossfade;
  const period = seconds(crossfadePeriod(loop.crossfade) * 1000);
  return `Schleife ab ${seconds(startMs)} alle ${period}, Überblendung ${seconds(fadeMs)}`;
}

/**
 * What the page says of a piece of a pack, in one line: its length, its loudness before the gain
 * — a found piece's, as its pack.json keeps it — its gain, its licence and how it goes round.
 */
export function packFactsOf(row: PackRow): string {
  const { piece, sound } = row;
  if (sound === null) return 'keine Aufnahme: wartet auf die Partitur';
  const loudness = isScore(piece) ? [] : [loudnessFact(piece.loudness)];
  const licence = piece.licence === 'own' ? 'eigene Partitur' : piece.licence;
  const loop = packLoopFact(row);
  return [seconds(sound.ms), ...loudness, gainFact(sound.gain), licence, loop].join(' · ');
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
        Diesen Take wählen
      </button>
    </li>
  );
}

/**
 * The command that keeps take `n` of the entry `id` — of a suite, whole — what it does, and that
 * the page shows the take as the game's recording only once it is loaded anew.
 */
function KeepCommand({ id, n, whole = false }: { id: string; n: number; whole?: boolean }) {
  const what = whole
    ? `Take ${n} der ganzen Partitur, schneidet ihn in seine Stücke`
    : `Take ${n}`;
  return (
    <div className="sounds-keep-command">
      <p className="muted">
        {`Im Ordner packages/client behält dieser Befehl ${what} und löscht die übrigen:`}
      </p>
      <pre className="sounds-cli">{keepCommandFor(id, n)}</pre>
      <p className="muted">
        Danach die Seite neu laden: Der Take spielt dann als Aufnahme des Spiels.
      </p>
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

/** One piece of a suite's take: its play button, its id and its facts. */
function TakePiece({ id, n, piece, props }: TakePieceProps) {
  const playing = props.playing === pieceKey(id, n, piece.id);
  return (
    <li className={pieceFails(piece) ? 'sounds-piece sounds-piece--fails' : 'sounds-piece'}>
      <button
        type="button"
        className="sounds-play"
        aria-pressed={playing}
        onClick={() => props.on.playPiece(id, n, piece.id)}
      >
        {playing ? 'Stopp' : 'Abspielen'}
      </button>
      <code className="sounds-id">{piece.id}</code>
      <span className="sounds-facts">{pieceFactsOf(piece)}</span>
    </li>
  );
}

interface TakePieceProps {
  readonly id: string;
  readonly n: number;
  readonly piece: PieceInfo;
  readonly props: BoardProps;
}

/**
 * One take of the suite `id`: its number and facts, the choice to keep it whole, and every piece
 * of it in the plan's order, each to be played where the plan cuts it.
 */
function SuiteTakeRow({ id, take, props }: { id: string; take: TakeInfo; props: BoardProps }) {
  const chosen = props.keeping[id] === take.n;
  return (
    <li className={takeFails(take) ? 'sounds-take sounds-take--fails' : 'sounds-take'}>
      <span className="sounds-take-name">{`Take ${take.n}`}</span>
      <span className="sounds-facts">{suiteTakeFactsOf(take)}</span>
      <button
        type="button"
        className="sounds-keep"
        aria-pressed={chosen}
        onClick={() => props.on.keep(id, take.n)}
      >
        Diesen Take wählen
      </button>
      <ol className="sounds-piece-list" aria-label={`Stücke von Take ${take.n}`}>
        {(take.pieces ?? []).map((piece) => (
          <TakePiece key={piece.id} id={id} n={take.n} piece={piece} props={props} />
        ))}
      </ol>
    </li>
  );
}

/** A piece of a suite as the game plays it now: its play button, its id, facts and name. */
function PieceRowView({ row, props }: { row: PieceRow; props: BoardProps }) {
  const { id, name } = row.piece;
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
        <span className="sounds-facts">{pieceRowFactsOf(row)}</span>
        <p className="sounds-prompt">{`${name}: entsteht mit der Partitur`}</p>
      </div>
    </li>
  );
}

/**
 * A suite: its row with the box to tick for new takes, its takes — one row each, every piece
 * playable — and the command that keeps the one chosen whole; then its pieces as the game plays
 * them now.
 */
function SuiteBlock({ listing, props }: { listing: SuiteListing; props: BoardProps }) {
  const { suite } = listing;
  const takes = props.takes[suite.id] ?? [];
  const chosen = props.keeping[suite.id];
  return (
    <section className="sounds-section" aria-label={`Partitur ${suite.id}`}>
      <h2>
        Partitur <span className="muted">({suite.sections.length} Stücke)</span>
      </h2>
      <ul className="sounds-list">
        <li className="sounds-row">
          <div className="sounds-what">
            <code className="sounds-id">{suite.id}</code>
            <span className="sounds-facts">{suiteFactsOf(suite)}</span>
            <p className="sounds-prompt">
              Ein Werk aus einem Guss, in seine Stücke geschnitten: jeder Take steht hier mit
              jedem Stück in der Reihenfolge des Plans.
            </p>
          </div>
          <label className="sounds-pick">
            <input
              type="checkbox"
              checked={props.selected.has(suite.id)}
              onChange={() => props.on.toggle(suite.id)}
            />{' '}
            neu rendern
          </label>
          {takes.length === 0 ? null : (
            <div className="sounds-takes">
              <ol className="sounds-take-list" aria-label={`Takes von ${suite.id}`}>
                {takes.map((take) => (
                  <SuiteTakeRow key={take.n} id={suite.id} take={take} props={props} />
                ))}
              </ol>
              {chosen === undefined ? null : <KeepCommand id={suite.id} n={chosen} whole />}
            </div>
          )}
        </li>
        {listing.rows.map((row) => (
          <PieceRowView key={row.piece.id} row={row} props={props} />
        ))}
      </ul>
    </section>
  );
}

/** A piece of a pack: its play button, its place, its facts, and its attribution, links and all. */
function PackRowView({ pack, row, props }: { pack: string; row: PackRow; props: BoardProps }) {
  const playing = props.playing === packKey(pack, row.slot);
  return (
    <li className="sounds-row">
      <button
        type="button"
        className="sounds-play"
        aria-pressed={playing}
        disabled={row.sound === null}
        onClick={() => props.on.playPack(pack, row.slot)}
      >
        {playing ? 'Stopp' : 'Abspielen'}
      </button>
      <div className="sounds-what">
        <code className="sounds-id">{row.slot}</code>
        <span className="sounds-facts">{packFactsOf(row)}</span>
        <p className="sounds-prompt sounds-credit">{linked(row.piece.attribution)}</p>
      </div>
    </li>
  );
}

/**
 * The music packs: each under its title, its id and its composers, with its piece for every place
 * in their order — each played as the game levels it, its attribution under it as its licence
 * wants it: the whole list of the music's credits.
 */
function PacksBlock({ packs, props }: { packs: readonly PackListing[]; props: BoardProps }) {
  return (
    <section className="sounds-section" aria-label="Musikpakete">
      <h2>
        Musikpakete <span className="muted">({packs.length})</span>
      </h2>
      <p className="muted">
        Jedes Stück so laut, wie das Spiel es einpegelt, einmal von seinem Einsatz bis zum Ende; im
        Spiel gehen die Schleifen an ihrer Naht ineinander über. Unter jedem Stück steht seine
        Nennung, wie seine Lizenz sie verlangt.
      </p>
      {packs.map(({ pack, rows }) => (
        <section key={pack.id} className="sounds-pack" aria-label={pack.title}>
          <h3>
            {pack.title}{' '}
            <span className="muted">{`(${pack.id} · ${pack.composers.join(', ')})`}</span>
          </h3>
          <ul className="sounds-list">
            {rows.map((row) => (
              <PackRowView key={row.slot} pack={pack.id} row={row} props={props} />
            ))}
          </ul>
        </section>
      ))}
    </section>
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
        mit pnpm dev hier unter ihm erscheinen. Die Partitur kommt in zwei Takes je Lauf, so viele
        die Obergrenze eines Laufs zulässt; derselbe Befehl noch einmal bringt weitere.
      </p>
      {props.commands.length === 0 ? (
        <p className="muted">Nichts angekreuzt.</p>
      ) : (
        props.commands.map((command) => (
          <pre key={command} className="sounds-cli">
            {command}
          </pre>
        ))
      )}
      <button type="button" disabled={props.commands.length === 0} onClick={props.on.copy}>
        Befehl kopieren
      </button>
      <span className="muted sounds-copied">{said}</span>
    </section>
  );
}

/**
 * Every sound of the lab, section by section, to be listened to as the game loads it, the takes
 * of the music under their piece, the music packs with their credits, and the command that makes
 * the ones ticked anew.
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
      {props.suites.map((listing) => (
        <SuiteBlock key={listing.suite.id} listing={listing} props={props} />
      ))}
      {props.packs.length === 0 ? null : <PacksBlock packs={props.packs} props={props} />}
      {props.sections.filter((section) => section.rows.length > 0).map((section) => (
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
