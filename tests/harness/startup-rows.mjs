// Every startup-matrix row without an issue tag (#1, item 2), as data, so the
// built server (tests/e2e/startup.spec.ts) and the image (`pnpm
// smoke:profiles`) run the same rows. Each must stop the process with exit 1
// before it serves a request, log the config.fatal lines in `fatal`, and
// never print a value in `never`.
//
// A runner gives each row its own directory and passes the row its paths:
// `source`, the source directory, holding `documents` (by default the harness
// fixture as portfolio.yml), and `beside(name)`, a path next to it, where
// `files` are written. In the image they are /config and /files/<name>.
import { readFileSync } from 'node:fs';
import { DEFAULT_PORTFOLIO } from './app-server.mjs';

export const ORIGIN = 'https://rowan.test';
export const DEMO_ORIGIN = 'https://demo.rowan.test';
/** The lines every version 2 portfolio document starts with. */
export const HEAD = 'schemaVersion: 2\nlocale: en\ndirection: ltr\n';
const FIXTURE = readFileSync(DEFAULT_PORTFOLIO, 'utf8');

/**
 * @typedef {{ source: string, beside: (name: string) => string }} RowPaths
 *
 * @typedef {object} StartupRow
 * @property {string} group
 * @property {string} name
 * @property {(paths: RowPaths) => Record<string, string>} env the deployment's environment
 * @property {Record<string, string>} [documents] the source directory's files (name to text)
 * @property {Record<string, string>} [files] files written beside the source directory
 * @property {boolean} [unreadable] the server can't read the source directory
 * @property {Record<string, string | number>[]} fatal each config.fatal line, in order, by
 *   the fields it must have
 * @property {string | string[]} [mentions] text the first line's message names, such as a
 *   replacement
 * @property {string[] | ((paths: RowPaths) => string[])} [never] values the output must
 *   never contain
 */

/** A read-only deployment that starts, until a row changes it. */
function readOnly(paths, extra = {}) {
  return {
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_ORIGIN: ORIGIN,
    PORTFOLIO_SOURCE_DIR: paths.source,
    ...extra,
  };
}

function without(env, key) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name !== key));
}

const named = (key, code) => ({ key, code });

const EVERY_MODE = 'in every mode';
const PRODUCTION = 'in production';
const SOURCE = 'the source directory';
const DOCUMENT = 'the document';
const PROFILES = 'profiles this build cannot start';

/** @type {readonly StartupRow[]} */
export const STARTUP_ROWS = [
  {
    group: EVERY_MODE,
    name: 'a missing profile',
    env: (paths) => without(readOnly(paths), 'PORTFOLIO_PROFILE'),
    fatal: [named('PORTFOLIO_PROFILE', 'required')],
  },
  {
    group: EVERY_MODE,
    name: 'an inexact profile',
    env: (paths) => readOnly(paths, { PORTFOLIO_PROFILE: 'Readonly-Canary' }),
    never: ['Readonly-Canary'],
    fatal: [named('PORTFOLIO_PROFILE', 'invalid')],
  },
  {
    group: EVERY_MODE,
    name: 'a missing origin',
    env: (paths) => without(readOnly(paths), 'PORTFOLIO_ORIGIN'),
    fatal: [named('PORTFOLIO_ORIGIN', 'required')],
  },
  {
    group: EVERY_MODE,
    name: 'an origin that is not bare',
    env: (paths) => readOnly(paths, { PORTFOLIO_ORIGIN: 'https://canary-origin.test/blog' }),
    never: ['canary-origin'],
    fatal: [named('PORTFOLIO_ORIGIN', 'invalid')],
  },
  {
    group: EVERY_MODE,
    name: 'an http origin on a non-loopback owner host',
    env: (paths) =>
      readOnly(paths, { PORTFOLIO_PROFILE: 'owner', PORTFOLIO_ORIGIN: 'http://canary-owner.test' }),
    never: ['canary-owner'],
    fatal: [named('PORTFOLIO_ORIGIN', 'insecure')],
  },
  {
    group: EVERY_MODE,
    name: 'a key and its _FILE both set',
    files: { 'origin.txt': `${ORIGIN}\n` },
    env: (paths) => readOnly(paths, { PORTFOLIO_ORIGIN_FILE: paths.beside('origin.txt') }),
    fatal: [named('PORTFOLIO_ORIGIN', 'value_and_file')],
  },
  {
    group: EVERY_MODE,
    name: 'an unreadable _FILE',
    env: (paths) =>
      without(
        readOnly(paths, { PORTFOLIO_ORIGIN_FILE: paths.beside('canary-missing-file') }),
        'PORTFOLIO_ORIGIN',
      ),
    never: ['canary-missing-file'],
    fatal: [named('PORTFOLIO_ORIGIN_FILE', 'file_unreadable')],
  },
  {
    group: EVERY_MODE,
    name: 'non-integer trusted proxy hops',
    env: (paths) => readOnly(paths, { PORTFOLIO_TRUSTED_PROXY_HOPS: 'canary-hops' }),
    never: ['canary-hops'],
    fatal: [named('PORTFOLIO_TRUSTED_PROXY_HOPS', 'invalid')],
  },
  {
    group: EVERY_MODE,
    name: 'an invalid preview origin',
    env: () => ({
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: DEMO_ORIGIN,
      PORTFOLIO_PREVIEW_ORIGIN: 'canary-preview',
    }),
    never: ['canary-preview'],
    fatal: [named('PORTFOLIO_PREVIEW_ORIGIN', 'invalid')],
  },
  {
    group: EVERY_MODE,
    name: 'a preview origin equal to the canonical origin',
    env: () => ({
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: DEMO_ORIGIN,
      PORTFOLIO_PREVIEW_ORIGIN: DEMO_ORIGIN,
    }),
    fatal: [named('PORTFOLIO_PREVIEW_ORIGIN', 'same_as_origin')],
  },
  {
    group: EVERY_MODE,
    name: 'PORTFOLIO_PATH set, naming its replacement',
    env: (paths) => readOnly(paths, { PORTFOLIO_PATH: '/data/canary-portfolio.yml' }),
    never: ['canary-portfolio'],
    fatal: [named('PORTFOLIO_PATH', 'key_replaced')],
    mentions: 'PORTFOLIO_SOURCE_DIR',
  },
  {
    group: EVERY_MODE,
    name: 'NEXT_PUBLIC_BASE_URL set, naming its replacement',
    env: (paths) => readOnly(paths, { NEXT_PUBLIC_BASE_URL: 'https://canary-base.test' }),
    never: ['canary-base'],
    fatal: [named('NEXT_PUBLIC_BASE_URL', 'key_replaced')],
    mentions: 'PORTFOLIO_ORIGIN',
  },
  {
    group: PRODUCTION,
    name: 'GITHUB_TOKEN under demo, a key outside the profile column',
    env: () => ({
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: DEMO_ORIGIN,
      GITHUB_TOKEN: 'canary-token',
    }),
    never: ['canary-token'],
    fatal: [named('GITHUB_TOKEN', 'not_in_profile')],
  },
  {
    group: PRODUCTION,
    name: 'a source directory under demo, which renders only the bundled sample',
    env: (paths) => ({
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: DEMO_ORIGIN,
      PORTFOLIO_SOURCE_DIR: paths.source,
    }),
    fatal: [named('PORTFOLIO_SOURCE_DIR', 'not_in_profile')],
  },
  {
    group: PRODUCTION,
    name: 'GITHUB_TOKEN under read-only',
    env: (paths) => readOnly(paths, { GITHUB_TOKEN: 'canary-token' }),
    never: ['canary-token'],
    fatal: [named('GITHUB_TOKEN', 'not_in_profile')],
  },
  {
    group: PRODUCTION,
    name: 'an origin on a reserved example domain',
    env: (paths) => readOnly(paths, { PORTFOLIO_ORIGIN: 'https://jane.example.com' }),
    fatal: [named('PORTFOLIO_ORIGIN', 'reserved_domain')],
  },
  {
    group: PRODUCTION,
    name: 'the bundled sample identity',
    documents: { 'portfolio.yml': `${HEAD}identity:\n  name: Anamika Devi\n` },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'sample_identity', file: 'portfolio.yml', path: '/identity/name', line: 5 }],
  },
  {
    group: SOURCE,
    name: 'missing',
    env: (paths) => readOnly(paths, { PORTFOLIO_SOURCE_DIR: paths.beside('canary-absent-dir') }),
    never: ['canary-absent-dir'],
    fatal: [named('PORTFOLIO_SOURCE_DIR', 'source_missing')],
  },
  {
    group: SOURCE,
    name: 'naming the document instead, as PORTFOLIO_PATH did',
    env: (paths) => readOnly(paths, { PORTFOLIO_SOURCE_DIR: `${paths.source}/portfolio.yml` }),
    never: (paths) => [`${paths.source}/portfolio.yml`],
    fatal: [named('PORTFOLIO_SOURCE_DIR', 'source_not_directory')],
    mentions: 'directory that holds portfolio.yml',
  },
  {
    group: SOURCE,
    name: 'unreadable',
    unreadable: true,
    env: (paths) => readOnly(paths),
    fatal: [named('PORTFOLIO_SOURCE_DIR', 'source_unreadable')],
  },
  {
    group: SOURCE,
    name: 'holding no portfolio document',
    documents: { 'notes.md': 'not a portfolio' },
    env: (paths) => readOnly(paths),
    fatal: [named('PORTFOLIO_SOURCE_DIR', 'source_empty')],
  },
  {
    group: SOURCE,
    name: 'holding several portfolio documents',
    documents: {
      'portfolio.yml': FIXTURE,
      'portfolio.json': '{"identity":{"name":"Rowan Fixture"}}',
    },
    env: (paths) => readOnly(paths),
    fatal: [named('PORTFOLIO_SOURCE_DIR', 'source_several')],
  },
  {
    group: DOCUMENT,
    name: 'invalid YAML, located by line and column',
    documents: {
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\nsections:\n  - kind: canary-kind\n    id: x\n`,
    },
    env: (paths) => readOnly(paths),
    never: ['canary-kind'],
    fatal: [
      {
        code: 'document_invalid',
        file: 'portfolio.yml',
        path: '/sections/0/kind',
        line: 7,
        column: 11,
      },
    ],
  },
  {
    group: DOCUMENT,
    name: 'invalid JSON, located by line and column',
    documents: {
      'portfolio.json': [
        '{',
        '  "schemaVersion": 2,',
        '  "locale": "en",',
        '  "direction": "ltr",',
        '  "identity": {',
        '    "name": 42',
        '  }',
        '}',
        '',
      ].join('\n'),
    },
    env: (paths) => readOnly(paths),
    fatal: [
      {
        code: 'document_invalid',
        file: 'portfolio.json',
        path: '/identity/name',
        line: 6,
        column: 13,
      },
    ],
  },
  {
    group: DOCUMENT,
    name: 'a JSON syntax error V8 gives no position for, located anyway',
    documents: { 'portfolio.json': '{\n  "schemaVersion": 2,\n  "locale": NaN\n}\n' },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'document_syntax', issueCode: 'JSON_SYNTAX', line: 3, column: 13 }],
  },
  {
    group: DOCUMENT,
    name: 'an unknown key, refused at the key with a did-you-mean hint',
    documents: {
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\n  tagine: canary-tagline\n`,
    },
    env: (paths) => readOnly(paths),
    never: ['canary-tagline'],
    fatal: [
      {
        code: 'document_invalid',
        issueCode: 'unrecognized_keys',
        path: '/identity/tagine',
        line: 6,
        column: 3,
      },
    ],
    mentions: 'Did you mean tagline?',
  },
  {
    group: DOCUMENT,
    name: 'a javascript: URL, refused without quoting it',
    documents: {
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\nlinks:\n  - url: 'JavaScript:canary_script()'\n`,
    },
    env: (paths) => readOnly(paths),
    never: ['canary_script'],
    fatal: [{ code: 'document_invalid', path: '/links/0/url', line: 7 }],
  },
  {
    group: DOCUMENT,
    name: 'nesting past 64 levels, refused before any parser reads it',
    documents: { 'portfolio.json': `${'['.repeat(100_000)}${']'.repeat(100_000)}` },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'document_syntax', issueCode: 'TOO_DEEP', line: 1, column: 65 }],
  },
  {
    group: DOCUMENT,
    name: 'a mapping past 10,000 entries, refused before any parser composes it',
    documents: {
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\nmeta:\n${Array.from(
        { length: 10_001 },
        (_, i) => `  k${i}: 1`,
      ).join('\n')}\n`,
    },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'document_syntax', issueCode: 'TOO_MANY', line: 7 + 10_000, column: 3 }],
  },
  {
    group: DOCUMENT,
    name: 'a document over 1 MiB, refused where it passes the limit',
    documents: {
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\n# ${'x'.repeat(1024 * 1024)}\n`,
    },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'document_syntax', issueCode: 'TOO_LARGE', line: 6 }],
  },
  {
    group: DOCUMENT,
    name: 'a YAML alias, refused where it appears',
    documents: {
      'portfolio.yml': `${HEAD}identity:\n  name: &canary-anchor Rowan Fixture\nmeta:\n  title: *canary-anchor\n`,
    },
    env: (paths) => readOnly(paths),
    never: ['canary-anchor'],
    fatal: [
      { code: 'document_syntax', path: '/identity/name', line: 5 },
      { code: 'document_syntax', path: '/meta/title', line: 7 },
    ],
  },
  {
    group: DOCUMENT,
    name: 'a portfolio.toml, refused by name as the old format',
    documents: { 'portfolio.toml': '[identity]\nname = "Rowan Fixture"\n' },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'document_legacy', file: 'portfolio.toml' }],
    mentions: 'Convert it to YAML or JSON first',
  },
  {
    group: DOCUMENT,
    name: 'an old-format document, refused with one issue naming its old fields',
    documents: { 'portfolio.yml': 'identity:\n  name: Rowan Fixture\nvariant: canary-variant\n' },
    env: (paths) => readOnly(paths),
    never: ['canary-variant'],
    fatal: [{ code: 'document_legacy', path: '', line: 3 }],
    mentions: ['/variant to appearance.variant in site.yml', 'pnpm config:migrate portfolio.yml'],
  },
  {
    group: DOCUMENT,
    name: 'two sections sharing an id',
    documents: {
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\nsections:\n  - kind: lede\n    id: about\n    body: A\n  - kind: now\n    id: about\n    body: B\n`,
    },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'document_invalid', path: '/sections/1/id', line: 11 }],
  },
  {
    group: PROFILES,
    name: 'owner, with no authentication provider registered',
    env: (paths) => readOnly(paths, { PORTFOLIO_PROFILE: 'owner' }),
    fatal: [named('PORTFOLIO_PROFILE', 'auth_provider_missing')],
  },
];

/**
 * The files a row's source directory holds.
 *
 * @param {StartupRow} row
 * @returns {Record<string, string>}
 */
export function rowDocuments(row) {
  return row.documents ?? { 'portfolio.yml': FIXTURE };
}

/**
 * The values a row's output must never contain, at the row's paths.
 *
 * @param {StartupRow} row
 * @param {RowPaths} paths
 * @returns {string[]}
 */
export function neverValues(row, paths) {
  return typeof row.never === 'function' ? row.never(paths) : (row.never ?? []);
}

/**
 * Checks a refusal's output against its row. Returns the problems found:
 * empty when the config.fatal lines match the row and no `never` value
 * appears.
 *
 * @param {StartupRow} row
 * @param {RowPaths} paths
 * @param {string} output everything the process wrote
 * @returns {string[]}
 */
export function checkRefusal(row, paths, output) {
  const problems = [];
  for (const value of neverValues(row, paths)) {
    if (output.includes(value)) problems.push(`the output contains ${value}`);
  }
  const fatal = fatalLines(output);
  if (JSON.stringify(fatalFields(row, fatal)) !== JSON.stringify(row.fatal)) {
    problems.push(
      `expected config.fatal ${JSON.stringify(row.fatal)}, got ${JSON.stringify(fatal)}`,
    );
  }
  for (const text of mentions(row)) {
    if (!fatal[0]?.message?.includes(text)) {
      problems.push(`the first config.fatal message doesn't name ${text}`);
    }
  }
  return problems;
}

/**
 * The texts a row's first config.fatal message must name.
 *
 * @param {StartupRow} row
 * @returns {string[]}
 */
export function mentions(row) {
  return row.mentions === undefined ? [] : [row.mentions].flat();
}

/**
 * The config.fatal entries among a process's JSON log lines.
 *
 * @param {string} output
 * @returns {Record<string, unknown>[]}
 */
export function fatalLines(output) {
  return output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === 'config.fatal');
}

/**
 * Each config.fatal entry cut down to the fields its row checks, to compare
 * with `row.fatal`. An entry past the row's last keeps no field.
 *
 * @param {StartupRow} row
 * @param {readonly object[]} fatal
 * @returns {Record<string, unknown>[]}
 */
export function fatalFields(row, fatal) {
  return fatal.map((entry, index) =>
    Object.fromEntries(Object.keys(row.fatal[index] ?? {}).map((field) => [field, entry[field]])),
  );
}
