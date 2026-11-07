import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { beamLight, beamPatches, beamVerdict, DISTANCES, FLANK_OFF, PATCH } from './beamcheck.mjs';

/** A picture `width` × `height`, each pixel grey as `grey(x, y)` says. */
function picture(width, height, grey) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = grey(x, y);
      rgba.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/** Tiles to CSS px: 20 px a tile, the tile (0, 0) at the page's corner. */
const toPage = (x, y) => ({ x: x * 20, y: y * 20 });
/** A beam from (1, 5) east. */
const beam = { x: 1, y: 5, facing: 0 };

describe('beamPatches — where a beam’s light is read', () => {
  it('reads the axis and FLANK_OFF either side at each distance, a patch PATCH tiles wide', () => {
    const patches = beamPatches(beam, toPage, 20);
    assert.equal(patches.core.length, DISTANCES.length);
    const [first] = patches.core;
    assert.deepEqual(first, {
      x: (1 + DISTANCES[0]) * 20 - PATCH * 10,
      y: 100 - PATCH * 10,
      width: PATCH * 20,
      height: PATCH * 20,
    });
    // The left flank lies north of an eastward beam (screen y grows downward), the right south.
    const leftY = (5 - Math.sin(FLANK_OFF) * DISTANCES[0]) * 20 - PATCH * 10;
    assert.ok(Math.abs(patches.left[0].y - leftY) < 1e-9);
    assert.ok(patches.right[0].y > first.y);
  });
});

describe('beamLight, beamVerdict — a beam brighter in its core than on its flanks', () => {
  it('passes a beam lit brightest along its axis', () => {
    // Bright within 0.6 tiles of the row y = 5, dimmer out to 1.6 tiles, dark beyond.
    const image = picture(200, 200, (_, y) => {
      const off = Math.abs(y / 20 - 5);
      return off < 0.6 ? 200 : off < 1.6 ? 140 : 10;
    });
    const light = beamLight(image, beamPatches(beam, toPage, 20), 1);
    assert.equal(light.core, 200);
    assert.ok(light.left < light.core && light.right < light.core);
    assert.equal(beamVerdict(light), true);
  });

  it('fails a flat wedge, as bright on its flanks as on its axis', () => {
    const image = picture(200, 200, () => 150);
    assert.equal(beamVerdict(beamLight(image, beamPatches(beam, toPage, 20), 1)), false);
  });

  it('reads the picture at its scale: twice the pixels on a screen twice as dense', () => {
    const image = picture(400, 400, (_, y) => (Math.abs(y / 40 - 5) < 0.6 ? 220 : 30));
    const light = beamLight(image, beamPatches(beam, toPage, 20), 2);
    assert.equal(light.core, 220);
  });
});
