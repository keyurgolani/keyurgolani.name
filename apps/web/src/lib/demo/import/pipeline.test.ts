import test from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { DOCUMENT_MAX_BYTES, isAllowedUrl, serialize } from '@portfolio/schema';
import {
  renderInlineMarkdown as postPassInline,
  renderMarkdown as postPassBlock,
} from '@portfolio/kit/markdown';
import {
  renderInlineMarkdown as browserInline,
  renderMarkdown as browserBlock,
} from '../../../../../../packages/kit/src/markdown';
import { htmlProblems } from '../../../../../../packages/kit/src/test-support/strict-html';
import {
  importMessage,
  uncheckedNames,
  IMPORT_MAX_BYTES,
  remoteImages,
  runImport,
  validateImport,
  type ImportInput,
  type ImportResult,
} from './pipeline';
import {
  bytes,
  CANARY,
  EXAMPLE,
  exampleData,
  HOSTILE_FIXTURES,
  pairFiles,
  portfolioWith,
} from './test-support/hostile';

// The import's pipeline (#9, PR 3), headless: every refusal, #4's limits,
// validator, and URL rules, the remote image list, the inert render of
// hostile Markdown through both of #10's renderers, and errors that never
// repeat what was imported.

type Imported = Extract<ImportResult, { kind: 'imported' }>;

function imported(result: ImportResult): Imported {
  assert.equal(result.kind, 'imported', JSON.stringify(result.kind === 'refused' && result));
  return result as Imported;
}

function refusal(result: ImportResult): string {
  return result.kind === 'refused' ? result.code : 'imported';
}

/** Everything a result says about the files but the files' own text and models. */
function messages(result: ImportResult): string {
  return JSON.stringify(
    result.kind === 'refused'
      ? result
      : { diagnostics: result.diagnostics, remoteImages: result.remoteImages },
  );
}

test('the example pair imports in either order, with its text, format, and versions, and no file name', () => {
  const files = pairFiles(EXAMPLE.portfolio);
  for (const order of [files, [...files].reverse()]) {
    const { unit, diagnostics } = imported(runImport(order));
    assert.deepEqual(unit.sources.portfolio, {
      text: EXAMPLE.portfolio,
      format: 'yaml',
      name: 'portfolio.yml',
    });
    assert.deepEqual(unit.sources.site, { text: EXAMPLE.site, format: 'yaml', name: 'site.yml' });
    assert.deepEqual(unit.schemaVersions, { portfolio: 3, site: 2 });
    assert.equal(unit.models.portfolio.identity.name, 'Anamika Devi');
    assert.equal(unit.models.site.appearance.variant, 'editorial-evidence');
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(Object.keys(unit).sort(), ['models', 'schemaVersions', 'sources']);
    assert.equal(JSON.stringify(unit).includes(CANARY), false);
  }
});

test('the format comes from the text, never the name: JSON under a .yml name and YAML under .json both import', () => {
  const json = serialize(exampleData('portfolio'), 'json');
  const { unit } = imported(
    runImport([
      { name: 'site.json', bytes: bytes(EXAMPLE.site) },
      { name: 'portfolio.yml', bytes: bytes(`\uFEFF  \n${json}`) },
    ]),
  );
  assert.equal(unit.sources.portfolio.format, 'json');
  assert.equal(unit.sources.portfolio.name, 'portfolio.json');
  assert.equal(unit.sources.site.format, 'yaml');
});

test('more than two files is too_many_files, and anything but one portfolio and one site document is not_one_document', () => {
  const [portfolio, site] = pairFiles(EXAMPLE.portfolio) as [ImportInput, ImportInput];
  assert.equal(refusal(runImport([portfolio, site, site])), 'too_many_files');
  assert.equal(refusal(runImport([portfolio, site, bytesFile('')])), 'too_many_files');
  assert.equal(refusal(runImport([])), 'not_one_document');
  assert.equal(refusal(runImport([portfolio])), 'not_one_document');
  assert.equal(refusal(runImport([portfolio, portfolio])), 'not_one_document');
  assert.equal(refusal(runImport([site, site])), 'not_one_document');
  for (const other of [
    '',
    '# nothing\n',
    'title = "TOML"\n[owner]\nname = "x"\n',
    '[]',
    '"text"',
  ]) {
    assert.equal(refusal(runImport([portfolio, bytesFile(other)])), 'not_one_document', other);
  }
  // Both keys, or neither, names no document.
  const both = serialize({ ...exampleData('site'), identity: { name: 'x' } }, 'yaml');
  assert.equal(refusal(runImport([portfolio, bytesFile(both)])), 'not_one_document');
});

test('a file over 1 MiB is too_large before anything parses it, and one of exactly 1 MiB is read', () => {
  assert.equal(IMPORT_MAX_BYTES, DOCUMENT_MAX_BYTES);
  assert.equal(IMPORT_MAX_BYTES, 1024 * 1024);
  const [portfolio] = pairFiles(EXAMPLE.portfolio) as [ImportInput];
  const padded = (size: number) => {
    const head = EXAMPLE.site;
    return `${head}#${'x'.repeat(size - Buffer.byteLength(head) - 2)}\n`;
  };
  const exact = bytesFile(padded(IMPORT_MAX_BYTES));
  assert.equal(exact.bytes.byteLength, IMPORT_MAX_BYTES);
  imported(runImport([portfolio, exact]));
  const over = bytesFile(padded(IMPORT_MAX_BYTES + 1));
  assert.equal(over.bytes.byteLength, IMPORT_MAX_BYTES + 1);
  assert.deepEqual(runImport([portfolio, over]), {
    kind: 'refused',
    code: 'too_large',
    diagnostics: [],
  });
  // Bytes that aren't text, and an alias bomb, past the cap: the size decides first.
  const junk = { name: 'x', bytes: new Uint8Array(IMPORT_MAX_BYTES + 1).fill(0xff) };
  assert.equal(refusal(runImport([portfolio, junk])), 'too_large');
  const bomb = HOSTILE_FIXTURES.find(({ expect }) => expect === 'parse_limits')!.files[0]!;
  const bigBomb = bytesFile(
    `${new TextDecoder().decode(bomb.bytes)}#${'x'.repeat(IMPORT_MAX_BYTES)}\n`,
  );
  assert.equal(refusal(runImport([bigBomb, bytesFile(EXAMPLE.site)])), 'too_large');
});

test("#4's pre-parse limits refuse a YAML alias bomb, anchors, merge keys, and deep or wide nesting as parse_limits", () => {
  const site = EXAMPLE.site;
  const cases: Record<string, string> = {
    'alias bomb': new TextDecoder().decode(
      HOSTILE_FIXTURES.find(({ name }) => name === 'a YAML alias bomb')!.files[0]!.bytes,
    ),
    anchor: `${EXAMPLE.portfolio}extra: &one ${CANARY}\n`,
    'merge key': `${EXAMPLE.portfolio}base: { a: 1 }\nmore:\n  <<: { b: 2 }\n`,
    'deep YAML': `schemaVersion: 3\nidentity: { name: x }\ndeep: ${'['.repeat(80)}1${']'.repeat(80)}\n`,
    'deep JSON': new TextDecoder().decode(
      HOSTILE_FIXTURES.find(({ name }) => name === 'JSON nested past the limit')!.files[0]!.bytes,
    ),
    'wide JSON': `{"schemaVersion":3,"identity":{"name":"x"},"wide":[${Array(10_001).fill('0').join(',')}]}`,
  };
  for (const [name, text] of Object.entries(cases)) {
    const started = performance.now();
    const result = runImport([bytesFile(text), bytesFile(site)]);
    assert.equal(refusal(result), 'parse_limits', name);
    assert.ok(performance.now() - started < 2000, `${name} took too long`);
    assert.ok(result.diagnostics.length > 0, name);
    for (const diagnostic of result.diagnostics) {
      assert.equal(diagnostic.code, 'parse.syntax', name);
      assert.equal(diagnostic.document, 'portfolio', name);
      assert.equal(typeof diagnostic.line, 'number', name);
    }
    assert.equal(messages(result).includes(CANARY), false, name);
  }
});

test('text that is not UTF-8 or not well-formed is invalid, located, and placed in the slot the other file leaves', () => {
  const [portfolio] = pairFiles(EXAMPLE.portfolio) as [ImportInput];
  const notText = { name: 'x', bytes: new Uint8Array([0x73, 0x63, 0xc3, 0x28]) };
  const result = runImport([notText, portfolio]);
  assert.equal(refusal(result), 'invalid');
  assert.equal(result.diagnostics[0]?.document, 'site');
  assert.equal(result.diagnostics[0]?.message, "The file isn't UTF-8 text.");

  const broken = runImport([
    portfolio,
    bytesFile(`schemaVersion: 2\nappearance: [${CANARY}\nkey: : :\n`),
  ]);
  assert.equal(refusal(broken), 'invalid');
  assert.ok(broken.diagnostics.length > 0);
  for (const diagnostic of broken.diagnostics) {
    assert.equal(diagnostic.code, 'parse.syntax');
    assert.equal(diagnostic.document, 'site');
    assert.equal(diagnostic.severity, 'blocks-preview');
    assert.equal(typeof diagnostic.line, 'number');
    assert.equal(typeof diagnostic.column, 'number');
  }
  const duplicate = runImport([portfolio, bytesFile(`${EXAMPLE.site}schemaVersion: 2\n`)]);
  assert.equal(refusal(duplicate), 'invalid');
  assert.equal(messages(broken).includes(CANARY), false);
});

test("#4's validator runs in full: schema, versions, the old format, and the Markdown cap are invalid with diagnostics", () => {
  const cases: Record<string, [string, string]> = {
    'schema.invalid': [
      portfolioWith((data) => {
        (data.identity as Record<string, unknown>).name = 42;
      }),
      '/identity/name',
    ],
    'schema.version': [
      portfolioWith((data) => {
        data.schemaVersion = 4;
      }),
      '/schemaVersion',
    ],
    'legacy.document': [`identity:\n  name: ${CANARY}\ntheme: dark\n`, ''],
    'markdown.too-long': [
      portfolioWith((data) => {
        (data.practice as Record<string, unknown>).thesis = `${CANARY} `.repeat(400);
      }),
      '/practice/thesis',
    ],
    'markdown.too-deep': [
      portfolioWith((data) => {
        (data.practice as Record<string, unknown>).thesis = `${'> '.repeat(6)}${CANARY}`;
      }),
      '/practice/thesis',
    ],
    'id.missing': [
      portfolioWith((data) => {
        delete (data.works as Record<string, unknown>[])[0]!.id;
      }),
      '/works/0/id',
    ],
  };
  for (const [code, [portfolio, pointer]] of Object.entries(cases)) {
    const result = runImport(pairFiles(portfolio));
    assert.equal(refusal(result), 'invalid', code);
    const found = result.diagnostics.find((diagnostic) => diagnostic.code === code);
    assert.ok(found, `${code}: ${JSON.stringify(result.diagnostics.map((d) => d.code))}`);
    assert.equal(found.document, 'portfolio', code);
    assert.equal(found.pointer, pointer, code);
    assert.equal(messages(result).includes(CANARY), false, code);
  }
});

test("#4's URL rules refuse javascript:, non-image data:, protocol-relative, and non-https media sources, and allow what they allow", () => {
  const refusedUrls = [
    `javascript:alert('${CANARY}')`,
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    `data:text/html,${CANARY}`,
    `data:image/svg+xml,<svg onload=alert('${CANARY}')>`,
    `//evil.example/${CANARY}`,
    `vbscript:${CANARY}`,
    `file:///etc/${CANARY}`,
  ];
  for (const url of refusedUrls) {
    const result = runImport(
      pairFiles(
        portfolioWith((data) => {
          (data.links as Record<string, unknown>[])[0]!.url = url;
        }),
      ),
    );
    assert.equal(refusal(result), 'invalid', url);
    assert.ok(
      result.diagnostics.some((d) => d.code === 'schema.invalid' && d.pointer === '/links/0/url'),
      url,
    );
    assert.equal(messages(result).includes(CANARY), false, url);
  }
  const refusedSources = [
    `http://images.example.net/${CANARY}.png`,
    `data:image/png;base64,${CANARY}`,
    `/abs/${CANARY}.png`,
    `../${CANARY}.png`,
    `//images.example.net/${CANARY}.png`,
  ];
  for (const source of refusedSources) {
    const result = runImport(
      pairFiles(
        portfolioWith((data) => {
          (data.media as Record<string, unknown>[])[0]!.source = source;
        }),
      ),
    );
    assert.equal(refusal(result), 'invalid', source);
    assert.ok(
      result.diagnostics.some(
        (d) => d.code === 'schema.invalid' && d.pointer === '/media/0/source',
      ),
      source,
    );
    assert.equal(messages(result).includes(CANARY), false, source);
  }
  for (const url of [
    'https://example.com/a',
    'mailto:a@example.com',
    'tel:+15550100',
    '#about',
    'notes/a',
  ]) {
    imported(
      runImport(
        pairFiles(
          portfolioWith((data) => {
            (data.links as Record<string, unknown>[])[0]!.url = url;
          }),
        ),
      ),
    );
  }
});

test('remote media are listed by kind, pointer, and host, local and refused ones are not, and nothing is fetched', async (t) => {
  const fetchSpy = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('no fetch');
  });
  const portfolio = portfolioWith((data) => {
    const media = data.media as Record<string, unknown>[];
    media[0]!.source = `https://images.example.net/${CANARY}/portrait.png?size=${CANARY}`;
    media[1]!.source = 'HTTPS://CDN.example.org:8443/og.png';
    media.push(
      { id: 'talk-video', kind: 'video', source: `https://video.example.net/${CANARY}.mp4` },
      { id: 'talk-audio', kind: 'audio', source: 'https://audio.example.net/talk.mp3' },
      { id: 'talk-slides', kind: 'document', source: 'https://docs.example.net/slides.pdf' },
      { id: 'local-video', kind: 'video', source: 'talks/local.mp4' },
    );
  });
  const result = imported(runImport(pairFiles(portfolio)));
  const at = (data: Record<string, unknown>) => (data.media as unknown[]).length;
  const count = at(exampleData('portfolio'));
  assert.deepEqual(result.remoteImages, [
    {
      document: 'portfolio',
      kind: 'image',
      pointer: '/media/0/source',
      host: 'images.example.net',
    },
    {
      document: 'portfolio',
      kind: 'image',
      pointer: '/media/1/source',
      host: 'cdn.example.org:8443',
    },
    {
      document: 'portfolio',
      kind: 'video',
      pointer: `/media/${count}/source`,
      host: 'video.example.net',
    },
    {
      document: 'portfolio',
      kind: 'audio',
      pointer: `/media/${count + 1}/source`,
      host: 'audio.example.net',
    },
    {
      document: 'portfolio',
      kind: 'document',
      pointer: `/media/${count + 2}/source`,
      host: 'docs.example.net',
    },
  ]);
  assert.equal(JSON.stringify(result.remoteImages).includes(CANARY), false);
  assert.deepEqual(
    remoteImages(imported(runImport(pairFiles(EXAMPLE.portfolio))).unit.models.portfolio),
    [],
  );
  // The remote SVG fixture imports, with its host listed and its path kept out of the list.
  const svg = HOSTILE_FIXTURES.find(({ name }) => name === 'a remote SVG image')!;
  assert.deepEqual(imported(runImport(svg.files)).remoteImages, [
    {
      document: 'portfolio',
      kind: 'image',
      pointer: '/media/0/source',
      host: 'images.example.net',
    },
  ]);
  assert.equal(fetchSpy.mock.callCount(), 0);
});

/** Every string the models hold, Markdown fields among them. */
function strings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const child of value) strings(child, found);
  else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) strings(child, found);
  }
  return found;
}

const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** What makes markup live, beyond what the strict reader already refuses. */
function liveParts(html: string): string[] {
  const found: string[] = [];
  if (/<\s*script/i.test(html)) found.push('a script element');
  if (/<\s*svg/i.test(html)) found.push('an svg element');
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) found.push('an event-handler attribute');
  for (const [, raw] of html.matchAll(/\shref="([^"]*)"/g)) {
    const href = raw!.replace(ENTITY, (_, hex, dec, name) =>
      hex
        ? String.fromCodePoint(parseInt(hex, 16))
        : dec
          ? String.fromCodePoint(Number(dec))
          : NAMED[name.toLowerCase()]!,
    );
    if (!isAllowedUrl(href) || /^\s*data:/i.test(href)) found.push(`a refused href ${href}`);
  }
  return found;
}

test('the hostile fixtures import as their names say, and no refusal or diagnostic repeats a planted value', () => {
  for (const fixture of HOSTILE_FIXTURES) {
    const result = runImport(fixture.files);
    assert.equal(refusal(result), fixture.expect, fixture.name);
    assert.equal(messages(result).includes(CANARY), false, fixture.name);
  }
});

test("every string of each imported hostile model renders inert through #10's browser renderer and its post-pass, block and inline", () => {
  // The test runner resolves @portfolio/kit/markdown under react-server: the post-pass.
  assert.match(
    createRequire(import.meta.url).resolve('@portfolio/kit/markdown'),
    /markdown\.server\.ts$/,
  );
  let rendered = 0;
  for (const fixture of HOSTILE_FIXTURES.filter(({ expect }) => expect === 'imported')) {
    const { unit } = imported(runImport(fixture.files));
    const values = strings(unit.models);
    assert.ok(
      values.some((value) => value.includes(CANARY)),
      fixture.name,
    );
    for (const value of values) {
      for (const [label, html, allowlist] of [
        ['browser block', browserBlock(value), 'block'],
        ['browser inline', browserInline(value), 'inline'],
        ['post-pass block', postPassBlock(value), 'block'],
        ['post-pass inline', postPassInline(value), 'inline'],
      ] as const) {
        const problems = [...htmlProblems(html, allowlist), ...liveParts(html)];
        assert.deepEqual(problems, [], `${fixture.name}, ${label}: ${html}`);
        rendered++;
      }
    }
  }
  assert.ok(rendered > 100);
});

test('validateImport runs alone, as the local frame calls it, and gives the result runImport does', () => {
  const sources = {
    portfolio: { text: EXAMPLE.portfolio, format: 'yaml' as const, name: 'portfolio.yml' },
    site: { text: EXAMPLE.site, format: 'yaml' as const, name: 'site.yml' },
  };
  assert.deepEqual(validateImport(sources), runImport(pairFiles(EXAMPLE.portfolio)));
  const bad = {
    ...sources,
    portfolio: {
      ...sources.portfolio,
      text: portfolioWith((data) => {
        (data.links as Record<string, unknown>[])[0]!.url = `javascript:${CANARY}`;
      }),
    },
  };
  const result = validateImport(bad);
  assert.equal(refusal(result), 'invalid');
  assert.equal(messages(result).includes(CANARY), false);
});

test('the worker message handler refuses anything but { files } of bytes as invalid, and never throws', () => {
  for (const data of [
    undefined,
    null,
    42,
    CANARY,
    {},
    { files: CANARY },
    { files: [{ name: CANARY, bytes: CANARY }] },
    { files: [{ name: CANARY }] },
    { files: [null] },
  ]) {
    const result = importMessage(data);
    assert.deepEqual(result, { kind: 'refused', code: 'invalid', diagnostics: [] });
  }
  const hostile = {
    get files(): never {
      throw new Error(CANARY);
    },
  };
  assert.deepEqual(importMessage(hostile), { kind: 'refused', code: 'invalid', diagnostics: [] });
  imported(importMessage({ files: pairFiles(EXAMPLE.portfolio) }));
});

test('importing a hostile fixture calls no fetch, console method, sendBeacon, or reportError', (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async () => {
    calls.push('fetch');
    throw new Error('no fetch');
  });
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    t.mock.method(console, method, () => calls.push(`console.${method}`));
  }
  // yaml's Node build warns through process.emitWarning, its browser build through console.
  t.mock.method(process, 'emitWarning', () => calls.push('process.emitWarning'));
  const navigator = { sendBeacon: () => (calls.push('sendBeacon'), true) };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true });
  const reportError = () => calls.push('reportError');
  (globalThis as { reportError?: unknown }).reportError = reportError;
  try {
    for (const fixture of HOSTILE_FIXTURES) importMessage({ files: fixture.files });
    // A collection key, which yaml would warn about if it ever reached toJS.
    importMessage({ files: [bytesFile(`? [${CANARY}]\n: 1\n`), bytesFile(EXAMPLE.site)] });
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete (globalThis as { navigator?: unknown }).navigator;
    delete (globalThis as { reportError?: unknown }).reportError;
  }
  assert.deepEqual(calls, []);
});

function bytesFile(text: string): ImportInput {
  return { name: `${CANARY}.yml`, bytes: bytes(text) };
}

const HTML_KEY = '<img src=x onerror=alert(1)>';

/** Every diagnostic's pointer, message, remediation, and stableId, as one text. */
function diagnosticText(result: ImportResult): string {
  return JSON.stringify(
    result.diagnostics.map(({ pointer, message, remediation, stableId }) => ({
      pointer,
      message,
      remediation,
      stableId,
    })),
  );
}

test('a key the schema does not name is (unknown key) in every pointer, message, and stableId, top level and nested, refused or imported', () => {
  const siteWith = (change: (data: Record<string, unknown>) => void) => {
    const data = exampleData('site');
    change(data);
    return serialize(data, 'yaml');
  };
  const cases: Record<string, { portfolio?: string; site?: string; outcome: string; at: string }> =
    {
      'an unknown portfolio key at the top level': {
        portfolio: portfolioWith((data) => {
          data[CANARY] = 'x';
        }),
        outcome: 'invalid',
        at: '/(unknown key)',
      },
      'an unknown key under identity': {
        portfolio: portfolioWith((data) => {
          (data.identity as Record<string, unknown>)[CANARY] = 'x';
        }),
        outcome: 'invalid',
        at: '/identity/(unknown key)',
      },
      'an HTML key under identity': {
        portfolio: portfolioWith((data) => {
          (data.identity as Record<string, unknown>)[HTML_KEY] = 'x';
        }),
        outcome: 'invalid',
        at: '/identity/(unknown key)',
      },
      'an unknown key nested in a work': {
        portfolio: portfolioWith((data) => {
          (data.works as Record<string, unknown>[])[0]![CANARY] = { deeper: true };
        }),
        outcome: 'invalid',
        at: '/works/0/(unknown key)',
      },
      'an unknown site key at the top level': {
        site: siteWith((data) => {
          data[CANARY] = true;
        }),
        outcome: 'invalid',
        at: '/(unknown key)',
      },
      'a site sections key naming no section': {
        site: siteWith((data) => {
          data.sections = { [CANARY]: { hidden: true } };
        }),
        outcome: 'imported',
        at: '/sections/(unknown key)',
      },
      'an unregistered extension': {
        portfolio: portfolioWith((data) => {
          data.extensions = { [CANARY]: { note: 'x' } };
        }),
        outcome: 'imported',
        at: '/extensions/(unknown key)',
      },
      'an anchor under an unknown key, before anything validates': {
        portfolio: `${EXAMPLE.portfolio}${CANARY}: &one x\n`,
        outcome: 'parse_limits',
        at: '/(unknown key)',
      },
    };
  for (const [name, { portfolio, site, outcome, at }] of Object.entries(cases)) {
    const result = runImport(pairFiles(portfolio ?? EXAMPLE.portfolio, site ?? EXAMPLE.site));
    assert.equal(refusal(result), outcome, name);
    const text = diagnosticText(result);
    assert.equal(text.includes(CANARY), false, `${name}: ${text}`);
    assert.equal(text.includes('<img'), false, `${name}: ${text}`);
    assert.equal(text.includes('onerror'), false, `${name}: ${text}`);
    assert.ok(
      result.diagnostics.some(({ pointer }) => pointer === at),
      `${name}: ${JSON.stringify(result.diagnostics.map(({ pointer }) => pointer))}`,
    );
    for (const { stableId } of result.diagnostics) {
      assert.ok(stableId === undefined || /^[a-z0-9-]+$|^\(unknown key\)$/.test(stableId), name);
    }
    if (result.kind === 'imported') {
      assert.equal(JSON.stringify(result.unchecked ?? []).includes(CANARY), false, name);
    }
  }
});

test('keys the schema names stay in pointers, so a diagnostic still points at its field', () => {
  const result = runImport(
    pairFiles(
      portfolioWith((data) => {
        (data.links as Record<string, unknown>[])[0]!.url = `javascript:${CANARY}`;
        (data.identity as Record<string, unknown>).name = 42;
      }),
    ),
  );
  const pointers = result.diagnostics.map(({ pointer }) => pointer);
  assert.ok(pointers.includes('/links/0/url'), JSON.stringify(pointers));
  assert.ok(pointers.includes('/identity/name'), JSON.stringify(pointers));
  assert.equal(diagnosticText(result).includes('(unknown key)'), false);
});

test('unchecked lists what the validator could not check as fixed strings, never a key from the file', () => {
  const plain = imported(runImport(pairFiles(EXAMPLE.portfolio)));
  assert.ok(plain.unchecked?.includes('site.appearance.colorScheme'), String(plain.unchecked));
  const site = exampleData('site');
  site.routes = { [CANARY]: { enabled: true } };
  site.variantControls = { [CANARY]: { version: 1, values: { [CANARY]: 'x' } } };
  const keyed = imported(runImport(pairFiles(EXAMPLE.portfolio, serialize(site, 'yaml'))));
  assert.ok(keyed.unchecked?.includes('site.routes.*'), String(keyed.unchecked));
  assert.ok(keyed.unchecked?.includes('site.variantControls.*'), String(keyed.unchecked));
  assert.equal(JSON.stringify(keyed.unchecked).includes(CANARY), false);
  assert.deepEqual(
    uncheckedNames([
      `site.routes.${CANARY}`,
      `site.appearanceInputs.${HTML_KEY}`,
      'site.appearance.typography',
      'origin.sample',
      HTML_KEY,
      `site.appearance.${CANARY}`,
    ]),
    [
      'origin.sample',
      'other',
      'site.appearance.typography',
      'site.appearanceInputs.*',
      'site.routes.*',
    ],
  );
});

test('the cap counts UTF-8 bytes: multi-byte text at exactly 1 MiB is read, one byte more is too_large, and a byte order mark counts', () => {
  const [portfolio] = pairFiles(EXAMPLE.portfolio) as [ImportInput];
  /** The site example with a comment of two-byte characters, to `size` bytes. */
  const padded = (size: number, prefix = '') => {
    const head = `${prefix}${EXAMPLE.site}#`;
    const room = size - Buffer.byteLength(head) - 1;
    return `${head}${'é'.repeat(Math.floor(room / 2))}${room % 2 ? 'x' : ''}\n`;
  };
  const exact = bytesFile(padded(IMPORT_MAX_BYTES));
  assert.equal(exact.bytes.byteLength, IMPORT_MAX_BYTES);
  assert.ok(new TextDecoder().decode(exact.bytes).length < IMPORT_MAX_BYTES / 2 + 4096);
  imported(runImport([portfolio, exact]));
  const over = bytesFile(padded(IMPORT_MAX_BYTES + 1));
  assert.equal(over.bytes.byteLength, IMPORT_MAX_BYTES + 1);
  assert.equal(refusal(runImport([portfolio, over])), 'too_large');
  // A byte order mark is three bytes of the file.
  const marked = bytesFile(padded(IMPORT_MAX_BYTES, '\uFEFF'));
  assert.equal(marked.bytes.byteLength, IMPORT_MAX_BYTES);
  imported(runImport([portfolio, marked]));
  const markedOver = {
    name: 'x',
    bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(padded(IMPORT_MAX_BYTES))]),
  };
  assert.equal(markedOver.bytes.byteLength, IMPORT_MAX_BYTES + 3);
  assert.equal(refusal(runImport([portfolio, markedOver])), 'too_large');
});
