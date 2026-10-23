// pnpm's readPackage hook (#12). It drops one optional peer edge, so the
// lockfile pnpm writes is the same on every run.
//
// eslint-import-resolver-typescript declares eslint-plugin-import as an
// optional peer, and eslint-plugin-import reaches the resolver through
// eslint-module-utils's optional peer on it. In that cycle, pnpm 10.33's
// resolvePeers sets each key from whichever node it finishes first, so the
// eslint-plugin-import keys came out two ways from run to run, and
// test:external-variant's exact lockfile checks failed on runs that changed
// nothing.
//
// The resolver never loads eslint-plugin-import; it only declares the peer.
// That was checked for 3.10.1 alone, so any other version stops the install
// until someone checks again. pnpm's `overrides` can't drop the edge:
// removing the peer leaves peerDependenciesMeta, which pnpm reads as an
// optional peer of its own. eslint-module-utils keeps its peer on the
// resolver, which it loads by name.
//
// This file runs on every install. ci/lockfile-drift.test.mjs pins what it
// exports and what it changes: one hook, and two keys in one manifest.
'use strict';

/** The peer edge dropped: package name, and the peer it no longer declares. */
const DROPPED_PEERS = Object.freeze([
  Object.freeze(['eslint-import-resolver-typescript', 'eslint-plugin-import']),
]);

/** The resolver version whose source was read for the reasoning above. */
const CHECKED_VERSION = '3.10.1';

function readPackage(pkg) {
  for (const [name, peer] of DROPPED_PEERS) {
    if (pkg.name !== name) continue;
    if (pkg.version !== CHECKED_VERSION) {
      throw new Error(
        `.pnpmfile.cjs drops ${name}'s peer on ${peer}, checked for ${CHECKED_VERSION}, ` +
          `but this install resolves ${pkg.version}. Re-check that ${name} ${pkg.version} ` +
          `never loads ${peer}, then update CHECKED_VERSION, or remove the hook.`,
      );
    }
    if (pkg.peerDependencies) delete pkg.peerDependencies[peer];
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[peer];
  }
  return pkg;
}

module.exports = { hooks: { readPackage }, DROPPED_PEERS };
