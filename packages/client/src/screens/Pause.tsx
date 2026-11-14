import { useEffect, useRef, useState } from 'react';
import type { AwayView, ClientMessage, PlayerView, TakeoverView } from '@escapelab/core';
import { useServerNow } from '../hooks.js';
import { Icon } from './Icon.js';

/**
 * The run standing still for crew members away, as everybody still on the line sees it, and
 * their return. Whom it waits for and for how long, counted on the server's clock; once the
 * wait for a drop is over (core FIRST_WAIT_MS, LATER_WAIT_MS) the way on without them — or,
 * with one alone still on the line, the way to call the run off. Somebody the run went on
 * without who is back is said for a moment („Ben ist zurück"). A new device asking for the
 * seat of somebody away is let in, or not, by whoever on the line answers first — on the pause
 * card, or on a card of its own while the run goes on without them.
 */

/**
 * How far past a wait's end the card offers the way on, ms: the page's reading of the
 * server's clock may lie a little ahead of it.
 */
export const CLOCK_MARGIN_MS = 400;

/** How long a return stands on the screen, ms. */
export const BACK_MS = 3500;

/** `ms` as the pause's counter reads it, m:ss, in whole seconds down. */
export function pauseClock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** What the pause card offers the crew on the line: a way on, or when it comes, on the counter. */
export type PauseWay =
  | { kind: 'go-on'; id: string; name: string }
  | { kind: 'go-on-at'; name: string; at: string }
  | { kind: 'call-off' }
  | { kind: 'call-off-at'; at: string };

/**
 * What the pause card offers at server time `now`: for each crew member it waits for, the way
 * on without them once the wait for their drop is over, before that the moment on the
 * counter it will be; with one alone on the line, instead, the way to call the run off once
 * the first of those waits is over.
 */
export function pauseWays(
  view: Pick<PlayerView, 'pausedFor' | 'pausedAt' | 'players'>,
  now: number,
): PauseWay[] {
  const away = view.pausedFor ?? [];
  if (away.length === 0) {
    return [];
  }
  const since = view.pausedAt ?? now;
  const over = (at: number): boolean => now >= at + CLOCK_MARGIN_MS;
  if (view.players.filter((player) => player.connected).length < 2) {
    const first = Math.min(...away.map((member) => member.waivableAt));
    return [
      over(first) ? { kind: 'call-off' } : { kind: 'call-off-at', at: pauseClock(first - since) },
    ];
  }
  return away.map((member) =>
    over(member.waivableAt)
      ? { kind: 'go-on', id: member.id, name: member.name }
      : { kind: 'go-on-at', name: member.name, at: pauseClock(member.waivableAt - since) },
  );
}

/** One way the card offers: a button to press, or a line saying when it comes. */
function Way({ way, send }: { way: PauseWay; send: (msg: ClientMessage) => void }) {
  switch (way.kind) {
    case 'go-on':
      return (
        <button
          className="primary pause-go-on"
          onClick={() => send({ kind: 'continue-without', absentId: way.id })}
        >
          Ohne {way.name} weiter
        </button>
      );
    case 'go-on-at':
      return (
        <p className="muted pause-when">
          Ab {way.at} lässt sich ohne {way.name} weitermachen.
        </p>
      );
    case 'call-off':
      return (
        <button className="danger pause-call-off" onClick={() => send({ kind: 'call-off' })}>
          Einsatz abbrechen
        </button>
      );
    case 'call-off-at':
      return <p className="muted pause-when">Ab {way.at} lässt sich der Einsatz abbrechen.</p>;
  }
}

/** The asks of new devices for seats of the crew, each with its way in and its way out. */
function TakeoverAsks({
  asks,
  now,
  send,
}: {
  asks: readonly TakeoverView[];
  now: number;
  send: (msg: ClientMessage) => void;
}) {
  const answer = (seat: string, allow: boolean): void =>
    send({ kind: 'takeover-answer', seat, allow });
  return (
    <div className="takeover-asks">
      {asks.map((ask) => (
        <div className="takeover-ask" key={ask.id}>
          <p>
            {ask.name} meldet sich von einem anderen Gerät ·{' '}
            <span className="pause-count">{pauseClock(ask.until - now)}</span>
          </p>
          <div className="pause-ways">
            <button className="primary takeover-allow" onClick={() => answer(ask.id, true)}>
              Zulassen
            </button>
            <button className="takeover-deny" onClick={() => answer(ask.id, false)}>
              Ablehnen
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A new device asks for the seat of somebody the run went on without: the run goes on, and
 * the ask stands at the top of the world, out of the way of the bar.
 */
export function TakeoverCard({
  asks,
  send,
}: {
  asks: readonly TakeoverView[];
  send: (msg: ClientMessage) => void;
}) {
  const now = useServerNow(250);
  return (
    <div className="takeover-card" role="alertdialog">
      <TakeoverAsks asks={asks} now={now} send={send} />
    </div>
  );
}

/**
 * Who of those the run waits for went to the main menu on purpose, their seat kept: „Ben ist ins
 * Hauptmenü gegangen.", „Ben und Cem sind ins Hauptmenü gegangen."; '' for none of them.
 */
export function wentToMenu(away: readonly Pick<AwayView, 'name' | 'menu'>[]): string {
  const names = away.filter((member) => member.menu === true).map((member) => member.name);
  if (names.length < 2) {
    return names.length === 0 ? '' : `${names.join('')} ist ins Hauptmenü gegangen.`;
  }
  return `${names.slice(0, -1).join(', ')} und ${names.at(-1) ?? ''} sind ins Hauptmenü gegangen.`;
}

/**
 * The run standing still for crew members away, over the world of everybody on the line — whom
 * it waits for, and who of them went to the main menu.
 */
export function PauseCard({
  view,
  send,
}: {
  view: PlayerView;
  send: (msg: ClientMessage) => void;
}) {
  const now = useServerNow(250);
  const away = view.pausedFor ?? [];
  const since = view.pausedAt ?? now;
  return (
    <div className="overlay pause" role="status">
      <span className="kicker">{view.maintenance === true ? 'WARTUNG' : 'MISSION PAUSIERT'}</span>
      <h1>
        <Icon name="pause" /> Warten auf {away.map((member) => member.name).join(', ')} ·{' '}
        <span className="pause-count">{pauseClock(now - since)}</span>
      </h1>
      <MenuGone away={away} />
      <p>Uhr, Patrouillen und Notfälle stehen still.</p>
      <div className="pause-ways">
        {pauseWays(view, now).map((way) => (
          <Way key={`${way.kind}-${'name' in way ? way.name : ''}`} way={way} send={send} />
        ))}
      </div>
      {view.takeovers !== undefined && (
        <TakeoverAsks asks={view.takeovers} now={now} send={send} />
      )}
    </div>
  );
}

/** The pause card's line of who went to the main menu (`wentToMenu`); nothing for none. */
function MenuGone({ away }: { away: readonly AwayView[] }) {
  const said = wentToMenu(away);
  return said === '' ? null : <p className="pause-gone">{said}</p>;
}

/** A member of the crew as a view lists them, as far as their return needs. */
type Mate = Pick<PlayerView['players'][number], 'id' | 'name' | 'connected' | 'waived'>;

/** The names of the crew back on the line between two views whom the run had gone on without. */
export function returnsOf(before: readonly Mate[], after: readonly Mate[]): string[] {
  const waived = new Set(before.filter((mate) => mate.waived === true).map((mate) => mate.id));
  return after.filter((mate) => mate.connected && waived.has(mate.id)).map((mate) => mate.name);
}

/** How a return is said: „Ben ist zurück", „Ben und Cem sind zurück". */
export function backLine(names: readonly string[]): string {
  if (names.length < 2) {
    return `${names.join('')} ist zurück`;
  }
  return `${names.slice(0, -1).join(', ')} und ${names.at(-1) ?? ''} sind zurück`;
}

/** Somebody the run went on without is back: said over the world for BACK_MS. */
export function BackToast({ players }: { players: PlayerView['players'] }) {
  const before = useRef(players);
  const [shown, setShown] = useState<{ names: string[]; seq: number } | null>(null);
  useEffect(() => {
    const back = returnsOf(before.current, players);
    before.current = players;
    if (back.length > 0) {
      setShown((last) => ({ names: back, seq: (last?.seq ?? 0) + 1 }));
    }
  }, [players]);
  useEffect(() => {
    if (shown === null) {
      return undefined;
    }
    const timer = setTimeout(() => setShown(null), BACK_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return shown === null ? null : (
    <div key={shown.seq} className="crew-back" role="status">
      {backLine(shown.names)}
    </div>
  );
}
