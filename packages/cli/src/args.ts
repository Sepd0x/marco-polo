/** A mistake in how the command was called. Printed without a stack, exit code 2. */
export class UsageError extends Error {}

export type FlagSpec =
  | { kind: 'string'; choices?: readonly string[] }
  | { kind: 'number'; min: number; max: number; integer?: boolean }
  | { kind: 'flag' };

export type FlagValues = Record<string, string | number | boolean | undefined>;

/**
 * Strict `--name value` parser. Unknown flags, missing values and values out
 * of range are errors, never silently replaced. `removed` maps flags that
 * used to exist to the message explaining what replaced them.
 */
export function parseFlags(
  argv: string[],
  spec: Record<string, FlagSpec>,
  removed: Record<string, string> = {},
): { values: FlagValues; help: boolean } {
  const values: FlagValues = {};
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '--help' || raw === '-h') {
      help = true;
      continue;
    }
    if (!raw.startsWith('--')) throw new UsageError(`unexpected argument "${raw}"`);
    const eq = raw.indexOf('=');
    const name = raw.slice(2, eq === -1 ? undefined : eq);
    if (name in removed) throw new UsageError(`--${name} was removed: ${removed[name]}`);
    const s = spec[name];
    if (!s) throw new UsageError(`unknown option --${name} (see --help)`);
    if (s.kind === 'flag') {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`);
      values[name] = true;
      continue;
    }
    let value: string | undefined;
    if (eq !== -1) value = raw.slice(eq + 1);
    else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
      i++;
    }
    if (s.kind === 'string') {
      if (s.choices && !s.choices.includes(value)) {
        throw new UsageError(`--${name} must be one of: ${s.choices.join(', ')} (got "${value}")`);
      }
      values[name] = value;
    } else {
      const n = value.trim() === '' ? NaN : Number(value);
      if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number (got "${value}")`);
      if (s.integer && !Number.isInteger(n)) throw new UsageError(`--${name} must be a whole number (got "${value}")`);
      if (n < s.min || n > s.max) throw new UsageError(`--${name} must be between ${s.min} and ${s.max} (got ${n})`);
      values[name] = n;
    }
  }
  return { values, help };
}
