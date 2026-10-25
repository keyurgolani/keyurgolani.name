import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { browserBackend, type LocalSources } from '~/lib/demo/browser-backend';
import { exportUnit } from '~/lib/demo/export';
import { IMPORT_MAX_BYTES, type ImportRefusal, type ImportResult } from '~/lib/demo/import';
import { runImport } from '~/lib/demo/import/pipeline';
import {
  CANARY,
  EXAMPLE,
  HOSTILE_FIXTURES,
  pairFiles,
} from '~/lib/demo/import/test-support/hostile';
import { demoStore, WORKING_KEY } from '~/lib/demo/storage';
import { CATALOG, DEFAULTS, FakeStorage, SCHEME_MODES, UNIT } from '~/lib/demo/test-support';
import { VIEWPORTS } from '~/lib/preview-frame';
import { envelope, LIMITS, readMessage, sizeOf, TO_FRAME } from '~/preview/protocol';
import {
  ContentTask,
  ExportDisclosure,
  ImportReport,
  KEPT_TEXT,
  pickRefusal,
  REFUSAL_TEXT,
} from './demo-content';
import {
  deliver,
  documentMessage,
  frameBudget,
  isLocalFrameSource,
  LOCAL_FRAME_FAILED,
  localFrameElement,
  LocalFrameHost,
  localNonce,
} from './demo-local-frame';
import { DemoStudio } from './demo-studio';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// Demo Studio's import, export, and local frame (#9, design note section
// 3): what the import says is text alone, the export's disclosure says what
// it leaves out, and while this tab holds an imported pair the frame is
// /preview/local, under the demo frame's sandbox, and nothing else.

const POLICY = { profile: 'demo', allowed: ['sandbox.view'] } as const;

function backend(session = new FakeStorage()) {
  return browserBackend({
    unit: UNIT,
    catalog: CATALOG,
    schemeModes: SCHEME_MODES,
    defaults: DEFAULTS,
    store: demoStore(new FakeStorage(), session),
    importer: async (files) => runImport(files),
  });
}

/** Every attribute of each iframe in `html`. */
function frames(html: string): Record<string, string>[] {
  return [...html.matchAll(/<iframe\b([^>]*)>/g)].map(([, tag]) =>
    Object.fromEntries(
      [...tag!.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, name, value]) => [
        name!.toLowerCase(),
        value!,
      ]),
    ),
  );
}

const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(2)>';

test("the import's answer is text alone: a finding, remote media, what wasn't checked, and each refusal", () => {
  const example = runImport(pairFiles(EXAMPLE.portfolio));
  if (example.kind !== 'imported') assert.fail(example.code);
  const imported: ImportResult = {
    kind: 'imported',
    unit: example.unit,
    diagnostics: [
      {
        code: 'UNKNOWN_KEY',
        severity: 'warning',
        document: 'portfolio',
        pointer: `/${HOSTILE}`,
        line: 3,
        message: `A key ${HOSTILE}.`,
        remediation: HOSTILE,
      } as never,
    ],
    remoteImages: [
      { document: 'portfolio', kind: 'image', pointer: `/media/0/${HOSTILE}`, host: HOSTILE },
    ],
    unchecked: [HOSTILE],
  };
  const html = renderToStaticMarkup(<ImportReport result={imported} />);
  // Every value shows, escaped: no element or attribute of its own.
  assert.doesNotMatch(html, /<script|<img|<[^>]*\son[a-z]+=/i);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.match(html, /portfolio \/&lt;script&gt;.*, line 3: A key /);
  assert.match(html, /image from &lt;script&gt;/);
  assert.match(html, /Not checked here: &lt;script&gt;/);
  assert.match(html, /<p role="status">Imported\./);
  for (const code of Object.keys(REFUSAL_TEXT) as ImportRefusal[]) {
    const refused = renderToStaticMarkup(
      <ImportReport result={{ kind: 'refused', code, diagnostics: [] }} />,
    );
    assert.ok(refused.includes(REFUSAL_TEXT[code].replace(/'/g, '&#x27;')), code);
    assert.equal(refused.includes('<li'), false, code);
  }
});

test("the export's disclosure says the schema versions, what the files leave out, and which won't import again", () => {
  const { disclosure } = exportUnit(
    {
      sources: {
        portfolio: { name: 'portfolio.yml', format: 'yaml', text: `# note\n${EXAMPLE.portfolio}` },
        site: { name: 'site.yml', format: 'yaml', text: EXAMPLE.site },
      },
    },
    'yaml',
  );
  const html = renderToStaticMarkup(<ExportDisclosure disclosure={disclosure} />);
  assert.match(html, /Schema versions: portfolio \d+, site \d+\./);
  assert.match(
    html,
    /Left out: the appearance you picked in the demo.*; images picked in this browser; comments in your YAML/,
  );
  assert.doesNotMatch(html, /import cap/);
  const over = renderToStaticMarkup(
    <ExportDisclosure disclosure={{ ...disclosure, overImportCap: ['site'] }} />,
  );
  assert.match(
    over,
    /<p role="alert">site\.yml is over the 1 MiB import cap, so it won&#x27;t import again\.<\/p>/,
  );
});

test('the Content task has one picker for two YAML or JSON files, no form and no paste, and Export setup', () => {
  const html = renderToStaticMarkup(<ContentTask backend={backend()} onSource={() => {}} />);
  assert.match(
    html,
    /<input id="studio-demo-import" class="studio-input" type="file" multiple="" accept="\.yml,\.yaml,\.json,application\/json"/,
  );
  assert.equal((html.match(/<input\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<form|<textarea|contenteditable/);
  assert.match(html, /<button type="button" class="studio-button">Export setup<\/button>/);
  assert.match(html, /the sample&#x27;s documents as two YAML files/);
});

test('a local frame loads /preview/local with a nonce in its fragment, and nothing else', () => {
  const nonce = localNonce();
  assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(localNonce(), nonce);
  assert.ok(isLocalFrameSource(`/preview/local#nonce=${nonce}`));
  for (const src of [
    '/preview/local',
    `/preview/local?nonce=${nonce}`,
    `/preview/local#nonce=${nonce}&x=1`,
    `/preview/local#nonce=${nonce.slice(1)}`,
    `/preview/localx#nonce=${nonce}`,
    `/preview/local/work/a#nonce=${nonce}`,
    `//evil.test/preview/local#nonce=${nonce}`,
    `https://evil.test/preview/local#nonce=${nonce}`,
    `/preview/g_7Hk-2#nonce=${nonce}`,
    `/sample#nonce=${nonce}`,
    `/PREVIEW/local#nonce=${nonce}`,
  ]) {
    assert.equal(isLocalFrameSource(src), false, src);
  }
});

test("the local frame keeps the demo frame's sandbox, scripts alone, and loads only once Studio's half of the channel is open", () => {
  const sources: LocalSources = {
    portfolio: { name: 'portfolio.yml', format: 'yaml', text: EXAMPLE.portfolio },
    site: { name: 'site.yml', format: 'yaml', text: EXAMPLE.site },
  };
  const html = renderToStaticMarkup(
    <LocalFrameHost
      sources={sources}
      selection={DEFAULTS}
      title="Your documents"
      viewport={VIEWPORTS[2]!}
      reduced={false}
    />,
  );
  const [frame, ...more] = frames(html);
  assert.equal(more.length, 0);
  assert.ok(frame);
  assert.equal(frame.sandbox, 'allow-scripts');
  assert.equal(frame.referrerpolicy, 'no-referrer');
  // No source until the channel is open: the effect sets it, in the browser.
  assert.equal(frame.src, undefined);
  // The document Studio sends is one #7's protocol takes for a frame, with the
  // source as its text and the selection's five axes.
  const message = documentMessage(sources, DEFAULTS);
  const read = readMessage(envelope('document', message, 1), TO_FRAME);
  assert.ok(read.ok, JSON.stringify(read));
  assert.deepEqual(Object.keys(message.selection).sort(), Object.keys(DEFAULTS).sort());
});

test('while this tab holds an imported pair the frame is /preview/local, otherwise /sample, and the page names no source', async () => {
  const session = new FakeStorage();
  const sample = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={backend(session)} task="content" />,
  );
  assert.match(frames(sample)[0]!.src ?? '', /^\/sample/);
  assert.doesNotMatch(sample, /data-source="local"/);
  const importer = backend(session);
  assert.equal((await importer.importFiles(pairFiles(EXAMPLE.portfolio)))?.kind, 'imported');
  assert.ok(session.getItem(WORKING_KEY));
  // A page in the same tab, as after a reload, shows the local frame on every task.
  for (const task of ['appearance', 'preview', 'content'] as const) {
    const html = renderToStaticMarkup(
      <DemoStudio catalog={CATALOG} policy={POLICY} backend={backend(session)} task={task} />,
    );
    const [frame] = frames(html);
    assert.equal(frame?.sandbox, 'allow-scripts', task);
    assert.equal(frame?.src, undefined, task);
    assert.match(html, /data-source="local"/, task);
    // Nothing of the documents is on the page: they go over the port alone.
    assert.equal(html.includes('Anamika'), false, task);
  }
});

/** A Worker the page's policy blocks, or that fails to load: it says so as an error, with the input nowhere in it. */
function brokenWorker(t: test.TestContext, how: 'blocked' | 'fails') {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const prevented: boolean[] = [];
  class Failing {
    onmessage: unknown = null;
    onerror: ((event: { preventDefault(): void; message: string }) => void) | null = null;
    onmessageerror: unknown = null;
    constructor() {
      if (how === 'blocked') throw new Error("SecurityError: blocked by the page's policy");
    }
    postMessage() {
      queueMicrotask(() => {
        let done = false;
        this.onerror?.({
          message: 'Failed to load the worker script',
          preventDefault: () => {
            done = true;
          },
        });
        prevented.push(done);
      });
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', {
    value: Failing,
    configurable: true,
    writable: true,
  });
  t.after(() => {
    if (had) Object.defineProperty(globalThis, 'Worker', had);
    else delete (globalThis as { Worker?: unknown }).Worker;
  });
  return prevented;
}

test('with the worker blocked, or failing to load, the import says worker_unavailable as text, keeps nothing, and logs nothing (risk 8)', async (t) => {
  const logged: unknown[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => logged.push(args));
  }
  const fixture = HOSTILE_FIXTURES.find(({ expect }) => expect === 'imported')!;
  for (const how of ['blocked', 'fails'] as const) {
    const prevented = brokenWorker(t, how);
    const session = new FakeStorage();
    // The backend's own importer: the module worker, as the page has it.
    const demo = browserBackend({
      unit: UNIT,
      catalog: CATALOG,
      schemeModes: SCHEME_MODES,
      defaults: DEFAULTS,
      store: demoStore(new FakeStorage(), session),
    });
    const result = await demo.importFiles(fixture.files);
    assert.deepEqual(result, { kind: 'refused', code: 'worker_unavailable', diagnostics: [] }, how);
    assert.equal(demo.localSources(), null, how);
    assert.deepEqual([...session.items.keys()], [], how);
    // A failed load's error is handled, so the browser adds no line of its own for it.
    if (how === 'fails') assert.deepEqual(prevented, [true]);
    const html = renderToStaticMarkup(<ImportReport result={result} />);
    assert.match(
      html,
      /<p role="status">The import couldn&#x27;t start in this browser, so nothing was read\.<\/p>/,
      how,
    );
    assert.equal(html.includes(CANARY), false, how);
  }
  assert.deepEqual(logged, []);
});

test("a frame document takes documents up to #7's 100 MiB in all, and the next one goes to a new frame document instead of being dropped", () => {
  const sources: LocalSources = {
    portfolio: { name: 'portfolio.yml', format: 'yaml', text: EXAMPLE.portfolio },
    site: { name: 'site.yml', format: 'yaml', text: EXAMPLE.site },
  };
  const message = documentMessage(sources, DEFAULTS);
  const bytes = sizeOf(message, LIMITS.document);
  assert.ok(bytes > 0);
  // The frame's own limit by default, counted as the frame counts it.
  const budget = frameBudget();
  const fits = Math.floor(LIMITS.frame / bytes);
  for (let index = 0; index < fits; index++) assert.equal(budget.take(message), true, `${index}`);
  assert.equal(budget.take(message), false, "one past the frame's total");
  // A refused one counts nothing, and a fresh budget, a new frame document's, takes it.
  const small = frameBudget(bytes * 2);
  assert.equal(small.take(message), true);
  assert.equal(small.take(message), true);
  assert.equal(small.take(message), false);
  assert.equal(small.take(message), false);
  assert.equal(frameBudget(bytes * 2).take(message), true);
});

test("past a frame document's budget, the next document goes to a new frame document, on an iframe of its own keyed on its nonce, so it loads a new document rather than moving the old one's fragment (handoff 2)", () => {
  const sources: LocalSources = {
    portfolio: { name: 'portfolio.yml', format: 'yaml', text: EXAMPLE.portfolio },
    site: { name: 'site.yml', format: 'yaml', text: EXAMPLE.site },
  };
  const message = documentMessage(sources, DEFAULTS);
  const bytes = sizeOf(message, LIMITS.document);
  const events: string[] = [];
  const send = () => events.push('send');
  const remount = () => events.push('remount');
  let budget = frameBudget(bytes * 2);
  for (let index = 0; index < 3; index++) deliver(budget, message, send, remount);
  assert.deepEqual(events, ['send', 'send', 'remount']);
  // The new frame document's budget, which its ready gets the document from.
  budget = frameBudget(bytes * 2);
  deliver(budget, message, send, remount);
  assert.deepEqual(events, ['send', 'send', 'remount', 'send']);

  // Each nonce's frame is an element of its own: React replaces an element
  // whose key changes, and a new iframe is a new browsing context.
  const props = { ref: null, title: 'Your documents', viewport: VIEWPORTS[2]!, scale: 1 };
  const [first, second] = [localNonce(), localNonce()];
  const before = localFrameElement(first, props);
  const after = localFrameElement(second, props);
  assert.equal(before.type, 'iframe');
  assert.equal(before.key, first);
  assert.equal(after.key, second);
  assert.notEqual(before.key, after.key);
  // Neither names a source: the host's effect sets it once the channel is open.
  for (const element of [before, after]) {
    const attributes = frames(renderToStaticMarkup(element))[0]!;
    assert.equal(attributes.sandbox, 'allow-scripts');
    assert.equal(attributes.src, undefined);
  }
});

test("a pick is refused by its count and sizes before any file is read, with the core's own codes (F4)", () => {
  // A file the picker must never read: reading it fails the test.
  const file = (size: number) => ({
    size,
    arrayBuffer: () => assert.fail('read before the count and sizes were checked'),
  });
  assert.equal(pickRefusal([file(10), file(10), file(10)]), 'too_many_files');
  assert.equal(pickRefusal([file(10)]), 'not_one_document');
  assert.equal(pickRefusal([file(10), file(IMPORT_MAX_BYTES + 1)]), 'too_large');
  assert.equal(pickRefusal([file(IMPORT_MAX_BYTES), file(1)]), null);
  // The picker asks before it reads: pickRefusal comes first in pick(), and returns early.
  const source = readFileSync(new URL('./demo-content.tsx', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function pick('));
  const asked = body.indexOf('pickRefusal(files)');
  const read = body.indexOf('.map(inputOf)');
  assert.ok(asked > 0 && read > asked, 'pickRefusal before any file is read');
  assert.match(body.slice(asked, read), /if \(early\) \{[\s\S]*?\n\s*return;\n\s*\}/);
});

test("a working copy this tab kept shows its own report, never one that says it was just imported, and the frame's alert never points at findings (F6)", () => {
  const example = runImport(pairFiles(EXAMPLE.portfolio));
  if (example.kind !== 'imported') assert.fail(example.code);
  const text = (html: string) => html.replace(/&#x27;/g, "'");
  const kept = text(renderToStaticMarkup(<ImportReport result={example} kept />));
  assert.ok(kept.includes(`<p role="status">${KEPT_TEXT.imported}</p>`));
  assert.equal(kept.includes('Imported.'), false);
  assert.match(kept, /data-kept="true"/);
  for (const [code, expected] of [
    ['invalid', KEPT_TEXT.refused],
    ['parse_limits', KEPT_TEXT.refused],
    ['timeout', KEPT_TEXT.unchecked],
    ['worker_unavailable', KEPT_TEXT.unchecked],
  ] as const) {
    const html = text(
      renderToStaticMarkup(
        <ImportReport result={{ kind: 'refused', code, diagnostics: [] }} kept />,
      ),
    );
    assert.ok(html.includes(`<p role="status">${expected}</p>`), code);
  }
  // A pick's report is as before.
  assert.doesNotMatch(renderToStaticMarkup(<ImportReport result={example} />), /data-kept/);
  assert.doesNotMatch(LOCAL_FRAME_FAILED, /finding/i);
});

test("the host's remount wiring: remount() starts a new nonce, both places a document goes hand deliver() remount, and the frame is the nonce's own element (handoff 2)", () => {
  const source = readFileSync(new URL('./demo-local-frame.tsx', import.meta.url), 'utf8');
  const body = (name: string) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start > 0, name);
    return source.slice(start, source.indexOf('\n  }\n', start));
  };
  // A new frame document: loading again, on a nonce of its own.
  assert.match(body('remount'), /setPhase\('loading'\);\s*setNonce\(localNonce\(\)\);/);
  // The ready handler's document and every later one go through deliver(), with remount.
  const delivered = [
    ...source.matchAll(/deliver\(\s*budget\.current,[\s\S]*?\n\s*remount,\n\s*\);/g),
  ];
  assert.equal(delivered.length, 2, 'both documents go through deliver() with remount');
  // And the iframe is localFrameElement's, keyed on the nonce the host holds.
  assert.match(source, /\{localFrameElement\(nonce, \{ ref: frame, title, viewport, scale \}\)\}/);
  assert.equal((source.match(/<iframe\b/g) ?? []).length, 1, 'one iframe, in localFrameElement');
});
