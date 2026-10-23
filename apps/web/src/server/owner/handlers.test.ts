import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePublicationUnit } from '@portfolio/schema';
import { authorize, type Authorized } from '../authorize';
import { accessIn, CAPABILITIES } from '../capabilities';
import { readDeploymentConfig } from '../config';
import { setDeploymentState } from '../config-store';
import type { HandlerContext } from '../dispatcher';
import { listOperations } from '../operations';
import { isStudioResult } from '../studio-result';
import { ownerHandlers, ownerStore } from './index';
import { mintSession } from './session-mint';

// Every owner handler re-checks its token (#1, item 12): one authorize()
// didn't issue, or one for another capability, throws before it does
// anything, so a caller that skips the dispatcher gets nothing.

const read = readDeploymentConfig(
  {
    NODE_ENV: 'production',
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_ORIGIN: 'https://rowan.test',
    PORTFOLIO_SOURCE_DIR: '/srv/portfolio',
  },
  { cwd: '/' },
);
assert.ok(read.ok, JSON.stringify(read.issues));
const config = read.config;
// An empty store in a directory of its own, whose reader serves nothing.
const dataDir = mkdtempSync(path.join(tmpdir(), 'owner-handlers-'));
const store = ownerStore({
  config: { ...config, dataDir },
  checks: { validate: (pair) => validatePublicationUnit(pair), appVersion: 'test' },
  documents: {
    getLive: async () => ({ state: 'empty', revisionId: null, unitHash: null, unit: null }),
  },
  setServable: () => {},
});
const handlers = ownerHandlers({
  config,
  catalog: 'revisions',
  store,
  variantHealth: async () => ({
    status: 'degraded',
    requested: 'missing-variant',
    rendered: 'fallback',
  }),
});
const session = mintSession();

const REVISION = `rev_${'a'.repeat(32)}`;
const DRAFT = `drf_${'b'.repeat(32)}`;
const DOCUMENTS = {
  portfolio: { format: 'yaml', sourceText: 'schemaVersion: 2\n' },
  site: { format: 'yaml', sourceText: 'schemaVersion: 2\n' },
};
/** Input each entry's schema takes, where `{}` isn't any. */
const SAMPLE_INPUT: Record<string, unknown> = {
  'revision.get': { revisionId: REVISION },
  'draft.get': { draftId: DRAFT },
  'draft.save': { draftId: DRAFT, expectedVersion: 1, documents: DOCUMENTS },
  'draft.applyEdits': {
    draftId: DRAFT,
    expectedVersion: 1,
    edits: [{ document: 'portfolio', pointer: '/locale', op: 'set', value: 'en' }],
  },
  'draft.rebase': {
    draftId: DRAFT,
    expectedVersion: 1,
    documents: DOCUMENTS,
    baseRevisionId: null,
  },
  'draft.discard': { draftId: DRAFT },
  publish: { draftId: DRAFT, draftVersion: 1, expectedLiveRevisionId: null },
  rollback: { targetRevisionId: REVISION, expectedLiveRevisionId: null },
  recover: { targetRevisionId: REVISION, expectedLiveRevisionId: null },
};

test.before(() => {
  setDeploymentState({
    config,
    catalog: { getLive: () => assert.fail('no handler here reads the catalog') },
    dispatch: () => assert.fail('the handlers are called directly'),
    degraded: [],
  });
});
test.after(() => {
  setDeploymentState(undefined);
  rmSync(dataDir, { recursive: true, force: true });
});

test('every owner handler serves a registered operation', () => {
  const names = new Set(listOperations().map((operation) => operation.name));
  for (const name of Object.keys(handlers)) assert.ok(names.has(name), name);
});

for (const [name, handler] of Object.entries(handlers)) {
  const operation = listOperations().find((entry) => entry.name === name)!;
  const context: HandlerContext = {
    request: new Request(`https://rowan.test/api/studio/${name}`),
    requestId: 'req-handler',
    operation,
    session,
    inputType: operation.kind === 'query' ? 'search' : 'json',
    recheckSession: async () => null,
    commitWithSession: async () => {
      throw new Error('Nothing commits in this test.');
    },
  };

  test(`${name} throws on a token authorize() never issued`, async () => {
    const forged = Object.freeze({
      capability: operation.capability,
      session,
    }) as unknown as Authorized;
    await assert.rejects(async () => handler(forged, {}, context), /not authorized/);
  });

  test(`${name} throws on a token for another capability`, async () => {
    const others = CAPABILITIES.filter(
      (capability) =>
        capability !== operation.capability && accessIn('owner', capability) !== 'absent',
    );
    assert.ok(others.length > 0);
    for (const capability of others) {
      const token = authorize(capability, session);
      assert.ok(token, capability);
      await assert.rejects(async () => handler(token, {}, context), /not authorized/, capability);
    }
  });

  test(`${name} runs with its own token`, async () => {
    const token = authorize(operation.capability, session);
    assert.ok(token);
    // Input as the dispatcher passes it: past the entry's schema.
    const input = operation.input.parse(SAMPLE_INPUT[name] ?? {});
    const output = await handler(token, input, context);
    // Output, or an error the entry declares, such as not_found in this empty store.
    if (isStudioResult(output)) {
      assert.ok(output.kind === 'error' && operation.errors.includes(output.code), name);
    } else {
      assert.equal(operation.output.safeParse(output).success, true);
    }
  });
}
