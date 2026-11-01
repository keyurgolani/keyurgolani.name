import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { documentAppearance } from '~/lib/document-appearance';
import { VARIANTS } from '~/lib/generated/registry.meta';
import {
  appearanceEdits,
  appearanceOfSite,
  canonicalState,
  type AppearanceState,
} from '~/lib/studio/appearance';
import { appearanceCatalog } from '../studio-appearance';
import { buildUnitChecks } from '../unit-checks';

// LANG-1 over a real data directory: a draft and a published revision that
// name a retired design language (ant-inspired, now primer-inspired) save,
// publish, serve, and read as the survivor, and nothing rewrites them. The
// store's bytes stay as written until the owner saves a change on that
// axis, which writes what the owner picked through the draft path (the
// lead's option a); a save of another axis leaves the alias where it is.

const SITE = `schemaVersion: 2
appearance:
  variant: editorial-evidence
  designLanguage: ant-inspired
  colorScheme: warm-parchment
  typography: humanist-ui
  displayMode: system
visitorControls:
  variant: locked
  designLanguage: locked
  colorScheme: selectable
  typography: locked
  displayMode: selectable
motionPolicy: respect-os
features:
  feed: true
`;
const PORTFOLIO = `schemaVersion: 3
locale: en
direction: ltr
identity:
  name: Rowan Alias
sections:
  - kind: lede
    id: about
    body: Hi.
`;

let root: string;

test.before(() => {
  root = mkdtempSync(path.join(tmpdir(), 'retired-alias-'));
});
test.after(() => rmSync(root, { recursive: true, force: true }));

/** Every file under `dir` by its path, with its bytes. */
function bytes(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = path.join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(path.relative(dir, full), readFileSync(full).toString('base64'));
    }
  };
  walk(dir);
  return files;
}

/** The files in `after` that differ from `before`, or are new or gone. */
function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => before.get(file) !== after.get(file))
    .sort();
}

test('a retired id in a draft and a live revision saves, publishes, serves as its survivor, and is never rewritten', async () => {
  const core = await import('@portfolio/core/owner');
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir, { mode: 0o700 });
  assert.equal(await core.preflight({ dataDir }), null);
  const store = core.openStore({
    dataDir,
    checks: buildUnitChecks({
      registry: VARIANTS,
      appearance: APPEARANCE_REGISTRY,
      appVersion: '',
    }),
  });
  const documents = {
    portfolio: { format: 'yaml' as const, sourceText: PORTFOLIO },
    site: { format: 'yaml' as const, sourceText: SITE },
  };
  // The alias is a warning: the save goes through, and so does the publish.
  const created = await store.drafts.create({ documents }, 'owner');
  assert.equal(created.kind, 'saved', JSON.stringify(created));
  assert.ok(created.kind === 'saved');
  const findings = created.draft.documents.site.diagnostics.map(({ code, severity }) => [
    code,
    severity,
  ]);
  assert.deepEqual(findings, [['appearance.alias', 'warning']]);
  const outcome = await store.publication.publish(
    { draftId: created.draft.draftId, draftVersion: 1, expectedLiveRevisionId: null },
    'operator',
  );
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  assert.ok(outcome.kind === 'committed');

  // The owner's next draft starts from live, as Studio's first edit does.
  const next = await store.drafts.create({}, 'owner');
  assert.ok(next.kind === 'saved', JSON.stringify(next));
  const before = bytes(dataDir);
  // Serving and reading it, as startup, the page, Studio, and the history do.
  const health = await store.revisions.health(outcome.revisionId, 'serve');
  assert.equal(health.state, 'ok');
  const publishable = await store.revisions.health(outcome.revisionId, 'publish');
  assert.equal(publishable.state, 'ok');
  const revision = await store.revisions.read(outcome.revisionId);
  assert.ok(revision.ok);
  const site = parse(revision.revision.unit.site.sourceText) as NonNullable<
    Parameters<typeof documentAppearance>[0]['site']
  >;
  assert.equal(
    site.appearance.designLanguage,
    'ant-inspired',
    'the revision keeps what was published',
  );
  const page = documentAppearance({ site, variant: site.appearance.variant, profile: 'owner' });
  assert.equal(page.selection.designLanguage, 'primer-inspired');
  assert.deepEqual(page.fallbackAxes, []);
  const working = await store.drafts.getWorking();
  assert.ok(working);
  const catalog = appearanceCatalog();
  const saved = canonicalState(
    catalog,
    appearanceOfSite(parse(working.documents.site.sourceText)),
  )!;
  assert.equal(saved.selection.designLanguage, 'primer-inspired', 'Studio shows the survivor');
  assert.deepEqual(appearanceEdits(saved, saved), [], 'and has nothing to save');
  assert.deepEqual(changed(before, bytes(dataDir)), [], 'reading wrote nothing');

  // A save of another axis writes that axis alone: the alias stays in the draft.
  const scheme: AppearanceState = {
    ...saved,
    selection: { ...saved.selection, colorScheme: 'neutral-slate' },
  };
  const schemeEdits = appearanceEdits(saved, scheme);
  assert.deepEqual(
    schemeEdits.map(({ pointer, value }) => [pointer, value]),
    [['/appearance/colorScheme', 'neutral-slate']],
  );
  const first = await store.drafts.applyEdits(
    { draftId: working.draftId, expectedVersion: working.version, edits: schemeEdits },
    'owner',
  );
  assert.ok(first.kind === 'saved', JSON.stringify(first));
  assert.match(first.draft.documents.site.sourceText, /designLanguage: ant-inspired/);
  const revisionFiles = (files: Map<string, string>) =>
    new Map([...files].filter(([file]) => file.includes(outcome.revisionId)));
  assert.ok(revisionFiles(before).size > 0);
  assert.deepEqual(changed(revisionFiles(before), revisionFiles(bytes(dataDir))), []);

  // A save of the design language writes what the owner picked, never an alias.
  const after = canonicalState(
    catalog,
    appearanceOfSite(parse(first.draft.documents.site.sourceText)),
  )!;
  const language: AppearanceState = {
    ...after,
    selection: { ...after.selection, designLanguage: 'spectrum-2-inspired' },
  };
  const second = await store.drafts.applyEdits(
    {
      draftId: first.draft.draftId,
      expectedVersion: first.draft.version,
      edits: appearanceEdits(after, language),
    },
    'owner',
  );
  assert.ok(second.kind === 'saved', JSON.stringify(second));
  assert.match(second.draft.documents.site.sourceText, /designLanguage: spectrum-2-inspired/);
  assert.doesNotMatch(second.draft.documents.site.sourceText, /ant-inspired/);
  assert.deepEqual(second.draft.documents.site.diagnostics, []);
  // The published revision is still byte for byte what was published.
  assert.deepEqual(changed(revisionFiles(before), revisionFiles(bytes(dataDir))), []);
});

// LANG-5a: the same over a retired color scheme and typography profile
// (bookcloth, now paper-ink; literary-reading, now editorial-serif), with
// the notices that say what changed at the merge.
const SITE_5A = SITE.replace('designLanguage: ant-inspired', 'designLanguage: primer-inspired')
  .replace('colorScheme: warm-parchment', 'colorScheme: bookcloth')
  .replace('typography: humanist-ui', 'typography: literary-reading');

test('a retired scheme and typography profile in a draft and a live revision save, publish, serve as their survivors, and are never rewritten (LANG-5a)', async () => {
  assert.match(SITE_5A, /colorScheme: bookcloth\n {2}typography: literary-reading\n/);
  const core = await import('@portfolio/core/owner');
  const dataDir = path.join(root, 'data-5a');
  mkdirSync(dataDir, { mode: 0o700 });
  assert.equal(await core.preflight({ dataDir }), null);
  const store = core.openStore({
    dataDir,
    checks: buildUnitChecks({
      registry: VARIANTS,
      appearance: APPEARANCE_REGISTRY,
      appVersion: '',
    }),
  });
  const created = await store.drafts.create(
    {
      documents: {
        portfolio: { format: 'yaml' as const, sourceText: PORTFOLIO },
        site: { format: 'yaml' as const, sourceText: SITE_5A },
      },
    },
    'owner',
  );
  assert.ok(created.kind === 'saved', JSON.stringify(created));
  assert.deepEqual(
    created.draft.documents.site.diagnostics.map(({ code, severity, message }) => [
      code,
      severity,
      message,
    ]),
    [
      [
        'appearance.alias',
        'warning',
        "/appearance/colorScheme bookcloth was merged into paper-ink and follows its updates; bookcloth now resolves to paper-ink's dove-grey stock; its cloth inks survive in paper-ink's categorical set.",
      ],
      [
        'appearance.alias',
        'warning',
        '/appearance/typography literary-reading was merged into editorial-serif and follows its updates; at the merge, its serif became an old-style face (Iowan Old Style on Apple devices) and its labels a neutral sans.',
      ],
    ],
  );
  const outcome = await store.publication.publish(
    { draftId: created.draft.draftId, draftVersion: 1, expectedLiveRevisionId: null },
    'operator',
  );
  assert.ok(outcome.kind === 'committed', JSON.stringify(outcome));
  const next = await store.drafts.create({}, 'owner');
  assert.ok(next.kind === 'saved', JSON.stringify(next));
  const before = bytes(dataDir);
  assert.equal((await store.revisions.health(outcome.revisionId, 'serve')).state, 'ok');
  assert.equal((await store.revisions.health(outcome.revisionId, 'publish')).state, 'ok');
  const revision = await store.revisions.read(outcome.revisionId);
  assert.ok(revision.ok);
  const site = parse(revision.revision.unit.site.sourceText) as NonNullable<
    Parameters<typeof documentAppearance>[0]['site']
  >;
  assert.equal(site.appearance.colorScheme, 'bookcloth', 'the revision keeps what was published');
  assert.equal(site.appearance.typography, 'literary-reading');
  const page = documentAppearance({ site, variant: site.appearance.variant, profile: 'owner' });
  assert.equal(page.selection.colorScheme, 'paper-ink');
  assert.equal(page.selection.typography, 'editorial-serif');
  assert.deepEqual(page.fallbackAxes, []);
  const working = await store.drafts.getWorking();
  assert.ok(working);
  const catalog = appearanceCatalog();
  const saved = canonicalState(
    catalog,
    appearanceOfSite(parse(working.documents.site.sourceText)),
  )!;
  assert.equal(saved.selection.colorScheme, 'paper-ink', 'Studio shows the survivor');
  assert.equal(saved.selection.typography, 'editorial-serif');
  assert.deepEqual(appearanceEdits(saved, saved), [], 'and has nothing to save');
  assert.deepEqual(changed(before, bytes(dataDir)), [], 'reading wrote nothing');

  // A save of the typography writes that axis alone: the scheme alias stays in the draft.
  const typography: AppearanceState = {
    ...saved,
    selection: { ...saved.selection, typography: 'book-serif' },
  };
  const first = await store.drafts.applyEdits(
    {
      draftId: working.draftId,
      expectedVersion: working.version,
      edits: appearanceEdits(saved, typography),
    },
    'owner',
  );
  assert.ok(first.kind === 'saved', JSON.stringify(first));
  assert.match(first.draft.documents.site.sourceText, /colorScheme: bookcloth/);
  assert.match(first.draft.documents.site.sourceText, /typography: book-serif/);
  const revisionFiles = (files: Map<string, string>) =>
    new Map([...files].filter(([file]) => file.includes(outcome.revisionId)));
  assert.ok(revisionFiles(before).size > 0);
  assert.deepEqual(changed(revisionFiles(before), revisionFiles(bytes(dataDir))), []);

  // A save of the scheme writes what the owner picked, never an alias.
  const after = canonicalState(
    catalog,
    appearanceOfSite(parse(first.draft.documents.site.sourceText)),
  )!;
  const scheme: AppearanceState = {
    ...after,
    selection: { ...after.selection, colorScheme: 'signal-paper' },
  };
  const second = await store.drafts.applyEdits(
    {
      draftId: first.draft.draftId,
      expectedVersion: first.draft.version,
      edits: appearanceEdits(after, scheme),
    },
    'owner',
  );
  assert.ok(second.kind === 'saved', JSON.stringify(second));
  assert.match(second.draft.documents.site.sourceText, /colorScheme: signal-paper/);
  assert.doesNotMatch(second.draft.documents.site.sourceText, /bookcloth|literary-reading/);
  assert.deepEqual(second.draft.documents.site.diagnostics, []);
  assert.deepEqual(changed(revisionFiles(before), revisionFiles(bytes(dataDir))), []);
});
