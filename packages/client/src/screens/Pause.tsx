import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AwayView, ClientMessage, PlayerView, TakeoverView } from '@escapelab/core';
import { useServerNow } from '../hooks.js';
import { Icon } from './Icon.js';

/**
 * The crew members away from a run, as everybody still on the line sees them, and their return.
 * The run goes on without stopping for anybody: once the wait for a drop is over (core
 * FIRST_WAIT_MS, LATER_WAIT_MS) the crew strip offers the way on without them — or, with one
 * alone still on the line, the way to call the run off (`AwayOffer`). Only the server's
 * maintenance stands a run still: its card over the world says whom it waits for — whoever's
 * line went down with the server — and for how long, counted on the server's clock, with the
 * same ways for them and when they come (`PauseCard`).
 * Somebody the run went on without who is back is said for a moment („Ben ist zurück"). A new
 * device asking for the seat of somebody away is let in, or not, by whoever on the line answers
 * first — on the maintenance card, or on a card of its own at the top while the run goes on.
 */

/**
 * How far past a wait's end the way on is offered, ms: the page's reading of the server's
 * clock may lie a little ahead of it.
 */
export const CLOCK_MARGIN_MS = 400;

/** How long a return stands on the screen, ms. */
export const BACK_MS = 3500;

/** `ms` as a counter of time away reads it, m:ss, in whole seconds down. */
export function pauseClock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** What the crew on the line is offered for those away: a way on, or when it comes. */
export type AwayWay =
  | { kind: 'go-on'; id: string; name: string }
  | { kind: 'go-on-at'; name: string; at: string }
  | { kind: 'call-off' }
  | { kind: 'call-off-at'; at: string };

/**
 * Whom the crew misses, as the view lists them: everybody away it has not gone on without —
 * while the run stands still for the server's maintenance, only those whose line went down with
 * the server, whom it waits for (core `missing`); whoever was away before stays away as before.
 */
export function missedOf(view: Pick<PlayerView, 'away' | 'pausedAt'>): AwayView[] {
  const standing = view.pausedAt !== null;
  return view.away.filter(
    (member) => member.waived !== true && (!standing || member.maintenance === true),
  );
}

/**
 * What the crew on the line is offered at server time `now`: for each crew member it misses
 * (`missedOf`) the way on without them once the wait for their drop is over, before that the
 * moment it will be on the maintenance card's counter; with one alone on the line, instead, the
 * way to call the run off once the first of those waits is over.
 */
export function awayWays(
  view: Pick<PlayerView, 'away' | 'pausedAt' | 'players'>,
  now: number,
): AwayWay[] {
  const missed = missedOf(view);
  if (missed.length === 0) {
    return [];
  }
  const since = view.pausedAt ?? now;
  const over = (at: number): boolean => now >= at + CLOCK_MARGIN_MS;
  if (view.players.filter((player) => player.connected).length < 2) {
    const first = Math.min(...missed.map((member) => member.waivableAt));
    return [
      over(first) ? { kind: 'call-off' } : { kind: 'call-off-at', at: pauseClock(first - since) },
    ];
  }
  return missed.map((member) =>
    over(member.waivableAt)
      ? { kind: 'go-on', id: member.id, name: member.name }
      : { kind: 'go-on-at', name: member.name, at: pauseClock(member.waivableAt - since) },
  );
}

/** Whether `way` can be taken now: a button, not a line saying when it comes. */
function offered(way: AwayWay): boolean {
  return way.kind === 'go-on' || way.kind === 'call-off';
}

/** One way on offer: a button to press, or a line saying when it comes. */
function Way({ way, send }: { way: AwayWay; send: (msg: ClientMessage) => void }) {
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
 * A new device asks for the seat of somebody away while the run goes on: the ask stands at the
 * top of the world, out of the way of the bar.
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
 * The run standing still for the server's maintenance — a deploy, a restart — over the world of
 * everybody back on the line: whom it waits for (`missedOf`), with the ways on once they come.
 * A line that drops stands nothing still, and has no card.
 */
export function PauseCard({
  view,
  send,
}: {
  view: PlayerView;
  send: (msg: ClientMessage) => void;
}) {
  const now = useServerNow(250);
  const missed = missedOf(view);
  const since = view.pausedAt ?? now;
  return (
    <div className="overlay pause" role="status">
      <span className="kicker">WARTUNG</span>
      <h1>
        <Icon name="pause" /> Warten auf {missed.map((member) => member.name).join(', ')} ·{' '}
        <span className="pause-count">{pauseClock(now - since)}</span>
      </h1>
      <p>Uhr, Patrouillen und Notfälle stehen still.</p>
      <div className="pause-ways">
        {awayWays(view, now).map((way) => (
          <Way key={`${way.kind}-${'name' in way ? way.name : ''}`} way={way} send={send} />
        ))}
      </div>
      {view.takeovers !== undefined && (
        <TakeoverAsks asks={view.takeovers} now={now} send={send} />
      )}
    </div>
  );
}

/**
 * The ways on the bar over the world offers while the run goes on without somebody away: „Ohne
 * Ben weiter" once the wait for their drop is over, „Einsatz abbrechen" for one alone on the
 * line; nothing before that — the crew strip counts their time away — and nothing while the run
 * stands still for the server's maintenance, whose card offers them (`PauseCard`). Kept out of
 * the bar while nobody is missed, so that its clock asks nothing then (`offerFor`).
 */
export function AwayOffer({
  view,
  send,
}: {
  view: Pick<PlayerView, 'away' | 'pausedAt' | 'players'>;
  send: (msg: ClientMessage) => void;
}) {
  const now = useServerNow(250);
  const ways = view.pausedAt === null ? awayWays(view, now).filter(offered) : [];
  if (ways.length === 0) {
    return null;
  }
  return (
    <div className="away-offer">
      {ways.map((way) => (
        <Way key={`${way.kind}-${'name' in way ? way.name : ''}`} way={way} send={send} />
      ))}
    </div>
  );
}

/** Whether the crew misses somebody away it has not gone on without: the bar's offer stands. */
export function missesSomebody(view: Pick<PlayerView, 'away'>): boolean {
  return view.away.some((member) => member.waived !== true);
}

/**
 * The bar's offer of the ways on (`AwayOffer`) while the crew misses somebody — a run on, since
 * none is missed outside one; nothing otherwise, so that no clock ticks for it.
 */
export function offerFor(
  view: Pick<PlayerView, 'away' | 'pausedAt' | 'players'>,
  send: (msg: ClientMessage) => void,
): ReactNode {
  return missesSomebody(view) ? <AwayOffer view={view} send={send} /> : null;
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
