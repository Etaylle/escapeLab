import { Fragment, type ReactNode } from 'react';
import type { FieldSpec } from '@escapelab/core';
import { fieldSpecs, type Draft } from './draft.js';
import {
  AreaField,
  CheckField,
  inputId,
  NumberField,
  OptionalNumberField,
  RangeField,
  SelectField,
} from './fields.js';
import { replaceAt } from './tools.js';
import { messagesUnder, type Validation } from './validate.js';

interface Props {
  draft: Draft;
  /** the puzzle's place in the mission's list */
  index: number;
  validation: Validation;
  onChange: (draft: Draft) => void;
}

/** What the input of one field gets: the value the draft holds, and where a new one goes. */
export interface SpecInput {
  value: unknown;
  set: (value: unknown) => void;
  /** the field's dotted path in the mission file */
  path: string;
  /** what the validator says of the field and its parts */
  issues: string[];
}

/** A number as the draft holds it; null where it holds none, as an empty field that can be off. */
const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const asText = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

/** A list of words as the textarea shows it: one a line. */
const asLines = (value: unknown): string => (Array.isArray(value) ? value.join('\n') : '');

/** A `{ min, max }` pair as the draft holds it, or the fallback where it holds none. */
function asRange(
  value: unknown,
  fallback: { readonly min: number; readonly max: number },
): { min: number; max: number } {
  if (typeof value === 'object' && value !== null && 'min' in value && 'max' in value) {
    const { min, max } = value;
    if (typeof min === 'number' && typeof max === 'number') {
      return { min, max };
    }
  }
  return { min: fallback.min, max: fallback.max };
}

type IntSpec = Extract<FieldSpec, { kind: 'int' }>;

/** A whole number; where the field can be off, one that may be left empty. */
function intInput(spec: IntSpec, { value, set, path, issues }: SpecInput): ReactNode {
  const common = { label: spec.label, note: spec.help, id: inputId(path), issues };
  const bounds = { min: spec.min, max: spec.max };
  return spec.off === undefined ? (
    <NumberField {...common} {...bounds} value={asNumber(value) ?? spec.default} onChange={set} />
  ) : (
    <OptionalNumberField {...common} {...bounds} value={asNumber(value)} onChange={set} />
  );
}

/** The input of a field's kind, with the field's label, its help line and its issues. */
export function inputFor(spec: FieldSpec, input: SpecInput): ReactNode {
  const { value, set, path, issues } = input;
  const common = { label: spec.label, note: spec.help, id: inputId(path), issues };
  switch (spec.kind) {
    case 'int':
      return intInput(spec, input);
    case 'bool':
      return <CheckField {...common} value={value === true} onChange={set} />;
    case 'choice':
      return (
        <SelectField
          {...common}
          value={asText(value, spec.default)}
          choices={spec.options}
          onChange={set}
        />
      );
    case 'words':
      return (
        <AreaField {...common} value={asLines(value)} onChange={(text) => set(text.split('\n'))} />
      );
    case 'range':
      return (
        <RangeField
          {...common}
          min={spec.min}
          max={spec.max}
          value={asRange(value, spec.default)}
          onChange={set}
        />
      );
  }
}

/**
 * A puzzle's own fields, built from what its module lists (`fields`): each
 * as the input of its kind, with its help line and, under it, what the
 * validator says of that field. A change goes into the puzzle's `fields`.
 */
export function ModuleForm({ draft, index, validation, onChange }: Props) {
  const puzzle = draft.puzzles[index];
  if (puzzle === undefined) {
    return null;
  }
  const setField = (key: string, value: unknown): void => {
    const fields = { ...puzzle.fields, [key]: value };
    onChange({ ...draft, puzzles: replaceAt(draft.puzzles, index, { ...puzzle, fields }) });
  };
  return (
    <>
      {fieldSpecs(puzzle.type).map((spec) => {
        const path = `puzzles.${index}.${spec.key}`;
        const input: SpecInput = {
          value: puzzle.fields[spec.key],
          set: (value) => setField(spec.key, value),
          path,
          issues: messagesUnder(validation, path),
        };
        return <Fragment key={spec.key}>{inputFor(spec, input)}</Fragment>;
      })}
    </>
  );
}
