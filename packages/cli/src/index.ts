/**
 * marco-polo CLI: the same engine as the web app, without a browser.
 *
 *   npm run scan -- --bbox "37.070,-8.125,37.079,-8.106"
 *   npx tsx src/index.ts scan --area ./area.geojson --source dgt --out ./scans/vilamoura
 */
import { pathToFileURL } from 'node:url';
import { candidatesCommand } from './commands/candidates.js';
import { SCAN_HELP, scanCommand } from './commands/scan.js';

type Command = (argv: string[]) => Promise<number>;

export const COMMANDS: Record<string, { run: Command; summary: string }> = {
  scan: { run: (argv) => scanCommand(argv), summary: 'find and measure pools in an area, write GeoJSON and CSV' },
  candidates: { run: candidatesCommand, summary: 'write per-candidate features for training' },
};

export const HELP = `marco-polo: finds, measures and ranks swimming pools in aerial imagery

usage:
  marco-polo <command> [options]
  marco-polo --bbox ...          same as "marco-polo scan --bbox ..."

commands:
${Object.entries(COMMANDS)
  .map(([name, c]) => `  ${name.padEnd(12)} ${c.summary}`)
  .join('\n')}

"marco-polo <command> --help" shows the options of a command. Options with
no command run a scan:

${SCAN_HELP}`;

/** Route argv to a command. Options with no command go to `scan`. */
export async function main(argv: string[]): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined || first === 'help' || ((first === '--help' || first === '-h') && rest.length === 0)) {
    console.log(HELP);
    return first === undefined ? 2 : 0;
  }
  if (first.startsWith('-')) return COMMANDS.scan.run(argv);
  const cmd = COMMANDS[first];
  if (!cmd) {
    process.stderr.write(`error: unknown command "${first}" (see --help)\n`);
    return 2;
  }
  return cmd.run(rest);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
