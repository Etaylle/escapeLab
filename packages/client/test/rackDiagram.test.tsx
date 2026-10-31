import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { serviceDiagram, SERVICES, type RackUnit } from '@escapelab/core';
import { BOX, laidOut, RackDiagram } from '../src/puzzles/RackDiagram.js';
import { Figure } from '../src/screens/Figure.js';

/** The rack as console B shows it: NETZ and DNS up, AUTH down with power, the rest dark. */
const RACK: RackUnit[] = SERVICES.map((service) => ({
  service,
  power: service !== 'web' && service !== 'mail' && service !== 'db',
  led: service === 'netz' || service === 'dns' ? 'green' : service === 'auth' ? 'red' : 'off',
}));

describe('the rack’s cabling diagram', () => {
  it('lays the Netzplan out in columns, NETZ first, an arrow from box edge to box edge', () => {
    const laid = laidOut(serviceDiagram());
    const at = new Map(laid.boxes.map((box) => [box.node, box]));
    expect(laid.boxes).toHaveLength(6);
    expect(at.get('netz')?.x).toBe(0);
    expect([at.get('dns')?.x, at.get('db')?.x]).toEqual([68, 68]);
    expect(at.get('auth')?.x).toBe(136);
    // MAIL over WEB, DNS over DB: no cable runs through AUTH's box.
    expect((at.get('mail')?.y ?? 0) < (at.get('web')?.y ?? 0)).toBe(true);
    expect(laid.arrows).toHaveLength(8);
    for (const arrow of laid.arrows) {
      const from = at.get(arrow.from);
      expect(arrow.x1).toBe((from?.x ?? 0) + BOX.w);
      expect(arrow.x2).toBe(at.get(arrow.to)?.x);
    }
  });

  it('shows every service with its LED as the rack’s unit has it — and no code anywhere', () => {
    const html = renderToStaticMarkup(<RackDiagram rack={RACK} />);
    expect(html).toContain('Netzplan · Verkabelung');
    expect(html).toContain('aria-label="Netzplan: NETZ braucht nichts; DNS braucht NETZ;');
    for (const service of ['NETZ', 'DNS', 'DB', 'AUTH', 'WEB', 'MAIL']) {
      expect(html).toContain(`>${service}</text>`);
    }
    expect(html).toMatch(/data-service="netz">.*?services-led services-led--green/);
    expect(html).toMatch(/data-service="auth">.*?services-led services-led--red/);
    expect(html).toMatch(/data-service="web">.*?services-led services-led--off/);
    // Rules, never answers: the codes stay at the terminal.
    expect(html).not.toMatch(/E11|E23|E42|E50|FEHLER|RUNNING/);
  });

  it('is the printed page’s figure too, its LEDs dark', () => {
    const figure = renderToStaticMarkup(<Figure of="servers" />);
    const graph = /<g class="services-graph">.*?<\/g><\/g><\/g>/.exec(figure)?.[0] ?? '';
    expect(graph.match(/class="services-box"/g)).toHaveLength(6);
    expect(graph).not.toMatch(/services-led--/);
    const rack = renderToStaticMarkup(<RackDiagram rack={RACK} />);
    const arrows = (html: string) => /class="services-arrows" d="([^"]+)"/.exec(html)?.[1];
    expect(arrows(figure)).toBe(arrows(rack));
  });
});
