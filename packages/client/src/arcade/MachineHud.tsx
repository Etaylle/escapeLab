import type { Game } from './rules.js';
import { current } from './rules.js';
import { chipsOf, type Banner, type Session } from './session.js';
import { CHIP_LABELS, DIFFICULTY_LABELS, TITLE, pad } from './texts.js';
import type { PickupKind } from './rules.js';

/**
 * The machine's frame and HUD: its name in the plant's look with the way back to the lab, the
 * score, the best, the wave and the lives, and the machine's Pause, Info and sound; over the
 * field the combo and the boosts running, and the banner of a new wave; under it, on a touch
 * screen, the buttons.
 */

/** The frame's head and the HUD around the field. */
export function Hud({ s, onLeave }: { s: Session; onLeave: () => void }) {
  const g = s.game;
  const p = g ? current(g) : null;
  const difficulty = g?.difficulty ?? s.choice.difficulty;
  return (
    <header className="arcade-hud">
      <div className="arcade-name">
        <span className="arcade-kicker">PAUSENRAUM · SPIELAUTOMAT</span>
        <h1>{TITLE}</h1>
      </div>
      <dl className="arcade-stats">
        <div>
          <dt>PUNKTE · S{g ? g.active + 1 : 1}</dt>
          <dd className="arcade-score">{pad(p?.score ?? 0, 5)}</dd>
        </div>
        <div>
          <dt>
            REKORD <small>{DIFFICULTY_LABELS[difficulty].toUpperCase()}</small>
          </dt>
          <dd>{pad(s.scores().values[difficulty], 5)}</dd>
        </div>
        <div>
          <dt>WELLE</dt>
          <dd>{pad(p?.wave ?? 1, 2)}</dd>
        </div>
        <div>
          <dt>LEBEN</dt>
          <dd>{pad(p?.lives ?? 3, 2)}</dd>
        </div>
      </dl>
      <div className="arcade-buttons">
        <button disabled={!g} onClick={() => s.togglePause()}>
          {g?.state === 'paused' ? '▶ Weiter' : 'Ⅱ Pause'}
        </button>
        <button onClick={() => s.openInfo()} aria-label="Info (I)">
          ⓘ Info
        </button>
        <button
          aria-pressed={s.audio.muted}
          onClick={() => {
            s.audio.muted = !s.audio.muted;
            if (s.audio.muted) s.audio.stop();
            s.changed();
          }}
        >
          {s.audio.muted ? '♪ Ton aus' : '♪ Ton an'}
        </button>
        <button className="arcade-back" onClick={onLeave}>
          ← Zurück
        </button>
      </div>
    </header>
  );
}

/** The combo and the boosts running, over the field's corner. */
export function Chips({ g }: { g: Game }) {
  const chips = chipsOf(g);
  if (chips === null) return null;
  return (
    <div className="arcade-chips" aria-live="polite">
      <span className={chips.multiplier > 1 ? 'arcade-chip arcade-chip--hot' : 'arcade-chip'}>
        ×{chips.multiplier} · KETTE {chips.chain}
      </span>
      {chips.boosts.map(([kind, seconds, share]) => (
        <span
          key={kind}
          className={`arcade-chip arcade-boost arcade-boost--${kind}`}
          style={{ '--left': String(share) } as React.CSSProperties}
        >
          {CHIP_LABELS[kind as PickupKind]} {seconds} s
        </span>
      ))}
    </div>
  );
}

/** The banner of a new wave: its number, what is new, one line more. */
export function BannerView({ banner }: { banner: Banner }) {
  return (
    <div key={banner.seq} className="arcade-banner" role="status" aria-live="polite">
      <span className="arcade-kicker">WELLE {pad(banner.wave, 2)}</span>
      <strong>{banner.title}</strong>
      <span>{banner.line}</span>
    </div>
  );
}

/** One touch button, held for as long as a finger stays on it. */
function Hold({ s, action, label, children }: { s: Session; action: string; label?: string; children: React.ReactNode }) {
  return (
    <button
      className={action === 'fire' ? 'arcade-fire' : undefined}
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        if (s.game?.state === 'playing') s.input.pointer(e.pointerId, action);
      }}
      onPointerUp={(e) => s.input.release(e.pointerId)}
      onPointerCancel={(e) => s.input.release(e.pointerId)}
      onLostPointerCapture={(e) => s.input.release(e.pointerId)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** The touch buttons: left and right, and fire. */
export function TouchPad({ s }: { s: Session }) {
  return (
    <div className="arcade-touch">
      <Hold s={s} action="left" label="Nach links">
        ◀
      </Hold>
      <Hold s={s} action="right" label="Nach rechts">
        ▶
      </Hold>
      <Hold s={s} action="fire">
        FEUER <span aria-hidden="true">●</span>
      </Hold>
    </div>
  );
}
