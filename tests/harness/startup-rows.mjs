// Every startup-matrix row without an issue tag (#1, item 2), as data, so the
// built server (tests/e2e/startup.spec.ts) and the image (`pnpm
// smoke:profiles`) run the same rows. Each in STARTUP_ROWS must stop the
// process with exit 1 before it serves a request, log the config.fatal lines
// in `fatal`, and never print a value in `never`. Each in WARNING_ROWS must
// start and serve, log the config.warning lines in `warning` and no
// config.fatal line, and never print a value in `never`.
//
// A runner gives each row its own directory and passes the row its paths:
// `source`, the source directory, holding `documents` (by default the harness
// fixture pair, portfolio.yml and site.yml), and `beside(name)`, a path next
// to it, where `files` are written. In the image they are /config and
// /files/<name>. A finding in the pair (#4) is its diagnostic record: code,
// document, pointer, line, column, message, and remediation.
import { readFileSync } from 'node:fs';
import { DEFAULT_PORTFOLIO, DEFAULT_SITE } from './app-server.mjs';

export const ORIGIN = 'https://rowan.test';
export const DEMO_ORIGIN = 'https://demo.rowan.test';
/** The lines every version 3 portfolio document starts with. */
export const HEAD = 'schemaVersion: 3\nlocale: en\ndirection: ltr\n';
const FIXTURE = readFileSync(DEFAULT_PORTFOLIO, 'utf8');
const SITE = readFileSync(DEFAULT_SITE, 'utf8');
/** A section, so a portfolio has something to publish. */
const ABOUT = 'sections:\n  - kind: lede\n    id: about\n    body: Hi.\n';
/** A source directory's files: these, beside the harness site document. */
const withSite = (documents) => ({ ...documents, 'site.yml': SITE });
/** An old one-file portfolio, which no site document can sit beside yet. */
const LEGACY = 'identity:\n  name: Rowan Fixture\nvariant: canary-variant\n';
/** The harness site document's variant line, which selects no registered variant (#5). */
const SELECTION = '\n  variant: missing-variant\n';

/** The harness site document selecting `variant`. */
function selecting(variant) {
  if (!SITE.includes(SELECTION))
    throw new Error(`${DEFAULT_SITE} no longer selects missing-variant.`);
  return SITE.replace(SELECTION, `\n  variant: ${variant}\n`);
}

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
 * @property {string | string[]} [remediates] text the first line's remediation names
 * @property {string[] | ((paths: RowPaths) => string[])} [never] values the output must
 *   never contain
 *
 * @typedef {object} WarningRow
 * @property {string} group
 * @property {string} name
 * @property {(paths: RowPaths) => Record<string, string>} env the deployment's environment
 * @property {Record<string, string>} documents the source directory's files (name to text)
 * @property {Record<string, string | number>[]} warning each config.warning line, in order,
 *   by the fields it must have
 * @property {string[]} [never] values the output must never contain
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
const PAIR = 'the pair';
const DOCUMENT = 'the document';
const OWNER = 'what owner needs';
const SNAPSHOTS = 'the snapshots beside the pair';
/** A portfolio with a github section, which a snapshot is for. */
const WITH_GITHUB = `${HEAD}identity:\n  name: Rowan Fixture\nsections:\n  - kind: github\n    id: on-github\n    username: rowan-fixture\n`;

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
    documents: withSite({ 'portfolio.yml': `${HEAD}identity:\n  name: Anamika Devi\n${ABOUT}` }),
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
    mentions: 'directory that holds portfolio.yml and site.yml',
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
    name: 'holding neither document',
    documents: { 'notes.md': 'not a portfolio' },
    env: (paths) => readOnly(paths),
    fatal: [
      { key: 'PORTFOLIO_SOURCE_DIR', code: 'source.missing', document: 'portfolio' },
      { key: 'PORTFOLIO_SOURCE_DIR', code: 'source.missing', document: 'site' },
    ],
    remediates: 'portfolio.example.yml is one to start from',
  },
  {
    group: SOURCE,
    name: 'holding the portfolio document without the site document',
    documents: { 'portfolio.yml': FIXTURE },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'source.missing', document: 'site' }],
  },
  {
    group: SOURCE,
    name: 'holding the site document without the portfolio document',
    documents: { 'site.yml': SITE },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'source.missing', document: 'portfolio' }],
  },
  {
    group: SOURCE,
    name: 'holding a document in two formats',
    documents: withSite({
      'portfolio.yml': FIXTURE,
      'portfolio.json': '{"identity":{"name":"Rowan Fixture"}}',
    }),
    env: (paths) => readOnly(paths),
    fatal: [
      {
        key: 'PORTFOLIO_SOURCE_DIR',
        code: 'source.duplicate',
        document: 'portfolio',
        message:
          'The directory holds portfolio.json and portfolio.yml, one portfolio document in 2 formats.',
      },
    ],
  },
  {
    // An unregistered variant only warns now (WARNING_ROWS); a variant that
    // is no id at all is an invalid document.
    group: PAIR,
    name: 'a site document whose variant is no registry id',
    documents: { 'portfolio.yml': FIXTURE, 'site.yml': selecting('Canary-Variant') },
    env: (paths) => readOnly(paths),
    never: ['Canary-Variant'],
    fatal: [
      {
        code: 'schema.invalid',
        file: 'site.yml',
        document: 'site',
        path: '/appearance/variant',
        line: 6,
        column: 12,
      },
    ],
  },
  {
    group: PAIR,
    name: 'a site document selecting the fallback composition, which no site can',
    documents: { 'portfolio.yml': FIXTURE, 'site.yml': selecting('fallback') },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'schema.invalid', document: 'site', path: '/appearance/variant', line: 6 }],
    mentions: "can't be selected",
  },
  {
    group: PAIR,
    name: 'a record that only blocks publishing stops the live server too',
    documents: {
      'portfolio.yml': FIXTURE,
      'site.yml': `${SITE}sections:\n  retired:\n    hidden: true\n`,
    },
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'ref.missing', document: 'site', path: '/sections/retired' }],
  },
  {
    group: DOCUMENT,
    name: 'invalid YAML, located by line and column',
    documents: withSite({
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\nsections:\n  - kind: canary-kind\n    id: x\n`,
    }),
    env: (paths) => readOnly(paths),
    never: ['canary-kind'],
    fatal: [
      {
        code: 'schema.invalid',
        file: 'portfolio.yml',
        document: 'portfolio',
        path: '/sections/0/kind',
        line: 7,
        column: 11,
      },
    ],
  },
  {
    group: DOCUMENT,
    name: 'invalid JSON, located by line and column',
    documents: withSite({
      'portfolio.json': [
        '{',
        '  "schemaVersion": 3,',
        '  "locale": "en",',
        '  "direction": "ltr",',
        '  "identity": {',
        '    "name": 42',
        '  }',
        '}',
        '',
      ].join('\n'),
    }),
    env: (paths) => readOnly(paths),
    fatal: [
      {
        code: 'schema.invalid',
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
    documents: withSite({ 'portfolio.json': '{\n  "schemaVersion": 3,\n  "locale": NaN\n}\n' }),
    env: (paths) => readOnly(paths),
    fatal: [
      {
        code: 'parse.syntax',
        line: 3,
        column: 13,
        message: "The file isn't valid JSON at this position.",
      },
    ],
  },
  {
    group: DOCUMENT,
    name: 'an unknown key, refused at the key with a did-you-mean hint',
    documents: withSite({
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\n  tagine: canary-tagline\n${ABOUT}`,
    }),
    env: (paths) => readOnly(paths),
    never: ['canary-tagline'],
    fatal: [
      {
        code: 'schema.invalid',
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
    documents: withSite({
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\nlinks:\n  - url: 'JavaScript:canary_script()'\n${ABOUT}`,
    }),
    env: (paths) => readOnly(paths),
    never: ['canary_script'],
    fatal: [{ code: 'schema.invalid', path: '/links/0/url', line: 7 }],
  },
  {
    group: DOCUMENT,
    name: 'nesting past 64 levels, refused before any parser reads it',
    documents: withSite({ 'portfolio.json': `${'['.repeat(100_000)}${']'.repeat(100_000)}` }),
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'parse.syntax', line: 1, column: 65 }],
    mentions: 'more than 64 levels deep',
  },
  {
    group: DOCUMENT,
    name: 'a mapping past 10,000 entries, refused before any parser composes it',
    documents: withSite({
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\nmeta:\n${Array.from(
        { length: 10_001 },
        (_, i) => `  k${i}: 1`,
      ).join('\n')}\n`,
    }),
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'parse.syntax', line: 7 + 10_000, column: 3 }],
    mentions: 'passes 10,000 entries',
  },
  {
    group: DOCUMENT,
    name: 'a document over 1 MiB, refused where it passes the limit',
    documents: withSite({
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\n# ${'x'.repeat(1024 * 1024)}\n`,
    }),
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'parse.syntax', line: 6 }],
    mentions: 'passes the 1 MiB limit',
  },
  {
    group: DOCUMENT,
    name: 'a YAML alias, refused where it appears',
    documents: withSite({
      'portfolio.yml': `${HEAD}identity:\n  name: &canary-anchor Rowan Fixture\nmeta:\n  title: *canary-anchor\n`,
    }),
    env: (paths) => readOnly(paths),
    never: ['canary-anchor'],
    fatal: [
      { code: 'parse.syntax', path: '/identity/name', line: 5 },
      { code: 'parse.syntax', path: '/meta/title', line: 7 },
    ],
  },
  {
    group: DOCUMENT,
    name: 'a portfolio.toml, refused by name as the old format, and nothing else',
    documents: withSite({ 'portfolio.toml': '[identity]\nname = "Rowan Fixture"\n' }),
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'legacy.document', document: 'portfolio' }],
    mentions: 'portfolio.toml is in the old one-file format',
    remediates: 'Convert it to YAML or JSON first',
  },
  {
    group: DOCUMENT,
    name: 'an old-format document, refused with one issue naming its old fields',
    documents: withSite({ 'portfolio.yml': LEGACY }),
    env: (paths) => readOnly(paths),
    never: ['canary-variant'],
    fatal: [{ code: 'legacy.document', path: '', line: 3 }],
    mentions: ['/variant to appearance.variant in site.yml', 'pnpm config:migrate portfolio.yml'],
    remediates: '--write --out <dir>',
  },
  {
    group: DOCUMENT,
    name: 'an old-format document with no site document, as an upgrade finds it',
    documents: { 'portfolio.yml': LEGACY },
    env: (paths) => readOnly(paths),
    never: ['canary-variant'],
    fatal: [
      { code: 'legacy.document', file: 'portfolio.yml', document: 'portfolio', path: '', line: 3 },
    ],
    mentions: ['/variant to appearance.variant in site.yml', 'pnpm config:migrate portfolio.yml'],
    remediates: '--write --out <dir>',
  },
  {
    group: DOCUMENT,
    name: 'two sections sharing an id',
    documents: withSite({
      'portfolio.yml': `${HEAD}identity:\n  name: Rowan Fixture\nsections:\n  - kind: lede\n    id: about\n    body: A\n  - kind: now\n    id: about\n    body: B\n`,
    }),
    env: (paths) => readOnly(paths),
    fatal: [{ code: 'id.duplicate', path: '/sections/1/id', line: 11 }],
  },
  {
    // #10: a snapshot that doesn't read would render as missing, so it stops
    // startup, by its file and never by its contents.
    group: SNAPSHOTS,
    name: 'a snapshot that does not parse, refused by its file without quoting it',
    documents: withSite({
      'portfolio.yml': WITH_GITHUB,
      'snapshots/github.json': '{ "records": [canary-snapshot',
    }),
    env: (paths) => readOnly(paths),
    never: ['canary-snapshot'],
    fatal: [{ code: 'snapshot.syntax', file: 'snapshots/github.json', document: 'snapshots' }],
  },
  {
    group: SNAPSHOTS,
    name: 'a snapshot that fails its schema, refused by its file without quoting it',
    documents: withSite({
      'portfolio.yml': WITH_GITHUB,
      'snapshots/github.json': '{ "records": "canary-snapshot" }',
    }),
    env: (paths) => readOnly(paths),
    never: ['canary-snapshot'],
    fatal: [{ code: 'snapshot.invalid', file: 'snapshots/github.json', document: 'snapshots' }],
  },
  {
    group: OWNER,
    name: 'owner, with no password hash or data directory',
    env: (paths) => readOnly(paths, { PORTFOLIO_PROFILE: 'owner' }),
    fatal: [
      named('PORTFOLIO_AUTH_PASSWORD_HASH_FILE', 'required'),
      named('PORTFOLIO_DATA_DIR', 'required'),
    ],
  },
];

/** @type {readonly WarningRow[]} */
export const WARNING_ROWS = [
  {
    // #5: the fallback composition renders in its place. The warning is the
    // owner's diagnostic; a visitor sees no label.
    group: PAIR,
    name: 'a variant this build does not register, replaced by the fallback composition',
    documents: { 'portfolio.yml': FIXTURE, 'site.yml': selecting('canary-variant') },
    env: (paths) => readOnly(paths),
    never: ['canary-variant'],
    warning: [
      {
        code: 'variant.unavailable',
        file: 'site.yml',
        document: 'site',
        path: '/appearance/variant',
        line: 6,
        column: 12,
      },
    ],
  },
  {
    // #10: a file in snapshots/ that is no <kind>.json is left out, with a
    // warning after the pair's own.
    group: SNAPSHOTS,
    name: 'a file in snapshots/ that is no snapshot, ignored',
    documents: {
      'portfolio.yml': WITH_GITHUB,
      'site.yml': SITE,
      'snapshots/canary-notes.txt': 'canary-notes-text',
    },
    env: (paths) => readOnly(paths),
    never: ['canary-notes-text'],
    warning: [
      { code: 'variant.unavailable', document: 'site' },
      { code: 'snapshot.ignored', file: 'snapshots/canary-notes.txt', document: 'snapshots' },
    ],
  },
];

/**
 * The files a row's source directory holds.
 *
 * @param {StartupRow} row
 * @returns {Record<string, string>}
 */
export function rowDocuments(row) {
  return row.documents ?? withSite({ 'portfolio.yml': FIXTURE });
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
  for (const text of remediates(row)) {
    if (!fatal[0]?.remediation?.includes(text)) {
      problems.push(`the first config.fatal remediation doesn't name ${text}`);
    }
  }
  return problems;
}

/**
 * Checks a started server's output against its warning row. Returns the
 * problems found: empty when the config.warning lines match the row, and
 * neither a config.fatal line nor a `never` value appears.
 *
 * @param {WarningRow} row
 * @param {string} output everything the process wrote
 * @returns {string[]}
 */
export function checkWarnings(row, output) {
  const problems = [];
  for (const value of row.never ?? []) {
    if (output.includes(value)) problems.push(`the output contains ${value}`);
  }
  const fatal = fatalLines(output);
  if (fatal.length > 0) problems.push(`it logged config.fatal ${JSON.stringify(fatal)}`);
  const warnings = warningLines(output);
  if (JSON.stringify(fieldsOf(row.warning, warnings)) !== JSON.stringify(row.warning)) {
    problems.push(
      `expected config.warning ${JSON.stringify(row.warning)}, got ${JSON.stringify(warnings)}`,
    );
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
 * The texts a row's first config.fatal remediation must name.
 *
 * @param {StartupRow} row
 * @returns {string[]}
 */
export function remediates(row) {
  return row.remediates === undefined ? [] : [row.remediates].flat();
}

/**
 * The entries for `event` among a process's JSON log lines. A line that only
 * looks like JSON is skipped, so it can't stop the rows after it.
 *
 * @param {string} output
 * @param {string} event
 * @returns {Record<string, unknown>[]}
 */
function logEntries(output, event) {
  return output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry?.event === event);
}

/**
 * The config.fatal entries among a process's JSON log lines.
 *
 * @param {string} output
 * @returns {Record<string, unknown>[]}
 */
export function fatalLines(output) {
  return logEntries(output, 'config.fatal');
}

/**
 * The config.warning entries among a process's JSON log lines.
 *
 * @param {string} output
 * @returns {Record<string, unknown>[]}
 */
export function warningLines(output) {
  return logEntries(output, 'config.warning');
}

/**
 * Each entry cut down to the fields `expected` names at its index, to
 * compare with `expected`. An entry past the last keeps no field.
 *
 * @param {readonly Record<string, unknown>[]} expected
 * @param {readonly object[]} entries
 * @returns {Record<string, unknown>[]}
 */
export function fieldsOf(expected, entries) {
  return entries.map((entry, index) =>
    Object.fromEntries(Object.keys(expected[index] ?? {}).map((field) => [field, entry[field]])),
  );
}

/**
 * Each config.fatal entry cut down to the fields its row checks, to compare
 * with `row.fatal`.
 *
 * @param {StartupRow} row
 * @param {readonly object[]} fatal
 * @returns {Record<string, unknown>[]}
 */
export function fatalFields(row, fatal) {
  return fieldsOf(row.fatal, fatal);
}
