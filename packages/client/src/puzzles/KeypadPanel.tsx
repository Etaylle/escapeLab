import { useState } from 'react';
import type { Change } from './feel.js';
import type { PanelProps } from './index.js';
import { typeBlip } from './sounds.js';
import './keypad.css';

type KeypadPuzzle = PanelProps<'keypad'>['puzzle'];
type KeypadChange = Change<KeypadPuzzle>;
type Key = NonNullable<KeypadPuzzle['keys']>[number];

/** Keys on the pad; a view without the keys only learns how many are lit. */
const KEY_COUNT = 4;

/** The key a change lit, by its place on the pad; none where none was. */
export function litWith(change: KeypadChange | null): number | null {
  const before = change?.before.keys ?? null;
  const after = change?.after.keys ?? null;
  if (before === null || after === null) {
    return null;
  }
  const lit = after.findIndex((key, i) => key.lit && before[i]?.lit === false);
  return lit === -1 ? null : lit;
}

/** What a change sounds like: the display taking the glyph of a key just lit. */
export function keypadSounds(change: KeypadChange): void {
  if (litWith(change) !== null) {
    typeBlip();
  }
}

/**
 * The lit keys in the order they lit, as far as the device saw it: `order` as it was, the
 * keys lit since put after it — those already lit as it opened in their order on the pad.
 */
export function typedOrder(order: readonly number[], keys: readonly Key[]): number[] {
  const kept = order.filter((i) => keys[i]?.lit === true);
  const fresh = keys.flatMap((key, i) => (key.lit && !kept.includes(i) ? [i] : []));
  return [...kept, ...fresh];
}

/** The keys lit while the device has been open, in their order (`typedOrder`). */
function useTyped(keys: readonly Key[]): number[] {
  const [order, setOrder] = useState(() => typedOrder([], keys));
  const next = typedOrder(order, keys);
  if (next.join() !== order.join()) {
    setOrder(next);
  }
  return next;
}

/**
 * The pad's display: a cell for every key of the code, the glyphs in as they were typed —
 * the one `typed` just now blinks in — or for a player without the keys a mark per key in.
 */
function Display(props: {
  glyphs: readonly string[] | null;
  filled: number;
  typed: number | null;
}) {
  const { glyphs, filled, typed } = props;
  const cell = (i: number): string =>
    `keypad-cell${i < filled ? ' keypad-cell--in' : ''}${i === typed ? ' keypad-cell--typed' : ''}`;
  return (
    <div
      className="keypad-display"
      role="img"
      aria-label={`Eingegeben: ${filled} von ${KEY_COUNT}`}
    >
      {Array.from({ length: KEY_COUNT }, (_, i) => (
        <span key={i} className={cell(i)}>
          {glyphs?.[i] ?? ''}
        </span>
      ))}
    </div>
  );
}

/** A key's classes: lit for good once pressed right — `fresh`, glowing on as it lit just now. */
function keyClass(key: Key, fresh: boolean): string {
  if (!key.lit) {
    return 'keypad-key';
  }
  return fresh ? 'keypad-key keypad-key--lit keypad-key--fresh' : 'keypad-key keypad-key--lit';
}

interface PadProps {
  keys: Key[];
  change: KeypadChange | null;
  send: PanelProps<'keypad'>['send'];
}

/** The operator's pad: the display over four keys; a right press lights its key for good. */
function Pad({ keys, change, send }: PadProps) {
  const order = useTyped(keys);
  const lit = litWith(change);
  return (
    <div className="keypad">
      <Display
        glyphs={order.map((i) => keys[i]?.glyph ?? '')}
        filled={order.length}
        typed={lit === null ? null : order.indexOf(lit)}
      />
      <div className="keypad-grid">
        {keys.map((key, i) => (
          <button
            key={i}
            className={keyClass(key, i === lit)}
            disabled={key.lit}
            onClick={() => send({ keyIndex: i })}
          >
            {key.glyph}
          </button>
        ))}
      </div>
    </div>
  );
}

export function KeypadPanel({ puzzle, change, send }: PanelProps<'keypad'>) {
  if (puzzle.keys === null) {
    const typed =
      change !== null && puzzle.litCount > change.before.litCount ? puzzle.litCount - 1 : null;
    return <Display glyphs={null} filled={puzzle.litCount} typed={typed} />;
  }
  return <Pad keys={puzzle.keys} change={change} send={send} />;
}
