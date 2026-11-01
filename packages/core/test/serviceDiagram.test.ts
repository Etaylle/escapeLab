import { describe, expect, it } from 'vitest';
import { DEPENDS_ON, diagramOf, SERVICES, serviceDiagram } from '../src/index.js';

describe('the Serverraum’s cabling diagram, derived from DEPENDS_ON', () => {
  it('lays the services out NETZ → DNS, DB → AUTH → WEB, MAIL', () => {
    // MAIL over WEB: it hangs on DNS above, WEB on DB below — no arrow crosses AUTH's box.
    const columns = [['netz'], ['dns', 'db'], ['auth'], ['mail', 'web']];
    expect(serviceDiagram().columns).toEqual(columns);
  });

  it('draws an arrow from every dependency to the service that needs it, and no other', () => {
    const { arrows } = serviceDiagram();
    const needed = SERVICES.flatMap((service) => DEPENDS_ON[service].map((dep) => [dep, service]));
    expect(arrows).toEqual(needed);
    expect(arrows).toHaveLength(8);
    // An arrow only ever points to a later column: the diagram reads left to right.
    const column = (service: string) =>
      serviceDiagram().columns.findIndex((col) => col.some((s) => s === service));
    for (const [from, to] of arrows) {
      expect(column(from), `${from} → ${to}`).toBeLessThan(column(to));
    }
  });

  it('places each node one column past the longest chain under it', () => {
    const chain = diagramOf(['a', 'b', 'c', 'd'], { a: [], b: ['a'], c: ['b'], d: ['a', 'c'] });
    expect(chain.columns).toEqual([['a'], ['b'], ['c'], ['d']]);
    const flat = diagramOf(['x', 'y'], { x: [], y: [] });
    expect(flat).toEqual({ columns: [['x', 'y']], arrows: [] });
    expect(diagramOf([], {})).toEqual({ columns: [], arrows: [] });
  });

  it('orders a column by where its dependencies stand, a tie by the order listed', () => {
    const crossed = diagramOf(['top', 'bottom', 'low', 'high'], {
      top: [],
      bottom: [],
      low: ['bottom'],
      high: ['top'],
    });
    expect(crossed.columns).toEqual([['top', 'bottom'], ['high', 'low']]);
    const tied = diagramOf(['a', 'b', 'c'], { a: [], b: ['a'], c: ['a'] });
    expect(tied.columns).toEqual([['a'], ['b', 'c']]);
  });

  it('refuses a node listed before what it needs', () => {
    expect(() => diagramOf(['b', 'a'], { a: [], b: ['a'] })).toThrow(/"b" depends on "a"/);
  });

  it('holds rules, never a service’s state: names and arrows only', () => {
    const text = JSON.stringify(serviceDiagram());
    expect(text).not.toMatch(/E\d\d|running|power|green|red|code/i);
  });
});
