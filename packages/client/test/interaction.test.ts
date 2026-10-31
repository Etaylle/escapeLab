import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The interaction sheet, as main.tsx loads it last. */
const CSS = readFileSync(new URL('../src/styles/interaction.css', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector `selector` matches, as one string. */
function rule(selector: RegExp): string {
  const found = new RegExp(`${selector.source}\\s*\\{([^{}]*)\\}`).exec(CSS);
  if (found === null) {
    throw new Error(`interaction.css has no rule for ${selector.source}`);
  }
  return found[1] ?? '';
}

/** The keyframes `name`, as one string. */
function keyframes(name: string): string {
  const start = CSS.indexOf(`@keyframes ${name}`);
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf('\n}\n', start));
}

describe('interaction.css — how panels come up and controls answer', () => {
  it('is loaded after every other sheet, so that it has the last word where it speaks', () => {
    const sheets = [...MAIN.matchAll(/import '\.\/(?:styles\/)?[\w-]+\.css';/g)].map((m) => m[0]);
    expect(sheets.at(-1)).toBe("import './styles/interaction.css';");
  });

  it('grows a panel from 0.98 as it fades in, over 150 ms, never one being put down', () => {
    const panel = rule(/\.puzzle-modal:not\(\.puzzle-modal--leaving\) \.panel/);
    expect(panel).toMatch(/animation: panel-up 150ms/);
    const up = keyframes('panel-up');
    expect(up).toMatch(/from \{\s*opacity: 0;\s*transform: scale\(0\.98\);/);
    expect(up).toMatch(/to \{\s*opacity: 1;\s*transform: none;/);
  });

  it('presses a plain button a pixel down, and leaves a device’s controls their own press', () => {
    const press = /:where\(button\):active:not\(([^)]*)\)\s*\{([^}]*)\}/.exec(CSS);
    expect(press?.[2]).toMatch(/translate: 0 1px;/);
    for (const own of ['.device *', '.relay *', '.lever-grip', '.world-dpad-btn', '.world-sprint']) {
      expect(press?.[1]).toContain(own);
    }
  });

  it('rings what has the keyboard’s focus, not what a click focused', () => {
    expect(CSS).toMatch(/:where\(button[^)]*\):focus-visible\s*\{\s*outline: 2px solid var\(--accent\);/);
    expect(CSS).not.toMatch(/:focus\s*\{/);
  });

  it('cross-fades a panel and presses without moving under reduced motion', () => {
    const reduced = CSS.slice(CSS.indexOf(":where([data-motion='reduce'])"));
    expect(reduced).toMatch(/\.panel \{\s*animation-name: panel-fade;/);
    expect(reduced).toMatch(/button:active:not\(:disabled\) \{\s*translate: none;/);
    expect(keyframes('panel-fade')).not.toMatch(/transform|scale/);
  });
});
