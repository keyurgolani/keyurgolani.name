import 'server-only';
import type { ConfigIssue } from '../config';
import { recordOwnerModule } from '../load-trace';
import { ownerStoreOf } from './store';

// The revision.integrity startup requirement (#3, item 21), which degrades
// rather than stops startup: the store's repair runs, then the reader reads
// the live revision as it serves it, every hash checked, and decides the
// state, logging any render drift. A damaged live revision is served as the
// last known good; with none, visitors get 503 and owner still starts, so
// Studio can recover. #3's Slice 3 adds the first-start import and source
// drift (item 24) here. Typed by shape, so this module doesn't import the
// composition root.

recordOwnerModule('server/owner/revision-integrity');

export async function check({
  owner,
}: {
  /** The owner branch's store. */
  readonly owner?: object;
}): Promise<readonly ConfigIssue[]> {
  return (await ownerStoreOf(owner)?.checkIntegrity()) ?? [];
}
