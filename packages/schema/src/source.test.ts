import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectFormat,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_DEPTH,
  DOCUMENT_MAX_ENTRIES,
  parseSource,
  toPointer,
  type ParsedSource,
} from './source';

function problems(result: ParsedSource) {
  assert.equal(result.ok, false, 'expected the source to be refused');
  if (result.ok) return [];
  return result.problems.map(({ code, pointer, line, column }) => ({
    code,
    pointer,
    line,
    column,
  }));
}

function data(result: ParsedSource): unknown {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.data : undefined;
}

test('detectFormat reads YAML and JSON names and refuses everything else, TOML included', () => {
  assert.equal(detectFormat('portfolio.yml'), 'yaml');
  assert.equal(detectFormat('portfolio.yaml'), 'yaml');
  assert.equal(detectFormat('SITE.YML'), 'yaml');
  assert.equal(detectFormat('site.json'), 'json');
  assert.throws(() => detectFormat('portfolio.toml'), /YAML \(\.yml, \.yaml\) or JSON/);
  assert.throws(() => detectFormat('portfolio.txt'));
});

test('YAML parses with 1.2 core semantics: yes, dates, and leading zeros stay as written', () => {
  assert.deepEqual(data(parseSource('a: yes\nb: 2024-01-05\nc: "010"\nd: 3\n', 'yaml')), {
    a: 'yes',
    b: '2024-01-05',
    c: '010',
    d: 3,
  });
});

test('a byte order mark is ignored', () => {
  assert.deepEqual(data(parseSource('\uFEFFa: 1\n', 'yaml')), { a: 1 });
  assert.deepEqual(data(parseSource('\uFEFF{"a": 1}', 'json')), { a: 1 });
});

test('a duplicate key is refused with its position', () => {
  assert.deepEqual(problems(parseSource('a: 1\nb:\n  c: 1\n  c: 2\n', 'yaml')), [
    { code: 'DUPLICATE_KEY', pointer: undefined, line: 4, column: 3 },
  ]);
});

test('anchors, aliases, merge keys, and tags are refused, each located where it is written', () => {
  const source = [
    'base: &base',
    '  x: 1',
    'copy: *base',
    'merged:',
    '  <<: {x: 2}',
    'typed: !!str 7',
    'custom: !thing value',
    'list:',
    '  - !!map {}',
    'text: !!str |',
    '  block',
    '',
  ].join('\n');
  assert.deepEqual(problems(parseSource(source, 'yaml')), [
    { code: 'ANCHOR', pointer: '/base', line: 1, column: 7 },
    { code: 'ALIAS', pointer: '/copy', line: 3, column: 7 },
    { code: 'MERGE_KEY', pointer: '/merged/<<', line: 5, column: 3 },
    { code: 'TAG', pointer: '/typed', line: 6, column: 8 },
    { code: 'TAG', pointer: '/custom', line: 7, column: 9 },
    { code: 'TAG', pointer: '/list/0', line: 9, column: 5 },
    { code: 'TAG', pointer: '/text', line: 10, column: 7 },
  ]);
});

test('a collection and its first key, both anchored, each get their own anchor', () => {
  // The mapping's content and its first key start at the same place.
  const source = 'outer: &map\n  &key first: &value 1\n  second: 2\nseq: !!seq\n  - !!str a\n';
  assert.deepEqual(problems(parseSource(source, 'yaml')), [
    { code: 'ANCHOR', pointer: '/outer', line: 1, column: 8 },
    { code: 'ANCHOR', pointer: '/outer/first', line: 2, column: 3 },
    { code: 'ANCHOR', pointer: '/outer/first', line: 2, column: 15 },
    { code: 'TAG', pointer: '/seq', line: 4, column: 6 },
    { code: 'TAG', pointer: '/seq/0', line: 5, column: 5 },
  ]);
  assert.deepEqual(problems(parseSource('--- &root\nkey: v\n', 'yaml')), [
    { code: 'ANCHOR', pointer: '', line: 1, column: 5 },
  ]);
});

test('a second document is refused', () => {
  assert.deepEqual(problems(parseSource('a: 1\n---\nb: 2\n', 'yaml')), [
    { code: 'MULTIPLE_DOCS', pointer: undefined, line: 2, column: 1 },
  ]);
});

test('every directive is refused where it is written, so no document switches to YAML 1.1', () => {
  for (const source of [
    '%YAML 1.1\n---\na: yes\n',
    '%TAG !e! tag:example.com,2000:\n---\na: 1\n',
    // Redefines the !! handle the core schema's tags use.
    '%TAG !! tag:example.com,2000:\n---\na: !!str 1\n',
    '%RESERVED anything\n---\na: 1\n',
  ]) {
    assert.deepEqual(problems(parseSource(source, 'yaml')), [
      { code: 'DIRECTIVE', pointer: undefined, line: 1, column: 1 },
    ]);
  }
  assert.deepEqual(
    problems(parseSource('# note\n%YAML 1.2\n%TAG !e! tag:example.com,2000:\n---\na: 1\n', 'yaml')),
    [
      { code: 'DIRECTIVE', pointer: undefined, line: 2, column: 1 },
      { code: 'DIRECTIVE', pointer: undefined, line: 3, column: 1 },
    ],
  );
});

test('mapping keys are strings', () => {
  assert.deepEqual(data(parseSource('1: one\ntrue: yes\n', 'yaml')), { '1': 'one', true: 'yes' });
  assert.deepEqual(
    problems(parseSource('? [a, b]\n: c\n', 'yaml')).map((p) => p.code),
    ['NON_STRING_KEY'],
  );
});

test('JSON must pass JSON.parse, and every syntax error is located', () => {
  assert.deepEqual(data(parseSource('{\n  "a": [1, 2]\n}\n', 'json')), { a: [1, 2] });
  assert.deepEqual(data(parseSource('[1, -0.5e+3, "\\u00e9\\n", true, false, null, {}]', 'json')), [
    1,
    -500,
    'é\n',
    true,
    false,
    null,
    {},
  ]);
  // Where the first character that can't continue the JSON is, or the end
  // when the text stops short. V8 names no position for most of these.
  const cases: Array<[source: string, line: number, column: number]> = [
    ['{\n  "a": 1,\n}\n', 3, 1], // valid YAML flow syntax
    ['[1,]', 1, 4],
    ['tru', 1, 4],
    ['NaN', 1, 1],
    ['undefined', 1, 1],
    ['.5', 1, 1],
    ['# comment\na: 1\n', 1, 1],
    ['', 1, 1],
    ['  \n', 2, 1],
    ['{"a" 1}', 1, 6],
    ['{"a": 01}', 1, 8],
    ['{"a": "\\x"}', 1, 9],
    ['{"a": "\\u12G4"}', 1, 12],
    ['{"a": "tab\there"}', 1, 11],
    ['{"a": 1}}', 1, 9],
    ['[\n  [1, 2],\n  {"b": -}\n]', 3, 10],
    ['"unterminated', 1, 14],
  ];
  for (const [source, line, column] of cases) {
    const result = parseSource(source, 'json');
    assert.deepEqual(
      problems(result),
      [{ code: 'JSON_SYNTAX', pointer: undefined, line, column }],
      source,
    );
    if (!result.ok)
      assert.equal(result.problems[0]!.message, "The file isn't valid JSON at this position.");
  }
});

test('nesting past 64 levels is refused before any parser reads the text', () => {
  const brackets = (depth: number) => `${'['.repeat(depth)}${']'.repeat(depth)}`;
  const blocks = (depth: number) =>
    Array.from({ length: depth }, (_, i) => `${' '.repeat(i)}k${i}:`).join('\n');
  const tooDeep = (line: number, column: number) => [
    { code: 'TOO_DEEP', pointer: undefined, line, column },
  ];

  assert.deepEqual(DOCUMENT_MAX_DEPTH, 64);
  assert.deepEqual(data(parseSource(brackets(64), 'json')), JSON.parse(brackets(64)));
  assert.deepEqual(problems(parseSource(brackets(65), 'json')), tooDeep(1, 65));
  // Brackets inside a string aren't nesting.
  assert.equal(parseSource(`{"a": "${'['.repeat(100)}"}`, 'json').ok, true);

  assert.equal(parseSource(brackets(64), 'yaml').ok, true);
  assert.deepEqual(problems(parseSource(brackets(65), 'yaml')), tooDeep(1, 65));
  assert.equal(parseSource(blocks(64), 'yaml').ok, true);
  assert.deepEqual(problems(parseSource(blocks(65), 'yaml')), tooDeep(65, 65));
  // Brackets in a plain scalar or a comment aren't nesting either.
  assert.equal(parseSource(`a: x${'['.repeat(100)} # ${'{'.repeat(100)}\n`, 'yaml').ok, true);

  // Far deeper text, which once aborted the process on Node 22, is refused the same way.
  for (const format of ['json', 'yaml'] as const) {
    assert.deepEqual(problems(parseSource(`${'['.repeat(200_000)}1`, format)), tooDeep(1, 65));
  }
});

test('a document over 1 MiB is refused where it passes the limit', () => {
  assert.equal(DOCUMENT_MAX_BYTES, 1024 * 1024);
  const tooLarge = (line: number, column: number) => [
    { code: 'TOO_LARGE', pointer: undefined, line, column },
  ];
  // Exactly the limit is fine.
  assert.deepEqual(data(parseSource(`#${'x'.repeat(DOCUMENT_MAX_BYTES - 1)}`, 'yaml')), null);
  const lines = `${'x'.repeat(1023)}\n`.repeat(1024);
  assert.deepEqual(problems(parseSource(`${lines}tail\n`, 'yaml')), tooLarge(1025, 1));
  assert.deepEqual(problems(parseSource(`"${'x'.repeat(DOCUMENT_MAX_BYTES)}"`, 'json')), [
    { code: 'TOO_LARGE', pointer: undefined, line: 1, column: DOCUMENT_MAX_BYTES + 1 },
  ]);
  // Counted in UTF-8 bytes: each emoji is two UTF-16 units and four bytes.
  const emoji = `#${'\u{1F600}'.repeat(DOCUMENT_MAX_BYTES / 4)}`;
  assert.deepEqual(problems(parseSource(emoji, 'yaml')), tooLarge(1, emoji.length - 1));
  const result = parseSource(`${lines}tail\n`, 'yaml');
  if (!result.ok) assert.ok(!result.problems[0]!.message.includes('xxx'));
});

test('a duplicate key in JSON is refused even though JSON.parse would keep the last', () => {
  assert.deepEqual(problems(parseSource('{\n  "a": 1,\n  "a": 2\n}\n', 'json')), [
    { code: 'DUPLICATE_KEY', pointer: undefined, line: 3, column: 3 },
  ]);
  // Keys compare as decoded, and each object has keys of its own.
  assert.deepEqual(
    problems(parseSource('{"a": {"b": 1, "\\u0062": 2}, "c": {"b": 1}, "\\u0061": 3}', 'json')),
    [
      { code: 'DUPLICATE_KEY', pointer: undefined, line: 1, column: 16 },
      { code: 'DUPLICATE_KEY', pointer: undefined, line: 1, column: 45 },
    ],
  );
});

/** Milliseconds `run` takes. */
function timed(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

test('text that only YAML reads as nesting-free is refused by the JSON scan, before any parser', () => {
  // A JSON scan can't follow text that isn't JSON, which could hide its
  // brackets from a check that ran after yaml's recursive composer. Composing
  // this much nesting took half a second or more per shape (and can abort
  // Node 22); the strict scan refuses each at its first character.
  const deep = `${'['.repeat(400_000)}${']'.repeat(400_000)}`;
  const shapes: Array<[string, number, number]> = [
    [`]${deep}`, 1, 1],
    [`#"\n${deep}`, 1, 1],
    [`['"', ${deep}]`, 1, 2],
    [`[a"b, ${deep}]`, 1, 2],
    [`a: |\n  "\nb: ${deep}\n`, 1, 1],
  ];
  for (const [source, line, column] of shapes) {
    let result: ParsedSource | undefined;
    const ms = timed(() => {
      result = parseSource(source, 'json');
    });
    assert.deepEqual(problems(result!), [
      { code: 'JSON_SYNTAX', pointer: undefined, line, column },
    ]);
    assert.ok(ms < 100, `${ms} ms`);
  }
});

test('a mapping or sequence past 10,000 entries is refused before the composer reads it', () => {
  assert.equal(DOCUMENT_MAX_ENTRIES, 10_000);
  const tooMany = (line: number, column: number) => [
    { code: 'TOO_MANY', pointer: undefined, line, column },
  ];
  const keys = (count: number) => Array.from({ length: count }, (_, i) => `k${i}: 1`).join('\n');
  assert.equal(parseSource(keys(10_000), 'yaml').ok, true);
  assert.deepEqual(problems(parseSource(keys(10_001), 'yaml')), tooMany(10_001, 1));
  // A dash with nothing after it is an entry too.
  assert.deepEqual(problems(parseSource('-\n'.repeat(10_001), 'yaml')), tooMany(10_001, 1));
  const flow = (count: number) => `a: [${Array.from({ length: count }, () => '1').join(', ')}]`;
  assert.equal(parseSource(flow(10_000), 'yaml').ok, true);
  assert.deepEqual(problems(parseSource(flow(10_001), 'yaml')), tooMany(1, 5 + 3 * 10_000));
  // Comments between entries hold no place.
  assert.equal(parseSource(`${keys(10_000)}\n# done\n`, 'yaml').ok, true);

  const object = (count: number) =>
    `{${Array.from({ length: count }, (_, i) => `"k${i}": 1`).join(',\n')}}`;
  assert.equal(parseSource(object(10_000), 'json').ok, true);
  assert.deepEqual(problems(parseSource(object(10_001), 'json')), tooMany(10_001, 1));
  const array = (count: number) => `[${Array.from({ length: count }, () => '1').join(',')}]`;
  assert.equal(parseSource(array(10_000), 'json').ok, true);
  assert.deepEqual(problems(parseSource(array(10_001), 'json')), tooMany(1, 2 + 2 * 10_000));
});

test('large mappings parse in time linear in their size', () => {
  // The budgets are far above the linear times and far below the quadratic
  // ones these replaced: comparing each key with every earlier one took
  // seconds per 10,000-key mapping.
  // 100,000 keys, under the size limit, are refused at the entry limit.
  const lines = Array.from({ length: 100_000 }, (_, i) => `k${i}: 1`);
  const name = (i: number) => `"${i.toString(36)}"`;
  const json = `{${Array.from({ length: 100_000 }, (_, i) => `${name(i)}:1`).join(',')}}`;
  for (const [source, format, line, column] of [
    [lines.join('\n'), 'yaml', 10_001, 1],
    [json, 'json', 1, json.indexOf(name(10_000)) + 1],
  ] as const) {
    let result: ParsedSource | undefined;
    const ms = timed(() => {
      result = parseSource(source, format);
    });
    assert.deepEqual(problems(result!), [{ code: 'TOO_MANY', pointer: undefined, line, column }]);
    assert.ok(ms < 3000, `${format}: ${ms} ms`);
  }

  // Six mappings at the limit, each ending with its first key again.
  const mapping = (m: number, repeat: boolean) =>
    [
      `m${m}:`,
      ...lines.slice(0, repeat ? 9_999 : 10_000).map((line) => `  ${line}`),
      ...(repeat ? ['  k0: 2'] : []),
    ].join('\n');
  const document = (repeat: boolean) =>
    `${Array.from({ length: 6 }, (_, m) => mapping(m, repeat)).join('\n')}\n`;
  let repeated: ParsedSource | undefined;
  const ms = timed(() => {
    repeated = parseSource(document(true), 'yaml');
  });
  assert.deepEqual(
    problems(repeated!),
    Array.from({ length: 6 }, (_, m) => ({
      code: 'DUPLICATE_KEY',
      pointer: undefined,
      line: (m + 1) * 10_001,
      column: 3,
    })),
  );
  assert.ok(ms < 4000, `${ms} ms`);

  // locate() indexes each mapping's keys once, rather than scanning for each key.
  const valid = parseSource(document(false), 'yaml');
  assert.ok(valid.ok);
  const located = timed(() => {
    for (let m = 0; m < 6; m++)
      for (let i = 0; i < 10_000; i++) valid.locate([`m${m}`, `k${i}`], 'key');
  });
  assert.deepEqual(valid.locate(['m5', 'k9999'], 'key'), { line: 60_006, column: 3 });
  assert.ok(located < 1000, `${located} ms`);
});

test('every repeated key is refused, in text order, with keys read as strings', () => {
  assert.deepEqual(problems(parseSource('b: 1\na: 1\nb: 2\nc:\n  x: 1\n  x: 2\na: 3\n', 'yaml')), [
    { code: 'DUPLICATE_KEY', pointer: undefined, line: 3, column: 1 },
    { code: 'DUPLICATE_KEY', pointer: undefined, line: 6, column: 3 },
    { code: 'DUPLICATE_KEY', pointer: undefined, line: 7, column: 1 },
  ]);
  assert.deepEqual(problems(parseSource('1: a\n"1": b\n', 'yaml')), [
    { code: 'DUPLICATE_KEY', pointer: undefined, line: 2, column: 1 },
  ]);
  // Keys in different mappings, or in a sequence's items, don't collide.
  assert.equal(parseSource('- a: 1\n- a: 2\n', 'yaml').ok, true);
  assert.equal(parseSource('x:\n  - a: 1\n  - a: 2\ny:\n  a: 1\n', 'yaml').ok, true);
});

test('locate finds a path, or the nearest ancestor the document has', () => {
  const result = parseSource(
    'identity:\n  name: Rowan\nsections:\n  - kind: hero\n    id: top\n',
    'yaml',
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.locate(['identity', 'name']), { line: 2, column: 9 });
  assert.deepEqual(result.locate(['sections', 0, 'id']), { line: 5, column: 9 });
  // Missing: the nearest ancestor that exists.
  assert.deepEqual(result.locate(['identity', 'email']), { line: 2, column: 3 });
  assert.deepEqual(result.locate(['sections', 3, 'id']), { line: 4, column: 3 });
  assert.deepEqual(result.locate([]), { line: 1, column: 1 });
});

test('locate works on JSON too', () => {
  const result = parseSource('{\n  "identity": {\n    "name": "Rowan"\n  }\n}\n', 'json');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.locate(['identity', 'name']), { line: 3, column: 13 });
});

test('no message quotes the document', () => {
  const canary = 'canary-value-91';
  const sources: Array<[string, 'yaml' | 'json']> = [
    [`a: &${canary} 1\nb: *${canary}\n`, 'yaml'],
    [`a: !${canary} x\n`, 'yaml'],
    [`${canary}: 1\n${canary}: 2\n`, 'yaml'],
    [`{"${canary}": 1,}`, 'json'],
    [`%TAG !${canary}! tag:x,2000:\n---\na: 1\n`, 'yaml'],
    [`a: [${canary}\n`, 'yaml'],
  ];
  for (const [source, format] of sources) {
    const result = parseSource(source, format);
    assert.equal(result.ok, false, source);
    if (result.ok) continue;
    for (const problem of result.problems)
      assert.ok(!problem.message.includes(canary), problem.message);
  }
});

test('toPointer escapes ~ and /', () => {
  assert.equal(toPointer([]), '');
  assert.equal(toPointer(['sections', 2, 'id']), '/sections/2/id');
  assert.equal(toPointer(['a/b', 'c~d']), '/a~1b/c~0d');
});
