import { useEffect, useRef } from 'react';
import { useGlyph } from '../input/glyphs.js';
import { ControlSettings } from './ControlSettings.js';
import {
  changeSettings,
  isRebinding,
  useSettings,
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
 * Esc closes the panel — capturing, and stopped there, so that the Esc that closes it closes
 * nothing under it — unless the panel waits for a key or a button to bind: that Esc only stops
 * waiting.
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
 * keys and the controller (ControlSettings.tsx), the text size and less motion, each kept on
 * this device as it is set (settings.ts). The top bar's sound switch stays the quick way to
 * silence everything; a controller's Start opens them.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const closeKey = useGlyph('close');
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
            Schließen [{closeKey}]
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
        <ControlSettings />
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
