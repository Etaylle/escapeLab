import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { makeFloorTile, makeWallTile } from '../world/art.js';
import type { Tile } from './draft.js';
import { paintScene, paintToolGlyph, type Scene, type Textures } from './paint.js';
import { lineBetween, mapSize, refsAt, sameTile, type Ref, type Tool } from './tools.js';

/**
 * The map: the draft painted as the game paints it, at the largest whole
 * tile size that fits the space it gets. A press goes to the screen as a
 * tile; a brush paints every tile its stroke passes; the select tool drags
 * what it pressed on to wherever it is let go.
 */

let textures: Textures | null = null;

/** The game's floor and wall textures, made once, on first use in a browser. */
function sharedTextures(): Textures {
  textures ??= { floor: makeFloorTile(), wall: makeWallTile() };
  return textures;
}

/** Tile sizes in CSS pixels the map is drawn at: never too small to hit, never giant. */
export const TILE_PX = { min: 10, max: 48 } as const;

/** The largest whole tile size at which `cols` × `rows` tiles fit a box. */
export function fitTile(
  box: { width: number; height: number },
  cols: number,
  rows: number,
): number {
  if (box.width <= 0 || box.height <= 0 || cols <= 0 || rows <= 0) {
    return 24;
  }
  const fits = Math.floor(Math.min(box.width / cols, box.height / rows));
  return Math.max(TILE_PX.min, Math.min(TILE_PX.max, fits));
}

interface Props {
  scene: Omit<Scene, 'hover'>;
  /** a press with a placing tool, or the select tool's press */
  onPress: (at: Tile) => void;
  /** a brush went over these tiles */
  onPaint: (tiles: Tile[]) => void;
  /** the select tool let go of a thing it dragged, on another tile */
  onDrop: (ref: Ref, to: Tile) => void;
}

export function EditorCanvas({ scene, onPress, onPaint, onDrop }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<Tile | null>(null);
  /** the last tile the brush painted, while it is down */
  const stroke = useRef<Tile | null>(null);
  /** what the select tool holds, and where it took hold */
  const drag = useRef<{ ref: Ref; from: Tile } | null>(null);
  const { width: cols, height: rows } = mapSize(scene.draft);
  const tilePx = fitTile(box, cols, rows);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) {
      return undefined;
    }
    const measure = (): void => setBox({ width: wrap.clientWidth, height: wrap.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cols * tilePx * dpr);
    canvas.height = Math.round(rows * tilePx * dpr);
    paintScene(ctx, { ...scene, hover }, tilePx, dpr, sharedTextures());
  }, [scene, hover, tilePx, cols, rows]);

  const tileAt = (e: PointerEvent<HTMLCanvasElement>): Tile => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / tilePx),
      y: Math.floor((e.clientY - rect.top) / tilePx),
    };
  };
  const brush = scene.tool === 'floor' || scene.tool === 'wall';

  return (
    // The frame's proportions, for a narrow window, where the frame takes its height from them.
    <div
      ref={wrapRef}
      className="editor-map"
      style={{ '--map-aspect': `${cols} / ${rows}` } as CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className={`editor-canvas editor-canvas-${scene.pending === null ? scene.tool : 'pick'}`}
        data-cols={cols}
        data-rows={rows}
        data-tile-px={tilePx}
        style={{ width: cols * tilePx, height: rows * tilePx }}
        aria-label={`Karte, ${cols} × ${rows} Felder`}
        onPointerDown={(e) => {
          if (e.button !== 0) {
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          const at = tileAt(e);
          if (brush && scene.pending === null) {
            stroke.current = at;
            onPaint([at]);
            return;
          }
          const selecting = scene.tool === 'select' && scene.pending === null;
          const held = selecting ? refsAt(scene.draft, at)[0] : undefined;
          drag.current = held === undefined ? null : { ref: held, from: at };
          onPress(at);
        }}
        onPointerMove={(e) => {
          const at = tileAt(e);
          if (hover === null || !sameTile(hover, at)) {
            setHover(at);
          }
          const last = stroke.current;
          if (last !== null && !sameTile(last, at)) {
            onPaint(lineBetween(last, at));
            stroke.current = at;
          }
        }}
        onPointerUp={(e) => {
          const held = drag.current;
          const at = tileAt(e);
          if (held !== null && !sameTile(held.from, at)) {
            onDrop(held.ref, at);
          }
          stroke.current = null;
          drag.current = null;
        }}
        onPointerCancel={() => {
          stroke.current = null;
          drag.current = null;
        }}
        onPointerLeave={() => setHover(null)}
      />
    </div>
  );
}

/** A tool's picture: the prop it places, drawn by the game's own art. */
export function ToolGlyph({ tool }: { tool: Tool }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) {
      return;
    }
    const size = Math.round(28 * (window.devicePixelRatio || 1));
    canvas.width = size;
    canvas.height = size;
    paintToolGlyph(ctx, tool, size, sharedTextures());
  }, [tool]);
  return <canvas ref={ref} className="editor-tool-glyph" aria-hidden="true" />;
}
