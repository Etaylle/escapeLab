interface Props {
  tiles: string[];
  /** rendered height in pixels; the width follows the map's aspect ratio */
  height?: number;
}

/**
 * Tiny outline of a mission's layout, so people can see what they are
 * signing up for before they join. Walls and floor only — the puzzles stay
 * a surprise.
 */
export function MapThumb({ tiles, height = 54 }: Props) {
  const rows = tiles.length;
  const cols = tiles[0]?.length ?? 0;
  if (rows === 0 || cols === 0) {
    return null;
  }
  const floors: string[] = [];
  for (let y = 0; y < rows; y++) {
    const row = tiles[y] ?? '';
    for (let x = 0; x < cols; x++) {
      if (row.charAt(x) === '.') {
        floors.push(`M${x} ${y}h1v1h-1z`);
      }
    }
  }
  return (
    <svg
      className="map-thumb"
      viewBox={`0 0 ${cols} ${rows}`}
      style={{ height, width: (height * cols) / rows }}
      role="img"
      aria-label="Kartenvorschau"
    >
      <rect x={0} y={0} width={cols} height={rows} className="map-thumb-bg" />
      <path d={floors.join('')} className="map-thumb-floor" />
    </svg>
  );
}
