import { useState } from 'react';
import { moduleFor } from '@escapelab/core';
import {
  MODULE_NAMES,
  STATION_TYPES,
  type Draft,
  type DraftPuzzle,
  type StationType,
} from './draft.js';
import { ChecksField, IdField, SelectField, TextField, type Choice } from './fields.js';
import { addPuzzle, remove, rename, replaceAt, retype, shiftPuzzle } from './tools.js';
import { messagesAt, type Validation } from './validate.js';

interface Props {
  draft: Draft;
  validation: Validation;
  onChange: (draft: Draft) => void;
  /** the puzzle whose form is open, by index; null for none */
  open: number | null;
  onOpen: (index: number | null) => void;
}

/** A module in the type list: its word, and how its station is worked where that differs. */
function typeLabel(type: StationType): string {
  const { consoles, wholeCrew } = moduleFor(type);
  const how = consoles === 2 ? ' · zwei Pulte' : wholeCrew ? ' · ganze Crew' : '';
  return `${MODULE_NAMES[type].kind}${how}`;
}

const TYPE_CHOICES: readonly Choice[] = STATION_TYPES.map((type) => ({
  value: type,
  label: typeLabel(type),
}));

const asType = (value: string): StationType => STATION_TYPES.find((t) => t === value) ?? 'keypad';

const HINTS = [0, 1, 2] as const;

interface FormProps {
  draft: Draft;
  index: number;
  validation: Validation;
  onChange: (draft: Draft) => void;
  onRemove: () => void;
}

function PuzzleForm({ draft, index, validation, onChange, onRemove }: FormProps) {
  const puzzle = draft.puzzles[index];
  if (puzzle === undefined) {
    return null;
  }
  const at = (field: string): string[] => messagesAt(validation, `puzzles.${index}.${field}`);
  const set = (next: DraftPuzzle): void =>
    onChange({ ...draft, puzzles: replaceAt(draft.puzzles, index, next) });
  const rooms = [...new Set(draft.map.labels.map((l) => l.text))];
  // A room a puzzle lights that no label names stays in the list, so it can be unticked.
  const lights = [...rooms, ...puzzle.lights.filter((room) => !rooms.includes(room))];
  const own = Object.keys(puzzle.extra).filter((key) => key !== 'penaltySec');
  return (
    <div className="editor-puzzle-form">
      <SelectField
        label="Art"
        value={puzzle.type}
        choices={TYPE_CHOICES}
        onChange={(type) => onChange(retype(draft, index, asType(type)))}
      />
      <IdField
        label="Kennung"
        value={puzzle.id}
        taken={draft.puzzles.filter((p) => p !== puzzle).map((p) => p.id)}
        onChange={(id) => onChange(rename(draft, 'puzzle', puzzle.id, id))}
        issues={at('id')}
      />
      <TextField
        label="Titel"
        value={puzzle.title}
        onChange={(title) => set({ ...puzzle, title })}
        issues={at('title')}
      />
      {HINTS.map((n) => (
        <TextField
          key={n}
          label={`Notiz ${n + 1} der letzten Crew`}
          value={puzzle.hints[n] ?? ''}
          placeholder={n === 0 ? 'ein Schubs' : n === 1 ? 'genauer' : 'fast die Lösung'}
          onChange={(hint) => {
            const hints = HINTS.map((i) => (i === n ? hint : (puzzle.hints[i] ?? '')));
            // Empty notes at the end are no notes.
            while (hints.at(-1) === '') {
              hints.pop();
            }
            set({ ...puzzle, hints });
          }}
          issues={at(`hints.${n}`)}
        />
      ))}
      <ChecksField
        label="Gelöst, geht hier das Licht an"
        value={puzzle.lights}
        choices={lights.map((room) => ({ value: room, label: room }))}
        empty="Noch kein Raumname auf der Karte."
        onChange={(next) => set({ ...puzzle, lights: [...next] })}
        issues={at('lights')}
      />
      <TextField
        label="Funkspruch, wenn gelöst"
        value={puzzle.onSolved}
        onChange={(onSolved) => set({ ...puzzle, onSolved })}
      />
      {own.length > 0 && (
        <p className="editor-note">
          Eigene Felder des Moduls bleiben, wie sie sind: {own.join(', ')}.
        </p>
      )}
      <button className="link editor-remove" title="Mit seinen Stationen" onClick={onRemove}>
        Rätsel entfernen
      </button>
    </div>
  );
}

/**
 * The mission's puzzles in the order the crew meets them: each opens to
 * its form — the module and the fields every puzzle has; a module's own
 * fields keep their defaults (part 2 of the editor sets them).
 */
export function PuzzleList({ draft, validation, onChange, open, onOpen }: Props) {
  const [adding, setAdding] = useState<StationType>('keypad');
  const errorsOf = (index: number): number =>
    validation.findings.filter(
      (f) => f.severity === 'error' && f.path.startsWith(`puzzles.${index}`),
    ).length;
  return (
    <div className="editor-puzzles">
      <ol className="editor-puzzle-list">
        {draft.puzzles.map((puzzle, index) => (
          // By place, not id: a rename while typing must not remount the form under the cursor.
          <li key={index} className={open === index ? 'editor-puzzle-open' : ''}>
            <div className="editor-puzzle-head">
              <button
                className="editor-puzzle-title"
                aria-expanded={open === index}
                onClick={() => onOpen(open === index ? null : index)}
              >
                <span className="editor-puzzle-no">{index + 1}</span>
                <span className="editor-puzzle-name">
                  {puzzle.title || puzzle.id || 'ohne Titel'}
                </span>
                <span className="editor-puzzle-kind">{MODULE_NAMES[puzzle.type].kind}</span>
                {errorsOf(index) > 0 && (
                  <span className="editor-puzzle-errors">{errorsOf(index)}</span>
                )}
              </button>
              <button
                className="editor-icon-button"
                aria-label="Früher"
                title="Früher in der Reihenfolge"
                disabled={index === 0}
                onClick={() => onChange(shiftPuzzle(draft, index, -1))}
              >
                ▲
              </button>
              <button
                className="editor-icon-button"
                aria-label="Später"
                title="Später in der Reihenfolge"
                disabled={index === draft.puzzles.length - 1}
                onClick={() => onChange(shiftPuzzle(draft, index, 1))}
              >
                ▼
              </button>
            </div>
            {open === index && (
              <PuzzleForm
                draft={draft}
                index={index}
                validation={validation}
                onChange={onChange}
                onRemove={() => {
                  onChange(remove(draft, { kind: 'puzzle', index }));
                  onOpen(null);
                }}
              />
            )}
          </li>
        ))}
      </ol>
      <div className="editor-add">
        <SelectField
          label="Neues Rätsel"
          value={adding}
          choices={TYPE_CHOICES}
          onChange={(t) => setAdding(asType(t))}
        />
        <button
          onClick={() => {
            onChange(addPuzzle(draft, adding));
            onOpen(draft.puzzles.length);
          }}
        >
          Hinzufügen
        </button>
      </div>
    </div>
  );
}
