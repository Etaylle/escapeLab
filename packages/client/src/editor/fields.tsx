import { useState, type ReactNode } from 'react';

/**
 * The side forms' plain inputs. Each field shows under it what the
 * validator says about that field (`issues`), and what it cannot take
 * itself — a number field with no number, an id another thing has. A field
 * given an `id` (`inputId` of its path in the mission file) can be focused
 * from the validator's list.
 */

/** The id of a field's input, by the field's dotted path in the mission file. */
export function inputId(path: string): string {
  return `editor-${path.replaceAll('.', '-')}`;
}

/**
 * Focuses the input of the field a path names, or of the field it is a
 * part of: `puzzles.0.wires.min` finds the wires' first input. A path that
 * names no field of a puzzle focuses nothing.
 */
export function focusField(path: string): void {
  const segments = path.split('.');
  for (let n = segments.length; n > 2; n -= 1) {
    const input = document.getElementById(inputId(segments.slice(0, n).join('.')));
    if (input !== null) {
      input.focus();
      return;
    }
  }
}

function Issues({ issues }: { issues: readonly string[] }) {
  return (
    <>
      {issues.map((issue) => (
        <span key={issue} className="editor-issue">
          {issue}
        </span>
      ))}
    </>
  );
}

/** A line under a field that says what it does; none where it is left out. */
function Note({ note }: { note: string | undefined }) {
  return note === undefined ? null : <span className="editor-note">{note}</span>;
}

interface FieldProps<T> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  issues?: readonly string[];
  /** the input's id, for focusing it (`inputId`) */
  id?: string | undefined;
  /** a line under the field that says what it does */
  note?: string | undefined;
}

/** The bounds a number field offers; what is typed beyond them is left to the validator. */
interface Bounds {
  min?: number | undefined;
  max?: number | undefined;
}

export function TextField({
  label,
  value,
  onChange,
  issues = [],
  id,
  note,
  placeholder,
}: FieldProps<string> & { placeholder?: string }) {
  return (
    <label className="editor-field">
      {label}
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-invalid={issues.length > 0}
        onChange={(e) => onChange(e.target.value)}
      />
      <Note note={note} />
      <Issues issues={issues} />
    </label>
  );
}

export function AreaField({ label, value, onChange, issues = [], id, note }: FieldProps<string>) {
  return (
    <label className="editor-field">
      {label}
      <textarea id={id} value={value} rows={3} onChange={(e) => onChange(e.target.value)} />
      <Note note={note} />
      <Issues issues={issues} />
    </label>
  );
}

/**
 * A whole number. What is typed stays in the field while it is no number,
 * with a word under it; the draft only ever gets numbers.
 */
export function NumberField({
  label,
  value,
  onChange,
  issues = [],
  id,
  note,
  min,
  max,
}: FieldProps<number> & Bounds) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    // The draft moved on from elsewhere — an undo of sorts, a load: show it.
    setShown(value);
    setText(String(value));
  }
  const number = Number(text);
  const valid = text.trim() !== '' && Number.isInteger(number);
  return (
    <label className="editor-field editor-field-number">
      {label}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        aria-invalid={!valid || issues.length > 0}
        onChange={(e) => {
          setText(e.target.value);
          const next = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isInteger(next)) {
            setShown(next);
            onChange(next);
          }
        }}
      />
      <Note note={note} />
      <Issues issues={valid ? issues : ['Eine ganze Zahl eingeben.', ...issues]} />
    </label>
  );
}

/**
 * A whole number that may be left empty, which hands on null: a field
 * that can be off, a penalty left at the module's own. What is typed stays
 * while it is no number, with a word under it.
 */
export function OptionalNumberField({
  label,
  value,
  onChange,
  issues = [],
  id,
  note,
  min,
  max,
  placeholder,
}: FieldProps<number | null> & Bounds & { placeholder?: string | undefined }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value === null ? '' : String(value));
  }
  const typed = text.trim();
  const valid = typed === '' || Number.isInteger(Number(typed));
  return (
    <label className="editor-field editor-field-number">
      {label}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        placeholder={placeholder}
        aria-invalid={!valid || issues.length > 0}
        onChange={(e) => {
          setText(e.target.value);
          const raw = e.target.value.trim();
          const next = raw === '' ? null : Number(raw);
          if (next === null || Number.isInteger(next)) {
            setShown(next);
            onChange(next);
          }
        }}
      />
      <Note note={note} />
      <Issues issues={valid ? issues : ['Eine ganze Zahl eingeben oder leer lassen.', ...issues]} />
    </label>
  );
}

/** A lower and an upper whole number, both from min to max: how many wires a run may draw. */
export function RangeField({
  label,
  value,
  onChange,
  issues = [],
  id,
  note,
  min,
  max,
}: FieldProps<{ min: number; max: number }> & Bounds) {
  return (
    <fieldset className="editor-field editor-checks editor-range">
      <legend>{label}</legend>
      <div className="editor-row">
        <NumberField
          label="von"
          value={value.min}
          id={id}
          min={min}
          max={max}
          onChange={(low) => onChange({ ...value, min: low })}
        />
        <NumberField
          label="bis"
          value={value.max}
          id={id === undefined ? undefined : `${id}-max`}
          min={min}
          max={max}
          onChange={(high) => onChange({ ...value, max: high })}
        />
      </div>
      <Note note={note} />
      <Issues issues={issues} />
    </fieldset>
  );
}

/** One thing that is so or not, ticked. */
export function CheckField({ label, value, onChange, issues = [], id, note }: FieldProps<boolean>) {
  return (
    <div className="editor-field editor-check-field">
      <label className="editor-check-row">
        <input
          id={id}
          type="checkbox"
          checked={value}
          aria-invalid={issues.length > 0}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      <Note note={note} />
      <Issues issues={issues} />
    </div>
  );
}

/**
 * An id other things may name. It is handed on only when it is no other
 * thing's and not empty, so a rename never merges two things or empties a
 * reference; till then the field says why.
 */
export function IdField({
  label,
  value,
  onChange,
  taken,
  issues = [],
  id,
}: FieldProps<string> & { taken: readonly string[] }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const trimmed = text.trim();
  const taking = taken.includes(trimmed) ? 'Diese Kennung ist schon vergeben.' : null;
  const problem = trimmed === '' ? 'Eine Kennung braucht es.' : taking;
  return (
    <label className="editor-field">
      {label}
      <input
        id={id}
        value={text}
        spellCheck={false}
        aria-invalid={problem !== null || issues.length > 0}
        onChange={(e) => {
          setText(e.target.value);
          const next = e.target.value.trim();
          if (next !== '' && !taken.includes(next)) {
            setShown(next);
            onChange(next);
          }
        }}
      />
      <Issues issues={problem === null ? issues : [problem, ...issues]} />
    </label>
  );
}

export interface Choice {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  onChange,
  choices,
  issues = [],
  id,
  note,
}: FieldProps<string> & { choices: readonly Choice[] }) {
  return (
    <label className="editor-field">
      {label}
      <select
        id={id}
        value={value}
        aria-invalid={issues.length > 0}
        onChange={(e) => onChange(e.target.value)}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <Note note={note} />
      <Issues issues={issues} />
    </label>
  );
}

/** Several of a set, ticked: the puzzles a source covers, the rooms a puzzle lights. */
export function ChecksField({
  label,
  value,
  onChange,
  choices,
  empty,
  issues = [],
}: FieldProps<readonly string[]> & { choices: readonly Choice[]; empty: string }) {
  const toggle = (id: string): void =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <fieldset className="editor-field editor-checks">
      <legend>{label}</legend>
      {choices.length === 0 && <span className="editor-note">{empty}</span>}
      {choices.map((choice) => (
        <label key={choice.value} className="editor-check-row">
          <input
            type="checkbox"
            checked={value.includes(choice.value)}
            onChange={() => toggle(choice.value)}
          />
          {choice.label}
        </label>
      ))}
      <Issues issues={issues} />
    </fieldset>
  );
}

/** A heading for a group of fields, with room for a button beside it. */
export function FormHead({
  title,
  where,
  children,
}: {
  title: string;
  where?: string;
  children?: ReactNode;
}) {
  return (
    <header className="editor-form-head">
      <h3>{title}</h3>
      {where !== undefined && <span className="editor-where">{where}</span>}
      {children}
    </header>
  );
}
