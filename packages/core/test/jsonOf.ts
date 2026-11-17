/** How wide a line of the files may run before an object or a list breaks over lines. */
const WIDTH = 100;

/**
 * `value` as the mission files are set: two spaces a level, an object or a list on one line
 * where it fits — `{ "x": 3, "y": 4 }` — and one entry a line where it does not.
 */
export function jsonOf(value: unknown, indent = ''): string {
  const flat = JSON.stringify(value, null, 1)?.replace(/\n\s*/g, ' ') ?? 'null';
  const tidy = flat.replace(/\[ /g, '[').replace(/ \]/g, ']');
  if (typeof value !== 'object' || value === null || indent.length + tidy.length <= WIDTH) {
    return tidy;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${jsonOf(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) => `${inner}${JSON.stringify(key)}: ${jsonOf(item, inner)}`,
  );
  return `{\n${entries.join(',\n')}\n${indent}}`;
}
