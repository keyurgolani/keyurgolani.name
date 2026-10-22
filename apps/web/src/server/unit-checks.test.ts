import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { UnitChecks } from '@portfolio/core';
import { readPair } from '@portfolio/schema/node';
import { storeChecks } from '../../scripts/portfolio-store';
import { deploymentUnitChecks } from './register';

// One unit check for a revision, whoever writes it (#3, items 21 and 26):
// the composition root's, as register() binds it, and portfolio-store's.
// A revision the CLI imports records the rendering the server's would, so
// the server reads no render drift into it, and the two find the same.

const ROOT = '../../../../';
const EXAMPLES = {
  portfolio: fileURLToPath(new URL(`${ROOT}portfolio.example.yml`, import.meta.url)),
  site: fileURLToPath(new URL(`${ROOT}site.example.yml`, import.meta.url)),
};
const ORIGIN = 'https://rowan.name';

test('the CLI and the composition root check a pair alike: one rendering, snapshots, findings, and app version', () => {
  const read = readPair(EXAMPLES);
  assert.ok(read.ok, 'the bundled example reads');
  const server = deploymentUnitChecks(ORIGIN);
  const cli = storeChecks({ PORTFOLIO_ORIGIN: ORIGIN });
  const served = server.validateLive!(read.sources);
  assert.ok(served.pair, 'the example serves');

  assert.deepEqual(cli.rendering!(served.pair), server.rendering!(served.pair));
  assert.deepEqual(
    cli.snapshots!(served.pair, undefined),
    server.snapshots!(served.pair, undefined),
  );
  assert.equal(cli.appVersion, server.appVersion);
  const findings = (checks: UnitChecks, rule: 'validate' | 'validateLive') =>
    checks[rule]!(read.sources).diagnostics.map(
      (diagnostic) => `${diagnostic.severity} ${diagnostic.code} ${diagnostic.pointer}`,
    );
  for (const rule of ['validate', 'validateLive'] as const) {
    assert.deepEqual(findings(cli, rule), findings(server, rule), rule);
  }
  // As published, the example's unregistered variant blocks; as served, it warns.
  assert.ok(findings(server, 'validate').some((line) => line.includes('variant.unavailable')));
});
