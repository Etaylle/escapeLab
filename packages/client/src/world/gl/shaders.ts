/**
 * The light layer's GLSL (GLSL ES 3.00, WebGL2), as strings, and what each
 * program expects to be handed. Four passes over a triangle covering the
 * layer (lightLayer.ts):
 *
 *   light   every light at every pixel: how far it reaches (its falloff and
 *           cone), whether the walls let it through (a DDA march through the
 *           occupancy texture to SAMPLES points across the light: soft
 *           shadows), how the faces of a wall turn to it; summed with the
 *           lit rooms, the darkness and the escape's red into a light map
 *           (what the picture keeps, to be multiplied) and a glow (light
 *           added over it), and what blooms: the colour small lights add,
 *           not the gleam of steel nor the wide glow of the open hatch
 *   bright  what blooms, at a quarter of the size, above a threshold
 *   blur    a separable Gaussian, once across and once down
 *   output  the light map in the upper half of the layer's canvas, glow and
 *           bloom in the lower half — render/light.ts lays the one over the
 *           picture with 'multiply' and the other with 'lighter'
 */

/** The most lights the layer draws at once; the dimmest beyond are dropped (pack.ts). */
export const MAX_SOURCES = 32;
/** Four-component vectors a light takes in `uSources` (pack.ts writes them). */
export const VECS_PER_SOURCE = 6;
/** Points across a light that its shadow lines run to: its penumbra's steps. */
export const SAMPLES = 4;
/** The most tiles a shadow line crosses; a light further away than that does not get through. */
export const MAX_STEPS = 24;
/** The glow is kept at half its value in 8 bits: light up to twice white survives to bloom. */
export const GLOW_SCALE = 0.5;
/** The bloom's threshold: of what small lights add, what lies above it blooms (`bright`). */
export const BLOOM_THRESHOLD = 0.22;
/** The darkness's colour, as the Canvas pass fills it (render/darkness.ts). */
const DARK_RGB = '3.0, 5.0, 9.0';

/** One program: its two shaders and the uniforms it declares, by name. */
export interface ProgramSource {
  vertex: string;
  fragment: string;
  uniforms: readonly string[];
}

/** A triangle covering the whole target, drawn from gl_VertexID alone: no buffers. */
const COVER_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** The march through the occupancy texture and the soft shadow built from it. */
const SHADOW_GLSL = `
bool blocks(ivec2 cell) {
  if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, uMapSize))) {
    return true;
  }
  return texelFetch(uOccupancy, cell, 0).r > 0.5;
}

// Whether light gets along the line from 'from' to 'to' (tiles): no tile that stops light
// between them — the tile 'from' lies in and the tile 'to' lies in never count, as in the
// core's canSee. A DDA through the grid (Amanatides and Woo), at most MAX_STEPS tiles.
float reaches(vec2 from, vec2 to) {
  ivec2 cell = ivec2(floor(from));
  ivec2 end = ivec2(floor(to));
  vec2 run = to - from;
  ivec2 stepDir = ivec2(sign(run));
  vec2 inv = 1.0 / max(abs(run), vec2(1e-6));
  vec2 ahead = vec2(cell) + max(vec2(stepDir), vec2(0.0));
  vec2 tMax = abs(ahead - from) * inv;
  if (stepDir.x == 0) { tMax.x = 1e9; }
  if (stepDir.y == 0) { tMax.y = 1e9; }
  for (int i = 0; i < MAX_STEPS; i++) {
    if (min(tMax.x, tMax.y) >= 1.0) { return 1.0; }
    if (tMax.x < tMax.y) {
      cell.x += stepDir.x;
      tMax.x += inv.x;
    } else {
      cell.y += stepDir.y;
      tMax.y += inv.y;
    }
    if (cell == end) { return 1.0; }
    if (blocks(cell)) { return 0.0; }
  }
  return 0.0;
}

// Interleaved gradient noise: where across the light this pixel's samples start, 0 to 1.
float shiftAt(vec2 frag) {
  return fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
}

// Where a tile that stops light sees a light at 'l' from: its point nearest the light, just
// off the tile towards it — a wall is lit whole where its face is in sight, as the Canvas
// pass lights the walls in sight whole.
vec2 faceToward(ivec2 cell, vec2 l) {
  vec2 lo = vec2(cell);
  vec2 near = clamp(l, lo, lo + 1.0);
  vec2 off = l - near;
  float len = length(off);
  return len < 1e-4 ? near : near + off / len * 0.02;
}

// How much of a light 'size' tiles across at 'c' reaches 'p' (tile 'cell', 'solid' where that
// tile stops light): SAMPLES lines to points across the light, square to the way to it, each
// kept on the light's own tile so that a lamp on a wall never shines through it.
float visibility(vec2 p, ivec2 cell, bool solid, vec2 c, float size, float shift) {
  vec2 way = c - p;
  float away = length(way);
  if (away < 1e-4) { return 1.0; }
  vec2 across = vec2(-way.y, way.x) / away * size;
  vec2 lo = floor(c) + 0.02;
  vec2 hi = floor(c) + 0.98;
  float seen = 0.0;
  for (int k = 0; k < SAMPLES; k++) {
    float o = (float(k) + shift) / float(SAMPLES) * 2.0 - 1.0;
    vec2 l = clamp(c + across * o, lo, hi);
    vec2 from = p;
    if (solid) {
      from = faceToward(cell, l);
      ivec2 start = ivec2(floor(from));
      if (start != ivec2(floor(l)) && start != cell && blocks(start)) { continue; }
    }
    seen += reaches(from, l);
  }
  return seen / float(SAMPLES);
}
`;

/** How a light falls off, how the faces of a wall turn, and what a light adds in colour. */
const SHADING_GLSL = `
// A light's depth along its reach, u from 0 at its middle to 1 at its rim: v0 there, vk at
// the knee, nothing at the rim — smoothly between, the Canvas pass's gradient stops eased.
float profile(float u, float v0, float knee, float vk) {
  if (u >= 1.0) { return 0.0; }
  if (u < knee) { return mix(v0, vk, smoothstep(0.0, knee, u)); }
  return mix(vk, 0.0, smoothstep(knee, 1.0, u));
}

// The way the surface of a wall tile faces at 'f' (0 to 1 across the tile): up on its crown,
// tilted out over a band along each face that looks onto the floor ('faces': north, east,
// south, west) — the south face, the one the view looks at, wider. A band is a plane, eased
// in over its inner part, not a ridge: a face turned to a lamp lights up whole.
vec3 wallNormal(vec2 f, vec4 faces) {
  float north = faces.r * (1.0 - smoothstep(BEVEL * 0.6, BEVEL, f.y));
  float east = faces.g * smoothstep(1.0 - BEVEL, 1.0 - BEVEL * 0.6, f.x);
  float south = faces.b * smoothstep(1.0 - FRONT, 1.0 - FRONT * 0.8, f.y);
  float west = faces.a * (1.0 - smoothstep(BEVEL * 0.6, BEVEL, f.x));
  return normalize(vec3(east - west, south - north, TILT));
}

// The colour a light adds 'u' along its reach, as a share of what it adds at its middle: the
// Canvas pass's gradient — all of it there, shape.y at the knee shape.x, shape.w halfway,
// nothing at the rim, straight between — whiter than its colour by 'white' at its middle and
// by shape.z at the knee, as the gradient's stops are.
vec3 tone(vec3 colour, float white, vec4 shape, float u) {
  float share = 0.0;
  float whiter = 0.0;
  if (u < shape.x) {
    float t = u / shape.x;
    share = mix(1.0, shape.y, t);
    whiter = mix(white, shape.z, t);
  } else if (u < 0.5) {
    float t = (u - shape.x) / (0.5 - shape.x);
    share = mix(shape.y, shape.w, t);
    whiter = mix(shape.z, 0.0, t);
  } else {
    share = mix(shape.w, 0.0, (u - 0.5) / 0.5);
  }
  return mix(colour, vec3(1.0), whiter) * share;
}
`;

/** One light's share at a pixel: how much darkness it clears, what it adds, how walls gleam. */
const SOURCE_GLSL = `
struct Pixel {
  vec2 p;
  ivec2 cell;
  bool solid;
  bool faced;
  vec3 normal;
  float shift;
};

struct Share {
  float clear;
  vec3 glow;
  vec3 gleam;
  vec3 bloom;
};

// How much of a light's glow blooms, by how wide the light is: a bulb, a lamp's hot core, not
// the wide mouth of the open hatch, which would white out whoever stands in it.
float bloomOf(float size) {
  return 1.0 - smoothstep(BLOOM_SMALL, BLOOM_WIDE, size);
}

Share lightAt(Pixel px, int i) {
  Share share = Share(0.0, vec3(0.0), vec3(0.0), vec3(0.0));
  vec4 s0 = uSources[i * VECS];
  vec4 s1 = uSources[i * VECS + 1];
  vec4 s2 = uSources[i * VECS + 2];
  vec4 s3 = uSources[i * VECS + 3];
  vec4 s4 = uSources[i * VECS + 4];
  vec4 s5 = uSources[i * VECS + 5];
  vec2 to = px.p - s0.xy;
  float away = length(to);
  float u = 1.0;
  float cone = 0.0;
  float clear = 0.0;
  if (s0.w > 0.0 && away < s0.w) {
    u = away / s0.w;
    cone = 1.0;
    clear = profile(u, s1.x, s1.y, s1.z);
  }
  if (s1.w > 0.0 && away < s1.w) {
    float off = away > 1e-4 ? dot(to / away, s2.xy) : 1.0;
    float beam = smoothstep(s2.z, s2.w, off);
    clear = max(clear, profile(away / s1.w, s3.x, s3.y, s3.z) * beam);
    if (s0.w <= 0.0) {
      u = away / s1.w;
      cone = beam;
    }
  }
  bool adds = s3.w > 0.0 && u < 1.0 && cone > 0.0;
  if (clear <= 0.002 && !adds) { return share; }
  float seen = s0.z < 0.0 ? 1.0 : visibility(px.p, px.cell, px.solid, s0.xy, s0.z, px.shift);
  if (seen <= 0.0) { return share; }
  float shade = 1.0;
  // A wall turns its faces to a lamp; to an object's glow, which no wall stops, it does not.
  if (px.faced && s0.z >= 0.0) {
    vec2 toward2 = away > 1e-4 ? -to / away : vec2(0.0);
    float toward = dot(px.normal.xy, toward2);
    shade = 1.0 - BACK_DIM * max(-toward, 0.0);
    vec3 lamp = normalize(vec3(-to, LAMP_HEIGHT));
    float spec = pow(max(dot(px.normal, normalize(lamp + vec3(0.0, 0.0, 1.0))), 0.0), SHININESS);
    float gleam = FACE_GLEAM * max(toward, 0.0) * max(toward, 0.0) + SPEC * spec;
    share.gleam = s4.rgb * (clear * seen * gleam);
  }
  share.clear = clear * seen * shade;
  if (adds) {
    share.glow = tone(s4.rgb, s4.a, s5, u) * (s3.w * seen * cone);
    share.bloom = share.glow * bloomOf(s0.z);
  }
  return share;
}
`;

/** The light pass: every light at every pixel, summed with the rooms' light and the darkness. */
const LIGHT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

#define MAX_SOURCES ${MAX_SOURCES}
#define SAMPLES ${SAMPLES}
#define MAX_STEPS ${MAX_STEPS}
#define VECS ${VECS_PER_SOURCE}

uniform vec2 uView;
uniform vec2 uCamera;
uniform float uScale;
uniform ivec2 uMapSize;
uniform sampler2D uOccupancy;
uniform sampler2D uFaces;
uniform sampler2D uKeep;
uniform sampler2D uOver;
uniform sampler2D uUnder;
uniform float uDark;
uniform float uVeil;
uniform vec4 uTint;
uniform int uCount;
uniform vec4 uSources[MAX_SOURCES * VECS];

layout(location = 0) out vec4 outLight;
layout(location = 1) out vec4 outGlow;

const vec3 DARK = vec3(${DARK_RGB}) / 255.0;
const float GLOW_SCALE = ${GLOW_SCALE.toFixed(2)};
const float LAMP_HEIGHT = 0.8;
const float BEVEL = 0.22;
const float FRONT = 0.5;
const float TILT = 1.4;
const float BACK_DIM = 0.55;
const float FACE_GLEAM = 0.2;
const float SPEC = 0.2;
const float SHININESS = 42.0;
const float BLOOM_SMALL = 0.2;
const float BLOOM_WIDE = 0.4;
${SHADOW_GLSL}${SHADING_GLSL}${SOURCE_GLSL}
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 p = uCamera + (frag - 0.5 * uView) / uScale;
  ivec2 cell = ivec2(floor(p));
  bool inside = all(greaterThanEqual(cell, ivec2(0))) && all(lessThan(cell, uMapSize));
  vec4 faces = inside ? texelFetch(uFaces, cell, 0) : vec4(0.0);
  bool faced = dot(faces, vec4(1.0)) > 0.0;
  vec3 normal = wallNormal(fract(p), faces);
  Pixel px = Pixel(p, cell, blocks(cell), faced, normal, shiftAt(gl_FragCoord.xy));
  float through = 1.0;
  vec3 glow = vec3(0.0);
  vec3 gleam = vec3(0.0);
  vec3 bloom = vec3(0.0);
  for (int i = 0; i < MAX_SOURCES; i++) {
    if (i >= uCount) { break; }
    Share share = lightAt(px, i);
    through *= 1.0 - share.clear;
    glow += share.glow;
    gleam += share.gleam;
    bloom += share.bloom;
  }
  float keep = inside ? texelFetch(uKeep, cell, 0).r : 1.0;
  vec2 uv = p / vec2(uMapSize);
  vec3 over = inside ? texture(uOver, uv).rgb : vec3(0.0);
  vec3 under = inside ? texture(uUnder, uv).rgb : vec3(0.0);
  float dark = uVeil * uDark * keep * through;
  float light = 1.0 - dark;
  vec3 added = over + under * light + glow + gleam + DARK * dark;
  light *= 1.0 - uTint.a;
  added = added * (1.0 - uTint.a) + uTint.rgb * uTint.a;
  outLight = vec4(light, bloom * GLOW_SCALE);
  outGlow = vec4(added * GLOW_SCALE, 1.0);
}
`;

/** What blooms, a quarter of the size: the light pass's glow above the threshold, 4×4 to one. */
const BRIGHT_FRAGMENT = `#version 300 es
precision mediump float;

uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uThreshold;

out vec4 outColor;

void main() {
  vec2 c = gl_FragCoord.xy * 4.0 * uTexel;
  vec3 sum = texture(uSource, c + uTexel * vec2(-1.0, -1.0)).gba
    + texture(uSource, c + uTexel * vec2(1.0, -1.0)).gba
    + texture(uSource, c + uTexel * vec2(-1.0, 1.0)).gba
    + texture(uSource, c + uTexel * vec2(1.0, 1.0)).gba;
  vec3 glow = sum * (0.25 / ${GLOW_SCALE.toFixed(2)});
  outColor = vec4(max(glow - uThreshold, 0.0), 1.0);
}
`;

/** A separable Gaussian, nine taps in five linear reads, along `uStep`. */
const BLUR_FRAGMENT = `#version 300 es
precision mediump float;

uniform sampler2D uSource;
uniform vec2 uSize;
uniform vec2 uStep;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 sum = texture(uSource, uv).rgb * 0.2270270270;
  sum += texture(uSource, uv + uStep * 1.3846153846).rgb * 0.3162162162;
  sum += texture(uSource, uv - uStep * 1.3846153846).rgb * 0.3162162162;
  sum += texture(uSource, uv + uStep * 3.2307692308).rgb * 0.0702702703;
  sum += texture(uSource, uv - uStep * 3.2307692308).rgb * 0.0702702703;
  outColor = vec4(sum, 1.0);
}
`;

/** The layer's canvas: the light map over the upper half, glow and bloom over the lower. */
const OUTPUT_FRAGMENT = `#version 300 es
precision mediump float;

uniform sampler2D uLight;
uniform sampler2D uGlow;
uniform sampler2D uBloom;
uniform vec2 uView;
uniform float uBloomGain;

out vec4 outColor;

void main() {
  if (gl_FragCoord.y >= uView.y) {
    vec2 uv = vec2(gl_FragCoord.x, gl_FragCoord.y - uView.y) / uView;
    outColor = vec4(vec3(texture(uLight, uv).r), 1.0);
    return;
  }
  vec2 uv = gl_FragCoord.xy / uView;
  vec3 glow = texture(uGlow, uv).rgb / ${GLOW_SCALE.toFixed(2)};
  outColor = vec4(glow + texture(uBloom, uv).rgb * uBloomGain, 1.0);
}
`;

/** The layer's four programs. */
export const PROGRAMS = {
  light: {
    vertex: COVER_VERTEX,
    fragment: LIGHT_FRAGMENT,
    uniforms: [
      'uView',
      'uCamera',
      'uScale',
      'uMapSize',
      'uOccupancy',
      'uFaces',
      'uKeep',
      'uOver',
      'uUnder',
      'uDark',
      'uVeil',
      'uTint',
      'uCount',
      'uSources',
    ],
  },
  bright: {
    vertex: COVER_VERTEX,
    fragment: BRIGHT_FRAGMENT,
    uniforms: ['uSource', 'uTexel', 'uThreshold'],
  },
  blur: {
    vertex: COVER_VERTEX,
    fragment: BLUR_FRAGMENT,
    uniforms: ['uSource', 'uSize', 'uStep'],
  },
  output: {
    vertex: COVER_VERTEX,
    fragment: OUTPUT_FRAGMENT,
    uniforms: ['uLight', 'uGlow', 'uBloom', 'uView', 'uBloomGain'],
  },
} as const satisfies Record<string, ProgramSource>;

export type ProgramName = keyof typeof PROGRAMS;
