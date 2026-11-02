// The reference variant's id, from its manifest (#5, Slice 6), with nothing
// else loaded: the quality plan names it by this (#11) whether or not a run
// installs the variant, and the variant's own checks through reference.ts.
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')) as {
  readonly id: string;
};

/** The reference variant's id. */
export const REFERENCE_ID = manifest.id;
