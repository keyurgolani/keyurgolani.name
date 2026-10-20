import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { runAppToExit } from '../harness/app-server.mjs';
import {
  fatalFields,
  HEAD,
  mentions,
  neverValues,
  ORIGIN,
  rowDocuments,
  STARTUP_ROWS,
  type RowPaths,
  type StartupRow,
} from '../harness/startup-rows.mjs';

// Every startup-matrix row without an issue tag (#1, item 2), against the
// built standalone server. The rows live in tests/harness/startup-rows.mjs,
// which `pnpm smoke:profiles` runs against the image too. Each must stop the
// process with exit 1 before it serves a request, log a config.fatal line
// naming the key, and never print the configured value. No browser: these
// only start and stop the server.

interface Fatal {
  event: string;
  key: string;
  code: string;
  file?: string;
  path?: string;
  line?: number;
  column?: number;
  issueCode?: string;
  message: string;
}

type Env = Record<string, string>;

/** Starts the server, expects it to stop with exit 1, and returns its config.fatal lines. */
async function expectRefusal(
  env: Env,
  { never = [], readDelayMs }: { never?: string[]; readDelayMs?: number } = {},
) {
  // Well inside the test timeout, so a server that wrongly keeps running is
  // killed and reported rather than left behind.
  const run = await runAppToExit({ env, timeoutMs: 15_000, readDelayMs });
  expect(run.exited, `the server kept running:\n${run.output}`).toBe(true);
  expect(run.code, run.output).toBe(1);
  expect(run.egress, 'requests the server tried to send out').toEqual([]);
  for (const value of never) expect(run.output).not.toContain(value);
  const fatal = run.output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Fatal)
    .filter((entry) => entry.event === 'config.fatal');
  expect(fatal.length, run.output).toBeGreaterThan(0);
  return fatal;
}

/** Writes the row's documents and files under the test's output directory. */
function place(row: StartupRow): RowPaths {
  const source = test.info().outputPath('config');
  mkdirSync(source, { recursive: true });
  for (const [name, text] of Object.entries(rowDocuments(row))) {
    writeFileSync(path.join(source, name), text);
  }
  const beside = (name: string) => test.info().outputPath(name);
  for (const [name, text] of Object.entries(row.files ?? {})) writeFileSync(beside(name), text);
  return { source, beside };
}

for (const group of new Set(STARTUP_ROWS.map((row) => row.group))) {
  test.describe(group, () => {
    for (const row of STARTUP_ROWS.filter((entry) => entry.group === group)) {
      test(row.name, async () => {
        test.skip(Boolean(row.unreadable) && process.getuid?.() === 0, 'root reads any directory');
        const paths = place(row);
        if (row.unreadable) chmodSync(paths.source, 0o000);
        try {
          const fatal = await expectRefusal(row.env(paths), { never: neverValues(row, paths) });
          expect(fatalFields(row, fatal)).toEqual(row.fatal);
          for (const text of mentions(row)) expect(fatal[0]!.message).toContain(text);
        } finally {
          if (row.unreadable) chmodSync(paths.source, 0o700);
        }
      });
    }
  });
}

test.describe('the refusal log', () => {
  test('reaches a slow reader in full before the server exits', async () => {
    // Over 300 KB of config.fatal lines: more than the pipe and the reader's
    // buffer hold while nothing reads, so the server must wait to write them.
    const count = 1000;
    const source = test.info().outputPath('config');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      path.join(source, 'portfolio.yml'),
      `${HEAD}identity:\n  name: Rowan Fixture\nsections:\n${'  - kind: canary-kind\n'.repeat(count)}`,
    );
    const fatal = await expectRefusal(
      { PORTFOLIO_PROFILE: 'read-only', PORTFOLIO_ORIGIN: ORIGIN, PORTFOLIO_SOURCE_DIR: source },
      { readDelayMs: 2_000 },
    );
    expect(fatal.map((entry) => entry.path)).toEqual(
      Array.from({ length: count }, (_, index) => `/sections/${index}/kind`),
    );
  });
});
