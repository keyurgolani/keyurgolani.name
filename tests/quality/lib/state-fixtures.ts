// The compositions' state fixtures (#11, Slice 1, item 5). #10's set (the
// neutral sample, minimal and long content, missing media, no source
// snapshot) isn't on next yet, so #5's contract fixtures stand in, as the
// body allows: complete, sparse, and missing-media. The 404 page is a
// state of its own, at a path no route matches. The unavailable state (a
// 503 with Retry-After, #1) and last-known-good (a 200 from #3's reader
// for a damaged newest revision, with /api/ready's catalog check degraded)
// can't be served on demand yet: they're named here and planned, and their
// cells skip with the reason, which the run counts as declared.

import type { ContractFixtureName } from '../../../packages/variant-contract/src/contract-fixtures';

export interface StateFixture {
  readonly id: string;
  /** The contract fixture whose pair the server reads. */
  readonly source: ContractFixtureName;
  /** The path it renders at, in place of the cell's route: the 404 page's. */
  readonly path?: string;
  /** What the page answers. */
  readonly status: number;
  /** #10's or another issue's state it stands in for. */
  readonly standsInFor: string;
  /** Why it can't be served yet, when it can't: its cells skip with this. */
  readonly pending?: string;
}

/** A path no route matches, for the 404 state. */
export const NOT_FOUND_PATH = '/quality-no-such-page';

export const STATE_FIXTURES: readonly StateFixture[] = [
  { id: 'complete', source: 'complete', status: 200, standsInFor: "#10's neutral sample" },
  { id: 'sparse', source: 'sparse', status: 200, standsInFor: "#10's minimal content" },
  { id: 'missing-media', source: 'missing-media', status: 200, standsInFor: "#10's missing media" },
  {
    id: 'not-found',
    source: 'complete',
    path: NOT_FOUND_PATH,
    status: 404,
    standsInFor: 'the 404 page, in the active appearance',
  },
  {
    id: 'unavailable',
    source: 'complete',
    status: 503,
    standsInFor: "#1's unavailable state: a 503 with Retry-After in the fallback-pack boundary",
    pending:
      "Stand-in until #1 and #3 can make a revision unavailable on demand: the unavailable state isn't servable from a fixture yet.",
  },
  {
    id: 'last-known-good',
    source: 'complete',
    status: 200,
    standsInFor: "#3's last-known-good: a 200 from the reader's fallback, /api/ready degraded",
    pending:
      "Stand-in until #3's damaged-revision fixture exists: last-known-good isn't servable from a fixture yet.",
  },
];

/** The state every appearance row runs on. */
export const APPEARANCE_STATE = STATE_FIXTURES[0]!;

export function stateFixture(id: string): StateFixture {
  const state = STATE_FIXTURES.find((each) => each.id === id);
  if (!state) throw new Error(`No state fixture is named ${id}.`);
  return state;
}
