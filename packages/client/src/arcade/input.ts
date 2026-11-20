/** The machine's controls (the reference's src/input.js): keys, touch buttons, a finger dragged. */
import type { Actions } from './rules.js';

export const MOVE_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space'];

export class Input {
  keys = new Set<string>();
  pointers = new Map<number, string>();
  drag: { id: number; x: number } | null = null;

  key(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }
  pointer(id: number, action: string): void {
    this.pointers.set(id, action);
  }
  /** A finger held on the field: the ferret runs towards its x, in field units. */
  steer(id: number, x: number): void {
    this.drag = { id, x };
  }
  release(id: number): void {
    this.pointers.delete(id);
    if (this.drag?.id === id) this.drag = null;
  }
  clear(): void {
    this.keys.clear();
    this.pointers.clear();
    this.drag = null;
  }
  get actions(): Required<Actions> {
    const held = [...this.pointers.values()];
    const has = (...codes: string[]): boolean => codes.some((code) => this.keys.has(code));
    return {
      left: has('ArrowLeft', 'KeyA') || held.includes('left'),
      right: has('ArrowRight', 'KeyD') || held.includes('right'),
      fire: has('Space') || held.includes('fire'),
    };
  }
  /** The held actions plus dragging and auto-fire, for a ferret standing at `ferretX`. */
  actionsFor(ferretX: number, autofire = false): Required<Actions> {
    const a = this.actions;
    if (this.drag && Math.abs(this.drag.x - ferretX) > 3) {
      a.left ||= this.drag.x < ferretX;
      a.right ||= this.drag.x > ferretX;
    }
    a.fire ||= autofire;
    return a;
  }
}
