// `pnpm catalog:lock [--check]` (#20): writes the catalog lock,
// packages/appearance/appearance-catalog.lock.json, with each first-party
// pack's version, tier, license, and content digest, and the third-party
// notices the image ships, apps/web/public/third-party-notices.txt, from the
// packs' provenance. --check writes nothing and fails when either is stale,
// as `pnpm check:appearance` does.
//
// It refuses to write a lock that would hide a pack whose content changed
// without a version bump: bump the version first, and the lock follows.

import fs from 'node:fs';
import path from 'node:path';
import {
  LOCK_FILE,
  lockedPacks,
  lockProblems,
  NOTICES_FILE,
  renderLock,
  renderNotices,
} from '@portfolio/appearance/node';
import { REPO_ROOT } from './registry-options';

const TAG = '[catalog:lock]';

function read(file: string): string | null {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  } catch {
    return null;
  }
}

function main(args: readonly string[]): number {
  const check = args.includes('--check');
  if (args.some((arg) => arg !== '--check')) {
    process.stderr.write('Usage: pnpm catalog:lock [--check]\n');
    return 2;
  }
  const packs = lockedPacks(REPO_ROOT);
  const problems = lockProblems(read(LOCK_FILE), packs);
  const notices = renderNotices(packs);
  const staleNotices = read(NOTICES_FILE) !== notices;
  if (check) {
    for (const { message } of problems) process.stderr.write(`${TAG} ${message}\n`);
    if (staleNotices) {
      process.stderr.write(
        `${TAG} ${NOTICES_FILE} is stale. Run pnpm catalog:lock and commit it.\n`,
      );
    }
    if (problems.length > 0 || staleNotices) return 1;
    process.stdout.write(
      `${TAG} The lock pins ${packs.length} packs, and the notices are current.\n`,
    );
    return 0;
  }
  // A changed pack needs its own version bump; regenerating can't stand in for one.
  const blocking = problems.filter(({ message }) =>
    /without a version bump|version went down/.test(message),
  );
  if (blocking.length > 0) {
    for (const { message } of blocking) process.stderr.write(`${TAG} ${message}\n`);
    process.stderr.write(`${TAG} Nothing was written.\n`);
    return 1;
  }
  fs.writeFileSync(path.join(REPO_ROOT, LOCK_FILE), renderLock(packs));
  fs.mkdirSync(path.dirname(path.join(REPO_ROOT, NOTICES_FILE)), { recursive: true });
  fs.writeFileSync(path.join(REPO_ROOT, NOTICES_FILE), notices);
  process.stdout.write(
    `${TAG} Wrote ${LOCK_FILE} with ${packs.length} packs, and ${NOTICES_FILE}.\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
