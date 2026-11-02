// Fixtures for #2's proxy-shape security tests: the image under test under
// owner behind the HTTPS proxy fixture (proxy-stack.mjs with
// compose.owner.yml), started once per worker, with a password made for the
// run. `proxyOptions` sets the app's trusted hop count, 1 by default, the
// fixture's one appending proxy. A spec that sets another one with
// test.use() gets a stack of its own.
import { test as base } from '@playwright/test';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { OWNER_DATA_DIR, startProxyStack } from '../harness/proxy-stack.mjs';
import { auditRecords, proxyTarget, type SecurityTarget } from '../harness/security-suite';

export { expect } from '@playwright/test';

/** The image under test, which `pnpm ci:image` builds, and the container CLI. */
const IMAGE = process.env.PORTFOLIO_IMAGE || 'portfolio:ci';
const CLI = process.env.CONTAINER_CLI || 'docker';

export interface ProxyOptions {
  /** PORTFOLIO_TRUSTED_PROXY_HOPS for the app behind the proxy. */
  readonly hops: number;
}

export interface Proxied {
  readonly stack: Awaited<ReturnType<typeof startProxyStack>>;
  readonly secret: { readonly password: string; readonly hash: string };
}

// Playwright's fixture callback is conventionally named `use`; it is
// `provide` here because the React Hooks lint rule mistakes `use(...)` for
// React's use().
export const test = base.extend<
  { target: SecurityTarget },
  { proxyOptions: ProxyOptions; proxied: Proxied }
>({
  proxyOptions: [{ hops: 1 }, { scope: 'worker', option: true }],
  proxied: [
    async ({ proxyOptions }, provide) => {
      // A password made for the run, hashed by the image's own
      // hash-password, which needs no network.
      const secret = ownerSecret([
        CLI,
        'run',
        '--rm',
        '-i',
        '--network',
        'none',
        IMAGE,
        'node',
        'apps/web/bin/owner.mjs',
      ]);
      const stack = await startProxyStack({
        image: IMAGE,
        cli: CLI,
        owner: { hash: secret.hash, hops: proxyOptions.hops },
      });
      try {
        await provide({ stack, secret });
      } finally {
        stack.stop();
      }
    },
    { scope: 'worker', timeout: 300_000 },
  ],
  target: async ({ proxied, proxyOptions }, provide) => {
    await provide(
      proxyTarget(proxied.stack, proxied.secret, {
        dataDir: OWNER_DATA_DIR,
        hops: proxyOptions.hops,
      }),
    );
  },
});

/**
 * The source of every failed or throttled sign-in record in the audit log,
 * oldest first. Each minute's first event of a kind and source is written at
 * once and the rest at the minute's end, so a test sees at least one record
 * for each source it made fail.
 */
export async function failureSources(target: SecurityTarget): Promise<string[]> {
  return auditRecords(await target.dataFiles())
    .filter((record) => record.type === 'login_failed' || record.type === 'login_throttled')
    .map((record) => String((record.refs as { source?: unknown }).source));
}
