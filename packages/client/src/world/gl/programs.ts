import type { ProgramSource } from './shaders.js';

/**
 * The light layer's handles on WebGL2: programs compiled from shaders.ts,
 * textures a texel a tile, and render targets to draw a pass into. Every
 * failure throws with what failed and why, so that the layer falls back to
 * the Canvas pass with a reason (path.ts) instead of drawing nothing.
 */

/** A linked program and its uniforms by name. */
export interface Program {
  program: WebGLProgram;
  uniforms: Readonly<Record<string, WebGLUniformLocation>>;
}

/** A framebuffer drawing into textures of one size, one per colour attachment. */
export interface Target {
  framebuffer: WebGLFramebuffer;
  textures: WebGLTexture[];
  width: number;
  height: number;
}

/** What a texture holds a texel of: one byte, or four. */
export type TexelFormat = 'r8' | 'rgba8';

function compile(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
  name: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error(`gl: no ${name} shader could be made — is the context lost?`);
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? 'no log';
    gl.deleteShader(shader);
    throw new Error(`gl: the ${name} shader does not compile: ${log}`);
  }
  return shader;
}

/**
 * Compiles and links the program `name` from `source`, and looks up every
 * uniform it declares; throws where a shader does not compile, the program
 * does not link, or a uniform it names is not active in it.
 */
export function linkProgram(
  gl: WebGL2RenderingContext,
  name: string,
  source: ProgramSource,
): Program {
  const vertex = compile(gl, gl.VERTEX_SHADER, source.vertex, `${name} vertex`);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, source.fragment, `${name} fragment`);
  const program = gl.createProgram();
  if (program === null) {
    throw new Error(`gl: no ${name} program could be made — is the context lost?`);
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // Flagged for deletion, they live on as long as the program they are attached to.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program) ?? 'no log';
    gl.deleteProgram(program);
    throw new Error(`gl: the ${name} program does not link: ${log}`);
  }
  const uniforms: Record<string, WebGLUniformLocation> = {};
  for (const uniform of source.uniforms) {
    const location = gl.getUniformLocation(program, uniform);
    if (location === null && !gl.isContextLost()) {
      throw new Error(`gl: the ${name} program has no active uniform ${uniform} (shaders.ts)`);
    }
    if (location !== null) {
      uniforms[uniform] = location;
    }
  }
  return { program, uniforms };
}

/** The location of `name` in `program`; throws for a uniform it was not linked with. */
export function uniformOf(program: Program, name: string): WebGLUniformLocation {
  const location = program.uniforms[name];
  if (location === undefined) {
    throw new Error(`gl: no uniform ${name} in this program — add it to its list in shaders.ts`);
  }
  return location;
}

/** A texture that clamps at its edges and samples with `filter` (NEAREST or LINEAR). */
export function makeTexture(gl: WebGL2RenderingContext, filter: GLenum): WebGLTexture {
  const texture = gl.createTexture();
  if (texture === null) {
    throw new Error('gl: no texture could be made — is the context lost?');
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** Fills `texture` with `data`, `width` × `height` texels of `format`, row by row from the top. */
export function fillTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  [width, height]: readonly [number, number],
  format: TexelFormat,
  data: Uint8Array | null,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const [internal, layout] = format === 'r8' ? [gl.R8, gl.RED] : [gl.RGBA8, gl.RGBA];
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, layout, gl.UNSIGNED_BYTE, data);
}

/** A render target `width` × `height` with `attachments` RGBA colour textures, sampled linearly. */
export function makeTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  attachments: number,
): Target {
  const framebuffer = gl.createFramebuffer();
  if (framebuffer === null) {
    throw new Error('gl: no framebuffer could be made — is the context lost?');
  }
  const textures = Array.from({ length: attachments }, () => makeTexture(gl, gl.LINEAR));
  const target = { framebuffer, textures, width: 0, height: 0 };
  sizeTarget(gl, target, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  textures.forEach((texture, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
  });
  gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    const code = `0x${status.toString(16)}`;
    throw new Error(`gl: a ${attachments}-target framebuffer is incomplete (status ${code})`);
  }
  return target;
}

/** Gives `target`'s textures the size `width` × `height`, unless they have it already. */
export function sizeTarget(
  gl: WebGL2RenderingContext,
  target: Target,
  width: number,
  height: number,
): void {
  if (target.width === width && target.height === height) {
    return;
  }
  for (const texture of target.textures) {
    fillTexture(gl, texture, [width, height], 'rgba8', null);
  }
  target.width = width;
  target.height = height;
}

/** Releases `target`'s framebuffer and textures. */
export function dropTarget(gl: WebGL2RenderingContext, target: Target): void {
  gl.deleteFramebuffer(target.framebuffer);
  for (const texture of target.textures) {
    gl.deleteTexture(texture);
  }
}
