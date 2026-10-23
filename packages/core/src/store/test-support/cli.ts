// For the store's CLI tests: runCli() in this process, with what it prints
// kept, the test checks, and the reader the test passes, since #4's pair
// loader is for tests and the CLI's entry alone (check:deps).
import { tmpdir } from 'node:os';
import { runCli, type CliOptions } from '../../cli';
import { recordOwnerModule } from '../../load-trace';
import type { SourceReader } from '../source';
import { testChecks } from './fixtures';

recordOwnerModule('core/store/test-support/cli');

export interface CliRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export interface CliCall extends Partial<Omit<CliOptions, 'argv' | 'io' | 'env' | 'readSource'>> {
  readonly readSource: SourceReader;
  /** PORTFOLIO_DATA_DIR, unless `env` sets it. */
  readonly dataDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export async function cli(argv: readonly string[], call: CliCall): Promise<CliRun> {
  let out = '';
  let err = '';
  const { dataDir, env = {}, ...rest } = call;
  const code = await runCli({
    checks: testChecks(),
    envBase: tmpdir(),
    cwd: tmpdir(),
    ...rest,
    argv,
    env: { ...(dataDir === undefined ? {} : { PORTFOLIO_DATA_DIR: dataDir }), ...env },
    io: {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
  });
  return { code, out, err };
}

/** The value of a `label: value` line the CLI printed, or undefined. */
export function line(text: string, label: string): string | undefined {
  const prefix = `${label}: `;
  return text
    .split('\n')
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
}
