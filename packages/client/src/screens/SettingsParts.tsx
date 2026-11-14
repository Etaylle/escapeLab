/**
 * The settings' controls, as every tab of the panel uses them (Settings.tsx, ControlSettings.tsx):
 * one of a few options side by side, and a slider with its value beside it.
 */

/** One of a few options, side by side, the one in force lit. */
export function Choice<T extends string>(props: {
  legend: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  /** where the browser cannot do it at all: the options stand, and none takes a press */
  disabled?: boolean;
}) {
  const { legend, options, value, onChange, disabled = false } = props;
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
            disabled={disabled}
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

/** A slider from `min` to `max` in steps of `step`, its name before it and its value after. */
export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** what a screen reader hears of the value: „40 %" by default */
  valueText?: string;
  onChange: (value: number) => void;
}) {
  const { label, value, min, max, step, onChange } = props;
  return (
    <label className="settings-volume">
      <span className="settings-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={props.valueText ?? `${value} %`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output className="settings-value">{value}</output>
    </label>
  );
}
