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

/** Every backdrop-filter `source` sets, with the selector of its rule; comments left out. */
function backdropFilters(source: string): { selector: string; value: string }[] {
  const plain = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector = '', body = '']) =>
    [...body.matchAll(/backdrop-filter:\s*([^;]+);/g)].map(([, value = '']) => ({
      selector: selector.trim(),
      value: value.trim(),
    })),
  );
}

describe('a stage screen', () => {
  it('blurs nothing behind anything: the world under a blur would redo it every frame', () => {
    const blurs = SHEETS.flatMap((sheet) =>
      backdropFilters(readFileSync(new URL(sheet, SRC), 'utf8'))
        .filter((rule) => rule.value !== 'none')
        .map((rule) => `${sheet}: ${rule.selector}`),
    );
    // The bar's alone, off a stage: over one it blurs nothing (above).
    expect(blurs).toEqual(['ui.css: .topbar']);
  });

  it('would notice a blur, inside a media block too, and leave one in a comment be', () => {
    const sheet = [
      '/* .x { backdrop-filter: blur(1px); } */',
      '@media (x) {',
      '  .a { backdrop-filter: blur(2px); }',
      '}',
    ].join('\n');
    expect(backdropFilters(sheet)).toEqual([{ selector: '.a', value: 'blur(2px)' }]);
  });
});

/** What the block opened by `header` holds, up to its matching brace; null where there is none. */
function blockAfter(source: string, header: string): string | null {
  const start = source.indexOf(header);
  if (start === -1) {
    return null;
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source.charAt(i) === '{') {
      depth += 1;
    } else if (source.charAt(i) === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  return null;
}

describe('a phone held sideways', () => {
  const ux2 = readFileSync(new URL('styles/ux2.css', SRC), 'utf8');
  const sideways = blockAfter(ux2, '@media (orientation: landscape) and (max-height: 500px)') ?? '';

  it('sets the end card in two columns: the crew’s shot left, word, time and rank right', () => {
    const card = blockAfter(sideways, '.end-title {') ?? '';
    expect(card).toMatch(/display:\s*grid;/);
    expect(card).toMatch(/grid-template-columns:/);
    expect(card).toMatch(/'scene mission'\s*'scene word'\s*'scene facts'/);
    expect(blockAfter(sideways, '.end-scene {')).toMatch(/grid-area:\s*scene;/);
    expect(blockAfter(sideways, '.end-facts {')).toMatch(/grid-area:\s*facts;/);
  });

  it('keeps the top bar on one line', () => {
    expect(blockAfter(sideways, '.topbar {')).toMatch(/flex-wrap:\s*nowrap;/);
  });
});

describe('the main switch under reduced motion', () => {
  it('moves no grip, down or springing back up', () => {
    const coldopen = readFileSync(new URL('styles/coldopen.css', SRC), 'utf8');
    const calm = blockAfter(coldopen, ":where([data-motion='reduce'])") ?? '';
    expect(calm).toMatch(
      /\.lever \.lever-grip,\s*\.lever \.lever-unit--down \.lever-grip \{\s*transition:\s*none;/,
    );
  });
});
