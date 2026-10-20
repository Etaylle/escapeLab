import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FieldSpec } from '@escapelab/core';
import {
  fieldSpecs,
  newDraft,
  newPuzzle,
  STATION_TYPES,
  type Draft,
  type StationType,
} from '../src/editor/draft.js';
import { focusField } from '../src/editor/fields.js';
import { ModuleForm } from '../src/editor/ModuleForm.js';
import { PuzzleList, RETYPE_NOTE } from '../src/editor/PuzzleList.js';
import { validateDraft, type Validation } from '../src/editor/validate.js';
import { ValidatorPanel } from '../src/editor/ValidatorPanel.js';
import { PICTOGRAPH } from './fixtures.js';

const noop = (): void => undefined;

const CLEAN: Validation = { findings: [], errors: 0, ms: 0 };

/** A new draft whose one puzzle is of `type`, with some of its own fields set. */
function draftWith(type: StationType, fields: Record<string, unknown> = {}): Draft {
  const puzzle = newPuzzle(type, []);
  return { ...newDraft(), puzzles: [{ ...puzzle, fields: { ...puzzle.fields, ...fields } }] };
}

type Input = ReactElement<{ label: string; value: unknown; onChange: (value: unknown) => void }>;

/**
 * The inputs a form's tree holds, in order, without rendering them: the
 * fields keep state of their own, so only the fragments around them are
 * opened.
 */
function inputsOf(node: ReactNode): Input[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: ReactNode) => inputsOf(child));
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    return [];
  }
  return node.type === Fragment ? inputsOf(node.props.children) : [node as Input];
}

/** A value other than the field's default, of the field's kind. */
function another(spec: FieldSpec): unknown {
  switch (spec.kind) {
    case 'int':
      return spec.off !== undefined ? null : spec.default === spec.max ? spec.min : spec.max;
    case 'bool':
      return !spec.default;
    case 'choice':
      return spec.options.find((option) => option.value !== spec.default)?.value;
    case 'range':
      return { min: spec.max, max: spec.max };
  }
}

function form(draft: Draft, validation: Validation = CLEAN, onChange = noop): string {
  return renderToStaticMarkup(
    <ModuleForm draft={draft} index={0} validation={validation} onChange={onChange} />,
  );
}

describe.each(STATION_TYPES)('the %s puzzle’s own fields', (type) => {
  const specs = fieldSpecs(type);

  it('stand in the form with their labels and help lines, each input focusable by its path', () => {
    const html = form(draftWith(type));
    for (const spec of specs) {
      expect(html).toContain(spec.label);
      expect(html).toContain(spec.help);
      expect(html).toContain(`id="editor-puzzles-0-${spec.key}"`);
    }
    expect(html).not.toMatch(PICTOGRAPH);
  });

  it('go into the draft as they change, each into its own key', () => {
    const draft = draftWith(type);
    let changed: Draft | null = null;
    const tree = ModuleForm({
      draft,
      index: 0,
      validation: CLEAN,
      onChange: (next) => {
        changed = next;
      },
    });
    const inputs = inputsOf(tree);
    expect(inputs.map((input) => input.props.label)).toEqual(specs.map((spec) => spec.label));
    specs.forEach((spec, i) => {
      const value = another(spec);
      inputs[i]?.props.onChange(value);
      const fields = (changed as Draft | null)?.puzzles[0]?.fields;
      expect(fields, spec.key).toEqual({ ...draft.puzzles[0]?.fields, [spec.key]: value });
    });
  });
});

describe('what the validator says of a field', () => {
  it('stands under that field, and the panel lists it too', () => {
    const draft = draftWith('maze', { size: 12 });
    const validation = validateDraft(draft);
    const said = validation.findings.find((f) => f.path === 'puzzles.0.size');
    expect(said).toBeDefined();
    const issue = renderToStaticMarkup(<span className="editor-issue">{said?.message}</span>);
    const html = form(draft, validation);
    expect(html).toContain(issue);
    // Under the size's input and its help line, before the field closes.
    expect(html.indexOf(issue)).toBeGreaterThan(html.indexOf('id="editor-puzzles-0-size"'));
    const panel = renderToStaticMarkup(
      <ValidatorPanel validation={validation} active={null} onPick={noop} />,
    );
    expect(panel).toContain(`puzzles.0.size: ${said?.message.replaceAll('<', '&lt;')}`);
  });

  it('about a range or a refinement stands under the field it names', () => {
    const wires = validateDraft(draftWith('circuit', { wires: { min: 6, max: 4 } }));
    expect(form(draftWith('circuit', { wires: { min: 6, max: 4 } }), wires)).toContain(
      'wires.min (6) is above wires.max (4)',
    );
    const late = draftWith('signal', { stages: 2, fleetingFrom: 5 });
    expect(form(late, validateDraft(late))).toContain('fleetingFrom (5) is past the last stage');
  });
});

describe('the puzzle form', () => {
  const html = renderToStaticMarkup(
    <PuzzleList
      draft={draftWith('maze')}
      validation={CLEAN}
      onChange={noop}
      open={0}
      onOpen={noop}
    />,
  );

  it('says under the type that another resets the settings', () => {
    expect(html).toContain(`<span class="editor-note">${RETYPE_NOTE}</span>`);
  });

  it('offers the penalty empty, with the module’s own as the placeholder', () => {
    const penalty = /<input id="editor-puzzles-0-penaltySec"[^>]* placeholder="15"[^>]* value=""/;
    expect(html).toMatch(penalty);
    expect(html).toContain('Fehlgriff in Sekunden');
  });
});

describe('a finding picked in the panel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('focuses the input of the field it names, or of the field it is part of', () => {
    const focus = vi.fn();
    const ids: string[] = [];
    vi.stubGlobal('document', {
      getElementById: (id: string) => {
        ids.push(id);
        return id === 'editor-puzzles-0-wires' ? { focus } : null;
      },
    });
    focusField('puzzles.0.wires.min');
    expect(ids).toEqual(['editor-puzzles-0-wires-min', 'editor-puzzles-0-wires']);
    expect(focus).toHaveBeenCalledTimes(1);
    focusField('puzzles.0');
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
