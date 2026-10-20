import { useState, type ReactNode } from 'react';

/**
 * The side forms' plain inputs. Each field shows under it what the
 * validator says about that field (`issues`), and what it cannot take
 * itself — a number field with no number, an id another thing has.
 */

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

interface FieldProps<T> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  issues?: readonly string[];
}

export function TextField({
  label,
  value,
  onChange,
  issues = [],
  placeholder,
}: FieldProps<string> & { placeholder?: string }) {
  return (
    <label className="editor-field">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        aria-invalid={issues.length > 0}
        onChange={(e) => onChange(e.target.value)}
      />
      <Issues issues={issues} />
    </label>
  );
}

export function AreaField({ label, value, onChange, issues = [] }: FieldProps<string>) {
  return (
    <label className="editor-field">
      {label}
      <textarea value={value} rows={3} onChange={(e) => onChange(e.target.value)} />
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
  note,
}: FieldProps<number> & { note?: string }) {
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
        type="number"
        inputMode="numeric"
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
      {note !== undefined && <span className="editor-note">{note}</span>}
      <Issues issues={valid ? issues : ['Eine ganze Zahl eingeben.', ...issues]} />
    </label>
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
}: FieldProps<string> & { choices: readonly Choice[] }) {
  return (
    <label className="editor-field">
      {label}
      <select
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
