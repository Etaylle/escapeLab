import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, PlayerView } from '@escapelab/core';
import { clock } from '../src/clock.js';
import { PASS_KEY } from '../src/pass.js';
import { JoinScreen } from '../src/screens/Join.js';
import { PauseCard, TakeoverCard } from '../src/screens/Pause.js';
import { replyTo, takeIn } from '../src/ws.js';
import { page, storage } from './page.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const T0 = 1_700_000_000_000;

/** Ben's pass. */
const PASS = { id: 'b3'.repeat(16), secret: '7e'.repeat(32) };

/** Ben's seat, asked for by a new device until T0 + 30 s. */
const ASK = { id: 'p2', name: 'Ben', until: T0 + 30_000 };

const mate = (id: string, name: string, connected = true): PlayerView['players'][number] => ({
  id,
  name,
  color: '#2dd4bf',
  ready: false,
  connected,
  isHost: id === 'p1',
});

/** Anna's view of a run that stands still since T0 for Ben, whose seat a new device asks for. */
const waiting = {
  players: [mate('p1', 'Anna'), mate('p2', 'Ben', false), mate('p3', 'Cem')],
  pausedFor: [{ id: 'p2', name: 'Ben', since: T0, waivableAt: T0 + 60_000 }],
  pausedAt: T0,
  takeovers: [ASK],
} as unknown as PlayerView;

describe('the crew asked to let a new device in on a seat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks on the pause card whose seat, on the clock, and sends the answer at a press', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 5000);
    const html = renderToStaticMarkup(<PauseCard view={waiting} send={() => undefined} />);
    expect(html).toContain(
      'Ben meldet sich von einem anderen Gerät · <span class="pause-count">0:25</span>',
    );
    const sent: ClientMessage[] = [];
    const elements = elementsOf(() => <PauseCard view={waiting} send={(m) => sent.push(m)} />);
    press(buttonsOf(elements, 'takeover-allow')[0]);
    press(buttonsOf(elements, 'takeover-deny')[0]);
    expect(sent).toEqual([
      { kind: 'takeover-answer', seat: 'p2', allow: true },
      { kind: 'takeover-answer', seat: 'p2', allow: false },
    ]);
  });

  it('asks on a card of its own while the run goes on without the seat', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 5000);
    const html = renderToStaticMarkup(<TakeoverCard asks={[ASK]} send={() => undefined} />);
    expect(html).toContain('class="takeover-card"');
    expect(html).toContain('Zulassen');
    expect(html).toContain('Ablehnen');
  });
});

describe('a device that asks for a seat by its name', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', storage(new Map()));
    vi.stubGlobal('window', {
      localStorage: storage(new Map([[PASS_KEY, JSON.stringify({ ...PASS, name: 'Ben' })]])),
      location: { search: '' },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('waits for the crew, resumes the seat on its pass once let in, and forgets the ask', () => {
    const { kept, got } = page();
    takeIn({ kind: 'takeover-pending', code: 'QX7R', name: 'Ben', until: ASK.until }, kept);
    expect(got.takeover).toEqual({ code: 'QX7R', name: 'Ben', until: ASK.until });
    const allowed = { kind: 'takeover-allowed', code: 'QX7R' } as const;
    expect(replyTo(allowed)).toEqual({ kind: 'resume', code: 'QX7R', pass: PASS });
    takeIn(allowed, kept);
    expect(got.takeover).toBeNull();
    expect(replyTo({ kind: 'joined', code: 'QX7R' })).toBeNull();
  });

  it('forgets the ask once the crew turns it away', () => {
    const { kept, got } = page();
    takeIn({ kind: 'takeover-pending', code: 'QX7R', name: 'Ben', until: ASK.until }, kept);
    const message = 'Die Crew hat die Übernahme nicht bestätigt.';
    takeIn({ kind: 'error', message, of: 'join-room' }, kept);
    expect(got.takeover).toBeNull();
  });

  it('says on the join screen that it waits, on the clock, and no more once its time is up', () => {
    const join = (): string =>
      renderToStaticMarkup(
        <JoinScreen
          send={() => undefined}
          connected
          missions={[]}
          rooms={[]}
          takeover={{ code: 'QX7R', name: 'Ben', until: ASK.until }}
          stats={[]}
          picked={null}
          onPick={() => undefined}
          openHandbook={() => undefined}
          openHistory={() => undefined}
        />,
      );
    const now = vi.spyOn(clock, 'now').mockReturnValue(T0 + 2000);
    expect(join()).toContain(
      'Warten, bis die Crew die Übernahme von Ben bestätigt · ' +
        '<span class="pause-count">0:28</span>',
    );
    now.mockReturnValue(ASK.until + 1);
    expect(join()).not.toContain('Warten, bis die Crew');
  });
});
