import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { failureRecord } from './lib/reports.mjs';
import { renderMarkdown } from './summarize.mjs';

const SUMMARIZE = fileURLToPath(new URL('./summarize.mjs', import.meta.url));

// The writer's exit status goes to a file, not the pipe. The reader waits for that file, or 3 s
// when the writer is still waiting on the pipe, before it reads anything: a writer that exits with
// its table still queued loses all but the pipe buffer's first bytes.
const SLOW_READER = [
  '{ node "$1"; echo "exit $?" > "$2"; }',
  '| { i=0; while [ ! -s "$2" ] && [ "$i" -lt 30 ]; do sleep 0.1; i=$((i + 1)); done; cat; }',
].join(' ');

test('a failure table past a pipe buffer reaches a reader that starts late whole, and the run still exits 0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'summarize-'));
  try {
    const failures = path.join(dir, 'failures');
    mkdirSync(failures);
    const records = [];
    for (let i = 0; i < 3000; i++) {
      const n = String(i).padStart(4, '0');
      const record = failureRecord({
        gate: 'unit',
        reproCommand: 'pnpm ci:unit',
        test: `cell ${n} keeps its text contrast at every width`,
        route: '/',
        viewport: '1280x720',
        expected: '4.5',
        actual: '3.1',
        artifacts: [`quality/cell-${n}.png`],
      });
      records.push(record);
      writeFileSync(path.join(failures, `unit-${n}.json`), JSON.stringify(record));
    }
    const markdown = `${renderMarkdown(records)}\n`;
    assert.ok(Buffer.byteLength(markdown) > 4 * 65536, 'the table is past any pipe buffer');

    const env = { ...process.env, CI_REPORTS_DIR: dir };
    delete env.GITHUB_STEP_SUMMARY;
    const marker = path.join(dir, 'exit-status');
    const result = spawnSync('sh', ['-c', SLOW_READER, 'sh', SUMMARIZE, marker], {
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(marker, 'utf8').trim(), 'exit 0');
    assert.equal(
      Buffer.byteLength(result.stdout),
      Buffer.byteLength(markdown),
      'every byte of the table arrives',
    );
    assert.ok(result.stdout === markdown, 'the table arrives as rendered');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
