import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionOfKey,
  bindVerdict,
  DEFAULT_KEYS,
  DEFAULT_PAD,
  keyName,
  keysOf,
  readKeys,
  readPad,
  rebindPad,
} from '../src/input/bindings.js';
import { ControlSettings, keyPressed } from '../src/screens/ControlSettings.js';
import { SettingsPanel } from '../src/screens/Settings.js';
import { changeSettings, DEFAULT_SETTINGS, getSettings } from '../src/settings.js';
import { buttonsOf, elementsOf, press } from './probe.js';

afterEach(() => {
  changeSettings(DEFAULT_SETTINGS);
});

/** A plain key going down, as the settings panel hears it. */
const plain = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('the binding map', () => {
  it('binds every action to a key of its own, W A S D, Shift, E, Q, N, M, C, I and V', () => {
    expect(ACTIONS.map((action) => keyName(DEFAULT_KEYS[action])).join(' ')).toBe(
      'W S A D Shift E Q N M C I V',
    );
    expect(new Set(Object.values(DEFAULT_KEYS)).size).toBe(ACTIONS.length);
  });

  it('reads a key as its action, the arrows, Enter and Space as theirs whatever is bound', () => {
    expect(actionOfKey(DEFAULT_KEYS, 'E')).toBe('interact');
    expect(actionOfKey(DEFAULT_KEYS, 'Shift')).toBe('sprint');
    expect(actionOfKey(DEFAULT_KEYS, 'ArrowLeft')).toBe('left');
    expect(actionOfKey(DEFAULT_KEYS, ' ')).toBe('interact');
    expect(actionOfKey(DEFAULT_KEYS, 'x')).toBeNull();
    const rebound = { ...DEFAULT_KEYS, interact: 'f' };
    expect(actionOfKey(rebound, 'e')).toBeNull();
    expect(actionOfKey(rebound, 'f')).toBe('interact');
    expect(keysOf(rebound, 'interact')).toEqual(['f', 'enter', ' ']);
  });

  it('refuses a key another action holds, naming it, and one the game keeps, saying why', () => {
    const verdict = (key: string) => bindVerdict(DEFAULT_KEYS, 'talk', key);
    expect(verdict('m')).toEqual({ ok: false, reason: 'taken', by: 'minimap' });
    expect(verdict('Escape')).toEqual({
      ok: false,
      reason: 'fixed',
      what: 'Zurücktreten',
    });
    expect(verdict('3')).toMatchObject({ reason: 'fixed', what: 'Schnellchat' });
    for (const unfit of ['Control', 'Alt', 'Meta', 'PageUp', 'F13', 'Dead']) {
      expect(verdict(unfit), unfit).toEqual({ ok: false, reason: 'unfit' });
    }
    // Its own key, a free letter, a digit past the chat's, an umlaut, F1–F12: fine.
    for (const fine of ['g', 'Ö', '9', 'F2', 'v']) {
      expect(verdict(fine), fine).toEqual({ ok: true });
    }
  });

  it('keeps stored bindings only where they fit and stay apart, the defaults otherwise', () => {
    expect(readKeys({ talk: 'G', interact: 'f' })).toMatchObject({ talk: 'g', interact: 'f' });
    expect(readKeys({ talk: 'w' })).toEqual(DEFAULT_KEYS);
    expect(readKeys({ info: 'escape', notes: 42 })).toEqual(DEFAULT_KEYS);
    expect(readKeys('kaputt')).toEqual(DEFAULT_KEYS);
    expect(readPad({ notes: 'r2' })).toEqual({ ...DEFAULT_PAD, notes: 'r2' });
    expect(readPad({ notes: 'a' })).toEqual(DEFAULT_PAD);
    expect(readPad({ minimap: 'start' })).toEqual(DEFAULT_PAD);
  });

  it('swaps two of the controller’s main actions rather than put both on one button', () => {
    const { pad, swapped } = rebindPad(DEFAULT_PAD, 'notes', 'a');
    expect(pad).toEqual({ interact: 'x', drop: 'b', notes: 'a', minimap: 'y' });
    expect(swapped).toBe('interact');
    expect(rebindPad(DEFAULT_PAD, 'minimap', 'r2')).toEqual({
      pad: { ...DEFAULT_PAD, minimap: 'r2' },
      swapped: null,
    });
  });
});

describe('rebinding in the settings', () => {
  it('binds the key pressed, and refuses a conflict by naming the action that holds it', () => {
    expect(keyPressed(DEFAULT_KEYS, 'talk', plain('G'))).toEqual({
      keys: { ...DEFAULT_KEYS, talk: 'g' },
    });
    expect(keyPressed(DEFAULT_KEYS, 'talk', plain('n'))).toEqual({
      refused: 'Schon belegt: Notizblock (N).',
    });
    expect(keyPressed(DEFAULT_KEYS, 'interact', plain('ArrowUp'))).toEqual({
      refused: 'Diese Taste behält ihre Aufgabe: Laufen.',
    });
    expect(keyPressed(DEFAULT_KEYS, 'talk', plain('g', { ctrlKey: true }))).toEqual({
      refused: 'Nur eine Taste ohne Strg, Alt oder Cmd: Buchstabe, Ziffer, Shift oder F1–F12.',
    });
  });

  it('shows every action with its key, and „Steuerung" puts keys and controller back at a press', () => {
    changeSettings({
      keys: { ...DEFAULT_KEYS, talk: 'g', interact: 'f' },
      pad: { ...DEFAULT_PAD, notes: 'r2' },
    });
    const keycaps = elementsOf(() => <ControlSettings />).filter(
      (el) => el.props['className'] === 'settings-kbd',
    );
    expect(keycaps.map((el) => el.props['children'])).toEqual([
      ...['W', 'S', 'A', 'D', 'Shift', 'F', 'Q', 'N', 'M', 'C', 'I', 'G'],
    ]);
    const panel = elementsOf(() => <SettingsPanel onClose={() => undefined} tab="steuerung" />);
    press(buttonsOf(panel, 'settings-reset')[0]);
    expect(getSettings().keys).toEqual(DEFAULT_KEYS);
    expect(getSettings().pad).toEqual(DEFAULT_PAD);
  });
});

// --- every prompt names its key from the binding map ---------------------------------------

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * A key named in a prompt's text: a letter or a key's name in brackets — „[E] Bedienen",
 * „Schließen [Esc]" —, the space bar by its name, or a letter worked in a sentence — „E
 * drücken", „mit Q ablegen".
 */
const KEY_IN_PROMPT = new RegExp(
  [
    String.raw`\[(?:[A-Z]|Esc|Enter|Space|Shift|Tab|Strg|Alt|F\d{1,2}|←|→|↑|↓)\]`,
    'Leertaste',
    String.raw`\b[A-Z] (?:drücken|halten)\b`,
    String.raw`\bmit [A-Z] (?:einsetzen|ablegen|bedienen|öffnen|lesen|sprechen)\b`,
  ].join('|'),
);

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      // The binding map names the keys: every prompt reads them from there.
      return name === 'input' ? [] : sourcesUnder(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * Every text `source` shows — strings, templates' parts, JSX text — that names a key itself,
 * and every letter a handler listens for by hand (`useKeys(['e'], …)`): a binding's key.
 */
function keysNamedIn(path: string, source: string): string[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const note = (text: string, node: ts.Node): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${line + 1}: ${text.trim()}`);
  };
  const check = (text: string, node: ts.Node): void => {
    if (KEY_IN_PROMPT.test(text)) {
      note(text, node);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useKeys') {
      const [keys] = node.arguments;
      const letters =
        keys !== undefined && ts.isArrayLiteralExpression(keys)
          ? keys.elements.filter((key) => ts.isStringLiteral(key) && /^[a-z]$/.test(key.text))
          : [];
      for (const letter of letters) {
        note(`[${letter.getText(file)}]`, letter);
      }
    }
    const plainText =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node);
    if (plainText) {
      check(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      check(node.head.text, node);
      for (const span of node.templateSpans) {
        check(span.literal.text, span);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('the prompts — every key from the binding map', () => {
  const files = sourcesUnder(SRC);

  it.each(files.map((path) => [relative(SRC, path), path]))(
    '%s names no key of its own',
    (_name, path) => {
      expect(keysNamedIn(path, readFileSync(path, 'utf8'))).toEqual([]);
    },
  );

  it('reads the screens, the world and the devices, and would catch a key named by hand', () => {
    const names = files.map((path) => relative(SRC, path));
    for (const name of ['screens/PutDown.tsx', 'world/interact.ts', 'puzzles/Device.tsx']) {
      expect(names).toContain(name);
    }
    expect(keysNamedIn('a.tsx', 'const a = <b title="Weglegen [N]">[Esc] Zurück</b>;')).toEqual([
      '1: Weglegen [N]',
      '1: [Esc] Zurück',
    ]);
    expect(keysNamedIn('a.ts', 'const a = `[E] ${b}`; const c = list[0];')).toEqual(['1: [E]']);
    expect(keysNamedIn('a.ts', "const a = 'Hebel — E drücken, mit Q ablegen.';")).toEqual([
      '1: Hebel — E drücken, mit Q ablegen.',
    ]);
    const heard = "useKeys(['e'], pull); useKeys(['escape', 'arrowleft'], f);";
    expect(keysNamedIn('a.tsx', heard)).toEqual(["1: ['e']"]);
    // A comment may name a key: no player reads it.
    expect(keysNamedIn('a.ts', '// [E] Bedienen\nconst a = 1;')).toEqual([]);
  });
});
