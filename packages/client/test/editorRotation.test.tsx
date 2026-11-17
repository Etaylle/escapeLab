import { readFileSync } from 'node:fs';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkMission, parseMission } from '@escapelab/core';
import { draftFromJson, draftToJson, newDraft, type Draft } from '../src/editor/draft.js';
import { POOL_NOTE, PuzzleForm, PuzzleList } from '../src/editor/PuzzleList.js';
import { placeChoices, ThingForm } from '../src/editor/ThingForm.js';
import type { Ref } from '../src/editor/tools.js';
import { Handbook, turnsNote } from '../src/screens/Handbook.js';
import { validateDraft, type Validation } from '../src/editor/validate.js';

const noop = (): void => undefined;

/** The Wechselprobe's file, as the walkthrough imports it. */
const PROBE: unknown = JSON.parse(
  readFileSync(new URL('../../../tools/fixtures/rotation-probe.json', import.meta.url), 'utf8'),
);

function probeDraft(): Draft {
  const loaded = draftFromJson(PROBE);
  if (!loaded.ok) {
    throw new Error(loaded.problems.join('; '));
  }
  return loaded.draft;
}

/** The form of the draft's puzzle `index`, with what `validation` says. */
function form(draft: Draft, index: number, validation: Validation): string {
  return renderToStaticMarkup(
    <PuzzleList
      draft={draft}
      validation={validation}
      onChange={noop}
      open={index}
      onOpen={noop}
    />,
  );
}

describe('the editor: a puzzle’s Wechselplatz', () => {
  it('reads each puzzle’s pool from a file and writes it back, none where it has none', () => {
    const draft = probeDraft();
    expect(draft.puzzles.map((p) => p.pool)).toEqual([
      '',
      'wechselplatz',
      'wechselplatz',
      'wechselplatz',
      '',
    ]);
    const json = draftToJson(draft);
    expect(checkMission(json)).toMatchObject({ ok: true });
    expect(parseMission(json)).toEqual(parseMission(PROBE));
    const [first] = json['puzzles'] as Record<string, unknown>[];
    expect(first).not.toHaveProperty('pool');
    expect(newDraft().puzzles[0]?.pool).toBe('');
  });

  it('stands in the puzzle’s form as a text field, with what it does under it', () => {
    const html = form(probeDraft(), 1, validateDraft(probeDraft()));
    expect(html).toContain('Wechselplatz');
    expect(html).toContain(POOL_NOTE);
    expect(html).toMatch(/<input id="editor-puzzles-1-pool"[^>]*value="wechselplatz"/);
  });

  it('shows what the validator says of a pool under the field it names', () => {
    const draft = probeDraft();
    const alone: Draft = {
      ...draft,
      puzzles: draft.puzzles.map((p, i) => (i === 1 ? { ...p, pool: 'allein' } : p)),
      map: {
        ...draft.map,
        doors: draft.map.doors.map((door) => ({
          ...door,
          opensBy: { kind: 'puzzle', puzzleId: 'allein' },
        })),
      },
    };
    const validation = validateDraft(alone);
    const said = validation.findings.find((f) => f.path === 'puzzles.1.pool');
    expect(said?.message).toMatch(/pool "allein" has "funkfeuer" alone/);
    const html = form(alone, 1, validation);
    const issue = renderToStaticMarkup(<span className="editor-issue">{said?.message}</span>);
    expect(html.indexOf(issue)).toBeGreaterThan(html.indexOf('id="editor-puzzles-1-pool"'));
  });

  it('offers a door and a part the Wechselplatz beside the puzzles, each once', () => {
    const choices = placeChoices(probeDraft());
    expect(choices.map((c) => c.value)).toEqual([
      'tastenfeld',
      'funkfeuer',
      'signalkette',
      'notstrom',
      'leitungsnetz',
      'wechselplatz',
    ]);
    expect(choices.at(-1)?.label).toBe('Wechselplatz wechselplatz');
    expect(placeChoices(newDraft()).map((c) => c.value)).toEqual(
      newDraft().puzzles.map((p) => p.id),
    );
  });
});

type Field = ReactElement<{ label?: string; onChange?: (value: string) => void }>;

/** Every element of a form's tree that carries a label, the tree walked without rendering. */
function fieldsOf(node: ReactNode): Field[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: ReactNode) => fieldsOf(child));
  }
  if (!isValidElement<{ children?: ReactNode; label?: string }>(node)) {
    return [];
  }
  const own = node.props.label === undefined ? [] : [node as Field];
  return [...own, ...fieldsOf(node.props.children)];
}

/** The options of the select labelled `label` in a form's markup, by value. */
function optionsOf(html: string, label: string): string[] {
  const from = html.indexOf(`>${label}<`);
  const select = html.slice(from, html.indexOf('</select>', from));
  return from < 0 ? [] : [...select.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1] ?? '');
}

/** The side form of the draft's thing `selection`, as markup. */
function thingForm(draft: Draft, selection: Ref): string {
  return renderToStaticMarkup(
    <ThingForm
      draft={draft}
      selection={selection}
      validation={validateDraft(draft)}
      onChange={noop}
      onRemove={noop}
      onPending={noop}
    />,
  );
}

describe('the editor: the Wechselplatz wired into its forms', () => {
  it('writes what is typed into the field into that puzzle’s pool, and no other', () => {
    const draft = probeDraft();
    let changed: Draft | null = null;
    const tree = PuzzleForm({
      draft,
      index: 0,
      validation: validateDraft(draft),
      onChange: (next) => {
        changed = next;
      },
      onRemove: noop,
    });
    const field = fieldsOf(tree).find((f) => f.props.label === 'Wechselplatz');
    field?.props.onChange?.('wechselplatz');
    expect((changed as Draft | null)?.puzzles.map((p) => p.pool)).toEqual([
      'wechselplatz',
      'wechselplatz',
      'wechselplatz',
      'wechselplatz',
      '',
    ]);
  });

  it('offers the Wechselplatz where a door names what opens it', () => {
    const html = thingForm(probeDraft(), { kind: 'door', index: 0 });
    expect(html).toContain('<option value="wechselplatz" selected="">Wechselplatz wechselplatz');
  });

  it('offers it where a plate door names what keeps it open, and where a part is needed', () => {
    const draft = probeDraft();
    const held: Draft = {
      ...draft,
      map: {
        ...draft.map,
        plates: [{ id: 'platte', x: 14, y: 3, label: 'HALTEN' }],
        doors: draft.map.doors.map((door) => ({
          ...door,
          opensBy: { kind: 'plate', plateId: 'platte', untilSolved: '' },
        })),
        items: [{ id: 'kiste', label: 'KISTE', x: 4, y: 3, requiredFor: '' }],
      },
    };
    const door = thingForm(held, { kind: 'door', index: 0 });
    expect(door.match(/<option value="wechselplatz"/g)).toHaveLength(1);
    const item = thingForm(held, { kind: 'item', index: 0 });
    expect(optionsOf(item, 'Nötig für')).toContain('wechselplatz');
  });
});

describe('the Handbuch: a station at a Wechselplatz', () => {
  it('says on its page which machines it takes turns with, and on no other page', () => {
    const page = (title: string, takesTurnsWith?: string[]) => ({
      index: 0,
      title,
      readAt: ['FUNKBUCH'],
      usesEdgework: false,
      manual: [],
      ...(takesTurnsWith === undefined ? {} : { takesTurnsWith }),
    });
    const stations = [
      page('Zeichentastenfeld'),
      { ...page('Funkfeuer', ['Signalkette', 'Notstromkasten']), index: 1 },
    ];
    const html = renderToStaticMarkup(
      <Handbook manual={{ missionTitle: 'Wechselprobe', hintCostSec: 20, stations }} />,
    );
    const note = turnsNote(['Signalkette', 'Notstromkasten']);
    expect(note).toBe(
      'Wechselplatz mit Signalkette, Notstromkasten: Je Schicht ist eine dieser Anlagen in ' +
        'Betrieb, die anderen tragen das Schild AUSSER BETRIEB.',
    );
    expect(html.split(note)).toHaveLength(2);
    expect(html.indexOf(note)).toBeGreaterThan(html.indexOf('§2 — Funkfeuer'));
  });
});
