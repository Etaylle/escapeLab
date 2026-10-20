import type { ComponentType, ReactNode } from 'react';
import { MANUAL_KINDS, type ManualKind } from '@escapelab/core';
import { SOURCE_NAMES, twoConsoles, type Draft, type DraftSource, type Tile } from './draft.js';
import { ChecksField, FormHead, IdField, SelectField, TextField, type Choice } from './fields.js';
import { rename, replaceAt, sameThing, tileOf, withMap, type Pending, type Ref } from './tools.js';
import { messagesAt, type Validation } from './validate.js';

/**
 * The side form of the selected thing: its fields, what the validator says
 * about it, and a button to remove it (as Backspace does). Each form edits
 * the draft through `onChange`; a source's next spot and an item's
 * drop-off are picked on the map through `onPending`.
 */

export interface ThingProps {
  draft: Draft;
  selection: Ref;
  validation: Validation;
  onChange: (draft: Draft) => void;
  onRemove: () => void;
  onPending: (pending: Pending) => void;
}

const NONE: Choice = { value: '', label: '—' };

const where = (tile: Tile | null): string => (tile === null ? '' : `Feld ${tile.x},${tile.y}`);

function puzzleChoices(draft: Draft): Choice[] {
  return draft.puzzles.map((p, i) => ({ value: p.id, label: `${i + 1}. ${p.title || p.id}` }));
}

/** The fields the forms show the validator's words beside, by the end of their path. */
const INLINE = ['.id', '.label', '.text', '.puzzleIds', '.puzzleId', '.plateId'];

/**
 * What the validator says about this thing that no field shows: the map
 * rules that name it, the warnings, and what concerns its place or its
 * spots rather than a field of the form.
 */
function Verdicts({ validation, selection }: { validation: Validation; selection: Ref }) {
  const about = validation.findings.filter(
    (f) =>
      f.target !== null &&
      sameThing(f.target, selection) &&
      (f.severity !== 'error' || !INLINE.some((field) => f.path.endsWith(field))),
  );
  if (about.length === 0) {
    return null;
  }
  return (
    <ul className="editor-verdicts">
      {about.map((f) => (
        <li key={f.text} className={`editor-verdict editor-verdict-${f.severity}`}>
          {f.message}
        </li>
      ))}
    </ul>
  );
}

function Shell({
  title,
  props,
  children,
}: {
  title: string;
  props: ThingProps;
  children?: ReactNode;
}) {
  return (
    <div className="editor-thing">
      <FormHead title={title} where={where(tileOf(props.draft, props.selection))}>
        <button
          className="link editor-remove"
          onClick={props.onRemove}
          title="Auch mit Entf oder Rücktaste"
        >
          Entfernen
        </button>
      </FormHead>
      <Verdicts validation={props.validation} selection={props.selection} />
      {children}
    </div>
  );
}

function DoorForm({ index, props }: { index: number; props: ThingProps }) {
  const { draft, validation, onChange } = props;
  const door = draft.map.doors[index];
  if (door === undefined) {
    return null;
  }
  const at = `map.doors.${index}`;
  const set = (next: typeof door): void =>
    onChange(withMap(draft, { doors: replaceAt(draft.map.doors, index, next) }));
  const opens = door.opensBy;
  const plates = draft.map.plates.map((p) => ({
    value: p.id,
    label: `${p.id} (${p.label || 'ohne Aufschrift'})`,
  }));
  return (
    <Shell title="Tür" props={props}>
      <IdField
        label="Kennung"
        value={door.id}
        taken={draft.map.doors.filter((d) => d !== door).map((d) => d.id)}
        onChange={(id) => set({ ...door, id })}
        issues={messagesAt(validation, `${at}.id`)}
      />
      <SelectField
        label="Öffnet"
        value={opens.kind}
        choices={[
          { value: 'puzzle', label: 'für immer, sobald ein Rätsel gelöst ist' },
          { value: 'plate', label: 'solange jemand auf einer Platte steht' },
        ]}
        onChange={(kind) =>
          set({
            ...door,
            opensBy:
              kind === 'plate'
                ? { kind: 'plate', plateId: draft.map.plates[0]?.id ?? '', untilSolved: '' }
                : { kind: 'puzzle', puzzleId: draft.puzzles[0]?.id ?? '' },
          })
        }
      />
      {opens.kind === 'puzzle' ? (
        <SelectField
          label="Rätsel"
          value={opens.puzzleId}
          choices={[NONE, ...puzzleChoices(draft)]}
          onChange={(puzzleId) => set({ ...door, opensBy: { kind: 'puzzle', puzzleId } })}
          issues={messagesAt(validation, `${at}.opensBy.puzzleId`)}
        />
      ) : (
        <>
          <SelectField
            label="Platte"
            value={opens.plateId}
            choices={[NONE, ...plates]}
            onChange={(plateId) => set({ ...door, opensBy: { ...opens, plateId } })}
            issues={messagesAt(validation, `${at}.opensBy.plateId`)}
          />
          <SelectField
            label="Bleibt offen, sobald gelöst ist"
            value={opens.untilSolved}
            choices={[NONE, ...puzzleChoices(draft)]}
            onChange={(untilSolved) => set({ ...door, opensBy: { ...opens, untilSolved } })}
          />
        </>
      )}
    </Shell>
  );
}

function PlateForm({ index, props }: { index: number; props: ThingProps }) {
  const { draft, validation, onChange } = props;
  const plate = draft.map.plates[index];
  if (plate === undefined) {
    return null;
  }
  const at = `map.plates.${index}`;
  return (
    <Shell title="Druckplatte" props={props}>
      <IdField
        label="Kennung"
        value={plate.id}
        taken={draft.map.plates.filter((p) => p !== plate).map((p) => p.id)}
        onChange={(id) => onChange(rename(draft, 'plate', plate.id, id))}
        issues={messagesAt(validation, `${at}.id`)}
      />
      <TextField
        label="Aufschrift"
        value={plate.label}
        onChange={(label) =>
          onChange(
            withMap(draft, { plates: replaceAt(draft.map.plates, index, { ...plate, label }) }),
          )
        }
      />
    </Shell>
  );
}

function StationForm({ index, props }: { index: number; props: ThingProps }) {
  const { draft, validation, onChange } = props;
  const station = draft.map.stations[index];
  if (station === undefined) {
    return null;
  }
  const puzzle = draft.puzzles.find((p) => p.id === station.puzzleId);
  const two = puzzle !== undefined && twoConsoles(puzzle.type);
  const set = (next: typeof station): void =>
    onChange(withMap(draft, { stations: replaceAt(draft.map.stations, index, next) }));
  const forPuzzle = (puzzleId: string): void => {
    const next = draft.puzzles.find((p) => p.id === puzzleId);
    const { console: letter, ...rest } = station;
    const lettered = next !== undefined && twoConsoles(next.type);
    set(lettered ? { ...rest, puzzleId, console: letter ?? 'a' } : { ...rest, puzzleId });
  };
  return (
    <Shell
      title={two ? `Station, Pult ${(station.console ?? 'a').toUpperCase()}` : 'Station'}
      props={props}
    >
      <SelectField
        label="Rätsel"
        value={station.puzzleId}
        choices={[NONE, ...puzzleChoices(draft)]}
        onChange={forPuzzle}
        issues={messagesAt(validation, `map.stations.${index}.puzzleId`)}
      />
      {two && (
        <SelectField
          label="Pult"
          value={station.console ?? 'a'}
          choices={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
          onChange={(letter) => set({ ...station, console: letter === 'b' ? 'b' : 'a' })}
        />
      )}
    </Shell>
  );
}

function SourceForm({ index, props }: { index: number; props: ThingProps }) {
  const { draft, validation, onChange, onPending } = props;
  const source = draft.map.manuals[index];
  if (source === undefined) {
    return null;
  }
  const at = `map.manuals.${index}`;
  const set = (next: DraftSource): void =>
    onChange(withMap(draft, { manuals: replaceAt(draft.map.manuals, index, next) }));
  const retitle = (kind: ManualKind): void => {
    // A label still at its kind's default follows the kind; one of its own stays.
    const own = source.label !== SOURCE_NAMES[source.kind].label;
    const label = own ? source.label : SOURCE_NAMES[kind].label;
    set({ ...source, kind, label, needsKey: kind === 'cabinet' ? source.needsKey : '' });
  };
  const items = draft.map.items.map((i) => ({ value: i.id, label: `${i.id} (${i.label})` }));
  return (
    <Shell title={`Quelle: ${SOURCE_NAMES[source.kind].name}`} props={props}>
      <IdField
        label="Kennung"
        value={source.id}
        taken={draft.map.manuals.filter((m) => m !== source).map((m) => m.id)}
        onChange={(id) => set({ ...source, id })}
        issues={messagesAt(validation, `${at}.id`)}
      />
      <SelectField
        label="Art"
        value={source.kind}
        choices={MANUAL_KINDS.map((kind) => ({ value: kind, label: SOURCE_NAMES[kind].name }))}
        onChange={(kind) => retitle(MANUAL_KINDS.find((k) => k === kind) ?? 'book')}
      />
      <TextField
        label="Aufschrift"
        value={source.label}
        onChange={(label) => set({ ...source, label })}
        issues={messagesAt(validation, `${at}.label`)}
      />
      <ChecksField
        label="Regeln für"
        value={source.puzzleIds}
        choices={puzzleChoices(draft)}
        empty="Noch kein Rätsel angelegt."
        onChange={(puzzleIds) => set({ ...source, puzzleIds: [...puzzleIds] })}
        issues={messagesAt(validation, `${at}.puzzleIds`)}
      />
      {source.kind === 'cabinet' && (
        <SelectField
          label="Schlüssel"
          value={source.needsKey}
          choices={[NONE, ...items]}
          onChange={(needsKey) => set({ ...source, needsKey })}
        />
      )}
      <SpotList
        title="Plätze — jeder Lauf lost einen aus"
        spots={source.spots}
        onRemove={(i) => set({ ...source, spots: source.spots.filter((_, j) => j !== i) })}
      />
      <button className="editor-pick" onClick={() => onPending({ kind: 'spot', source: index })}>
        Weiteren Platz auf der Karte wählen
      </button>
    </Shell>
  );
}

function SpotList({
  title,
  spots,
  onRemove,
}: {
  title: string;
  spots: readonly Tile[];
  onRemove: (index: number) => void;
}) {
  return (
    <div className="editor-field">
      {title}
      <ol className="editor-spots">
        {spots.map((spot, i) => (
          <li key={`${spot.x},${spot.y}`}>
            <span>
              {i + 1}. Feld {spot.x},{spot.y}
            </span>
            {spots.length > 1 && (
              <button className="link" onClick={() => onRemove(i)}>
                entfernen
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ItemForm({ index, props }: { index: number; props: ThingProps }) {
  const { draft, validation, onChange, onPending } = props;
  const item = draft.map.items[index];
  if (item === undefined) {
    return null;
  }
  const at = `map.items.${index}`;
  const set = (next: typeof item): void =>
    onChange(withMap(draft, { items: replaceAt(draft.map.items, index, next) }));
  const cabinet = draft.map.manuals.find((m) => m.needsKey === item.id);
  const zone = item.deliverTo;
  return (
    <Shell title="Gegenstand" props={props}>
      <IdField
        label="Kennung"
        value={item.id}
        taken={draft.map.items.filter((i) => i !== item).map((i) => i.id)}
        onChange={(id) => onChange(rename(draft, 'item', item.id, id))}
        issues={messagesAt(validation, `${at}.id`)}
      />
      <TextField
        label="Aufschrift — „Sicherung“ und „Schlüssel“ geben die Form"
        value={item.label}
        onChange={(label) => set({ ...item, label })}
        issues={messagesAt(validation, `${at}.label`)}
      />
      {cabinet !== undefined ? (
        <p className="editor-note">Schlüssel für „{cabinet.label}“: Er braucht keinen Ablageort.</p>
      ) : (
        <>
          <div className="editor-field">
            Ablageort
            <span className="editor-value">
              {zone === undefined ? 'noch keiner' : `Feld ${zone.x},${zone.y}`}
            </span>
          </div>
          <button
            className="editor-pick"
            onClick={() => onPending({ kind: 'dropoff', item: index })}
          >
            Ablageort auf der Karte wählen
          </button>
          <SelectField
            label="Nötig für"
            value={item.requiredFor}
            choices={[NONE, ...puzzleChoices(draft)]}
            onChange={(requiredFor) => set({ ...item, requiredFor })}
          />
        </>
      )}
    </Shell>
  );
}

function DroneForm({ index, props }: { index: number; props: ThingProps }) {
  const { draft, validation, onChange } = props;
  const drone = draft.map.drones[index];
  if (drone === undefined) {
    return null;
  }
  const set = (next: typeof drone): void =>
    onChange(withMap(draft, { drones: replaceAt(draft.map.drones, index, next) }));
  return (
    <Shell title="Drohne" props={props}>
      <IdField
        label="Kennung"
        value={drone.id}
        taken={draft.map.drones.filter((d) => d !== drone).map((d) => d.id)}
        onChange={(id) => set({ ...drone, id })}
        issues={messagesAt(validation, `map.drones.${index}.id`)}
      />
      <SpotList
        title="Wegpunkte — sie fliegt sie im Kreis ab"
        spots={drone.waypoints}
        onRemove={(i) => set({ ...drone, waypoints: drone.waypoints.filter((_, j) => j !== i) })}
      />
      <p className="editor-note">
        Mit dem Drohnen-Werkzeug hängt jeder Klick einen Wegpunkt an; Esc beendet den Weg.
      </p>
    </Shell>
  );
}

function LabelForm({ index, props }: { index: number; props: ThingProps }) {
  const { draft, validation, onChange } = props;
  const label = draft.map.labels[index];
  if (label === undefined) {
    return null;
  }
  return (
    <Shell title="Raumname" props={props}>
      <TextField
        label="Name — Rätsel schalten hier das Licht an"
        value={label.text}
        onChange={(text) =>
          onChange(
            withMap(draft, { labels: replaceAt(draft.map.labels, index, { ...label, text }) }),
          )
        }
        issues={messagesAt(validation, `map.labels.${index}.text`)}
      />
    </Shell>
  );
}

/** Things with nothing to set but where they stand. */
const PLAIN: Readonly<Partial<Record<Ref['kind'], { title: string; note: string }>>> = {
  spawn: {
    title: 'Startplatz',
    note: 'Jeder Lauf lost die Startplätze aus; es braucht mindestens einen je Spieler.',
  },
  sign: {
    title: 'Laborkennung',
    note: 'Wer davor steht, kennt die Kennung für den Rest des Laufs.',
  },
  exit: {
    title: 'Notausgang',
    note: 'Öffnet, wenn alle Rätsel gelöst sind; gewonnen ist, wenn alle dort stehen.',
  },
  panel: {
    title: 'Notventil',
    note: 'Gehört zum Notfall der Mission; dessen übrige Einstellungen bleiben, wie sie kamen.',
  },
};

/** The things with fields of their own, by kind; a drop-off is edited with its item. */
const FORMS: Readonly<
  Partial<Record<Ref['kind'], ComponentType<{ index: number; props: ThingProps }>>>
> = {
  door: DoorForm,
  plate: PlateForm,
  station: StationForm,
  source: SourceForm,
  item: ItemForm,
  dropoff: ItemForm,
  drone: DroneForm,
  label: LabelForm,
};

export function ThingForm(props: ThingProps) {
  const { selection } = props;
  const Form = FORMS[selection.kind];
  if (Form !== undefined && 'index' in selection) {
    return <Form index={selection.index} props={props} />;
  }
  const plain = PLAIN[selection.kind];
  return plain === undefined ? null : (
    <Shell title={plain.title} props={props}>
      <p className="editor-note">{plain.note}</p>
    </Shell>
  );
}
