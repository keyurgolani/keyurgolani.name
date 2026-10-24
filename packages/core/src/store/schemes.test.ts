// Generated color schemes in the store (#10, 10h): a draft save runs the
// generator the selected scheme's manifest declares and holds the result as
// derived.schemes; a changed result is a scheme-regenerated derived change
// the publish waits on; a dismissal puts the live tokens back; a publish
// freezes the entries into snapshots/schemes.json, under the revision's
// digest. An image-derived scheme reads its asset's stored bytes alone.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { applyEdits, isPlainObject, type RecordedChange } from '@portfolio/schema';
import type { UnitInput } from '../catalog/unit';
import type { Draft, DraftOutcome } from './drafts';
import { nodeFs } from './fs-port';
import type { RevisionId } from './layout';
import { readRevision } from './revisions';
import { pixelsSha256, seedInputsHash, type SchemeGenerators } from './schemes';
import { loadSharp } from '../catalog/media/derive';
import type { Store } from './store';
import { newStore, owned, pairInput, testChecks } from './test-support/fixtures';

const hex = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

/** Two whole sets, as the test generators make them: one role, the color given. */
const tokensOf = (color: string) => ({ light: { accent: color }, dark: { accent: color } });

interface Generated {
  readonly generators: SchemeGenerators;
  /** Each input a generator ran on. */
  readonly runs: unknown[];
}

/**
 * The test build's generators: gen-seed takes a seed and makes its tokens
 * from it; gen-image takes an asset and makes them from its bytes. `answer`
 * overrides what a run answers, to test a generator that answers wrongly.
 */
function testGenerators(
  answer?: (declared: { id: string; version: number }) => {
    generator: { id: string; version: number };
    tokens: unknown;
  } | null,
): Generated {
  const runs: unknown[] = [];
  const generators: SchemeGenerators = {
    declared: (schemeId) =>
      schemeId === 'gen-seed'
        ? { id: 'test-seed', version: 1, input: 'seed-color' }
        : schemeId === 'gen-image'
          ? { id: 'test-image', version: 1, input: 'asset' }
          : undefined,
    run(declared, input) {
      runs.push(input);
      const overridden = answer?.(declared);
      if (overridden) return { ok: true, ...overridden };
      if ('seedColor' in input) {
        if (!/^#[0-9a-f]{6}$/.test(input.seedColor)) {
          return { ok: false, problem: `${declared.id} takes a six-digit hex seed color.` };
        }
        return {
          ok: true,
          generator: { id: declared.id, version: declared.version },
          tokens: tokensOf(input.seedColor),
        };
      }
      return {
        ok: true,
        generator: { id: declared.id, version: declared.version },
        tokens: tokensOf(`#${hex(input.bytes).slice(0, 6)}`),
      };
    },
    check: (entry) =>
      isPlainObject(entry) &&
      isPlainObject(entry.generator) &&
      typeof entry.inputsHash === 'string' &&
      /^[0-9a-f]{64}$/.test(entry.inputsHash) &&
      isPlainObject(entry.tokens) &&
      isPlainObject(entry.tokens.light) &&
      isPlainObject(entry.tokens.dark) &&
      typeof entry.tokens.light.accent === 'string' &&
      typeof entry.tokens.dark.accent === 'string',
  };
  return { generators, runs };
}

/** The engineering pair, its site selecting `colorScheme` with `inputs` as its appearanceInputs. */
function pairWith(
  colorScheme: string,
  inputs: Record<string, unknown> | undefined,
  media?: unknown,
): UnitInput {
  const input = pairInput('engineering');
  const edits = [
    { op: 'set' as const, pointer: '/appearance/colorScheme', value: colorScheme },
    ...(inputs ? [{ op: 'set' as const, pointer: '/appearanceInputs', value: inputs }] : []),
  ];
  return {
    ...input,
    site: {
      ...input.site,
      sourceText: applyEdits(input.site.sourceText, input.site.format, edits),
    },
    ...(media
      ? { media: { format: 'json' as const, sourceText: `${JSON.stringify(media, null, 2)}\n` } }
      : {}),
  };
}

const seeded = (seed: string) => pairWith('gen-seed', { 'gen-seed': { seedColor: seed } });

function saved(outcome: DraftOutcome): Draft {
  assert.equal(outcome.kind, 'saved', JSON.stringify(outcome));
  if (outcome.kind !== 'saved') throw new Error('unreachable');
  return outcome.draft;
}

const changesOf = (draft: Draft): readonly RecordedChange[] => draft.derived?.changes ?? [];

async function importPair(store: Store, documents: UnitInput, marker: string) {
  const outcome = await store.publication.importSource(
    {
      documents,
      sourceHash: `sha256:${hex(marker)}`,
      expectedLiveRevisionId: (await store.publication.status()).liveRevisionId,
    },
    'operator',
  );
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  return outcome.kind === 'committed' ? outcome : null;
}

async function draftOf(store: Store): Promise<Draft> {
  const working = await store.drafts.getWorking();
  return saved(
    await store.drafts.create(working ? { expectedVersion: working.version } : {}, 'owner'),
  );
}

async function save(store: Store, draft: Draft, documents: UnitInput): Promise<Draft> {
  return saved(
    await store.drafts.save(
      { draftId: draft.draftId, expectedVersion: draft.version, documents },
      'owner',
    ),
  );
}

async function decide(store: Store, draft: Draft, decision: 'accepted' | 'dismissed') {
  return saved(
    await store.drafts.decideChanges(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        changeIds: changesOf(draft).map(({ id }) => id),
        decision,
      },
      'owner',
    ),
  );
}

async function publish(store: Store, draft: Draft) {
  return owned(store).publish(
    {
      draftId: draft.draftId,
      draftVersion: draft.version,
      expectedLiveRevisionId: (await store.publication.status()).liveRevisionId,
    },
    'owner',
  );
}

const codesOf = (outcome: Awaited<ReturnType<typeof publish>>) =>
  outcome.kind === 'rejected' ? [...new Set(outcome.diagnostics.map(({ code }) => code))] : [];

/** The revision's snapshots/schemes.json, or null when it has none. */
function frozenSchemes(store: Store, revisionId: RevisionId): unknown {
  const file = path.join(store.paths.revision(revisionId), 'snapshots', 'schemes.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

const EXAMPLE_MEDIA = new URL('../../../../example-media/', import.meta.url);

/** The pixelsSha256 example-media/provenance.json records for `file`. */
function provenanceOf(file: string): string {
  const provenance = JSON.parse(
    readFileSync(new URL('provenance.json', EXAMPLE_MEDIA), 'utf8'),
  ) as {
    images: { file: string; pixelsSha256: string }[];
  };
  const found = provenance.images.find((image) => image.file === file);
  assert.ok(found, file);
  return found.pixelsSha256;
}

test("an input's hash is #20's: a seed's text lowercased, and an image's decoded pixels, as provenance.json records them", async () => {
  // #6750a4, hashed as that exact string, in either case.
  assert.equal(
    seedInputsHash('#6750a4'),
    '01a28c730641b83ed17af45a4c2a60f93342735c1c27d2c340808cd5d79f60a3',
  );
  assert.equal(seedInputsHash('#6750A4'), seedInputsHash('#6750a4'));
  // Every bundled example image hashes to its provenance entry.
  const provenance = JSON.parse(
    readFileSync(new URL('provenance.json', EXAMPLE_MEDIA), 'utf8'),
  ) as {
    images: { file: string; pixelsSha256: string }[];
  };
  const hashOf = pixelsSha256(() => loadSharp());
  assert.ok(provenance.images.length > 0);
  for (const image of provenance.images) {
    const bytes = new Uint8Array(readFileSync(new URL(image.file, EXAMPLE_MEDIA)));
    assert.equal(await hashOf(bytes), image.pixelsSha256, image.file);
  }
  // What isn't an image has no pixels to hash.
  assert.equal(await hashOf(new TextEncoder().encode('not an image')), null);
});

const entryFor = (seed: string) => ({
  generator: { id: 'test-seed', version: 1 },
  inputsHash: hex(seed),
  tokens: tokensOf(seed),
});

test("a draft save stores a seed scheme's result; the same input again raises nothing, a new seed raises one scheme-regenerated change the publish waits on, a dismissal puts the live tokens back, and an acceptance publishes the new ones", async (t) => {
  const { generators } = testGenerators();
  const store = await newStore(t, { checks: testChecks({ schemes: generators }) });
  const first = await importPair(store, seeded('#3366FF'), 'first');
  // The import made it, and counts it as accepted, as it does every derived value its files bring.
  assert.deepEqual(frozenSchemes(store, first!.revisionId), { 'gen-seed': entryFor('#3366ff') });

  const draft = await draftOf(store);
  assert.deepEqual(draft.derived?.schemes, { 'gen-seed': entryFor('#3366ff') });
  const same = await save(store, draft, seeded('#3366ff'));
  assert.deepEqual(changesOf(same), [], 'the same seed, in either case, is the same input');

  const reseeded = await save(store, same, seeded('#aa0000'));
  assert.deepEqual(reseeded.derived?.schemes, { 'gen-seed': entryFor('#aa0000') });
  const [change] = changesOf(reseeded);
  assert.equal(changesOf(reseeded).length, 1);
  assert.equal(change?.cause, 'scheme-regenerated');
  assert.deepEqual(change?.subject, { kind: 'scheme', schemeId: 'gen-seed' });
  assert.deepEqual(change?.before, entryFor('#3366ff'));
  assert.deepEqual(change?.fields, ['inputsHash', 'tokens']);

  const refused = await publish(store, reseeded);
  assert.equal(refused.kind === 'rejected' && refused.code, 'validation_failed');
  assert.deepEqual(codesOf(refused), ['derived.unapproved']);
  const [record] = refused.kind === 'rejected' ? refused.diagnostics : [];
  assert.deepEqual([record?.document, record?.pointer], ['site', '/appearanceInputs/gen-seed']);
  // Saving the same seed again is the same change, still waiting.
  const again = await save(store, reseeded, seeded('#AA0000'));
  assert.deepEqual(
    changesOf(again).map(({ id }) => id),
    [change!.id],
  );

  // A dismissal puts the live tokens back, and the publish carries them.
  const dismissed = await decide(store, again, 'dismissed');
  assert.deepEqual(dismissed.derived?.schemes, { 'gen-seed': entryFor('#3366ff') });
  const kept = await publish(store, dismissed);
  assert.equal(kept.kind, 'committed', JSON.stringify(kept));
  const keptId = kept.kind === 'committed' ? kept.revisionId : first!.revisionId;
  assert.deepEqual(frozenSchemes(store, keptId), { 'gen-seed': entryFor('#3366ff') });

  // Accepted, the new tokens go live.
  const next = await save(store, await draftOf(store), seeded('#00aa00'));
  const accepted = await decide(store, next, 'accepted');
  const outcome = await publish(store, accepted);
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  const latest = outcome.kind === 'committed' ? outcome.revisionId : keptId;
  assert.deepEqual(frozenSchemes(store, latest), { 'gen-seed': entryFor('#00aa00') });
});

test('a generator that answers as another id or version, or with a problem, stores nothing, and the save and the publish say why', async (t) => {
  const wrong = testGenerators((declared) => ({
    generator: { id: declared.id, version: declared.version + 1 },
    tokens: tokensOf('#123456'),
  }));
  const store = await newStore(t, { checks: testChecks({ schemes: wrong.generators }) });
  await importPair(store, pairInput('engineering'), 'base');
  const draft = await save(store, await draftOf(store), seeded('#3366ff'));
  assert.equal(draft.derived?.schemes, undefined, 'nothing stored');
  const [finding] = draft.documents.site.diagnostics.filter(
    ({ code }) => code === 'scheme.ungenerated',
  );
  assert.match(
    finding?.message ?? '',
    /declares test-seed version 1, and the generator answered as test-seed version 2/,
  );
  assert.equal(finding?.severity, 'blocks-publish');
  assert.deepEqual(codesOf(await publish(store, draft)), ['scheme.ungenerated']);

  // A bad input is the generator's problem, in its words.
  const plain = await newStore(t, { checks: testChecks({ schemes: testGenerators().generators }) });
  await importPair(plain, pairInput('engineering'), 'base');
  const badInput = await save(plain, await draftOf(plain), seeded('blue'));
  assert.equal(badInput.derived?.schemes, undefined);
  const [problem] = badInput.documents.site.diagnostics.filter(
    ({ code }) => code === 'scheme.ungenerated',
  );
  assert.match(problem?.message ?? '', /test-seed takes a six-digit hex seed color\./);
});

test("a publish freezes only tokens made from the input the site gives now: a draft holding another seed's is refused, and saving it again makes them", async (t) => {
  const { generators } = testGenerators();
  const store = await newStore(t, { checks: testChecks({ schemes: generators }) });
  await importPair(store, pairInput('engineering'), 'base');
  const draft = await save(store, await draftOf(store), seeded('#3366ff'));
  const accepted = await decide(store, draft, 'accepted');
  // As a draft an older build wrote, or one edited on disk: its site gives
  // another seed than the one its tokens came from.
  const file = store.paths.draft(accepted.draftId);
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Draft;
  const other = seeded('#aa0000').site.sourceText;
  const site = stored.documents.site as {
    sourceText: string;
    model: { appearanceInputs: unknown };
  };
  site.sourceText = other;
  site.model.appearanceInputs = { 'gen-seed': { seedColor: '#aa0000' } };
  writeFileSync(file, `${JSON.stringify(stored)}\n`);
  const refused = await publish(store, (await store.drafts.getWorking())!);
  assert.deepEqual(codesOf(refused), ['scheme.ungenerated']);
  const [record] = refused.kind === 'rejected' ? refused.diagnostics : [];
  assert.match(
    record?.message ?? '',
    /holds no tokens for gen-seed from test-seed version 1 and the site's input/,
  );
  // Saved again, the draft makes them from the site's seed, for the owner to accept.
  const resaved = await save(store, (await store.drafts.getWorking())!, seeded('#aa0000'));
  assert.deepEqual(resaved.derived?.schemes, { 'gen-seed': entryFor('#aa0000') });
});

test('high-contrast sets a generator gives round-trip unchanged through save, freeze, and read, and a change to them alone is scheme-regenerated', async (t) => {
  let contrast = '#000000';
  const contrasted = testGenerators((declared) => ({
    generator: { id: declared.id, version: declared.version },
    tokens: { ...tokensOf('#3366ff'), highContrast: tokensOf(contrast) },
  }));
  const store = await newStore(t, { checks: testChecks({ schemes: contrasted.generators }) });
  const first = await importPair(store, seeded('#3366ff'), 'first');
  const expected = {
    ...entryFor('#3366ff'),
    tokens: { ...tokensOf('#3366ff'), highContrast: tokensOf('#000000') },
  };
  assert.deepEqual(frozenSchemes(store, first!.revisionId), { 'gen-seed': expected });
  const read = await readRevision(nodeFs, store.paths, first!.revisionId);
  assert.deepEqual(read.ok ? read.revision.unit.snapshots.schemes : null, { 'gen-seed': expected });
  const draft = await draftOf(store);
  assert.deepEqual(draft.derived?.schemes, { 'gen-seed': expected });
  assert.deepEqual(changesOf(draft), []);
  // The generator's high-contrast sets change, and nothing else does.
  contrast = '#111111';
  const changed = await save(store, draft, seeded('#3366ff'));
  assert.deepEqual(
    changesOf(changed).map(({ cause, fields }) => [cause, fields]),
    [['scheme-regenerated', ['tokens']]],
  );
});

test('a scheme the site no longer selects drops its entry, and the publish freezes none', async (t) => {
  const { generators } = testGenerators();
  const store = await newStore(t, { checks: testChecks({ schemes: generators }) });
  await importPair(store, seeded('#3366ff'), 'first');
  const dropped = await save(store, await draftOf(store), pairInput('engineering'));
  assert.equal(dropped.derived?.schemes, undefined);
  const outcome = await publish(store, dropped);
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  assert.equal(
    frozenSchemes(store, outcome.kind === 'committed' ? outcome.revisionId : ('' as RevisionId)),
    null,
  );
});

/** The test media document: one record, `portrait`, with the given hash and size. */
const portrait = (sha256: string, bytes: number, width = 4, height = 3) => ({
  assets: [
    {
      assetId: 'portrait',
      sha256,
      mime: 'image/png',
      bytes,
      width,
      height,
      renditions: [],
      derivedAt: '2026-10-24T00:00:00.000Z',
      algorithmVersion: 1,
      source: { kind: 'local', path: 'me.png' },
      availability: { state: 'available' },
    },
  ],
});

/** Every way out of the process, each recording itself and throwing. */
function blockNetwork(t: TestContext): string[] {
  const calls: string[] = [];
  const refuse =
    (what: string) =>
    (...args: unknown[]): never => {
      calls.push(`${what} ${String(args[0])}`);
      throw new Error(`The store called the network: ${what}.`);
    };
  t.mock.method(globalThis, 'fetch', async (input: unknown) => refuse('fetch')(input));
  t.mock.method(http, 'request', refuse('http.request'));
  t.mock.method(https, 'request', refuse('https.request'));
  t.mock.method(net.Socket.prototype, 'connect', refuse('net.Socket.connect'));
  return calls;
}

test("an image-derived scheme reads its asset's stored bytes and nothing else, refuses one over the media limits, and its first result waits for the owner", async (t) => {
  const calls = blockNetwork(t);
  const { generators, runs } = testGenerators();
  const store = await newStore(t, { checks: testChecks({ schemes: generators }) });
  await importPair(store, pairInput('engineering'), 'base');
  // The bundled example's portrait, whose pixels provenance.json records.
  const bytes = new Uint8Array(readFileSync(new URL('anamika/portrait.png', EXAMPLE_MEDIA)));
  const stored = await store.assets.put(bytes, 'image/png');
  const sha = stored.sha256.slice('sha256:'.length);
  const image = (media: unknown) =>
    pairWith('gen-image', { 'gen-image': { sourceAsset: 'portrait' } }, media);

  const draft = await save(
    store,
    await draftOf(store),
    image(portrait(sha, bytes.byteLength, 480, 480)),
  );
  const entry = draft.derived?.schemes?.['gen-image'] as { inputsHash: string; tokens: unknown };
  assert.equal(
    entry.inputsHash,
    provenanceOf('anamika/portrait.png'),
    "the hash is the decoded pixels', not the file's",
  );
  assert.notEqual(entry.inputsHash, sha);
  assert.deepEqual(entry.tokens, tokensOf(`#${hex(bytes).slice(0, 6)}`));
  assert.deepEqual(runs, [{ sourceAsset: 'portrait', bytes }]);
  // Its first result is a change like any other, never accepted for the owner.
  const [change] = changesOf(draft);
  assert.deepEqual(
    [change?.cause, change?.before, change?.decision.state],
    ['scheme-regenerated', null, 'pending'],
  );
  assert.deepEqual(codesOf(await publish(store, draft)), ['derived.unapproved']);
  const accepted = await decide(store, draft, 'accepted');
  assert.equal((await publish(store, accepted)).kind, 'committed');

  // Over the media limits, or not stored at all, it's a finding, and nothing is read.
  for (const [what, media] of [
    ['over 20 MiB', portrait(sha, 21 * 1024 * 1024)],
    ['over 100 megapixels', portrait(sha, bytes.byteLength, 20_000, 10_000)],
    ['not stored', portrait('f'.repeat(64), bytes.byteLength, 480, 480)],
  ] as const) {
    const base = await draftOf(store);
    runs.length = 0;
    const refused = await save(store, base, image(media));
    assert.deepEqual(runs, [], `${what}: no generator ran on an asset it may not read`);
    assert.equal(refused.derived?.schemes?.['gen-image'], undefined, what);
    const findings = refused.documents.site.diagnostics.filter(
      ({ code }) => code === 'scheme.ungenerated',
    );
    assert.equal(findings.length, 1, what);
    assert.match(
      findings[0]!.message,
      /over the media limits|missing or over the media limits/,
      what,
    );
  }
  assert.deepEqual(calls, [], 'nothing reached the network');
});

test('the revision freezes snapshots/schemes.json under its digest: a rollback brings the old entry back, and a changed byte fails its integrity check', async (t) => {
  const { generators } = testGenerators();
  const store = await newStore(t, { checks: testChecks({ schemes: generators }) });
  const first = await importPair(store, seeded('#3366ff'), 'first');
  const second = await importPair(store, seeded('#aa0000'), 'second');
  assert.deepEqual(frozenSchemes(store, second!.revisionId), { 'gen-seed': entryFor('#aa0000') });
  const rolled = await owned(store).rollback(
    { targetRevisionId: first!.revisionId, expectedLiveRevisionId: second!.revisionId },
    'owner',
  );
  assert.equal(rolled.kind, 'committed');
  const live = await readRevision(nodeFs, store.paths, first!.revisionId);
  assert.ok(live.ok);
  assert.deepEqual(live.ok ? live.revision.unit.snapshots.schemes : null, {
    'gen-seed': entryFor('#3366ff'),
  });
  // A draft started from it holds the old entry again.
  assert.deepEqual((await draftOf(store)).derived?.schemes, { 'gen-seed': entryFor('#3366ff') });

  const file = path.join(store.paths.revision(second!.revisionId), 'snapshots', 'schemes.json');
  writeFileSync(file, readFileSync(file, 'utf8').replace('#aa0000', '#aa0001'));
  const tampered = await readRevision(nodeFs, store.paths, second!.revisionId);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.ok ? null : tampered.damage, 'hash_mismatch');
});

test("an import leaves out a scheme it can't make whole, with a warning, and goes on", async (t) => {
  const broken = testGenerators(() => ({
    generator: { id: 'test-seed', version: 1 },
    tokens: { light: { accent: '#3366ff' } },
  }));
  const store = await newStore(t, { checks: testChecks({ schemes: broken.generators }) });
  const imported = await importPair(store, seeded('#3366ff'), 'first');
  assert.deepEqual(
    (imported?.warnings ?? []).map(({ code, severity }) => [code, severity]),
    [['scheme.dropped', 'warning']],
  );
  assert.match(imported?.warnings?.[0]?.remediation ?? '', /Nothing to do for the import/);
  assert.equal(frozenSchemes(store, imported!.revisionId), null);
});
