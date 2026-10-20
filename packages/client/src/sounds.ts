/** Tiny WebAudio blips — atmosphere only, the game must work without audio. */

let ctx: AudioContext | null = null;

function tone(freq: number, startIn: number, duration: number, volume: number): void {
  if (ctx === null) {
    return;
  }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  const t = ctx.currentTime + startIn;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

export function play(kind: 'alarm' | 'solved' | 'won' | 'lost' | 'start'): void {
  try {
    ctx ??= new AudioContext();
    switch (kind) {
      case 'alarm':
        tone(220, 0, 0.15, 0.08);
        tone(170, 0.16, 0.25, 0.08);
        break;
      case 'solved':
        tone(520, 0, 0.09, 0.05);
        tone(780, 0.1, 0.14, 0.05);
        break;
      case 'won':
        tone(520, 0, 0.12, 0.06);
        tone(660, 0.13, 0.12, 0.06);
        tone(880, 0.26, 0.3, 0.06);
        break;
      case 'lost':
        tone(330, 0, 0.3, 0.07);
        tone(220, 0.32, 0.5, 0.07);
        break;
      case 'start':
        tone(440, 0, 0.1, 0.05);
        tone(440, 0.9, 0.1, 0.05);
        tone(440, 1.8, 0.1, 0.05);
        tone(660, 2.7, 0.4, 0.06);
        break;
    }
  } catch {
    // Audio blocked or unsupported — the game stays fully playable.
  }
}
