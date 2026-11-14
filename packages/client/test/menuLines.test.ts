import { describe, expect, it } from 'vitest';
import { elementsOf, Sheets, type Screen, type Styled } from './cascade.js';

/**
 * The menu's quiet lines over the lab at night (docs/art-bible.md „The menu"): the sign under the
 * title and the line under the items lie over the lab wherever the vignette's dark does not reach
 * under them — an upright phone, a tablet, a narrower window —, so each is set in a colour of its
 * own that holds 4.5:1 (WCAG 2.2) against the lightest the lab at night shows behind it, on every
 * screen. The walkthrough measures them over the scene itself (tools/shots.mjs `checkMenuLines`).
 */

/**
 * The lightest pixel the lab at night showed behind either line, as luminance: measured with the
 * text made clear, every 750 ms across the drift's 30 s, in ten windows from 360 × 740 to
 * 1440 × 820 and the phones held sideways — behind the sign on a phone held sideways.
 */
const LIGHTEST_BEHIND = 0.0714;

const SCREENS: { name: string; screen: Screen }[] = [
  { name: 'a phone upright', screen: { width: 420, height: 760, coarse: true } },
  { name: 'a phone held sideways', screen: { width: 932, height: 430, coarse: true } },
  { name: 'a tablet upright', screen: { width: 768, height: 1024, coarse: true } },
  { name: 'a laptop', screen: { width: 1440, height: 820, coarse: false } },
];

/** The menu's stage as the join screen lays it out, its two quiet lines in it. */
const MENU =
  '<div class="menu"><div class="menu-head"><p class="menu-sub">Zutritt nur mit Dienstausweis</p>' +
  '</div><div class="menu-body"><p class="menu-lead">Am Pult die Maschine</p></div></div>';

/** WCAG 2.2's relative luminance of a colour written #rrggbb. */
function luminance(hex: string): number {
  const linear = (at: number): number => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

/** The node of `nodes` with the class `name`. */
function lineOf(nodes: readonly Styled[], name: string): Styled {
  const found = nodes.find((node) => node.classes.includes(name));
  if (found === undefined) throw new Error(`no ${name} in the menu's markup`);
  return found;
}

describe.each(SCREENS)('the menu’s quiet lines on $name', ({ screen }) => {
  const sheets = new Sheets();
  const nodes = elementsOf(MENU);

  it.each(['menu-sub', 'menu-lead'])('set %s in a colour of 4.5:1 over the lab at night', (name) => {
    const colour = sheets.declared(lineOf(nodes, name), 'color', screen)?.value ?? '';
    expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    const contrast = (luminance(colour) + 0.05) / (LIGHTEST_BEHIND + 0.05);
    expect(contrast, `${name} in ${colour}`).toBeGreaterThanOrEqual(4.5);
  });
});
