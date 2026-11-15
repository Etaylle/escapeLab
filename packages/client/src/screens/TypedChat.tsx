import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { TYPED_MAX, type ClientMessage } from '@escapelab/core';
import { loggedLines, onLog } from '../chatLog.js';
import { keysClaimed, typing } from '../hooks.js';
import { usePause } from '../menuLayer.js';
import { getSettings, isRebinding } from '../settings.js';

/**
 * A line typed to the crew: a field and, over it, the room's last lines (chatLog.ts), the quick
 * chat's among them. In the lobby both stand in the mission panel all along; in a run they open
 * over the world with the write key (T unless the settings bind another) or the ✎ button beside
 * the quick chat's, and close as the line goes out, with Esc, or once the field loses the focus.
 * The server tidies the line and refuses an empty one or one too long (core chat.ts
 * `typedLine`); it then shows as a phrase does, over the speaker and in the HUD's line. While
 * the field has the focus every key types there: the world, the run's keys and the talk key
 * leave a text field alone (GameWorld.tsx `worldHears`, hooks.ts `useKeys`, voice/useVoice.ts).
 */

type Send = (msg: ClientMessage) => void;

/** A crew member as the log names them. */
interface Member {
  id: string;
  name: string;
  color: string;
}

/** A key going down, as far as the write key cares. */
export type WriteKeyLike = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'repeat' | 'defaultPrevented'
>;

/**
 * Whether a key going down opens the field: the write key (`writeKey`, as the settings bind
 * it), plain and not on its auto-repeat, taken by nothing else, and not while the keys are
 * `busy` — a text field or a prompt holding them, the settings waiting for a key, a menu over
 * the screens.
 */
export function opensField(e: WriteKeyLike, writeKey: string, busy: boolean): boolean {
  const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && !e.defaultPrevented;
  return plain && !busy && e.key.toLowerCase() === writeKey;
}

/**
 * The write key calls `onOpen` while `listening`. The key is kept from the field it opens: the
 * letter never lands there.
 */
function useWriteKey(onOpen: () => void, listening: boolean): void {
  const covered = useRef(false);
  covered.current = usePause().open;
  const latest = useRef(onOpen);
  latest.current = onOpen;
  useEffect(() => {
    if (!listening) {
      return undefined;
    }
    const onKey = (e: KeyboardEvent): void => {
      const busy = typing() || keysClaimed() || isRebinding() || covered.current;
      if (opensField(e, getSettings().keys.write, busy)) {
        e.preventDefault();
        latest.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening]);
}

/**
 * Esc while `field` has the focus calls `onEscape` and goes no further — capturing, ahead of
 * the run's menu and the lobby's (Game.tsx `useEscape`, menuLayer.ts `escapeOpensMenu`).
 */
function useFieldEscape(field: RefObject<HTMLInputElement | null>, onEscape: () => void): void {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const focused = field.current !== null && document.activeElement === field.current;
      if (e.key === 'Escape' && focused) {
        e.preventDefault();
        e.stopPropagation();
        latest.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [field]);
}

/** The room's last lines, „Anna: Kabel 3", each name in its crew colour; newest at the foot. */
function ChatLines({ players }: { players: readonly Member[] }) {
  const lines = useSyncExternalStore(onLog, loggedLines, loggedLines);
  if (lines.length === 0) {
    return <p className="typed-chat-empty">Noch kein Wort gefallen.</p>;
  }
  return (
    <ol className="typed-chat-log" aria-label="Chat" aria-live="polite">
      {lines.map((line) => {
        const who = players.find((p) => p.id === line.playerId);
        return (
          <li key={line.n}>
            <span className="typed-chat-who" style={{ color: who?.color }}>
              {who?.name ?? '?'}
            </span>{' '}
            {line.text}
          </li>
        );
      })}
    </ol>
  );
}

interface FieldProps {
  send: Send;
  field: RefObject<HTMLInputElement | null>;
  /** the line went out, or nothing did (`sent` false) */
  onDone: (sent: boolean) => void;
  onEscape: () => void;
  /** the field lost the focus */
  onBlur?: () => void;
  autoFocus?: boolean;
}

/** The field and its button: Enter or „Senden" sends the line, the field empty after. */
function ChatField({ send, field, onDone, onEscape, onBlur, autoFocus = false }: FieldProps) {
  const [draft, setDraft] = useState('');
  useFieldEscape(field, onEscape);
  const submit = (): void => {
    const text = draft.trim();
    if (text !== '') {
      send({ kind: 'say', text });
    }
    setDraft('');
    onDone(text !== '');
  };
  return (
    <form
      className="typed-chat-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        ref={field}
        className="typed-chat-input"
        value={draft}
        maxLength={TYPED_MAX}
        placeholder="Nachricht an die Crew …"
        aria-label="Nachricht an die Crew"
        autoComplete="off"
        enterKeyHint="send"
        autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
      />
      {/* Pressed without taking the focus: the field in a run would close under the finger. */}
      <button type="submit" onPointerDown={(e) => e.preventDefault()}>
        Senden
      </button>
    </form>
  );
}

/**
 * The lobby's chat, a part of the mission panel: the log and the field, which the write key
 * puts the focus in and Esc takes it out of.
 */
export function LobbyChat({ players, send }: { players: readonly Member[]; send: Send }) {
  const field = useRef<HTMLInputElement>(null);
  useWriteKey(() => field.current?.focus(), true);
  return (
    <section className="typed-chat typed-chat--lobby" aria-label="Chat">
      <ChatLines players={players} />
      <ChatField
        send={send}
        field={field}
        onDone={() => undefined}
        onEscape={() => field.current?.blur()}
      />
    </section>
  );
}

interface WorldChatProps {
  players: readonly Member[];
  send: Send;
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** The run's chat over the world: shut until the write key or the ✎ button opens it. */
export function WorldChat({ players, send, open, setOpen }: WorldChatProps) {
  const field = useRef<HTMLInputElement>(null);
  useWriteKey(() => setOpen(true), !open);
  if (!open) {
    return null;
  }
  const close = (): void => setOpen(false);
  return (
    <div className="typed-chat typed-chat--world" role="dialog" aria-label="Chat">
      <ChatLines players={players} />
      <ChatField
        send={send}
        field={field}
        onDone={close}
        onEscape={close}
        onBlur={close}
        autoFocus
      />
    </div>
  );
}
