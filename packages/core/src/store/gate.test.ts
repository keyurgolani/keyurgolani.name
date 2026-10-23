// The import and publish gate (#3, Slice 3 and Verification required; #4's
// VR4 moved here): against a seeded store, every one of #4's invalid pairs
// (its item 21) with a blocks-preview or blocks-publish code fails
// `import --from <fixture>`, and, but for the source.* ones, which only an
// import can meet, a publish of it saved as a draft, each with
// validation_failed naming that code. Neither writes a revision or moves
// the pointer: live.json, events/, and revisions/ stay as they were.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  DIAGNOSTIC_SEVERITIES,
  validatePublicationUnit,
  type AppearanceCatalog,
  type Context,
  type DiagnosticCode,
} from '@portfolio/schema';
import { readPairBytes } from '@portfolio/schema/node';
import { cli } from './test-support/cli';
import {
  filesUnder,
  invalidInput,
  newStore,
  owned,
  pairInput,
  publishInput,
  SCHEMA_FIXTURES,
  testChecks,
} from './test-support/fixtures';

const INVALID = path.join(SCHEMA_FIXTURES, 'invalid');

/**
 * The context #4's invalid pairs are written against, as its own tests use
 * them: the color schemes and typography presets they name, every display
 * mode, and their own origin, https://rowan.name.
 */
const IDS: Readonly<Record<string, readonly string[]>> = {
  colorScheme: ['warm', 'warm-parchment', 'noir', 'ink-and-paper', 'nebula', 'aurora', 'solar'],
  typography: ['classic', 'humanist-ui', 'modernist', 'geometric', 'humanist'],
  displayMode: ['system', 'light', 'dark', 'high-contrast'],
};
const CATALOG: AppearanceCatalog = {
  ids: (axis) => IDS[axis] ?? null,
  generatorInput: () => undefined,
};
const CONTEXT: Context = { catalog: CATALOG, canonicalOrigin: 'https://rowan.name' };
const checks = testChecks({ validate: (pair) => validatePublicationUnit(pair, CONTEXT) });
const readSource = (dir: string) => readPairBytes(dir, CONTEXT);

const blocking = (code: string) =>
  (DIAGNOSTIC_SEVERITIES as Record<string, string>)[code] !== 'warning';

/** live.json, every event file, and every file under revisions/, byte for byte. */
function published(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const dir of ['publication/events', 'revisions']) {
    for (const file of filesUnder(path.join(root, dir))) {
      snapshot[`${dir}/${file}`] = readFileSync(path.join(root, dir, file), 'latin1');
    }
  }
  snapshot['publication/live.json'] = readFileSync(
    path.join(root, 'publication/live.json'),
    'latin1',
  );
  return snapshot;
}

test('every blocking invalid pair fails import and a draft publish with validation_failed naming its code, and nothing is published', async (t) => {
  const codes = readdirSync(INVALID).sort() as DiagnosticCode[];
  // A fixture's two documents are what import reads. One with a directory
  // beside them is another reader's: media/ and snapshots/ are read-only's
  // (#4's readUnitFiles), and live/ is the live pair #10's publication
  // validators, urls.vanished and id.reused, check a pair against, which
  // the store passes #4 no context for yet. The gate leaves those to them.
  const beside = (code: string) =>
    readdirSync(path.join(INVALID, code), { withFileTypes: true })
      // source.unreadable's portfolio.yml is a directory, which import can't read.
      .filter((entry) => entry.isDirectory() && !/^(?:portfolio|site)\./.test(entry.name))
      .map((entry) => entry.name);
  const others = codes.filter((code) => beside(code).length > 0);
  assert.deepEqual(
    others.map((code) => [code, beside(code).join(',')]),
    [
      ['id.reused', 'live'],
      ['media.invalid', 'media'],
      ['media.syntax', 'media'],
      ['snapshot.ignored', 'snapshots'],
      ['snapshot.invalid', 'snapshots'],
      ['snapshot.syntax', 'snapshots'],
      ['urls.vanished', 'live'],
    ],
  );
  const gated = codes.filter((code) => blocking(code) && !others.includes(code));
  // Every code with a fixture that blocks, the three that only a mounted directory can show among them.
  assert.ok(gated.length >= 14, gated.join(', '));
  for (const code of ['source.missing', 'source.duplicate', 'source.unreadable']) {
    assert.ok(gated.includes(code as DiagnosticCode), code);
  }

  const store = await newStore(t, { checks });
  const live = await publishInput(store, pairInput('engineering'));
  const before = published(store.paths.root);

  for (const code of gated) {
    const run = await cli(['import', '--from', path.join(INVALID, code)], {
      dataDir: store.paths.root,
      readSource,
      checks,
    });
    assert.equal(run.code, 1, `${code}: ${run.out}${run.err}`);
    assert.match(
      run.err,
      /^validation_failed: \d+ records? blocks? it\. Nothing was imported\.$/m,
      code,
    );
    assert.ok(run.err.includes(`: ${code} (`), `${code} is named:\n${run.err}`);
    assert.deepEqual(published(store.paths.root), before, `${code}: import published nothing`);

    if (code.startsWith('source.')) continue;
    const working = await store.drafts.getWorking();
    const saved = await store.drafts.create(
      { documents: invalidInput(code), ...(working ? { expectedVersion: working.version } : {}) },
      'owner',
    );
    assert.equal(saved.kind, 'saved', `${code}: an invalid draft saves`);
    if (saved.kind !== 'saved') continue;
    const outcome = await owned(store).publish(
      {
        draftId: saved.draft.draftId,
        draftVersion: saved.draft.version,
        expectedLiveRevisionId: live,
      },
      'owner',
    );
    assert.equal(outcome.kind === 'rejected' && outcome.code, 'validation_failed', code);
    assert.ok(
      outcome.kind === 'rejected' && outcome.diagnostics.some((d) => d.code === code),
      `${code}: ${outcome.kind === 'rejected' ? outcome.diagnostics.map((d) => d.code) : outcome.kind}`,
    );
    assert.deepEqual(published(store.paths.root), before, `${code}: publish published nothing`);
  }

  // The gate is the findings, not every import: a pair with warnings alone goes live.
  const warned = codes.find((code) => !blocking(code))!;
  const run = await cli(['import', '--from', path.join(INVALID, warned)], {
    dataDir: store.paths.root,
    readSource,
    checks,
  });
  assert.equal(run.code, 0, `${warned}: ${run.err}`);
  assert.notDeepEqual(published(store.paths.root), before);
});
