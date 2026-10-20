import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { moduleFor, MODULES, type FieldSpec } from '../src/index.js';

/**
 * The editor builds a module's form from its `fields` alone, so they have to
 * cover the def exactly: a key of the schema without a field could not be
 * set, a field without a key would be refused, and a default the schema
 * disagrees with would change a mission the moment it is opened.
 */

/** Keys every def carries, whatever its module: the editor's puzzle form has its own inputs. */
const COMMON = ['type', 'id', 'title', 'hints', 'lights', 'onSolved', 'penaltySec'];

const stations = MODULES.flatMap((m) => (m.type === 'relay' ? [] : [moduleFor(m.type)]));

/** The keys of a def schema: one with a refinement is still an object schema in zod 4. */
function schemaKeys(schema: unknown): string[] {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error('a def schema has to be an object schema, refined or not');
  }
  return Object.keys(schema.shape);
}

/** Whether a field's default is one of the values its own input offers. */
function offered(field: FieldSpec): boolean {
  switch (field.kind) {
    case 'int':
      return (
        Number.isInteger(field.default) && field.min <= field.default && field.default <= field.max
      );
    case 'range':
      return (
        field.min <= field.default.min &&
        field.default.min <= field.default.max &&
        field.default.max <= field.max
      );
    case 'choice':
      return field.options.some((option) => option.value === field.default);
    case 'bool':
      return true;
  }
}

/** What the schema makes of a file without the key: the default, or off where it can be off. */
function missing(field: FieldSpec): unknown {
  if (field.kind === 'int' && field.off !== undefined) {
    return field.off === 'null' ? null : undefined;
  }
  return field.default;
}

const cases = stations.map((station) => [station.type, station] as const);

describe.each(cases)('%s', (type, station) => {
  it('has a field for every key of its own in the def schema, and for nothing else', () => {
    const own = schemaKeys(station.defSchema).filter((key) => !COMMON.includes(key));
    const keys = station.fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(own.sort());
  });

  it('builds a def the schema takes from the defaults', () => {
    const defaults = Object.fromEntries(station.fields.map((field) => [field.key, field.default]));
    const result = station.defSchema.safeParse({ type, id: 'probe', title: 'Probe', ...defaults });
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('agrees with the schema on what a file without the key means', () => {
    const bare = station.defSchema.parse({ type, id: 'probe', title: 'Probe' }) as Record<
      string,
      unknown
    >;
    for (const field of station.fields) {
      expect(bare[field.key], field.key).toEqual(missing(field));
    }
  });

  it('offers its own default, and says in one line of German what each field does', () => {
    for (const field of station.fields) {
      expect(offered(field), field.key).toBe(true);
      expect(field.label.trim(), field.key).not.toBe('');
      expect(field.help, field.key).toMatch(/^[A-ZÄÖÜ0-9][^\n]*\.$/);
    }
  });
});

describe('the fields of all modules', () => {
  it('cover every station module, and some of them have fields of their own', () => {
    expect(stations).toHaveLength(MODULES.length - 1);
    const kinds = new Set(stations.flatMap((station) => station.fields.map((field) => field.kind)));
    expect([...kinds].sort()).toEqual(['bool', 'choice', 'int', 'range']);
  });
});
