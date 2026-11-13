import { useEffect, useRef, useState } from 'react';
import type { AccountView } from '@escapelab/core';
import { useGlyph } from '../input/glyphs.js';
import { dateText } from '../runStats.js';
import { ControlSettings } from './ControlSettings.js';
import { runsText } from './ProfileChip.js';
import {
  changeSettings,
  isRebinding,
  useSettings,
  type Motion,
  type TextSize,
  type Volumes,
} from '../settings.js';
import { volumeTick } from '../world/audio.js';

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

/** Where „Konto löschen" stands: not asked yet, asked — what it deletes said — or sent off. */
export type DeleteStep = 'idle' | 'asked' | 'sent';

/** What the account holds, on one line: its name, since when it is kept, its runs. */
export function accountFacts(account: AccountView): string {
  const name = account.name === '' ? 'Ohne Namen' : account.name;
  return `${name} · seit ${dateText(account.since)} · ${runsText(account.runs)}`;
}

/** What deleting the account leaves on this device, whatever the server keeps. */
const PASS_STAYS = 'Der Dienstausweis dieses Geräts bleibt.';

/**
 * What deleting the account deletes, and what it leaves, said before it is done: where the
 * server keeps a run log (`AccountStore`), the log keeps the name, and so does the Bestenliste
 * once the server starts anew.
 */
export function deleteLine(account: Pick<AccountView, 'runs' | 'store'>): string {
  const { runs, store } = account;
  if (runs === 0) {
    return `Löscht Name, Farbe und Erfolge des Kontos. ${PASS_STAYS}`;
  }
  if (store === 'run-log') {
    return (
      'Löscht Name, Farbe und Erfolge des Kontos und nimmt den Namen aus der Bestenliste dieses ' +
      'Servers. Sein Laufprotokoll behält ihn und führt ihn nach einem Neustart wieder auf. ' +
      PASS_STAYS
    );
  }
  const where = runs === 1 ? 'seinem Einsatz' : `seinen ${runs} Einsätzen`;
  return (
    `Löscht Name, Farbe und Erfolge des Kontos und nimmt den Namen aus ${where}; die ` +
    `Einsätze bleiben in der Bestenliste. ${PASS_STAYS}`
  );
}

/** What the settings say once the account is deleted. */
export const ACCOUNT_DELETED =
  'Konto gelöscht. Der Dienstausweis dieses Geräts beginnt beim nächsten Besuch ein neues, ' +
  'leeres Konto.';

/**
 * The account in the settings at the step `step` of its deletion: what it holds and „Konto
 * löschen" — a press asks first, saying what it deletes, „Endgültig löschen" sends it off
 * (`onDelete`), „Abbrechen" steps back — and, once it is gone, that it is. Nothing where there
 * is no account, nor was one deleted here.
 */
export function AccountSection(props: {
  account: AccountView | null;
  step: DeleteStep;
  onStep: (step: DeleteStep) => void;
  onDelete: () => void;
}) {
  const { account, step, onStep, onDelete } = props;
  if (account === null) {
    return step !== 'sent' ? null : (
      <fieldset className="settings-group settings-account">
        <legend>Konto</legend>
        <p className="settings-note" role="status">
          {ACCOUNT_DELETED}
        </p>
      </fieldset>
    );
  }
  const send = (): void => {
    onStep('sent');
    onDelete();
  };
  return (
    <fieldset className="settings-group settings-account">
      <legend>Konto</legend>
      <p className="settings-account-facts">{accountFacts(account)}</p>
      {step === 'idle' ? (
        <button
          type="button"
          className="danger settings-account-delete"
          onClick={() => onStep('asked')}
        >
          Konto löschen
        </button>
      ) : (
        <div className="settings-account-ask">
          <p className="settings-note">{deleteLine(account)}</p>
          <div className="settings-account-actions">
            <button type="button" className="danger" disabled={step === 'sent'} onClick={send}>
              Endgültig löschen
            </button>
            <button type="button" className="settings-rebind" onClick={() => onStep('idle')}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}

interface PanelProps {
  onClose: () => void;
  /** the pass's account as the server told it; without, the panel shows none */
  account?: AccountView | null;
  /** asks the server to delete the account (`delete-account`) */
  onDeleteAccount?: () => void;
}

/**
 * The settings over whatever screen is up — a run goes on under them: the three volumes, the
 * keys and the controller (ControlSettings.tsx), the text size and less motion, each kept on
 * this device as it is set (settings.ts), and the pass's account, which can be deleted here
 * (`AccountSection`). The top bar's sound switch stays the quick way to silence everything; a
 * controller's Start opens them.
 */
export function SettingsPanel({ onClose, account = null, onDeleteAccount }: PanelProps) {
  const [step, setStep] = useState<DeleteStep>('idle');
  // What deleting the account takes stands at the card's foot: it comes into sight as it is asked.
  useEffect(() => {
    if (step === 'asked') {
      document.querySelector('.settings-account-ask')?.scrollIntoView({ block: 'nearest' });
    }
  }, [step]);
  const settings = useSettings();
  const closeKey = useGlyph('close');
  useEscapeCloses(onClose);
  // A volume set ticks through the bus it sets, at its new level (world/audio.ts `volumeTick`).
  const setVolume = (part: keyof Volumes, value: number): void => {
    changeSettings({ volumes: { ...settings.volumes, [part]: value } });
    volumeTick(part);
  };
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
        {onDeleteAccount !== undefined && (
          <AccountSection
            account={account}
            step={step}
            onStep={setStep}
            onDelete={onDeleteAccount}
          />
        )}
      </div>
    </div>
  );
}
