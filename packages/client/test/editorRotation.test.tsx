import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkMission, parseMission } from '@escapelab/core';
import { draftFromJson, draftToJson, newDraft, type Draft } from '../src/editor/draft.js';
import { POOL_NOTE, PuzzleList } from '../src/editor/PuzzleList.js';
import { placeChoices } from '../src/editor/ThingForm.js';
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
