import {
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { MissionInfo } from '@escapelab/core';
import { lastName } from '../screens/Join.js';
import { copyOf, draftFromJson, draftToJson, newDraft, type Draft, type Tile } from './draft.js';
import { EditorCanvas } from './EditorCanvas.js';
import {
  EditorBar,
  LoadList,
  Notices,
  PlayForm,
  ShareBox,
  SidePanel,
  ToolBox,
  type Confirm,
  type Status,
  type Tab,
} from './EditorParts.js';
import { focusField } from './fields.js';
import { deleteMission, fetchMission, saveMission } from './server.js';
import { workOf, type EditorWork } from './session.js';
import { shareLink } from './share.js';
import {
  MATERIAL,
  move,
  paint,
  place,
  placePending,
  refsAt,
  remove,
  sameRef,
  type Pending,
  type Placement,
  type Ref,
  type StationChoice,
  type Tool,
} from './tools.js';
import { validateDraft, type Finding, type Validation } from './validate.js';

export { TOOLS } from './EditorParts.js';

interface Props {
  /** the catalog as the join screen has it, custom missions marked */
  missions: MissionInfo[];
  /** fetches the catalog again, after a save or a delete */
  reloadMissions: () => void;
  openHandbook: (missionId: string) => void;
  back: () => void;
  /** the draft and whether it is saved: the app keeps it across a test run and a reload */
  work: EditorWork;
  onWork: Dispatch<SetStateAction<EditorWork>>;
  /** what the editor says as it opens: a shared link that could not be read */
  greeting?: Status | null;
  /** the socket to the server is open: a test run can start */
  connected: boolean;
  /** opens a room for a saved mission, with the player of this name as its host */
  startTestRun: (name: string, missionId: string) => void;
}

/** How long the draft has to rest before the validator looks at it, in ms. */
const SETTLE_MS = 250;

/** The validator's view of the draft, taken once the draft has rested for a moment. */
function useValidation(draft: Draft): Validation {
  const [validation, setValidation] = useState<Validation>(() => validateDraft(draft));
  useEffect(() => {
    const timer = setTimeout(() => setValidation(validateDraft(draft)), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [draft]);
  return validation;
}

/** Whether a key press belongs to a field being typed in rather than to the map. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Backspace or Delete removes the selected thing; Escape drops a pending
 * press first, then the selection.
 */
function useEditorKeys(keys: {
  selection: Ref | null;
  pending: Pending | null;
  setPending: (pending: Pending | null) => void;
  select: (ref: Ref | null) => void;
  removeSelected: () => void;
}): void {
  const onKey = useEffectEvent((e: KeyboardEvent): void => {
    if (typing(e.target)) {
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && keys.selection !== null) {
      e.preventDefault();
      keys.removeSelected();
    } else if (e.key === 'Escape' && keys.pending !== null) {
      keys.setPending(null);
    } else if (e.key === 'Escape') {
      keys.select(null);
    }
  });
  useEffect(() => {
    const listen = (e: KeyboardEvent): void => onKey(e);
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, []);
}

/**
 * How the map edits the draft: the tool, the selection, a press the side
 * form armed, the tab the side shows. A tool's word for the status line
 * goes to `say`.
 */
function useMapEditing(
  draft: Draft,
  setDraft: (next: SetStateAction<Draft>) => void,
  say: (status: Status | null) => void,
) {
  const [tool, setTool] = useState<Tool>('floor');
  const [selection, setSelection] = useState<Ref | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [choice, setChoice] = useState<StationChoice>({ puzzleId: null, console: null });
  const [tab, setTab] = useState<Tab>('mission');

  const select = (ref: Ref | null): void => {
    setSelection(ref);
    if (ref !== null && ref.kind !== 'puzzle') {
      setTab('thing');
    }
  };
  const settle = ({ draft: next, selection: picked, note }: Placement): void => {
    setDraft(next);
    select(picked);
    say(note === null ? null : { tone: 'note', text: note });
  };
  const removeSelected = (): void => {
    if (selection !== null && selection.kind !== 'puzzle') {
      setDraft(remove(draft, selection));
      setSelection(null);
    }
  };
  const press = (at: Tile): void => {
    if (pending !== null) {
      settle(placePending(draft, pending, at));
      setPending(null);
    } else if (tool === 'select') {
      const here = refsAt(draft, at);
      // Pressing again where several things lie goes through them in turn.
      const now = selection === null ? -1 : here.findIndex((ref) => sameRef(ref, selection));
      select(here[(now + 1) % Math.max(1, here.length)] ?? null);
    } else if (tool !== 'floor' && tool !== 'wall') {
      settle(place(draft, tool, at, selection, choice));
    }
  };
  useEditorKeys({ selection, pending, setPending, select, removeSelected });
  return {
    tool,
    chooseTool: (next: Tool): void => {
      setTool(next);
      setPending(null);
    },
    selection,
    select,
    pending,
    setPending,
    choice,
    setChoice,
    tab,
    setTab,
    press,
    drop: (ref: Ref, to: Tile): void => settle(move(draft, ref, to)),
    stroke: (tiles: Tile[]): void =>
      setDraft((current) => paint(current, tiles, MATERIAL[tool === 'wall' ? 'wall' : 'floor'])),
    removeSelected,
    /** another draft is opened: nothing of the old one stays selected or armed */
    reset: (): void => {
      setSelection(null);
      setPending(null);
    },
  };
}

type MapEditing = ReturnType<typeof useMapEditing>;

/**
 * Picking a finding: it lights up on the map until picked again, and what it
 * is about opens — a thing on the map in the „Auswahl" tab, a puzzle in the
 * „Rätsel" tab with the input of the field it names focused.
 */
function usePick(edit: { select: (ref: Ref | null) => void; setTab: (tab: Tab) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const [openPuzzle, setOpenPuzzle] = useState<number | null>(0);
  // A new object each pick, so that picking the same finding again focuses again.
  const [focus, setFocus] = useState<{ path: string } | null>(null);
  useEffect(() => {
    if (focus !== null) {
      focusField(focus.path);
    }
  }, [focus]);
  const pick = (finding: Finding): void => {
    setActive(finding.text === active ? null : finding.text);
    if (finding.target?.kind === 'puzzle') {
      edit.setTab('puzzles');
      setOpenPuzzle(finding.target.index);
      setFocus({ path: finding.path });
    } else if (finding.target !== null) {
      edit.select(finding.target);
    }
  };
  return { active, setActive, pick, openPuzzle, setOpenPuzzle };
}

/** Offers the mission file for download, under its id. */
function download(json: Record<string, unknown>): void {
  const blob = new Blob([`${JSON.stringify(json, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${String(json['id'])}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * „Teilen": the link onto the clipboard; where the browser has no clipboard
 * for the page or refuses it, the link goes into a box of its own (`show`).
 */
async function share(
  json: Record<string, unknown>,
  say: (status: Status) => void,
  show: (link: string) => void,
): Promise<void> {
  const shared = await shareLink(json, window.location.origin);
  if (!shared.ok) {
    say({ tone: 'error', text: shared.error });
    return;
  }
  // Without a secure origin, as on a LAN address, the browser has no clipboard.
  const copied =
    navigator.clipboard === undefined
      ? false
      : await navigator.clipboard.writeText(shared.link).then(
          () => true,
          () => false,
        );
  if (copied) {
    say({ tone: 'ok', text: 'Link kopiert: Er trägt die ganze Mission.' });
  } else {
    show(shared.link);
  }
}

interface Files {
  json: Record<string, unknown>;
  reloadMissions: () => void;
  setBusy: (busy: boolean) => void;
  say: (status: Status | null) => void;
  /** the draft as it stands is what the server has now */
  markSaved: () => void;
  open: (draft: Draft, says: Status) => void;
  guard: (what: string, action: () => void) => void;
}

/** Saving, loading, deleting and importing: each says on the status line how it went. */
function missionFiles({ json, reloadMissions, setBusy, say, markSaved, open, guard }: Files) {
  const busyWith = async <T,>(work: Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await work;
    } finally {
      setBusy(false);
    }
  };
  return {
    /** Saves the mission; whether the server took it. */
    save: async (): Promise<boolean> => {
      const result = await busyWith(saveMission(json));
      if (!result.ok) {
        say({ tone: 'error', text: result.error, lines: result.issues });
        return false;
      }
      markSaved();
      say({ tone: 'ok', text: `Gespeichert als ${result.id}, jetzt in der Missionsauswahl.` });
      reloadMissions();
      return true;
    },
    load: async (info: MissionInfo): Promise<void> => {
      const loaded = await busyWith(fetchMission(info.id));
      if (!loaded.ok) {
        const text = `„${info.title}“ ließ sich nicht laden.`;
        say({ tone: 'error', text, lines: loaded.problems });
        return;
      }
      const copy = info.custom !== true;
      const text = copy
        ? `„${info.title}“ als Kopie geöffnet: Gespeichert wird sie als eigene Mission.`
        : `„${info.title}“ geöffnet.`;
      open(copy ? copyOf(loaded.draft) : loaded.draft, { tone: 'note', text });
    },
    remove: async (info: MissionInfo): Promise<void> => {
      const problem = await busyWith(deleteMission(info.id));
      say(
        problem === null
          ? { tone: 'ok', text: `„${info.title}“ gelöscht.` }
          : { tone: 'error', text: problem },
      );
      reloadMissions();
    },
    importFile: async (file: File): Promise<void> => {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        say({ tone: 'error', text: `${file.name} ist kein JSON: ${reason}` });
        return;
      }
      const loaded = draftFromJson(data);
      if (!loaded.ok) {
        const text = `${file.name} ist keine Missionsdatei.`;
        say({ tone: 'error', text, lines: loaded.problems });
        return;
      }
      const says: Status = { tone: 'note', text: `${file.name} importiert.` };
      guard('importierst', () => open(loaded.draft, says));
    },
  };
}

/**
 * „Probespiel": its form, open or not; the name the room opens under,
 * starting with the join screen's; and the start, which saves the mission
 * as „Speichern" does and opens a room for it only once the server has it.
 */
function usePlay(save: () => Promise<boolean>, startRun: (name: string) => void) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(lastName);
  return {
    open,
    setOpen,
    name,
    setName,
    start: async (): Promise<void> => {
      if (await save()) {
        setOpen(false);
        startRun(name.trim());
      }
    },
  };
}

/** What keeps a test run from starting now; null when it can. */
function playBlocked(connected: boolean, busy: boolean): string | null {
  if (!connected) {
    return 'Keine Verbindung zum Server.';
  }
  return busy ? 'Einen Moment, die Mission wird gespeichert.' : null;
}

/** The test run's button: open to a mission without errors, else its tooltip counts them. */
function playTitleOf(errors: number): string {
  if (errors === 0) {
    return 'Speichern und eine Runde mit dieser Mission eröffnen';
  }
  return errors === 1 ? 'Erst den einen Fehler beheben' : `Erst die ${errors} Fehler beheben`;
}

/** The workbench under the bar: the tools, the map and the side column. */
function EditorBody({
  draft,
  setDraft,
  edit,
  validation,
  pick,
  idTaken,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  edit: MapEditing;
  validation: Validation;
  pick: ReturnType<typeof usePick>;
  idTaken: boolean;
}) {
  return (
    <div className="editor-body">
      <ToolBox
        draft={draft}
        tool={edit.tool}
        choice={edit.choice}
        onTool={edit.chooseTool}
        onChoice={edit.setChoice}
      />
      <EditorCanvas
        scene={{
          draft,
          selection: edit.selection,
          highlight: validation.findings.find((f) => f.text === pick.active)?.spots ?? [],
          tool: edit.tool,
          pending: edit.pending,
        }}
        onPress={edit.press}
        onPaint={edit.stroke}
        onDrop={edit.drop}
      />
      <SidePanel
        draft={draft}
        validation={validation}
        idTaken={idTaken}
        onChange={setDraft}
        tab={edit.tab}
        onTab={edit.setTab}
        openPuzzle={pick.openPuzzle}
        onOpenPuzzle={pick.setOpenPuzzle}
        tool={edit.tool}
        selection={edit.selection}
        pending={edit.pending}
        onRemove={edit.removeSelected}
        onPending={edit.setPending}
        active={pick.active}
        onPick={pick.pick}
      />
    </div>
  );
}

/**
 * The mission editor: a lab painted on a canvas with the game's own tiles,
 * tools to place what a mission holds, side forms for the selected thing,
 * the mission and its puzzles, and the validator watching every change —
 * its findings point at the map and at the fields. Saves to the server as a
 * custom mission, opens any mission of the catalog as a start (a shipped one
 * as a copy), moves mission files in and out of the browser, packs the
 * mission into a link, and opens a room to try it out.
 */
export function EditorScreen(props: Props) {
  const { missions, reloadMissions, work, onWork } = props;
  const [status, setStatus] = useState<Status | null>(props.greeting ?? null);
  const { draft } = work;
  const setDraft = (next: SetStateAction<Draft>): void =>
    onWork((w) => ({ ...w, draft: typeof next === 'function' ? next(w.draft) : next }));
  const edit = useMapEditing(draft, setDraft, setStatus);
  const pick = usePick(edit);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const validation = useValidation(draft);
  const json = useMemo(() => draftToJson(draft), [draft]);
  const id = String(json['id']);
  const dirty = JSON.stringify(json) !== work.baseline;
  const custom = missions.some((m) => m.id === id && m.custom === true);

  const guard = (what: string, action: () => void): void =>
    dirty ? setConfirm({ what, run: action }) : action();
  const open = (next: Draft, says: Status | null): void => {
    edit.reset();
    onWork(workOf(next));
    pick.setActive(null);
    setLoading(false);
    setStatus(says);
  };
  const saved = JSON.stringify(json);
  const markSaved = (): void => onWork((w) => ({ ...w, baseline: saved, shared: false }));
  const say = setStatus;
  const files = missionFiles({ json, reloadMissions, setBusy, say, markSaved, open, guard });
  const play = usePlay(files.save, (name) => props.startTestRun(name, id));

  return (
    <div className="editor">
      <EditorBar
        title={draft.title}
        id={id}
        dirty={dirty}
        shared={work.shared}
        saved={custom}
        canSave={!busy && validation.errors === 0}
        saveTitle={validation.errors > 0 ? 'Erst die Fehler beheben' : `Als ${id} speichern`}
        canPlay={validation.errors === 0}
        playTitle={playTitleOf(validation.errors)}
        playing={play.open}
        loading={loading}
        onNew={() => guard('neu anfängst', () => open(newDraft(), null))}
        onLoad={() => setLoading(!loading)}
        onImport={(file) => void files.importFile(file)}
        onExport={() => download(json)}
        onShare={() => void share(json, setStatus, setLink)}
        onHandbook={() => props.openHandbook(id)}
        onPlay={() => play.setOpen(!play.open)}
        onSave={() => void files.save()}
        back={props.back}
      />
      <Notices
        confirm={confirm}
        status={status}
        onAnswered={() => setConfirm(null)}
        onClose={() => setStatus(null)}
      />
      {link !== null && <ShareBox link={link} onClose={() => setLink(null)} />}
      {play.open && validation.errors === 0 && (
        <PlayForm
          name={play.name}
          onName={play.setName}
          blocked={playBlocked(props.connected, busy)}
          onStart={() => void play.start()}
          onCancel={() => play.setOpen(false)}
        />
      )}
      {loading && (
        <LoadList
          missions={missions}
          busy={busy}
          onOpen={(info) => guard('eine andere Mission öffnest', () => void files.load(info))}
          onDelete={(info) => void files.remove(info)}
        />
      )}
      <EditorBody
        draft={draft}
        setDraft={setDraft}
        edit={edit}
        validation={validation}
        pick={pick}
        idTaken={work.shared && custom}
      />
    </div>
  );
}
