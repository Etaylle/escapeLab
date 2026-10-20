import { useRef, useState, type ChangeEvent } from 'react';
import type { MissionInfo } from '@escapelab/core';
import { MapThumb } from '../screens/MapThumb.js';
import { twoConsoles, type Draft } from './draft.js';
import { ToolGlyph } from './EditorCanvas.js';
import { SelectField } from './fields.js';
import { MissionForm } from './MissionForm.js';
import { PuzzleList } from './PuzzleList.js';
import { ThingForm } from './ThingForm.js';
import {
  stationConsole,
  stationTarget,
  type Pending,
  type Ref,
  type StationChoice,
  type Tool,
} from './tools.js';
import type { Finding, Validation } from './validate.js';
import { ValidatorPanel } from './ValidatorPanel.js';

/** The editor's pieces around the map: its bar, its notices, the list to load from, the tools. */

export const TOOLS: readonly { tool: Tool; label: string; help: string }[] = [
  { tool: 'select', label: 'Auswahl', help: 'Klicken wählt aus, Ziehen verschiebt, Entf löscht.' },
  { tool: 'floor', label: 'Boden', help: 'Malt Boden: Fläche, auf der die Crew geht.' },
  { tool: 'wall', label: 'Wand', help: 'Malt Wand.' },
  { tool: 'spawn', label: 'Start', help: 'Ein Startplatz; jeder Lauf lost die Plätze aus.' },
  { tool: 'door', label: 'Tür', help: 'In eine Wandlücke; öffnet durch Rätsel oder Platte.' },
  { tool: 'plate', label: 'Platte', help: 'Hält eine Tür offen, solange jemand darauf steht.' },
  { tool: 'station', label: 'Station', help: 'Das Pult eines Rätsels; bei zwei Pulten A und B.' },
  { tool: 'source', label: 'Quelle', help: 'Wo Regeln liegen: Buch, Terminal, Tafel, Spind …' },
  { tool: 'sign', label: 'Kennung', help: 'Das Schild mit der Laborkennung.' },
  { tool: 'label', label: 'Raumname', help: 'Name eines Raums; gelöste Rätsel machen dort Licht.' },
  { tool: 'exit', label: 'Ausgang', help: 'Der Notausgang: Am Ende müssen alle dorthin.' },
  { tool: 'item', label: 'Teil', help: 'Zum Tragen: zu seinem Ablageort, oder ein Schlüssel.' },
  { tool: 'drone', label: 'Drohne', help: 'Jeder Klick ein Wegpunkt; Esc beendet den Weg.' },
];

export interface Status {
  tone: 'ok' | 'error' | 'note';
  text: string;
  lines?: string[];
}

/** A step that throws away unsaved changes, once the user agrees. */
export interface Confirm {
  /** „wenn du …": what the user is about to do */
  what: string;
  run: () => void;
}

interface BarProps {
  title: string;
  id: string;
  dirty: boolean;
  /** opened from a shared link and not saved since */
  shared: boolean;
  /** the catalog has a custom mission of this id: its handbook can be opened */
  saved: boolean;
  /** save is open only to a sound mission while nothing else is under way */
  canSave: boolean;
  saveTitle: string;
  /** a test run is open to a mission without errors; `playTitle` says why not */
  canPlay: boolean;
  playTitle: string;
  /** the test run's form is open */
  playing: boolean;
  loading: boolean;
  onNew: () => void;
  onLoad: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onShare: () => void;
  onHandbook: () => void;
  onPlay: () => void;
  onSave: () => void;
  back: () => void;
}

/** Beside the mission's name: shared and not saved yet, or changed since it was saved. */
function SavedMark({ shared, dirty }: { shared: boolean; dirty: boolean }) {
  if (shared) {
    return <span className="editor-shared">GETEILT · nicht gespeichert</span>;
  }
  return dirty ? <span className="editor-dirty">ungespeichert</span> : null;
}

/** The mission's name and id, and everything that can be done with it as a whole. */
export function EditorBar(props: BarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const picked = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Cleared, so that picking the same file again fires again.
    e.target.value = '';
    if (file !== undefined) {
      props.onImport(file);
    }
  };
  return (
    <header className="editor-bar">
      <button className="link editor-back" onClick={props.back}>
        ← Zurück
      </button>
      <div className="editor-name">
        <span className="kicker">MISSIONS-EDITOR</span>
        <strong>{props.title || 'Ohne Titel'}</strong>
        <code className="editor-id">{props.id}</code>
        <SavedMark shared={props.shared} dirty={props.dirty} />
      </div>
      <div className="editor-actions">
        <button onClick={props.onNew}>Neu</button>
        <button aria-expanded={props.loading} onClick={props.onLoad}>
          Laden
        </button>
        <button onClick={() => fileRef.current?.click()}>Importieren</button>
        <button onClick={props.onExport}>Exportieren</button>
        <button title="Ein Link, der die ganze Mission enthält" onClick={props.onShare}>
          Teilen
        </button>
        <button
          disabled={!props.saved}
          title={props.saved ? 'Das Handbuch der gespeicherten Fassung' : 'Erst speichern'}
          onClick={props.onHandbook}
        >
          Handbuch
        </button>
        <button
          disabled={!props.canPlay}
          aria-expanded={props.playing}
          title={props.playTitle}
          onClick={props.onPlay}
        >
          Probespiel
        </button>
        <button
          className="primary"
          disabled={!props.canSave}
          title={props.saveTitle}
          onClick={props.onSave}
        >
          Speichern
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={picked} />
      </div>
    </header>
  );
}

/**
 * A question before unsaved changes go — answered either way, `onAnswered`
 * puts it away — and the outcome of the last step.
 */
export function Notices({
  confirm,
  status,
  onAnswered,
  onClose,
}: {
  confirm: Confirm | null;
  status: Status | null;
  onAnswered: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {confirm !== null && (
        <div className="editor-confirm" role="alertdialog" aria-label="Änderungen verwerfen?">
          <span>Ungespeicherte Änderungen gehen verloren, wenn du {confirm.what}.</span>
          <button
            onClick={() => {
              confirm.run();
              onAnswered();
            }}
          >
            Verwerfen
          </button>
          <button className="link" onClick={onAnswered}>
            Abbrechen
          </button>
        </div>
      )}
      {status !== null && (
        <div className={`editor-status editor-status-${status.tone}`} role="status">
          <span>{status.text}</span>
          {status.lines !== undefined && status.lines.length > 0 && (
            <ul>
              {status.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <button className="link" onClick={onClose}>
            schließen
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The test run's form: the name the room opens under — the join screen's,
 * where it has one — and the start, which saves the mission first.
 */
export function PlayForm({
  name,
  onName,
  blocked,
  onStart,
  onCancel,
}: {
  name: string;
  onName: (name: string) => void;
  /** why the run cannot start now; null when it can */
  blocked: string | null;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="editor-play"
      aria-label="Probespiel"
      onSubmit={(e) => {
        e.preventDefault();
        onStart();
      }}
    >
      <label className="editor-field">
        Dein Name
        <input
          value={name}
          maxLength={40}
          placeholder="z. B. Anna"
          autoFocus
          onChange={(e) => onName(e.target.value)}
        />
      </label>
      <button type="submit" className="primary" disabled={blocked !== null || name.trim() === ''}>
        Starten
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Abbrechen
      </button>
      {blocked !== null && <span className="editor-note">{blocked}</span>}
    </form>
  );
}

/** Puts the cursor into the link and marks all of it, once, as the box opens. */
function selectAll(input: HTMLInputElement | null): void {
  input?.focus();
  input?.select();
}

/** A link the clipboard would not take: marked in a box of its own, to copy by hand. */
export function ShareBox({ link, onClose }: { link: string; onClose: () => void }) {
  return (
    <div className="editor-share" role="status">
      <span>Link markiert — mit Strg+C kopieren</span>
      <input readOnly value={link} aria-label="Link zur Mission" ref={selectAll} />
      <button className="link" onClick={onClose}>
        schließen
      </button>
    </div>
  );
}

/** The catalog to start from: shipped missions open as a copy, custom ones as they are. */
export function LoadList({
  missions,
  busy,
  onOpen,
  onDelete,
}: {
  missions: MissionInfo[];
  busy: boolean;
  onOpen: (info: MissionInfo) => void;
  onDelete: (info: MissionInfo) => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <ul className="editor-load" aria-label="Missionen">
      {missions.map((info) => (
        <li key={info.id} className="editor-load-row">
          <MapThumb tiles={info.tiles} height={36} />
          <span className="editor-load-title">
            {info.title}
            <span className="editor-load-kind">{info.custom === true ? 'eigene' : 'Vorlage'}</span>
          </span>
          <button disabled={busy} onClick={() => onOpen(info)}>
            {info.custom === true ? 'Öffnen' : 'Als Kopie öffnen'}
          </button>
          {info.custom === true &&
            (deleting === info.id ? (
              <button
                className="editor-danger"
                disabled={busy}
                onClick={() => {
                  setDeleting(null);
                  onDelete(info);
                }}
              >
                Wirklich löschen
              </button>
            ) : (
              <button className="link" onClick={() => setDeleting(info.id)}>
                Löschen
              </button>
            ))}
        </li>
      ))}
    </ul>
  );
}

/** The station tool's choice: which puzzle, and at two consoles which; „auto" picks itself. */
function StationOptions({
  draft,
  choice,
  onChoice,
}: {
  draft: Draft;
  choice: StationChoice;
  onChoice: (choice: StationChoice) => void;
}) {
  const target = stationTarget(draft, choice.puzzleId);
  return (
    <div className="editor-tool-options">
      <SelectField
        label="Für Rätsel"
        value={choice.puzzleId ?? ''}
        choices={[
          { value: '', label: `auto: ${target?.title ?? '—'}` },
          ...draft.puzzles.map((p, i) => ({ value: p.id, label: `${i + 1}. ${p.title || p.id}` })),
        ]}
        onChange={(id) => onChoice({ ...choice, puzzleId: id === '' ? null : id })}
      />
      {target !== undefined && twoConsoles(target.type) && (
        <SelectField
          label="Pult"
          value={choice.console ?? ''}
          choices={[
            { value: '', label: `auto: ${stationConsole(draft, target.id, null).toUpperCase()}` },
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
          onChange={(letter) =>
            onChoice({ ...choice, console: letter === 'a' || letter === 'b' ? letter : null })
          }
        />
      )}
    </div>
  );
}

export function ToolBox({
  draft,
  tool,
  choice,
  onTool,
  onChoice,
}: {
  draft: Draft;
  tool: Tool;
  choice: StationChoice;
  onTool: (tool: Tool) => void;
  onChoice: (choice: StationChoice) => void;
}) {
  return (
    <nav className="editor-tools" aria-label="Werkzeuge">
      <div className="editor-tool-grid">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            data-tool={t.tool}
            className="editor-tool"
            aria-pressed={tool === t.tool}
            title={t.help}
            onClick={() => onTool(t.tool)}
          >
            <ToolGlyph tool={t.tool} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <p className="editor-tool-help">{TOOLS.find((t) => t.tool === tool)?.help}</p>
      {tool === 'station' && <StationOptions draft={draft} choice={choice} onChoice={onChoice} />}
    </nav>
  );
}

/** The „Auswahl" tab: the pending press, the selected thing's form, or what the tool does. */
function ThingPane({
  draft,
  tool,
  selection,
  pending,
  validation,
  onChange,
  onRemove,
  onPending,
}: {
  draft: Draft;
  tool: Tool;
  selection: Ref | null;
  pending: Pending | null;
  validation: Validation;
  onChange: (draft: Draft) => void;
  onRemove: () => void;
  onPending: (pending: Pending | null) => void;
}) {
  if (pending !== null) {
    const what = pending.kind === 'spot' ? 'einen weiteren Platz der Quelle' : 'den Ablageort';
    return (
      <div className="editor-thing">
        <p className="editor-pending">Auf der Karte {what} anklicken.</p>
        <button className="link" onClick={() => onPending(null)}>
          Abbrechen (Esc)
        </button>
      </div>
    );
  }
  if (selection === null || selection.kind === 'puzzle') {
    const help = TOOLS.find((t) => t.tool === tool);
    return (
      <div className="editor-thing">
        <p className="editor-note">
          Nichts ausgewählt. {help?.label}: {help?.help}
        </p>
        <p className="editor-note">Mit „Auswahl“ ein Ding anklicken, um es hier zu bearbeiten.</p>
      </div>
    );
  }
  return (
    <ThingForm
      draft={draft}
      selection={selection}
      validation={validation}
      onChange={onChange}
      onRemove={onRemove}
      onPending={onPending}
    />
  );
}

export type Tab = 'thing' | 'mission' | 'puzzles';

const TABS: readonly (readonly [Tab, string])[] = [
  ['thing', 'Auswahl'],
  ['mission', 'Mission'],
  ['puzzles', 'Rätsel'],
];

interface SideProps {
  draft: Draft;
  validation: Validation;
  /** a shared mission whose id a mission on this server has already */
  idTaken: boolean;
  onChange: (draft: Draft) => void;
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** the puzzle whose form is open in the „Rätsel" tab */
  openPuzzle: number | null;
  onOpenPuzzle: (index: number | null) => void;
  tool: Tool;
  selection: Ref | null;
  pending: Pending | null;
  onRemove: () => void;
  onPending: (pending: Pending | null) => void;
  /** the text of the finding lit up on the map */
  active: string | null;
  onPick: (finding: Finding) => void;
}

/** The column beside the map: the forms in their tabs over the validator. */
export function SidePanel(props: SideProps) {
  const { draft, validation, onChange, tab } = props;
  return (
    <aside className="editor-side">
      <div className="editor-tabs" role="tablist" aria-label="Bearbeiten">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            className="editor-tab"
            aria-selected={tab === value}
            onClick={() => props.onTab(value)}
          >
            {value === 'puzzles' ? `${label} (${draft.puzzles.length})` : label}
          </button>
        ))}
      </div>
      <div className="editor-pane" role="tabpanel">
        {tab === 'mission' && (
          <MissionForm
            draft={draft}
            validation={validation}
            idTaken={props.idTaken}
            onChange={onChange}
          />
        )}
        {tab === 'puzzles' && (
          <PuzzleList
            draft={draft}
            validation={validation}
            onChange={onChange}
            open={props.openPuzzle}
            onOpen={props.onOpenPuzzle}
          />
        )}
        {tab === 'thing' && (
          <ThingPane
            draft={draft}
            tool={props.tool}
            selection={props.selection}
            pending={props.pending}
            validation={validation}
            onChange={onChange}
            onRemove={props.onRemove}
            onPending={props.onPending}
          />
        )}
      </div>
      <ValidatorPanel validation={validation} active={props.active} onPick={props.onPick} />
    </aside>
  );
}
