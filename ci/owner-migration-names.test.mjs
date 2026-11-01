// #18's owner migration prompt uses only names this checkout ships
// (ci/lib/owner-migration-names.mjs): every environment variable,
// portfolio-store command and flag, Studio operation, route, flag, code and
// log event and log field, proxy directive, Compose key, service, project,
// container, secret file, and name, label, boundary attribute, profile,
// `--set` path, site.yml setting, readiness id and status, store state, and
// repository, image, and container path it names is defined where its kind
// lives, with codes, log events, and readiness looked up in code. The Compose
// names are deployment config, not code, so the shipped Compose file is their
// source. The last rebase before a merge runs this, so a rename anywhere fails
// until the prompt follows it. Each kind is proved by renaming one of its
// names in a copy of the prompt, and some by renaming it in a copy of the
// source. The safety rules the delta review added (N1, N2) each have a test
// that drops them from a copy of the prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTERNAL_DIRECTIVES,
  EXTERNAL_FLAGS,
  inputNames,
  missingNames,
  promptNames,
  promptText,
  readSources,
  safetyProblems,
} from './lib/owner-migration-names.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = readFileSync(path.join(ROOT, 'docs/operations/owner-migration.md'), 'utf8');
const PROMPT = promptText(DOC);
const SOURCES = readSources(ROOT);

test('every name the owner migration prompt uses is defined in the code or docs this checkout ships (#18)', () => {
  assert.deepEqual(missingNames(PROMPT, SOURCES), []);
  const names = promptNames(PROMPT);
  // Names of each kind the prompt leans on, so the check can't pass by reading nothing.
  const expected = {
    env: ['PORTFOLIO_ORIGIN', 'PORTFOLIO_TRUSTED_PROXY_HOPS', 'PORTFOLIO_DATA_DIR'],
    envFile: ['PORTFOLIO_ORIGIN', 'PORTFOLIO_TRUSTED_PROXY_HOPS', 'PORT'],
    storeCommands: [
      'status',
      'history',
      'verify',
      'import',
      'rollback',
      'recover',
      'backup',
      'restore',
    ],
    storeFlags: ['import --from', 'import --expect', 'rollback --to', 'backup --out'],
    operations: ['config.status', 'draft.getWorking', 'draft.save'],
    routes: ['/api/health', '/api/ready', '/feed.xml', '/studio/sign-in', '/preview'],
    codes: [
      'authentication_required',
      'store.import.first_start',
      'config.fatal',
      'malformed',
      'file_unreadable',
    ],
    composeKeys: ['read_only', 'cap_drop', 'security_opt', 'healthcheck', 'env_file'],
    labels: ['org.opencontainers.image.revision', 'com.docker.compose.project'],
    tools: ['facts', 'compose-facts', 'proxy-lines', 'validate-check'],
    composeNames: ['portfolio-data', 'portfolio-owner'],
    services: ['web'],
    attributes: ['data-appearance-boundary', 'data-variant', 'data-color-scheme'],
    profiles: ['owner'],
    setPaths: ['site.appearance.variant', 'site.appearance.displayMode'],
    siteSettings: ['features.feed'],
    readiness: ['catalog', 'packs', 'data-directory'],
    readyStatus: ['ready', 'degraded'],
    storeStates: ['live'],
    repoFiles: ['.github/workflows/release.yml', 'deploy/compose.owner.yml'],
    imagePaths: ['bin/portfolio-store.mjs'],
    containerPaths: ['/var/lib/portfolio'],
    proxyDirectives: ['reverse_proxy', 'proxy_pass', 'ssl_certificate', 'ssl_certificate_key'],
    logFields: ['event', 'key', 'code'],
    secretFiles: ['owner_password_hash'],
    containerNames: ['portfolio-owner'],
    projects: ['portfolio-owner'],
  };
  for (const [kind, list] of Object.entries(expected)) {
    for (const name of list) assert.ok(names[kind].includes(name), `${kind}: ${name}`);
  }
  assert.deepEqual(names.scripts.sort(), ['config:migrate', 'config:validate']);
});

test('every flag and proxy directive the check takes as the host tools own is one the prompt uses (#18)', () => {
  const { flags, proxyDirectives } = promptNames(PROMPT);
  assert.deepEqual(
    EXTERNAL_FLAGS.filter((flag) => !flags.includes(flag)),
    [],
  );
  assert.deepEqual(
    EXTERNAL_DIRECTIVES.filter((name) => !proxyDirectives.includes(name)),
    [],
  );
});

test('the prompt keeps the candidate and the scratch copy off every upstream the live site uses, and out of every existing Compose project (#18)', () => {
  assert.deepEqual(safetyProblems(PROMPT), []);
  for (const [from, to, problem] of [
    [
      'when any upstream host is `web`, `portfolio-owner`,',
      'when any upstream host is `web`,',
      'inventory: no stop on an upstream named portfolio-owner',
    ],
    [
      'when any upstream host is `web`, ',
      'when any upstream host is ',
      'inventory: no stop on an upstream named web',
    ],
    [
      ', or `portfolio-m18-scratch`, or when',
      ', or when',
      'inventory: no stop on an upstream named portfolio-m18-scratch',
    ],
    ['`CANONICAL_UPSTREAM`', '`CANONICAL_HOST`', 'inventory: no upstream read'],
    [
      '--expect-name "${OLD_NAME:?}" --expect-origin "${CANONICAL_ORIGIN:?}" --no-put > ',
      '--expect-name "${OLD_NAME:?}" --no-put > ',
      'inventory: check-before has no origin rows',
    ],
    [
      '--expect-origin "${CANONICAL_ORIGIN:?}" --no-put` matches',
      '--no-put` matches',
      'rollback: its check has no origin rows',
    ],
    ['no `networks:` key', 'its `networks:`', 'scratch: its Compose file may keep networks'],
    ['no `network` line marked `(external)`', 'its networks', 'scratch: no external network check'],
    [
      'm18_scratch() { command docker compose',
      'm18_scratch() { command docker compose --network proxy',
      'scratch: its helper names a network',
    ],
    [
      'nor `portfolio-m18-scratch`',
      'nor `portfolio-other`',
      "inventory: OLD_PROJECT isn't compared with portfolio-m18-scratch",
    ],
    [
      'docker ps -a --filter label=com.docker.compose.project=portfolio-owner ',
      'docker ps -a --filter label=com.docker.compose.project=portfolio ',
      'inventory: no project label check with docker ps -a',
    ],
    [
      "--format '{{.Name}}'`, and the same with `portfolio-m18-scratch`",
      "--format '{{.Name}}'`",
      'inventory: no project label check with docker volume ls',
    ],
    [
      "Run step 5.14's two `portfolio-owner` project commands again",
      'Look around',
      'step 11: no project recheck before up',
    ],
    [
      "Run step 5.14's two `portfolio-m18-scratch` project commands again",
      'Look around',
      'step 14: no project recheck before up',
    ],
  ]) {
    assert.ok(safetyProblems(renamed(from, to)).includes(problem), `${from} -> ${to}`);
  }
});

test('each Inputs name is set once, checked in step 2 and before steps 6, 9, and 15, and never written over by a fact (#18)', () => {
  const inputs = inputNames(PROMPT);
  assert.ok(inputs.length >= 13, inputs.join(' '));
  assert.equal(new Set(inputs).size, inputs.length, 'an Inputs name is listed twice');
  const loop =
    /for n in ([A-Z_ ]+); do \[ "\$\(command grep -c "\^\$n=" "\$\{RUN_DIR:\?\}\/vars\.sh"\)" = 1 \]/.exec(
      PROMPT,
    );
  assert.ok(loop, 'no exactly-once check');
  assert.deepEqual(loop[1].trim().split(' '), inputs);
  for (const step of ['2', '6', '9', '15']) {
    const body =
      new RegExp(`\\n## ${step}\\. [^\\n]*\\n([\\s\\S]*?)\\n## `).exec(PROMPT)?.[1] ?? '';
    assert.ok(body.includes('Run the Inputs check'), `step ${step} doesn't run the Inputs check`);
  }
  for (const input of inputs) {
    assert.ok(!PROMPT.includes(`Append \`${input}\``), `the prompt appends ${input}`);
    assert.ok(!new RegExp(`NAME "${input}"|printf[^\\n]*\\b${input}=`).test(PROMPT), input);
  }
  // The facts tool prints NAME, ORIGIN, and VARIANT. The prompt prefixes them,
  // so none of them lands on an Inputs name.
  const printed = [...SOURCES.tools.matchAll(/^ {6}`([A-Z]+)=\$\{shellQuote/gm)].map(
    ([, name]) => name,
  );
  assert.deepEqual(printed, ['NAME', 'ORIGIN', 'VARIANT']);
  assert.match(PROMPT, /m18_tools facts < [^\n|]*\| command sed 's\/\^\/OLD_\/' >>/);
  assert.doesNotMatch(PROMPT, /m18_tools facts < [^\n|]*>>/);
  for (const name of printed) assert.ok(!inputs.includes(`OLD_${name}`), name);
});

/** The prompt with `from` replaced by `to`, once, which must be in it. */
function renamed(from, to) {
  assert.ok(PROMPT.includes(from), from);
  return PROMPT.replace(from, to);
}

test('a name the release no longer ships fails the check, for every kind of name (#18)', () => {
  for (const [from, to, problem] of [
    [
      'PORTFOLIO_TRUSTED_PROXY_HOPS=<',
      'PORTFOLIO_TRUSTED_PROXY_HOP=<',
      'candidate .env key: PORTFOLIO_TRUSTED_PROXY_HOP',
    ],
    ['PORTFOLIO_DATA_DIR', 'PORTFOLIO_DATA_PATH', 'environment variable: PORTFOLIO_DATA_PATH'],
    ['m18_store rollback --to', 'm18_store revert --to', 'portfolio-store command: revert'],
    ['backup --out', 'backup --into', 'portfolio-store flag: backup --into'],
    [
      '/api/studio/draft.getWorking',
      '/api/studio/draft.working',
      'Studio operation: draft.working',
    ],
    ['--drop-unknown', '--drop-unknowns', 'flag: --drop-unknowns'],
    ['`/api/ready`', '`/api/readiness`', 'route or path: /api/readiness'],
    ['`/preview/* /api/*`', '`/previews/* /api/*`', 'route or path: /previews'],
    ['`authentication_required`', '`auth_required`', 'code or log event: auth_required'],
    [
      '`store.import.first_start`',
      '`store.import.first_run`',
      'code or log event: store.import.first_run',
    ],
    ['`cap_drop`', '`drop_caps`', 'Compose key: drop_caps'],
    [
      '`org.opencontainers.image.revision`',
      '`org.opencontainers.image.commit`',
      'Docker label: org.opencontainers.image.commit',
    ],
    ['`portfolio-data`', '`portfolio-state`', 'Compose name: portfolio-state'],
    ['m18_compose restart web', 'm18_compose restart app', 'Compose service: app'],
    ['`data-color-scheme`', '`data-colour-scheme`', 'boundary attribute: data-colour-scheme'],
    ['m18_tools proxy-lines', 'm18_tools proxy-line', 'containment tool: proxy-line'],
    ['pnpm config:validate', 'pnpm config:check', 'pnpm script: config:check'],
    ['the `owner` profile', 'the `owners` profile', 'profile: owners'],
    ['"profile":"owner"', '"profile":"homelab"', 'profile: homelab'],
    [
      '--set site.appearance.displayMode=',
      '--set site.appearance.mode=',
      '--set path: site.appearance.mode',
    ],
    [
      '`feed:` line under `features:`',
      '`feed:` line under `extras:`',
      'site.yml setting: extras.feed',
    ],
    ['`catalog`, `packs`', '`catalogue`, `packs`', 'readiness check: catalogue'],
    ['"status":"ready"', '"status":"up"', 'readiness status: up'],
    ['status` says `live`', 'status` says `active`', 'store state: active'],
    [
      '.github/workflows/release.yml',
      '.github/workflows/releases.yml',
      'repository file: .github/workflows/releases.yml',
    ],
    ['node bin/portfolio-store.mjs', 'node bin/store.mjs', 'image path: bin/store.mjs'],
    ['/var/lib/portfolio', '/var/lib/portfolio_data', 'container path: /var/lib/portfolio_data'],
    ['the code `malformed`', 'the code `bad_format_x`', 'code or log event: bad_format_x'],
    ['the code `file_unreadable`', 'the code `file_gone`', 'code or log event: file_gone'],
    [
      'portfolio-store.mjs recover',
      'portfolio-store.mjs repair',
      'portfolio-store command: repair',
    ],
    ['"status":"degraded"', '"status":"impaired"', 'readiness status: impaired'],
    ['"key":"[A-Z_]*"', '"setting":"[A-Z_]*"', 'log field: setting'],
    ['`ssl_certificate_key`', '`ssl_cert_key`', 'proxy directive: ssl_cert_key'],
    [
      '${CANDIDATE_DIR:?}/secrets/owner_password_hash',
      '${CANDIDATE_DIR:?}/secrets/owner_hash',
      'Compose secret file: owner_hash',
    ],
    [
      'container named `portfolio-owner`',
      'container named `portfolio-site`',
      'Compose container name: portfolio-site',
    ],
    ['-p portfolio-owner', '-p portfolio-site', 'Compose project: portfolio-site'],
  ]) {
    assert.ok(missingNames(renamed(from, to), SOURCES).includes(problem), `${from} -> ${to}`);
  }
});

/** The sources with `from` replaced by `to` everywhere in `key`, which must hold it. */
function changed(key, from, to) {
  assert.ok(SOURCES[key].includes(from), `${key}: ${from}`);
  return { ...SOURCES, [key]: SOURCES[key].replaceAll(from, to) };
}

test('a name renamed or removed in its source fails the check, though the prompt is unchanged (#18)', () => {
  for (const [sources, problem] of [
    [changed('compose', '\n  web:\n', '\n  app:\n'), 'Compose service: web'],
    [
      changed('code', 'store.import.first_start', 'store.import.first_run'),
      'code or log event: store.import.first_start',
    ],
    [changed('deployment', '`packs`', '`pack-set`'), 'readiness check: packs'],
    [
      changed('storeCli', '  backup --out <dir>', '  backup --to <dir>'),
      'portfolio-store flag: backup --out',
    ],
    [
      changed('compose', '${PORTFOLIO_TRUSTED_PROXY_HOPS', '${PORTFOLIO_PROXY_HOPS'),
      'candidate .env key: PORTFOLIO_TRUSTED_PROXY_HOPS',
    ],
    [
      changed('dockerfile', './bin/portfolio-store.mjs', './bin/store.mjs'),
      'image path: bin/portfolio-store.mjs',
    ],
    [changed('code', "'malformed'", "'bad_format'"), 'code or log event: malformed'],
    [changed('readiness', "id: 'packs'", "id: 'pack-set'"), 'readiness check: packs'],
    [changed('readiness', "'degraded'", "'impaired'"), 'readiness status: degraded'],
    [changed('config', '    key: issue.key,', '    setting: issue.key,'), 'log field: key'],
    [
      changed('compose', 'file: ./secrets/owner_password_hash', 'file: ./secrets/hash'),
      'Compose secret file: owner_password_hash',
    ],
    // `name: portfolio-owner` stays, so the container name is checked on its own line.
    [
      changed('compose', 'container_name: portfolio-owner', 'container_name: portfolio-site'),
      'Compose container name: portfolio-owner',
    ],
    [
      changed('compose', '\nname: portfolio-owner\n', '\nname: portfolio-site\n'),
      'Compose project: portfolio-owner',
    ],
  ]) {
    assert.ok(missingNames(PROMPT, sources).includes(problem), problem);
  }
  // A code a doc still mentions isn't defined by it: codes come from code alone.
  const docsOnly = {
    ...changed('code', 'authentication_required', 'auth_required'),
    deployment: `${SOURCES.deployment}\nA denial answers \`authentication_required\`.\n`,
  };
  assert.ok(missingNames(PROMPT, docsOnly).includes('code or log event: authentication_required'));
});

test("a placeholder, a helper the prompt defines, and anything outside the prompt's markers aren't names to look up (#18)", () => {
  const extra = [
    'Run `m18_extra` after `m18_extra() { true; }` with `<PORTFOLIO_NOT_A_NAME>` in place.',
  ].join('\n');
  assert.deepEqual(missingNames(`${PROMPT}\n${extra}`, SOURCES), []);
  const outside = `${DOC}\nAfter the prompt: \`PORTFOLIO_GONE\` and \`gone_code\`.\n`;
  assert.deepEqual(missingNames(promptText(outside), SOURCES), []);
  assert.throws(() => promptText('no markers here'), /No prompt markers/);
});
