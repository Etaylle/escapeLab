import { createHash } from 'node:crypto';
import type { CrewPass } from '@escapelab/core';

const hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The crew pass of `name`'s browser in a test: the same for the same name, hex as minted. */
export function passFor(name: string): CrewPass {
  return { id: hex(`id:${name}`).slice(0, 32), secret: hex(`secret:${name}`) };
}
