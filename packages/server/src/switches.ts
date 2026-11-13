/**
 * Reads a switch the server takes from its environment for development — ALLOW_SEED,
 * ALLOW_RECORD, ALLOW_TAKES: on with `<name>=1`, as `pnpm dev` sets it; off with 0 or unset.
 * Anything else throws, saying what `<name>=1` does (`does`), so that a misspelt switch is not
 * taken for either.
 */
export function switchOn(env: NodeJS.ProcessEnv, name: string, does: string): boolean {
  const flag = env[name] ?? '';
  if (flag === '1') {
    return true;
  }
  if (flag === '' || flag === '0') {
    return false;
  }
  throw new Error(`${name}=${flag} versteht der Server nicht — ${name}=1 ${does}`);
}
