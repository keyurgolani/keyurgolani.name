import 'server-only';
import type { ConfigIssue } from '../config';
import { recordOwnerModule } from '../load-trace';
import { ownerStoreOf } from './store';

// The documents.shape startup requirement (#3, item 24), owner's half of the
// pair's startup rows, which read-only's documents.pair covers there. With
// an empty store it's the first-start import: the mounted pair goes live as
// revision 1, and a pair that can't (one that doesn't serve, an old-format
// one, or the bundled sample in production) stops startup. Once a revision
// exists, the data directory is authoritative, and the pair's findings
// only warn. A busy lock never stops it: the
// import waits for the lock in the background, and visitors get 503 until
// it commits. Typed by shape, so this module doesn't import the composition
// root.

recordOwnerModule('server/owner/first-start');

export async function check({
  documents,
  owner,
}: {
  /** The mounted pair as startup found it: whether it serves, and every finding. */
  readonly documents?: { readonly ok: boolean; readonly issues: readonly ConfigIssue[] };
  /** The owner branch's store. */
  readonly owner?: object;
}): Promise<readonly ConfigIssue[]> {
  const store = ownerStoreOf(owner);
  return store ? store.checkSource(documents) : (documents?.issues ?? []);
}
