/**
 * How the walkthrough works each station type of the Übungshalle (tools/shots.mjs
 * `playHallStation`): `control` — every move of the plan a control clicked on the device
 * (`HALL_CONTROLS`); `driver` — every move made as its type makes it, a button held, a command
 * typed, a token read (`HALL_DRIVERS`); `follow` — no move one by one, the crew following the
 * device's pages to the solve (`HALL_FOLLOWERS`). shots.mjs holds its own tables to this one as
 * it loads (`waysMatch`), and groups' sibling test holds the hall's types to it, so that a module
 * added to the hall fails a test before it fails a walkthrough.
 */
export const HALL_WAYS = Object.freeze({
  'button-sync': 'control',
  wiring: 'control',
  keypad: 'control',
  switches: 'control',
  simon: 'control',
  maze: 'control',
  memory: 'control',
  morse: 'control',
  signal: 'control',
  circuit: 'control',
  button: 'driver',
  servers: 'driver',
  access: 'driver',
  firewall: 'follow',
});

/** The station types among `types` the walkthrough knows no way to work, each once. */
export function unworked(types, ways = HALL_WAYS) {
  return [...new Set(types)].filter((type) => !Object.hasOwn(ways, type));
}

/**
 * Where tables of the walkthrough and `ways` disagree: a type a table works that `ways` gives
 * another way or none, or a type `ways` gives a way whose table lacks it — each as a line.
 */
export function waysMatch(ways, tables) {
  const named = { control: tables.controls, driver: tables.drivers, follow: tables.followers };
  const lines = [];
  for (const [way, types] of Object.entries(named)) {
    for (const type of types) {
      if (ways[type] !== way) {
        lines.push(`${type} is worked by ${way}, but the hall's ways say ${ways[type] ?? 'none'}`);
      }
    }
  }
  for (const [type, way] of Object.entries(ways)) {
    if (!(named[way] ?? []).includes(type)) {
      lines.push(`${type} should be worked by ${way}, but that table has no entry for it`);
    }
  }
  return lines;
}
