/**
 * `marco-polo candidates`: writes per-candidate features for training, using
 * the same core code as the product. Placeholder until the detection work
 * fills it in; it exits with code 2 so scripts cannot mistake it for output.
 */
export async function candidatesCommand(_argv: string[]): Promise<number> {
  process.stderr.write('candidates: not implemented yet\n');
  return 2;
}
