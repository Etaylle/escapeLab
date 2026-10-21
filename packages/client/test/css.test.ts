import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Nothing parses a stylesheet before the browser does, and a browser swallows
 * every rule after an unclosed one without a word. Sections merged at a
 * file's end have lost a closing brace before; this keeps the braces of
 * ui.css and of every sheet under styles/ balanced — and every one of those
 * imported, since a sheet nobody imports styles nothing.
 */
const SRC = new URL('../src/', import.meta.url);
const STYLES = readdirSync(new URL('styles/', SRC))
  .filter((name) => name.endsWith('.css'))
  .sort();
const SHEETS = ['ui.css', ...STYLES.map((name) => `styles/${name}`)];

/** Opening lines of the blocks still open at the end, comments skipped. */
function unclosedBlocks(source: string): string[] {
  const open: string[] = [];
  let line = 1;
  for (let i = 0; i < source.length; i++) {
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const skipped = end === -1 ? source.length : end + 2;
      line += (source.slice(i, skipped).match(/\n/g) ?? []).length;
      i = skipped - 1;
      continue;
    }
    const ch = source.charAt(i);
    if (ch === '\n') {
      line += 1;
    } else if (ch === '{') {
      open.push(`line ${line}`);
    } else if (ch === '}') {
      open.pop();
    }
  }
  return open;
}

describe.each(SHEETS)('%s', (sheet) => {
  it('closes every block it opens', () => {
    expect(unclosedBlocks(readFileSync(new URL(sheet, SRC), 'utf8'))).toEqual([]);
  });
});

describe('the stylesheets', () => {
  it('are imported by main.tsx, ui.css first and every sheet under styles/ after it', () => {
    expect(STYLES.length).toBeGreaterThan(0);
    const main = readFileSync(new URL('main.tsx', SRC), 'utf8');
    const imports = [...main.matchAll(/^import '\.\/(.+\.css)';$/gm)].map((match) => match[1]);
    expect(imports[0]).toBe('ui.css');
    expect(imports.slice(1).sort()).toEqual(SHEETS.slice(1));
  });

  it('would notice a block left open', () => {
    expect(unclosedBlocks('.a {\n  color: red;\n/* } */\n.b {\n}\n')).toEqual(['line 1']);
  });
});

describe('the bar over a stage', () => {
  it('blurs nothing behind it: the world drawing under it would redo the blur every frame', () => {
    const ui = readFileSync(new URL('ui.css', SRC), 'utf8');
    const rule = /\.app:has\(> \.content--stage\) > \.topbar \{([^}]*)\}/.exec(ui);
    expect(rule?.[1]).toMatch(/backdrop-filter:\s*none;/);
  });
});
