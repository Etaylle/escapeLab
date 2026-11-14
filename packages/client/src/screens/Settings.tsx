import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { AccountView } from '@escapelab/core';
import { bindVerdict, DEFAULT_KEYS, DEFAULT_PAD, type KeyBindings } from '../input/bindings.js';
import { useGlyph } from '../input/glyphs.js';
import { dateText } from '../runStats.js';
import {
  changeSettings,
  DEFAULT_SETTINGS,
  getSettings,
  isRebinding,
  useSettings,
  type Bus,
  type LightWay,
  type Motion,
  type Settings,
  type SubtitleSize,
  type TextSize,
} from '../settings.js';
import { isMuted, setMuted, subscribeMuted, volumeTick } from '../world/audio.js';
import { stopPreview } from '../world/musicPreview.js';
import type { LoginAsk, LoginNews, Refusal } from '../ws.js';
import { ControlSettings, KeyTable } from './ControlSettings.js';
import { Icon } from './Icon.js';
import { LoginSection } from './LoginSection.js';
import { MusicSettings } from './MusicSettings.js';
import { ProfileFields } from './ProfileFields.js';
import { runsText } from './ProfileChip.js';
import { Choice, Slider } from './SettingsParts.js';

/**
 * The settings over whatever screen is up — a run goes on under them — in tabs, as Deep Rock
 * Galactic's and Helldivers 2's stand: „Ton" (the whole lab's volume and each bus's, a mute
 * each, the talk key, the music — its pack, a piece for each place, their Nennungen:
 * MusicSettings.tsx), „Bild" (the text size, less motion, the light, the full screen),
 * „Steuerung" (the keys, the controller, its symbols, the stick's dead zone), „Zugang" (the
 * crew's colour patterns, the spoken lines' size) and, with the pass's account, „Konto" (the
 * profile's name and colour, the account's Ausweis — its Kennwort, signing in and out — and
 * „Konto löschen"). Every change takes at once and is
 * kept on this device (settings.ts); a volume ticks through its bus as it is set, so that the
 * ear hears where it stands. Each tab but „Konto" has its „Zurücksetzen". The arrows step along
 * the tab bar, a controller's D-pad and A move through it and the controls as through every
 * dialog (input/focus.ts); the tab bar stays put while a tab's controls scroll under it.
 */

/** The settings' tabs. */
export type SettingsTab = 'ton' | 'bild' | 'steuerung' | 'zugang' | 'konto';

/** What each tab says. */
export const TAB_NAMES: Readonly<Record<SettingsTab, string>> = {
  ton: 'Ton',
  bild: 'Bild',
  steuerung: 'Steuerung',
  zugang: 'Zugang',
  konto: 'Konto',
};

/** The panel's tabs in order: „Konto" where the panel has the pass's account to show. */
export function tabsOf(account: boolean): SettingsTab[] {
  return ['ton', 'bild', 'steuerung', 'zugang', ...(account ? (['konto'] as const) : [])];
}

/** The buses of „Ton", as the panel names them. */
const BUSES: readonly (readonly [Bus, string])[] = [
  ['master', 'Gesamt'],
  ['music', 'Musik'],
  ['effects', 'Effekte'],
  ['voice', 'Funk'],
  ['ambience', 'Umgebung'],
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

const LIGHTS: readonly (readonly [LightWay, string])[] = [
  ['auto', 'Automatisch'],
  ['canvas', 'Einfach'],
];

const SUBTITLE_SIZES: readonly (readonly [SubtitleSize, string])[] = [
  ['normal', 'Normal'],
  ['large', 'Groß'],
  ['larger', 'Sehr groß'],
];

/** An on and an off, as „Zugang" and „Bild" offer them. */
const SWITCH: readonly (readonly ['off' | 'on', string])[] = [
  ['off', 'Aus'],
  ['on', 'An'],
];

/** `on` as a switch's option. */
const onOff = (on: boolean): 'off' | 'on' => (on ? 'on' : 'off');

/**
 * The talk key back to V where no other action holds V meanwhile; else the one it has — two
 * actions on one key would put every key back (input/bindings.ts `readKeys`).
 */
function talkBack(keys: KeyBindings): KeyBindings {
  const v = DEFAULT_KEYS.talk;
  return bindVerdict(keys, 'talk', v).ok ? { ...keys, talk: v } : keys;
}

/**
 * What a tab's „Zurücksetzen" puts back, from the settings as they stand (`now`): „Ton" every
 * volume, every mute, the talk key and the music — its pack, the pieces picked cleared; „Bild" the
 * text, the motion and the light; „Steuerung" the keys, the controller, its symbols and the dead
 * zone; „Zugang" the patterns and the spoken lines' size. „Konto" holds no setting.
 */
export function resetOf(tab: SettingsTab, now: Settings): Partial<Settings> {
  const d = DEFAULT_SETTINGS;
  const parts: Record<SettingsTab, Partial<Settings>> = {
    ton: { volumes: d.volumes, muted: d.muted, keys: talkBack(now.keys), music: d.music },
    bild: { textSize: d.textSize, motion: d.motion, light: d.light },
    steuerung: { keys: DEFAULT_KEYS, pad: DEFAULT_PAD, glyphs: d.glyphs, deadzone: d.deadzone },
    zugang: { patterns: d.patterns, subtitles: d.subtitles },
    konto: {},
  };
  return parts[tab];
}

/** A tab's „Zurücksetzen": its settings back (`resetOf`), and with „Ton" the sound switch on. */
export function resetTab(tab: SettingsTab): void {
  changeSettings(resetOf(tab, getSettings()));
  if (tab === 'ton') {
    setMuted(false);
  }
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
    const onKey = (e: globalThis.KeyboardEvent): void => {
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
 * Where an arrow key, Home or End on the tab bar goes from tab `at` of `count`: the next or the
 * one before, round at the ends, or an end; null for any other key.
 */
export function tabStep(at: number, key: string, count: number): number | null {
  const steps: Record<string, number> = {
    ArrowRight: (at + 1) % count,
    ArrowLeft: (at - 1 + count) % count,
    Home: 0,
    End: count - 1,
  };
  return steps[key] ?? null;
}

/**
 * The tab bar: a tab a press, or the arrows, Home and End stepping along it, the tab the focus
 * comes to — by the keys, a controller's D-pad — opening as it does.
 */
function TabBar(props: {
  tabs: readonly SettingsTab[];
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
}) {
  const { tabs, tab, onTab } = props;
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const next = tabStep(tabs.indexOf(tab), e.key, tabs.length);
    const id = next === null ? undefined : tabs[next];
    if (id === undefined) {
      return;
    }
    e.preventDefault();
    onTab(id);
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus();
  };
  return (
    <div className="settings-tabs" role="tablist" aria-label="Bereiche" onKeyDown={onKey}>
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`settings-tab-${id}`}
          data-tab={id}
          aria-selected={id === tab}
          aria-controls="settings-panel"
          tabIndex={id === tab ? 0 : -1}
          className={id === tab ? 'settings-tab settings-tab--on' : 'settings-tab'}
          onClick={() => onTab(id)}
          onFocus={() => onTab(id)}
        >
          {TAB_NAMES[id]}
        </button>
      ))}
    </div>
  );
}

/** The sound switch's mute, the whole lab's (world/audio.ts), kept up to date. */
function useSoundOff(): boolean {
  return useSyncExternalStore(subscribeMuted, isMuted, isMuted);
}

/** Whether `bus` stands muted: the whole lab by the sound switch (`off`), a bus by the settings. */
const mutedOf = (bus: Bus, settings: Settings, off: boolean): boolean =>
  bus === 'master' ? off : settings.muted[bus];

/** `bus` muted or heard again (`mute`): the whole lab by the sound switch, a bus in settings. */
function muteBus(bus: Bus, mute: boolean): void {
  if (bus === 'master') {
    setMuted(mute);
    return;
  }
  changeSettings({ muted: { ...getSettings().muted, [bus]: mute } });
}

/**
 * A bus's volume and its mute: the slider ticks through the bus as it is set, at its new level
 * (world/audio.ts `volumeTick`), and so does the bus heard again.
 */
function BusRow({ bus, label, muted }: { bus: Bus; label: string; muted: boolean }) {
  const { volumes } = useSettings();
  const value = volumes[bus];
  return (
    <div className={muted ? 'settings-bus settings-bus--muted' : 'settings-bus'}>
      <Slider
        label={label}
        value={value}
        min={0}
        max={100}
        step={5}
        valueText={muted ? `${value} %, stumm` : `${value} %`}
        onChange={(next) => {
          changeSettings({ volumes: { ...getSettings().volumes, [bus]: next } });
          volumeTick(bus);
        }}
      />
      <button
        type="button"
        className="settings-mute"
        aria-pressed={muted}
        aria-label={`${label} stumm`}
        title={muted ? `${label}: stumm` : `${label}: hörbar`}
        onClick={() => {
          muteBus(bus, !muted);
          volumeTick(bus);
        }}
      >
        <Icon name={muted ? 'speaker-off' : 'speaker'} />
      </button>
    </div>
  );
}

/** „Ton": the whole lab's volume and each bus's, a mute each, the talk key, and the music. */
function SoundTab() {
  const settings = useSettings();
  const off = useSoundOff();
  return (
    <>
      <fieldset className="settings-group">
        <legend>Lautstärke</legend>
        {BUSES.map(([bus, label]) => (
          <BusRow key={bus} bus={bus} label={label} muted={mutedOf(bus, settings, off)} />
        ))}
        <p className="settings-note">
          Gesamt schaltet wie der Lautsprecher oben; Stimmen über das Mikrofon bleiben hörbar.
        </p>
      </fieldset>
      <KeyTable keys={settings.keys} actions={['talk']} legend="Sprechtaste" note={false} />
      <MusicSettings />
    </>
  );
}

/** Whether the page fills the screen now, kept up to date; false where there is no document. */
function useFullscreen(): boolean {
  const [on, setOn] = useState(() => fullscreenNow());
  useEffect(() => {
    const follow = (): void => setOn(fullscreenNow());
    document.addEventListener('fullscreenchange', follow);
    return () => document.removeEventListener('fullscreenchange', follow);
  }, []);
  return on;
}

/** Whether anything fills the screen; nothing where there is no document, or no API. */
function fullscreenNow(): boolean {
  return typeof document !== 'undefined' && (document.fullscreenElement ?? null) !== null;
}

/** The page to the full screen, or back, inside the press as browsers ask; a refusal is quiet. */
function setFullscreen(on: boolean): void {
  const asked = on
    ? document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    : document.exitFullscreen();
  asked.catch(() => undefined);
}

/** „Bild": the text's size, less motion, the light's way, the full screen. */
function PictureTab() {
  const settings = useSettings();
  const full = useFullscreen();
  const canFill = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  return (
    <>
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
      <Choice
        legend="Licht"
        options={LIGHTS}
        value={settings.light}
        onChange={(light) => changeSettings({ light })}
      />
      <p className="settings-note">Einfach zeichnet das Licht der Welt ohne WebGL.</p>
      <Choice
        legend="Vollbild"
        options={SWITCH}
        value={onOff(full)}
        disabled={!canFill}
        onChange={(next) => setFullscreen(next === 'on')}
      />
    </>
  );
}

/** „Zugang": the crew's colours with a pattern each, and the spoken lines' size. */
function AccessTab() {
  const settings = useSettings();
  return (
    <>
      <Choice
        legend="Farbmuster"
        options={SWITCH}
        value={onOff(settings.patterns)}
        onChange={(next) => changeSettings({ patterns: next === 'on' })}
      />
      <p className="settings-note">
        Die Punkte neben den Namen tragen je Farbe ein Zeichen. Die Signalkette zeigt ihre Muster
        immer, die Kabel ihre Namen.
      </p>
      <Choice
        legend="Untertitel"
        options={SUBTITLE_SIZES}
        value={settings.subtitles}
        onChange={(subtitles) => changeSettings({ subtitles })}
      />
      <p className="settings-note">
        Die Zeilen von Funk und Durchsagen; auf dem Handy behalten sie ihre Größe.
      </p>
    </>
  );
}

/** Where „Konto löschen" stands: not asked yet, asked — what it deletes said — or sent off. */
export type DeleteStep = 'idle' | 'asked' | 'sent';

/**
 * Where the deletion stands now: at the step the panel took, unless the server refused the
 * deletion sent off since (`sentAfter`, the count of its refusals as it was sent): then back at
 * the ask, its „Endgültig löschen" open again, the refusal said there.
 */
export function deletionNow(
  taken: DeleteStep,
  sentAfter: number,
  refusal: Refusal | null,
): { step: DeleteStep; refused: string | null } {
  const since = refusal !== null && refusal.of === 'delete-account' && refusal.seq > sentAfter;
  return taken === 'sent' && since
    ? { step: 'asked', refused: refusal.message }
    : { step: taken, refused: null };
}

/** What the account holds, on one line: its name, since when it is kept, its runs. */
export function accountFacts(account: AccountView): string {
  const name = account.name === '' ? 'Ohne Namen' : account.name;
  return `${name} · seit ${dateText(account.since)} · ${runsText(account.runs)}`;
}

/** What deleting the account leaves on this device, whatever the server keeps. */
const PASS_STAYS = 'Der Dienstausweis dieses Geräts bleibt.';

/** What deleting an account with a Kennwort takes besides: its Ausweisnummer opens it no more. */
const NUMBER_GOES = (login: string): string =>
  `Die Ausweisnummer ${login} öffnet danach nichts mehr, auf keinem Gerät.`;

/**
 * What deleting the account deletes, and what it leaves, said before it is done: where the
 * server keeps a run log (`AccountStore`), the log keeps the name, and so does the Bestenliste
 * once the server starts anew; an account with a Kennwort loses its Ausweisnummer with it.
 */
export function deleteLine(account: Pick<AccountView, 'runs' | 'store' | 'login'>): string {
  const goes = account.login === null ? '' : ` ${NUMBER_GOES(account.login)}`;
  return `${deletesWhat(account)}${goes} ${PASS_STAYS}`;
}

/** What deleting the account takes off it and its runs (`deleteLine`): by runs and store. */
function deletesWhat({ runs, store }: Pick<AccountView, 'runs' | 'store'>): string {
  if (runs === 0) {
    return 'Löscht Name, Farbe und Erfolge des Kontos.';
  }
  if (store === 'run-log') {
    return (
      'Löscht Name, Farbe und Erfolge des Kontos und nimmt den Namen aus der Bestenliste dieses ' +
      'Servers. Sein Laufprotokoll behält ihn und führt ihn nach einem Neustart wieder auf.'
    );
  }
  const where = runs === 1 ? 'seinem Einsatz' : `seinen ${runs} Einsätzen`;
  return (
    `Löscht Name, Farbe und Erfolge des Kontos und nimmt den Namen aus ${where}; die ` +
    'Einsätze bleiben in der Bestenliste.'
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
  /** why the server refused the deletion sent off last (`deletionNow`); null for nothing */
  refused?: string | null;
  onStep: (step: DeleteStep) => void;
  onDelete: () => void;
}) {
  const { account, step, refused = null, onStep, onDelete } = props;
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
          {refused !== null && (
            <p className="settings-note settings-account-refused" role="alert">
              {refused}
            </p>
          )}
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
  /** the account takes the name typed in „Konto" (`profile`) */
  onName?: (name: string) => void;
  /** the server's latest refusal on the line (ws.ts `Connection.refusal`) */
  refusal?: Refusal | null;
  /** the server's latest answer to an ask of a login (ws.ts `Connection.login`) */
  login?: LoginNews | null;
  /** asks something of a login (ws.ts `Connection.askLogin`); without, „Konto" shows no Ausweis */
  askLogin?: (ask: LoginAsk) => void;
  /** the tab the panel opens on; the last one opened on this page by default */
  tab?: SettingsTab;
}

/**
 * „Konto": the profile's name, which the account takes once it stands still, and its colour,
 * the account's Ausweis (LoginSection.tsx), what the account holds and „Konto löschen"
 * (`AccountSection`).
 */
function AccountTab(props: Required<Pick<PanelProps, 'onDeleteAccount'>> & PanelProps) {
  const { account = null, onDeleteAccount, refusal = null, askLogin } = props;
  const [taken, setTaken] = useState<DeleteStep>('idle');
  const [sentAfter, setSentAfter] = useState(0);
  const { step, refused } = deletionNow(taken, sentAfter, refusal);
  const takeStep = (next: DeleteStep): void => {
    if (next === 'sent') {
      setSentAfter(refusal?.seq ?? 0);
    }
    setTaken(next);
  };
  // What deleting the account takes stands at the tab's foot: it comes into sight as it is asked.
  useEffect(() => {
    if (step === 'asked') {
      document.querySelector('.settings-account-ask')?.scrollIntoView({ block: 'nearest' });
    }
  }, [step]);
  return (
    <>
      <ProfileFields account={account} onName={props.onName ?? (() => undefined)} />
      {askLogin !== undefined && (
        <LoginSection
          account={account}
          news={props.login ?? null}
          refusal={refusal}
          ask={askLogin}
        />
      )}
      <AccountSection
        account={account}
        step={step}
        refused={refused}
        onStep={takeStep}
        onDelete={onDeleteAccount}
      />
    </>
  );
}

/** The tab the panel opened last on this page: it opens on it again. */
let lastTab: SettingsTab = 'ton';

/** What tab `tab` holds. */
function TabBody({ tab, panel }: { tab: SettingsTab; panel: PanelProps }): ReactNode {
  const { onDeleteAccount } = panel;
  const bodies: Record<SettingsTab, () => ReactNode> = {
    ton: () => <SoundTab />,
    bild: () => <PictureTab />,
    steuerung: () => <ControlSettings />,
    zugang: () => <AccessTab />,
    konto: () =>
      onDeleteAccount === undefined ? null : (
        <AccountTab {...panel} onDeleteAccount={onDeleteAccount} />
      ),
  };
  return bodies[tab]();
}

/**
 * The settings in tabs over whatever screen is up (see the module's comment): the head with its
 * way out, the tab bar, the tab's controls — scrolling where they run long, under a tab bar that
 * stays — and the tab's „Zurücksetzen".
 */
export function SettingsPanel(props: PanelProps) {
  const onClose = (): void => {
    stopPreview();
    props.onClose();
  };
  // A piece played for the ear stops with the panel, however it goes (musicPreview.ts).
  useEffect(() => stopPreview, []);
  const tabs = tabsOf(props.onDeleteAccount !== undefined);
  const [tab, setTab] = useState<SettingsTab>(() => {
    const wanted = props.tab ?? lastTab;
    return tabs.includes(wanted) ? wanted : 'ton';
  });
  const closeKey = useGlyph('close');
  useEscapeCloses(onClose);
  const choose = (next: SettingsTab): void => {
    lastTab = next;
    setTab(next);
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
        <div className="settings-head">
          <h2 className="settings-title">Einstellungen</h2>
          <button className="link" onClick={onClose}>
            Schließen [{closeKey}]
          </button>
        </div>
        <TabBar tabs={tabs} tab={tab} onTab={choose} />
        <div
          className="settings-body"
          role="tabpanel"
          id="settings-panel"
          aria-labelledby={`settings-tab-${tab}`}
        >
          <TabBody tab={tab} panel={props} />
        </div>
        {tab !== 'konto' && (
          <div className="settings-foot">
            <button type="button" className="settings-reset" onClick={() => resetTab(tab)}>
              Zurücksetzen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
