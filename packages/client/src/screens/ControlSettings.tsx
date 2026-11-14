import { useCallback, useEffect, useState } from 'react';
import {
  ACTION_NAMES,
  ACTIONS,
  bindVerdict,
  DEFAULT_KEYS,
  DEFAULT_PAD,
  keyName,
  PAD_ACTIONS,
  rebindPad,
  type BindVerdict,
  type InputAction,
  type KeyBindings,
  type PadAction,
  type PadBindings,
} from '../input/bindings.js';
import {
  PAD_CHAT,
  PAD_GLYPHS,
  PAD_PING,
  type PadButton,
  type PadFamily,
} from '../input/pad.js';
import { capturePadButton, usePadLive, type PadLive } from '../input/padRuntime.js';
import { changeSettings, startRebinding, useSettings } from '../settings.js';

/**
 * The settings' controls (screens/Settings.tsx): every action's key, rebound by pressing the
 * new one — a key the game keeps, or one another action holds, is refused and named — and a
 * controller's live test, every button lighting up as it is pressed, with the four main
 * actions on buttons of the player's choosing; both back to the defaults with one press.
 * Meanwhile, waiting for a key or a button, nothing else acts on it (settings.ts
 * `isRebinding`), and Esc stops waiting.
 */

/** What the panel says to a key it cannot bind. */
export function refusal(verdict: Exclude<BindVerdict, { ok: true }>, keys: KeyBindings): string {
  switch (verdict.reason) {
    case 'fixed':
      return `Diese Taste behält ihre Aufgabe: ${verdict.what}.`;
    case 'taken':
      return `Schon belegt: ${ACTION_NAMES[verdict.by]} (${keyName(keys[verdict.by])}).`;
    case 'unfit':
      return 'Nur eine Taste ohne Strg, Alt oder Cmd: Buchstabe, Ziffer, Shift oder F1–F12.';
  }
}

/** A key as the panel hears it while it waits. */
export type PressedKey = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>;

/**
 * What a key pressed while the panel waits for `action`'s new key does to `keys`: binds it —
 * the new bindings — or is refused, with the reason (`refusal`); held with Strg, Alt or Cmd it
 * is no key to hold alone.
 */
export function keyPressed(
  keys: KeyBindings,
  action: InputAction,
  e: PressedKey,
): { keys: KeyBindings } | { refused: string } {
  const verdict: BindVerdict =
    e.altKey || e.ctrlKey || e.metaKey
      ? { ok: false, reason: 'unfit' }
      : bindVerdict(keys, action, e.key);
  return verdict.ok
    ? { keys: { ...keys, [action]: e.key.toLowerCase() } }
    : { refused: refusal(verdict, keys) };
}

/**
 * While `waiting` names an action, the next key pressed is its new key — or refused, the
 * reason told by `done` — and Esc stops waiting; capturing, so that the key goes nowhere else.
 */
function useKeyCapture(
  waiting: InputAction | null,
  keys: KeyBindings,
  done: (refused: string | null) => void,
): void {
  useEffect(() => {
    if (waiting === null) {
      return undefined;
    }
    const endWait = startRebinding();
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        done(null);
        return;
      }
      const pressed = keyPressed(keys, waiting, e);
      if ('keys' in pressed) {
        changeSettings({ keys: pressed.keys });
        done(null);
      } else {
        done(pressed.refused);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      endWait();
    };
  }, [waiting, keys, done]);
}

/** The keys that keep their task whatever is bound, as the panel names them. */
const KEPT = [
  ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].map(keyName).join(' '),
  ...['enter', ' ', 'escape'].map(keyName),
].join(', ');

/** What the panel says under the keys: what keeps its task, how to stop waiting, touch. */
const KEPT_NOTE =
  `${KEPT} behalten ihre Aufgabe; ${keyName('escape')} bricht das Ändern ab. ` +
  'Touch-Geräte behalten ihre Knöpfe.';

/** Every action with its key and „Ändern"; a refused key's reason under the table. */
function KeyTable({ keys }: { keys: KeyBindings }) {
  const [waiting, setWaiting] = useState<InputAction | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const done = useCallback((refused: string | null) => {
    setSaid(refused);
    if (refused === null) {
      setWaiting(null);
    }
  }, []);
  useKeyCapture(waiting, keys, done);
  return (
    <fieldset className="settings-group">
      <legend>Tastenbelegung</legend>
      <table className="settings-bindings">
        <tbody>
          {ACTIONS.map((action) => (
            <tr key={action} data-action={action}>
              <th scope="row">{ACTION_NAMES[action]}</th>
              <td>
                <kbd className="settings-kbd">{keyName(keys[action])}</kbd>
              </td>
              <td>
                <button
                  type="button"
                  className="settings-rebind"
                  aria-pressed={waiting === action}
                  onClick={() => {
                    setSaid(null);
                    setWaiting(waiting === action ? null : action);
                  }}
                >
                  {waiting === action ? 'Taste drücken …' : 'Ändern'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {said !== null && (
        <p className="settings-refused" role="status">
          {said}
        </p>
      )}
      <p className="settings-note">{KEPT_NOTE}</p>
    </fieldset>
  );
}

/** A button of the live test: its glyph, lit while it is held. */
function PadKey(props: { live: PadLive; button: PadButton; x: number; y: number; r?: number }) {
  const { live, button, x, y, r = 9 } = props;
  const lit = live.held.has(button);
  return (
    <g className={lit ? 'pad-key pad-key--lit' : 'pad-key'} data-button={button}>
      <circle cx={x} cy={y} r={r} />
      <text x={x} y={y + 3.5} textAnchor="middle">
        {PAD_GLYPHS[live.family][button]}
      </text>
    </g>
  );
}

/** A shoulder button or trigger of the live test: a rounded bar, lit while held. */
function PadBar(props: { live: PadLive; button: PadButton; x: number; y: number }) {
  const { live, button, x, y } = props;
  const lit = live.held.has(button);
  return (
    <g className={lit ? 'pad-key pad-key--lit' : 'pad-key'} data-button={button}>
      <rect x={x} y={y} width={44} height={14} rx={6} />
      <text x={x + 22} y={y + 10.5} textAnchor="middle">
        {PAD_GLYPHS[live.family][button]}
      </text>
    </g>
  );
}

/** The controller's outline: a body with two grips. */
const PAD_BODY =
  'M30 44 H230 Q256 44 252 92 Q246 146 214 140 Q190 134 170 112 H90 Q70 134 46 140 ' +
  'Q14 146 8 92 Q4 44 30 44 Z';

/**
 * The controller as it stands: shoulders and triggers over its body, the D-pad and the left
 * stick — its dot where it leans — on the left, the four face buttons on the right, Select and
 * Start between; every button lit while it is held.
 */
export function PadTest({ live }: { live: PadLive }) {
  const { x, y } = live.stick;
  return (
    <svg className="pad-test" viewBox="0 0 260 150" role="img" aria-label="Controller-Test">
      <PadBar live={live} button="l2" x={22} y={4} />
      <PadBar live={live} button="r2" x={194} y={4} />
      <PadBar live={live} button="l1" x={22} y={22} />
      <PadBar live={live} button="r1" x={194} y={22} />
      <path className="pad-body" d={PAD_BODY} />
      <g className="pad-stick" data-button="l3">
        <circle cx={66} cy={74} r={17} />
        <circle
          className={live.held.has('l3') ? 'pad-dot pad-key--lit' : 'pad-dot'}
          cx={66 + x * 11}
          cy={74 + y * 11}
          r={6}
        />
      </g>
      <PadKey live={live} button="dup" x={96} y={98} r={7} />
      <PadKey live={live} button="ddown" x={96} y={126} r={7} />
      <PadKey live={live} button="dleft" x={82} y={112} r={7} />
      <PadKey live={live} button="dright" x={110} y={112} r={7} />
      <PadKey live={live} button="select" x={112} y={62} r={7} />
      <PadKey live={live} button="start" x={148} y={62} r={7} />
      <PadKey live={live} button="y" x={204} y={58} />
      <PadKey live={live} button="a" x={204} y={94} />
      <PadKey live={live} button="x" x={186} y={76} />
      <PadKey live={live} button="b" x={222} y={76} />
      <PadKey live={live} button="r3" x={164} y={112} r={11} />
    </svg>
  );
}

/** The fixed part of a controller, in words: what the buttons nobody remaps do. */
function fixedLine(family: PadFamily, pad: PadBindings): string {
  const g = PAD_GLYPHS[family];
  return (
    `Der Stick läuft, ${g.r1} sprintet, ${g.l1} hält den Funk, ${g[PAD_PING]} setzt einen ` +
    `Ping, ${g[PAD_CHAT]} öffnet den Schnellchat, ${g.start} das Menü, ${g.select} ` +
    `die Einsatzinfo; in Pulten und Fenstern wählt das Steuerkreuz, ${g[pad.interact]} drückt.`
  );
}

/**
 * The controller: whether one is there, its live test, and the four main actions each on a
 * button of the player's choosing — the next button pressed takes it, and where another
 * action sat there the two swap, which the panel says; Esc stops waiting.
 */
function PadSettings({ pad }: { pad: PadBindings }) {
  const live = usePadLive();
  const [waiting, setWaiting] = useState<PadAction | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (waiting === null) {
      return undefined;
    }
    const endWait = startRebinding();
    const stop = capturePadButton((slot) => {
      if (slot !== null) {
        const { pad: next, swapped } = rebindPad(pad, waiting, slot);
        changeSettings({ pad: next });
        setSaid(swapped === null ? null : `Getauscht mit ${ACTION_NAMES[swapped]}.`);
      }
      setWaiting(null);
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setWaiting(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      stop();
      window.removeEventListener('keydown', onKey, true);
      endWait();
    };
  }, [waiting, pad]);
  const glyphs = PAD_GLYPHS[live.family];
  return (
    <fieldset className="settings-group settings-pad">
      <legend>Controller</legend>
      <p className="settings-note" role="status">
        {live.connected
          ? `Verbunden — ${live.family === 'playstation' ? 'PlayStation' : 'Xbox'}-Tasten.`
          : 'Kein Controller erkannt: eine Taste am Controller drücken, dann meldet er sich.'}
      </p>
      <PadTest live={live} />
      <table className="settings-bindings">
        <tbody>
          {PAD_ACTIONS.map((action) => (
            <tr key={action} data-pad-action={action}>
              <th scope="row">{ACTION_NAMES[action]}</th>
              <td>
                <kbd className="settings-kbd settings-kbd--pad">{glyphs[pad[action]]}</kbd>
              </td>
              <td>
                <button
                  type="button"
                  className="settings-rebind"
                  aria-pressed={waiting === action}
                  onClick={() => {
                    setSaid(null);
                    setWaiting(waiting === action ? null : action);
                  }}
                >
                  {waiting === action ? 'Taste am Controller …' : 'Ändern'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {said !== null && (
        <p className="settings-refused" role="status">
          {said}
        </p>
      )}
      <p className="settings-note">{fixedLine(live.family, pad)}</p>
    </fieldset>
  );
}

/** The keys and the controller, and the way back to how they came. */
export function ControlSettings() {
  const { keys, pad } = useSettings();
  return (
    <>
      <KeyTable keys={keys} />
      <PadSettings pad={pad} />
      <button
        type="button"
        className="settings-reset"
        onClick={() => changeSettings({ keys: DEFAULT_KEYS, pad: DEFAULT_PAD })}
      >
        Tasten und Controller zurücksetzen
      </button>
    </>
  );
}
