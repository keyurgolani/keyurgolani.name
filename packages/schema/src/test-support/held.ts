// A run that holds a scratch directory, with a mode taken away inside it,
// until a signal stops it: scratch.test.ts runs this file and stops it.
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lockMode, tempDir } from './scratch';

test('holds a scratch directory until a signal stops the run', async (t) => {
  const dir = tempDir(t, { 'portfolio.yml': 'held' });
  fs.mkdirSync(path.join(dir, 'locked'));
  lockMode(path.join(dir, 'locked'), 0o000);
  fs.writeFileSync(path.join(os.tmpdir(), 'held'), dir);
  await new Promise((resolve) => setTimeout(resolve, 60_000));
});
