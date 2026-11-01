/**
 * A frame window of the walkthrough (shots.mjs `sampleFrames`) measures one page: while it runs,
 * every other page of the run is frozen, and thawed again once it is over, however it ends. On a
 * runner with two cores, every page drawing the same scene at once, a window would otherwise
 * measure how the pages share the cores, not what a frame of the game costs one client.
 */

/**
 * Freezes each of `others` in turn, runs `measure`, and thaws every page it froze, the last
 * frozen first, however `measure` ended. A page that does not freeze has those frozen before it
 * thawed and is thrown about by name, `measure` never running. A page that does not thaw is
 * thrown about once the rest are thawed — one left frozen would stall the run — together with
 * the error `measure` threw, where it threw one.
 *
 * @template {{ name: string }} Page
 * @template T
 * @param {readonly Page[]} others the pages to freeze, in this order
 * @param {{ freeze: (page: Page) => Promise<string>, thaw: (page: Page) => Promise<void> }} hands
 *   `freeze` holds a page still and says how it froze; `thaw` lets it go on
 * @param {() => Promise<T>} measure what to do while the others stand frozen
 * @returns {Promise<{ value: T, frozen: Array<{ name: string, how: string }> }>} what `measure`
 *   returned, and every page frozen meanwhile with what `freeze` said of it
 */
export async function withOthersFrozen(others, hands, measure) {
  const frozen = [];
  const outcome = await settle(async () => {
    for (const page of others) {
      const how = await named(() => hands.freeze(page), `${page.name} did not freeze`);
      frozen.push({ page, how });
    }
    return measure();
  });
  const errors = [
    ...('error' in outcome ? [outcome.error] : []),
    ...(await thawAll([...frozen].reverse(), hands.thaw)),
  ];
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, errors.map(messageOf).join('; '));
  }
  return { value: outcome.value, frozen: frozen.map(({ page, how }) => ({ name: page.name, how })) };
}

/** What `work` came to: `{ value }`, or `{ error }` where it threw. */
async function settle(work) {
  try {
    return { value: await work() };
  } catch (error) {
    return { error };
  }
}

/** `work`'s value; what it throws is thrown again as `what`, its cause kept. */
async function named(work, what) {
  try {
    return await work();
  } catch (cause) {
    throw new Error(`${what}: ${messageOf(cause)}`, { cause });
  }
}

/** Thaws each page of `frozen` in its order; the errors of those that did not thaw. */
async function thawAll(frozen, thaw) {
  const errors = [];
  for (const { page } of frozen) {
    const outcome = await settle(() => named(() => thaw(page), `${page.name} did not thaw`));
    if ('error' in outcome) {
      errors.push(outcome.error);
    }
  }
  return errors;
}

/** The first line of what `error` says. */
function messageOf(error) {
  return String(error instanceof Error ? error.message : error).split('\n')[0];
}
