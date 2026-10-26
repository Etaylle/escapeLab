import { useEffect, useRef, useState } from 'react';
import {
  changeSettings,
  isRebinding,
  keyName,
  setRebinding,
  talkKeyVerdict,
  useSettings,
  type KeyVerdict,
  type Motion,
  type TextSize,
  type Volumes,
} from '../settings.js';

/** The three volumes as the panel names them. */
const VOLUMES: readonly (readonly [keyof Volumes, string])[] = [
  ['radio', 'Funk'],
  ['effects', 'Effekte'],
  ['music', 'Musik'],
];

const TEXT_SIZES: readonly (readonly [TextSize, string])[] = [
  ['small', 'Klein'],
  ['normal', 'Normal'],
  ['large', 'Groß'],
];

const MOTIONS: readonly (readonly [Motion, string])[] = [
  ['off', 'Aus'],
  ['on', 'An'],
  ['system', 'System'],
];

/** What the panel says to a key that cannot be the talk key. */
const REFUSED: Readonly<Record<Exclude<KeyVerdict, 'ok'>, string>> = {
  taken: 'Diese Taste ist schon belegt.',
  unfit: 'Nur eine Taste ohne Strg, Alt oder Cmd: Buchstabe, Ziffer oder F1–F12.',
};

/** A volume's slider, 0 to 100, with its value beside it. */
function Volume(props: { label: string; value: number; onChange: (value: number) => void }) {
  const { label, value, onChange } = props;
  return (
    <label className="settings-volume">
      <span className="settings-label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-valuetext={`${value} %`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output className="settings-value">{value}</output>
    </label>
  );
}

/** One of a few options, side by side, the one in force lit. */
function Choice<T extends string>(props: {
  legend: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { legend, options, value, onChange } = props;
  return (
    <fieldset className="settings-group">
      <legend>{legend}</legend>
      <div className="settings-options" role="radiogroup" aria-label={legend}>
        {options.map(([option, label]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            className={option === value ? 'settings-option settings-option--on' : 'settings-option'}
            onClick={() => onChange(option)}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The key held to talk, and „Ändern": then the next key pressed becomes it — one the game
 * takes already, or one held with Strg, Alt or Cmd, is refused with the reason; Esc stops
 * waiting. Meanwhile no key talks and none reaches the screen under the panel. Touch screens
 * keep their talk button.
 */
function TalkKey({ talkKey }: { talkKey: string }) {
  const [waiting, setWaiting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    if (!waiting) {
      return undefined;
    }
    setRebinding(true);
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setWaiting(false);
        return;
      }
      const verdict = e.altKey || e.ctrlKey || e.metaKey ? 'unfit' : talkKeyVerdict(e.key);
      if (verdict === 'ok') {
        changeSettings({ talkKey: e.key.toLowerCase() });
        setRefused(null);
        setWaiting(false);
      } else {
        setRefused(REFUSED[verdict]);
      }
    };
    // Capturing, and stopped here: the key pressed goes nowhere else.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setRebinding(false);
    };
  }, [waiting]);
  return (
    <fieldset className="settings-group">
      <legend>Push-to-Talk-Taste</legend>
      <div className="settings-key">
        <kbd className="settings-kbd">{keyName(talkKey)}</kbd>
        <button
          type="button"
          className="settings-rebind"
          aria-pressed={waiting}
          onClick={() => {
            setRefused(null);
            setWaiting(true);
          }}
        >
          {waiting ? 'Taste drücken … (Esc bricht ab)' : 'Ändern'}
        </button>
      </div>
      {refused !== null && (
        <p className="settings-refused" role="status">
          {refused}
        </p>
      )}
      <p className="settings-note">Gilt für die Tastatur; Touch-Geräte behalten den Sprechknopf.</p>
    </fieldset>
  );
}

/**
 * Esc closes the panel — capturing, and stopped there, so that the Esc that closes it closes
 * nothing under it — unless the panel waits for a new talk key: that Esc only stops waiting.
 */
function useEscapeCloses(onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !isRebinding()) {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

/**
 * The settings over whatever screen is up — a run goes on under them: the three volumes, the
 * talk key, the text size and less motion, each kept on this device as it is set
 * (settings.ts). The top bar's sound switch stays the quick way to silence everything.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  useEscapeCloses(onClose);
  const setVolume = (part: keyof Volumes, value: number): void =>
    changeSettings({ volumes: { ...settings.volumes, [part]: value } });
  return (
    <div
      className="overlay settings"
      role="dialog"
      aria-modal="true"
      aria-label="Einstellungen"
      onClick={onClose}
    >
      <div className="card settings-card" onClick={(e) => e.stopPropagation()}>
        <div className="info-head">
          <h2>Einstellungen</h2>
          <button className="link" onClick={onClose}>
            Schließen [Esc]
          </button>
        </div>
        <fieldset className="settings-group">
          <legend>Lautstärke</legend>
          {VOLUMES.map(([part, label]) => (
            <Volume
              key={part}
              label={label}
              value={settings.volumes[part]}
              onChange={(value) => setVolume(part, value)}
            />
          ))}
        </fieldset>
        <TalkKey talkKey={settings.talkKey} />
        <Choice
          legend="Textgröße"
          options={TEXT_SIZES}
          value={settings.textSize}
          onChange={(textSize) => changeSettings({ textSize })}
        />
        <Choice
          legend="Weniger Bewegung"
          options={MOTIONS}
          value={settings.motion}
          onChange={(motion) => changeSettings({ motion })}
        />
      </div>
    </div>
  );
}
