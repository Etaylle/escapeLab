import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The chrome round the world — the top bar, the strip under the run, the lobby's panel, the end
 * screen's report — in the main menu's look (styles/menu.css): its panel's near-black, hairline
 * and corners, Michroma for the headings and nowhere else, the sizes the readability rules ask.
 */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const UI = read('../src/ui.css');
const MENU = read('../src/styles/menu.css');
const LOBBY = read('../src/styles/lobby.css');
const FINALE = read('../src/styles/finale.css');

/** The body of the first rule in `css` whose selector line is `selector`, braces left out. */
function ruleOf(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) {
    throw new Error(`no rule ${selector}`);
  }
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

/** The menu's panel, the look the chrome takes. */
const PANEL = ruleOf(MENU, '.menu-panel');

describe('the chrome in the menu’s look', () => {
  it('lays the strip, the lobby’s panel and the end’s report on the menu’s panel', () => {
    expect(PANEL).toContain('background: rgba(9, 14, 19, 0.97);');
    expect(PANEL).toContain('border: 1px solid var(--line-2);');
    for (const rule of [
      ruleOf(UI, '.hud'),
      ruleOf(LOBBY, '.lobby-panel'),
      ruleOf(FINALE, '.end-screen > .card.end'),
    ]) {
      expect(rule).toContain('background: rgba(9, 14, 19, 0.97);');
      expect(rule).toMatch(/border(-color)?: (1px solid )?var\(--line-2\);/);
    }
  });

  it('sets the headings in Michroma — the bar’s, the lobby’s, the report’s — and only them', () => {
    expect(ruleOf(UI, '.logo')).toContain('font-family: var(--display);');
    expect(ruleOf(LOBBY, '.lobby-head h1')).toContain('font-family: var(--display);');
    expect(ruleOf(FINALE, '.end-screen > .card.end h2')).toContain('font-family: var(--display);');
    // The bar's chips, its mission and the strip keep the mono and the sans.
    const chips = ruleOf(UI, '.room-code,\n.watching-chip');
    expect(chips).toContain('font-family: var(--mono);');
    const strip = UI.slice(UI.indexOf('\n.hud {'), UI.indexOf('/* ── info panel'));
    expect(strip).not.toContain('var(--display)');
    expect(ruleOf(UI, '.topbar-mission')).not.toContain('var(--display)');
  });

  it('keeps the strip’s frame, which the world’s height comes from, and casts no shadow', () => {
    const hud = ruleOf(UI, '.hud');
    expect(hud).toContain('margin-top: 10px;');
    expect(hud).toContain('padding: 8px 12px;');
    expect(hud).toContain('border: 1px solid var(--line-2);');
    expect(hud).not.toContain('box-shadow');
    // One height on a wide window: the zoom follows the canvas, the canvas what the strip leaves.
    expect(UI).toMatch(/\n\.hud \{\s*height: 58px;/);
  });

  it('reads the bar’s chips at 14 px, the code and how many watch alike', () => {
    expect(ruleOf(UI, '.room-code,\n.watching-chip')).toContain('font-size: 14px;');
    expect(ruleOf(UI, '.logo')).toContain('font-size: 14px;');
  });

  it('leaves a phone’s narrow bar the logo’s mark, the word gone with the mission’s name', () => {
    const narrow = UI.slice(UI.indexOf('@media (max-width: 560px) {\n  .topbar {'));
    expect(narrow.slice(0, narrow.indexOf('\n}\n'))).toMatch(
      /\.topbar-mission,\s*\.room-code-prefix,\s*\.conn-text,\s*\.logo-word \{\s*display: none;/,
    );
  });
});
