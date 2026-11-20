/**
 * The machine's own tune (the reference's src/music.js): a small chiptune loop, synthesised and
 * laid a moment ahead on the audio clock, into the machine's music gain.
 */

const TEMPO = 112;
const SIXTEENTH = 60 / TEMPO / 4;
const LOOKAHEAD = 0.15;
const ROOTS = [45, 41, 48, 43];
const BASS: readonly (number | null)[] = [
  0, null, null, 12, null, null, 0, null, 7, null, null, 12, null, null, 0, null,
];
/** Four bars of melody as MIDI notes; „." rests. */
const LEAD: readonly (readonly (number | null)[])[] = [
  '69 . 72 . 76 . 74 72 . 69 . . 67 . 69 .',
  '65 . 69 . 72 . 74 . 72 69 . . 65 . . .',
  '64 . 67 . 72 . 71 72 74 . 72 . 67 . . .',
  '67 . 71 . 74 . 76 . 74 . 71 . 67 . 62 .',
].map((bar) => bar.split(' ').map((n) => (n === '.' ? null : Number(n))));
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** What the tune plays through: the audio clock, and a note's way into the music gain. */
export interface MusicOut {
  readonly ctx: BaseAudioContext;
  note(frequency: number, at: number, length: number, type: OscillatorType, volume: number): void;
  stopNotes(): void;
}

export class Music {
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private next = 0;

  constructor(private readonly out: () => MusicOut | null) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    const out = this.out();
    if (this.playing || out === null) return;
    this.next = out.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), 50);
    this.schedule();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.out()?.stopNotes();
  }

  private schedule(): void {
    const out = this.out();
    if (out === null) return;
    const until = out.ctx.currentTime + LOOKAHEAD;
    while (this.next < until) {
      this.play(out);
      this.next += SIXTEENTH;
      this.step++;
    }
  }

  private play(out: MusicOut): void {
    const bar = Math.floor(this.step / 16) % 4;
    const i = this.step % 16;
    const bass = BASS[i] ?? null;
    const lead = LEAD[bar]?.[i] ?? null;
    if (bass !== null) {
      out.note(hz((ROOTS[bar] ?? 45) + bass), this.next, SIXTEENTH * 1.6, 'triangle', 0.09);
    }
    if (lead !== null) this.lead(out, lead, i);
  }

  /** The melody in the loop's second half, its quarter notes an octave down in the first. */
  private lead(out: MusicOut, note: number, i: number): void {
    if (this.step % 128 >= 64) out.note(hz(note), this.next, SIXTEENTH * 1.8, 'square', 0.028);
    else if (i % 4 === 0) out.note(hz(note - 12), this.next, SIXTEENTH * 0.9, 'square', 0.018);
  }
}
