import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FIXTURE_DIR, REFERENCE_CANARIES } from '../../scripts/reference-fixture';
import { compose } from './composition';
import { readDeploymentConfig } from './config';
import { setDeploymentState } from './config-store';
import { demoStudioSetup } from './demo-studio';

// What Demo Studio's page hands its shell about the read-only reference (#9,
// 9-4a): only what startup verified, from the server's own state, and of it
// only the name its public view gives and its site's own selection. With no
// reference mounted there is none to offer.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};

async function deploy(t: TestContext, env: Record<string, string> = {}) {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: 'https://demo.wren.test',
      ...env,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  const composed = await compose({ config: read.config, examples: EXAMPLES, report: () => {} });
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  setDeploymentState(composed.state);
  t.after(() => setDeploymentState(undefined));
}

test('with no reference mounted, Demo Studio gets none to offer', async (t) => {
  await deploy(t);
  const setup = await demoStudioSetup();
  assert.equal(setup.reference, null);
});

test("with the verified reference mounted, Demo Studio gets its public name and its site's own selection, and nothing private", async (t) => {
  await deploy(t, { PORTFOLIO_REFERENCE_DIR: FIXTURE_DIR });
  const setup = await demoStudioSetup();
  assert.ok(setup.reference);
  assert.equal(setup.reference.name, 'Wren Halloway');
  assert.equal(setup.reference.defaults.variant, 'spatial-bento');
  assert.equal(setup.reference.defaults.colorScheme, 'warm-parchment');
  assert.deepEqual(Object.keys(setup.reference).sort(), ['defaults', 'name']);
  const text = JSON.stringify(setup);
  for (const canary of Object.values(REFERENCE_CANARIES)) assert.ok(!text.includes(canary), canary);
  // The sample is still the default the demo opens on.
  assert.notEqual(setup.unit.documents.portfolio.sourceText.includes('Wren Halloway'), true);
});

test('a reference that fails to verify gives Demo Studio none to offer', async (t) => {
  await deploy(t, {
    PORTFOLIO_REFERENCE_DIR: fileURLToPath(new URL('./no-such-mount', import.meta.url)),
  });
  assert.equal((await demoStudioSetup()).reference, null);
});
