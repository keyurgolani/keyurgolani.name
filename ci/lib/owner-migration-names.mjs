// The names #18's owner migration prompt uses (docs/operations/owner-migration.md),
// and whether each still exists in the code and docs this checkout ships, so
// the prompt never sends the homelab agent to a variable, command, flag,
// route, operation, code, path, or Compose name that's gone. It reads the
// text between the prompt's markers, takes every name of a kind it knows,
// and looks each one up in the source that defines its kind: codes and log
// events in code alone, never in a doc that may still mention them. A name
// the prompt makes itself, such as its shell helpers and its scratch
// project, needs no source.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Where each kind of name is defined, relative to the repository root. */
export const SOURCES = Object.freeze({
  config: 'apps/web/src/server/config.ts',
  deployment: 'docs/deployment.md',
  configuration: 'docs/configuration.md',
  releasing: 'docs/releasing.md',
  compose: 'deploy/compose.owner.yml',
  dockerfile: 'Dockerfile',
  operations: 'apps/web/src/server/operations.ts',
  storeCli: 'packages/core/src/cli.ts',
  ownerCli: 'apps/web/bin/owner.mjs',
  configCli: 'apps/web/scripts/config.mjs',
  checkScript: 'apps/web/scripts/check-containment.mjs',
  tools: 'apps/web/scripts/containment-tools.mjs',
  boundary: 'packages/appearance/src/boundary.ts',
  capabilities: 'apps/web/src/server/capabilities.ts',
  readiness: 'apps/web/src/server/readiness.ts',
  containment: 'docs/operations/interim-containment.md',
  releaseWorkflow: '.github/workflows/release.yml',
  packageJson: 'package.json',
});

/** The code codes and log events are looked up in: these trees, tests left out. */
export const CODE_DIRS = Object.freeze([
  'apps/web/src',
  'apps/web/bin',
  'apps/web/scripts',
  'packages/core/src',
  'packages/appearance/src',
]);

/**
 * Flags of the host's own tools (docker, Compose, git, gh, pnpm, caddy), which
 * no source here defines. The names test fails on one the prompt stops using.
 */
export const EXTERNAL_FLAGS = Object.freeze([
  '--format',
  '--quiet',
  '--no-build',
  '--rm',
  '--name',
  '--env-file',
  '--network',
  '--project-directory',
  '--user',
  '--entrypoint',
  '--depth',
  '--branch',
  '--porcelain',
  '--ignored',
  '--no-optional-locks',
  '--repo',
  '--signer-workflow',
  '--version',
  '--frozen-lockfile',
  '--all',
  '--no-pager',
  '--adapter',
  '--config',
  '--no-env-resolution',
  '--filter',
]);

/**
 * Proxy directives `proxy-lines` hides on purpose, since their lines can name
 * key files, so no source here lists them. The names test fails on one the
 * prompt stops using.
 */
export const EXTERNAL_DIRECTIVES = Object.freeze(['ssl_certificate', 'ssl_certificate_key']);

/** Names the prompt makes itself: its scratch project, containers, and markers. */
export const OWN_NAMES = Object.freeze([
  'portfolio-m18-scratch',
  'portfolio-m18-restore',
  'not-a-hash',
]);

/** The prompt itself: the text between its markers, each on a line of its own. */
export function promptText(markdown) {
  const start = /^<!-- prompt:start -->$/m.exec(markdown);
  const end = /^<!-- prompt:end -->$/m.exec(markdown);
  if (!start || !end || end.index < start.index) throw new Error('No prompt markers.');
  return markdown.slice(start.index, end.index);
}

/** The names the Inputs block sets, in order. */
export function inputNames(prompt) {
  const block = /## Inputs\s+```sh\n([\s\S]*?)```/.exec(prompt)?.[1] ?? '';
  return [...block.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(([, name]) => name);
}

/** Every inline code span and every line of a fenced block. */
function codeOf(text) {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map(([, span]) => span);
  const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].flatMap(([, body]) =>
    body.split('\n'),
  );
  return [...spans, ...blocks];
}

const FILE_EXTENSION = /\.(?:md|sh|ya?ml|json|mjs|ts|txt|xml|new)$/;
// A Compose command's service: after `exec` or `restart`, or after `run` and
// its options, where only `--rm` and `-d` take no value.
const SERVICE_USE =
  /\bm18_(?:compose|scratch)\s+(?:exec|restart|run(?:\s+(?:--rm|-d|--?[a-z-]+\s+(?:"[^"]*"|[^\s"]+)))*)\s+([a-z][a-z-]*)\b/g;
const LABEL = /^(?:org\.opencontainers|com\.docker\.compose)\./;
const PROXY_DIRECTIVE = /^(?:ssl_[a-z_]+|reverse_proxy|proxy_pass|server_name)$/;

/**
 * The names `prompt` uses, by kind, each once, in order. Lines of fenced
 * blocks count, and a name written inside a placeholder (`<...>`) doesn't.
 */
export function promptNames(prompt) {
  const own = new Set([
    ...OWN_NAMES,
    ...[...prompt.matchAll(/\b(m18_[a-z_]+)\(\)/g)].map(([, name]) => name),
  ]);
  const kinds = [
    'env',
    'envFile',
    'storeCommands',
    'storeFlags',
    'ownerCommands',
    'scripts',
    'operations',
    'routes',
    'codes',
    'composeKeys',
    'labels',
    'flags',
    'tools',
    'composeNames',
    'services',
    'attributes',
    'profiles',
    'setPaths',
    'siteKeys',
    'siteSettings',
    'readiness',
    'readyStatus',
    'storeStates',
    'repoFiles',
    'imagePaths',
    'containerPaths',
    'proxyDirectives',
    'logFields',
    'secretFiles',
    'containerNames',
    'projects',
  ];
  const names = Object.fromEntries(kinds.map((kind) => [kind, new Set()]));
  const add = (kind, name) => names[kind].add(name);
  const text = prompt.replace(/<[^>\n]*>/g, '<>');
  for (const [, name] of prompt.matchAll(/`([a-z-]+)` profile/g)) add('profiles', name);
  for (const [, name] of text.matchAll(/"profile":"([a-z-]+)"/g)) add('profiles', name);
  for (const [, name] of text.matchAll(/"status":"([a-z]+)"/g)) add('readyStatus', name);
  // A one-word code, written as "the code `x`" or "with the code `x`".
  for (const [, name] of prompt.matchAll(/the code `([a-z][a-z_]*)`/g)) add('codes', name);
  // The fields a log filter reads, such as "key" in '"key":"[A-Z_]*"'.
  for (const [, name] of prompt.matchAll(/"([a-z]+)":"\[/g)) add('logFields', name);
  // The Compose secret's file, beside the Compose file: secrets/<name>.
  for (const [, name] of text.matchAll(/(?:CANDIDATE_DIR:\?\}\/| )secrets\/([a-z_]+)\b/g)) {
    add('secretFiles', name);
  }
  for (const [, name] of prompt.matchAll(/container named `([a-z][a-z0-9-]*)`/g)) {
    add('containerNames', name);
  }
  for (const [, name] of prompt.matchAll(/\bm18_compose\(\) \{[^\n]*? -p ([a-z][a-z0-9-]*)/g)) {
    add('projects', name);
  }
  for (const [, list] of prompt.matchAll(/readiness checks? ((?:`[a-z-]+`(?:,? (?:and )?)?)+)/g)) {
    for (const [, id] of list.matchAll(/`([a-z-]+)`/g)) add('readiness', id);
  }
  for (const [, state] of prompt.matchAll(/status` (?:says|names) `([a-z]+)`/g)) {
    add('storeStates', state);
  }
  for (const [, name] of prompt.matchAll(/the service (?:still )?`([a-z][a-z-]*)`/g)) {
    add('services', name);
  }
  for (const [, name] of prompt.matchAll(/`([A-Z][A-Z0-9_]*)=<[^`]*>`/g)) add('envFile', name);
  for (const [, list] of prompt.matchAll(/Keep its ((?:`[a-z_]+`(?:,? (?:and )?)?)+)/g)) {
    for (const [, key] of list.matchAll(/`([a-z_]+)`/g)) add('composeKeys', key);
  }
  for (const [, key, parent] of prompt.matchAll(
    /`([a-z][a-zA-Z]*):(?: [^`]*)?`(?: lines?)? under `([a-z][a-zA-Z]*):?`/g,
  )) {
    add('siteSettings', `${parent}.${key}`);
  }
  for (const [, file] of text.matchAll(
    /(?:^|[\s"'`(/])((?:apps|packages|docs|deploy|ci|\.github)\/[A-Za-z0-9_./-]+\.[a-z]+)\b/g,
  )) {
    add('repoFiles', file);
  }
  for (const [name] of text.matchAll(/(?<![\w/.-])bin\/[a-z-]+\.mjs/g)) add('imagePaths', name);
  for (const [name] of text.matchAll(/\/(?:var\/lib|run\/secrets)\/[a-z_]+/g)) {
    add('containerPaths', name);
  }
  for (const raw of [...codeOf(prompt), prompt]) {
    const code = raw.replace(/<[^>\n]*>/g, '<>');
    for (const [name] of code.matchAll(/\bPORTFOLIO_[A-Z0-9_]+\b/g)) add('env', name);
    for (const [, name] of code.matchAll(
      /(?:\bm18_store|portfolio-store(?:\.mjs)?)\s+([a-z]+)\b/g,
    )) {
      add('storeCommands', name);
    }
    for (const [, name] of code.matchAll(/owner\.mjs\s+([a-z-]+)/g)) add('ownerCommands', name);
    for (const [, name] of code.matchAll(/\bpnpm\s+([a-z]+:[a-z-]+)/g)) add('scripts', name);
    for (const [, name] of code.matchAll(/\/api\/studio\/([a-zA-Z.]+)/g)) add('operations', name);
    for (const [, name] of code.matchAll(/m18_tools\s+([a-z-]+)/g)) add('tools', name);
    for (const [, set] of code.matchAll(/--set ((?:site|portfolio)\.[A-Za-z.<>]+)=/g)) {
      add('setPaths', set);
    }
    for (const [, name] of code.matchAll(SERVICE_USE)) add('services', name);
  }
  for (const raw of codeOf(prompt)) {
    const code = raw.replace(/<[^>\n]*>/g, '<>');
    for (const [name] of code.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) add('flags', name);
    // A store command's flags, each checked against that command's usage line.
    for (const [, command, rest] of code.matchAll(
      /(?:\bm18_store|portfolio-store(?:\.mjs)?)\s+([a-z]+)((?:\s+(?:--[a-z-]+|"[^"]*"|[^\s"-][^\s"]*))*)/g,
    )) {
      for (const [flag] of rest.matchAll(/--[a-z-]+/g)) add('storeFlags', `${command} ${flag}`);
    }
    for (const [name] of code.matchAll(/\bdata-[a-z-]+\b/g)) add('attributes', name);
    const span = raw.trim();
    // A route, or a proxy line's list of them, such as `/preview/* /api/*`.
    if (
      /^(?:\/[a-z][^\s<]*)(?: \/[a-z][^\s<]*)*$/.test(span) &&
      !/^\/(?:proc|etc|var|run|dev|tmp)\//.test(span)
    ) {
      for (const route of span.split(' ')) {
        add('routes', route.replace(/\/\*$|\*$/g, '').replace(/(.)\/$/, '$1'));
      }
    }
    const key = /^([a-z][a-zA-Z]*):(?: .*)?$/.exec(span)?.[1];
    if (key && !span.includes('//')) add('siteKeys', key);
    if (PROXY_DIRECTIVE.test(span)) add('proxyDirectives', span);
    else if (/^[a-z]+(?:_[a-z]+)+$/.test(span) && !own.has(span)) add('codes', span);
    if (/^[a-z]+(?:\.[a-zA-Z_-]+)+$/.test(span) && !FILE_EXTENSION.test(span) && !own.has(span)) {
      add(LABEL.test(span) ? 'labels' : 'codes', span);
    }
    if (/^portfolio-[a-z-]+$/.test(span) && !own.has(span)) add('composeNames', span);
  }
  // A Compose key is a code of Compose's, not the app's.
  for (const name of [...names.codes]) {
    if (/^[a-z]+(?:_[a-z]+)+$/.test(name) && COMPOSE_KEYS.includes(name)) {
      names.codes.delete(name);
      add('composeKeys', name);
    }
  }
  return Object.fromEntries(Object.entries(names).map(([kind, set]) => [kind, [...set]]));
}

/** Compose's own keys the prompt names, which the app's code never defines. */
const COMPOSE_KEYS = ['read_only', 'cap_drop', 'security_opt', 'env_file', 'container_name'];

/** Every code file under `dirs`, tests left out, as one text. */
function codeTree(root, dirs) {
  const texts = [];
  for (const dir of dirs) {
    for (const entry of readdirSync(path.join(root, dir), { recursive: true })) {
      const file = String(entry);
      if (!/\.(?:ts|tsx|mjs|cjs|js)$/.test(file) || /\.test\.|[\\/]generated[\\/]/.test(file)) {
        continue;
      }
      texts.push(readFileSync(path.join(root, dir, file), 'utf8'));
    }
  }
  return texts.join('\n');
}

/** The text of each source, read from `root`, the code tree's as `code`, and `root` itself. */
export function readSources(root) {
  return {
    ...Object.fromEntries(
      Object.entries(SOURCES).map(([key, file]) => [
        key,
        readFileSync(path.join(root, file), 'utf8'),
      ]),
    ),
    code: codeTree(root, CODE_DIRS),
    root,
  };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` holds `name` whole: not as part of a longer name. */
function hasWord(text, name) {
  return new RegExp(`(?<![A-Za-z0-9_-])${escape(name)}(?![A-Za-z0-9_-])`).test(text);
}

/** The store CLI's commands, from its COMMANDS list. */
function storeCommands(cli) {
  const list = /const COMMANDS = \[([\s\S]*?)\]/.exec(cli)?.[1] ?? '';
  return new Set([...list.matchAll(/'([a-z]+)'/g)].map(([, name]) => name));
}

/** The Studio operations, from operations.ts's names. */
function operationNames(operations) {
  return new Set(
    [
      ...operations.matchAll(/name: '([a-zA-Z.]+)'/g),
      ...operations.matchAll(/store(?:Query|Command)\(\s*'([a-zA-Z.]+)'/g),
      ...operations.matchAll(/^\s+'([a-z]+\.[a-zA-Z.]+)',$/gm),
    ].map(([, name]) => name),
  );
}

/** The services a Compose file declares: the keys two spaces in under `services:`. */
function composeServices(compose) {
  const body = /^services:\n((?:(?: {2}.*)?\n)*)/m.exec(compose)?.[1] ?? '';
  return new Set([...body.matchAll(/^ {2}([a-z][a-z0-9_-]*):/gm)].map(([, name]) => name));
}

/** A doc's section, from its heading to the next of the same level. */
function section(doc, heading) {
  const start = doc.indexOf(`\n${heading}\n`);
  if (start === -1) return '';
  const level = heading.split(' ')[0];
  const next = doc.indexOf(`\n${level} `, start + heading.length + 2);
  return doc.slice(start, next === -1 ? undefined : next);
}

/**
 * Each name `prompt` uses that its sources don't define, as `<kind>: <name>`.
 * An empty list means every name is current.
 */
export function missingNames(prompt, sources) {
  const names = promptNames(prompt);
  const docs = [sources.deployment, sources.configuration, sources.releasing, sources.compose].join(
    '\n',
  );
  const scripts = Object.keys(JSON.parse(sources.packageJson).scripts ?? {});
  const commands = storeCommands(sources.storeCli);
  const operations = operationNames(sources.operations);
  const services = composeServices(sources.compose);
  const readiness = section(sources.deployment, '## Health and readiness');
  const cliFlags = [
    sources.storeCli,
    sources.ownerCli,
    sources.configCli,
    sources.checkScript,
    sources.tools,
  ].join('\n');
  const problems = [];
  const check = (kind, list, has) => {
    for (const name of list) if (!has(name)) problems.push(`${kind}: ${name}`);
  };
  check(
    'environment variable',
    names.env,
    (name) => hasWord(sources.config, name.replace(/_FILE$/, '')) && hasWord(docs, name),
  );
  check('candidate .env key', names.envFile, (name) =>
    new RegExp(`\\$\\{${escape(name)}[:?}-]`).test(sources.compose),
  );
  check('portfolio-store command', names.storeCommands, (name) => commands.has(name));
  const usage = /const USAGE = `([\s\S]*?)`/.exec(sources.storeCli)?.[1] ?? '';
  check('portfolio-store flag', names.storeFlags, (pair) => {
    const [command, flag] = pair.split(' ');
    return new RegExp(`^ {2}${command} [^\\n]*${escape(flag)}(?![a-z-])`, 'm').test(usage);
  });
  check('owner.mjs command', names.ownerCommands, (name) => sources.ownerCli.includes(`'${name}'`));
  check('pnpm script', names.scripts, (name) => scripts.includes(name));
  check('Studio operation', names.operations, (name) => operations.has(name));
  check('containment tool', names.tools, (name) =>
    new RegExp(`^  (?:'${escape(name)}'|${escape(name)}): \\{$`, 'm').test(sources.tools),
  );
  check('profile', names.profiles, (name) => sources.capabilities.includes(`'${name}'`));
  check('flag', names.flags, (name) => EXTERNAL_FLAGS.includes(name) || hasWord(cliFlags, name));
  check('route or path', names.routes, (name) =>
    new RegExp(`[\`\\s(]${escape(name)}(?![A-Za-z0-9_.-])`).test(`${docs}\n${sources.containment}`),
  );
  check('code or log event', names.codes, (name) =>
    name.includes('_') || name.includes('.')
      ? hasWord(sources.code, name)
      : sources.code.includes(`'${name}'`),
  );
  check(
    'proxy directive',
    names.proxyDirectives,
    (name) => EXTERNAL_DIRECTIVES.includes(name) || sources.tools.includes(`'${name}'`),
  );
  // The startup log line's own fields, from the function that writes it.
  const logLine = /export function issueLogLine[\s\S]*?\n\}/.exec(sources.config)?.[0] ?? '';
  check('log field', names.logFields, (name) =>
    new RegExp(`^\\s+${escape(name)}[:,]`, 'm').test(logLine),
  );
  // Deployment config, not code, defines these: the shipped Compose file is their source.
  check('Compose secret file', names.secretFiles, (name) =>
    new RegExp(`^ +file: \\./secrets/${escape(name)}$`, 'm').test(sources.compose),
  );
  check(
    'Compose container name',
    names.containerNames,
    (name) =>
      OWN_NAMES.includes(name) ||
      new RegExp(`^ +container_name: ${escape(name)}$`, 'm').test(sources.compose),
  );
  check('Compose project', names.projects, (name) =>
    new RegExp(`^name: ${escape(name)}$`, 'm').test(sources.compose),
  );
  check(
    'Compose key',
    names.composeKeys,
    (name) =>
      new RegExp(`^ {4}${escape(name)}:`, 'm').test(sources.compose) ||
      sources.tools.includes(`'${name}'`) ||
      sources.tools.includes(`.${name}`),
  );
  check(
    'Docker label',
    names.labels,
    (name) => hasWord(sources.containment, name) || hasWord(sources.releaseWorkflow, name),
  );
  check('Compose name', names.composeNames, (name) => hasWord(sources.compose, name));
  check('Compose service', names.services, (name) => services.has(name));
  check('boundary attribute', names.attributes, (name) =>
    hasWord(`${sources.boundary}\n${readiness}`, name),
  );
  check('--set path', names.setPaths, (name) =>
    name
      .split('.')
      .slice(1)
      .filter((part) => part !== '<>')
      .every((part) => sources.configuration.includes(`\`${part}\``)),
  );
  check(
    'site or Compose key',
    names.siteKeys,
    (name) =>
      sources.tools.includes(`s.${name}`) ||
      sources.configuration.includes(`\`${name}\``) ||
      new RegExp(`^ *${escape(name)}:`, 'm').test(sources.compose),
  );
  check('site.yml setting', names.siteSettings, (name) => {
    const [parent, key] = name.split('.');
    return (
      sources.configuration.includes(`\`${name}`) ||
      sources.configuration
        .split('\n')
        .some((line) => line.startsWith(`| \`${parent}\``) && line.includes(`\`${key}\``))
    );
  });
  check(
    'readiness check',
    names.readiness,
    (name) => readiness.includes(`\`${name}\``) && sources.readiness.includes(`id: '${name}'`),
  );
  check('readiness status', names.readyStatus, (name) =>
    new RegExp(`status: [^\\n]*'${escape(name)}'`).test(sources.readiness),
  );
  check('store state', names.storeStates, (name) =>
    section(sources.deployment, '### Running portfolio-store').includes(`\`${name}\``),
  );
  check('repository file', names.repoFiles, (name) => existsSync(path.join(sources.root, name)));
  check('image path', names.imagePaths, (name) => sources.dockerfile.includes(`./${name}`));
  check('container path', names.containerPaths, (name) => hasWord(sources.compose, name));
  return problems;
}

/** A step's text, from its heading to the next step's. */
function step(prompt, number) {
  return new RegExp(`\\n## ${number}\\. [^\\n]*\\n([\\s\\S]*?)(?=\\n## )`).exec(prompt)?.[1] ?? '';
}

/**
 * The safety rules the review found missing once (#18, N1 and N2), each as a
 * problem when the prompt drops it. The candidate and the scratch copy answer
 * on a shared network to their container and service names, so the inventory
 * must stop on an upstream that uses one, the scratch copy must join no shared
 * network, and the live site's check must carry its origin rows. And neither
 * Compose project may already hold a container, the old one included.
 */
export function safetyProblems(prompt) {
  const problems = [];
  const need = (ok, problem) => {
    if (!ok) problems.push(problem);
  };
  const inventory = step(prompt, 5);
  const scratch = step(prompt, 14);
  const projects = {
    candidate: /\bm18_compose\(\) \{[^\n]*? -p ([a-z][a-z0-9-]*)/.exec(prompt)?.[1],
    scratch: /\bm18_scratch\(\) \{[^\n]*? -p ([a-z][a-z0-9-]*)/.exec(prompt)?.[1],
  };
  need(projects.candidate && projects.scratch, 'helpers: no Compose project names');
  const service = /\bm18_store\(\) \{ m18_compose exec ([a-z][a-z-]*) /.exec(prompt)?.[1];
  // N1: every name the candidate or the scratch copy answers to stops an upstream.
  const stop =
    /when any upstream host is ((?:`[a-z0-9-]+`,? (?:or )?)+)/.exec(inventory)?.[1] ?? '';
  for (const name of [service, projects.candidate, projects.scratch]) {
    need(name && stop.includes(`\`${name}\``), `inventory: no stop on an upstream named ${name}`);
  }
  need(
    /`CANONICAL_UPSTREAM`/.test(inventory) && /reverse_proxy/.test(inventory),
    'inventory: no upstream read',
  );
  const before = /\n *m18_check [^\n]*check-before\.txt[^\n]*/.exec(inventory)?.[0] ?? '';
  need(
    before.includes('--expect-origin "${CANONICAL_ORIGIN:?}"'),
    'inventory: check-before has no origin rows',
  );
  need(
    /m18_check "\$\{CANONICAL_ORIGIN:\?\}"[^`]*--expect-origin "\$\{CANONICAL_ORIGIN:\?\}" --no-put` matches `check-before\.txt`/.test(
      step(prompt, 17),
    ),
    'rollback: its check has no origin rows',
  );
  // N1: the scratch copy joins no shared network.
  need(/no `networks:` key/.test(scratch), 'scratch: its Compose file may keep networks');
  need(
    /no `network` line marked `\(external\)`/.test(scratch),
    'scratch: no external network check',
  );
  need(!/\bm18_scratch\(\) \{[^\n]*network/.test(prompt), 'scratch: its helper names a network');
  // N2: neither project may hold a container or a volume before the run's own.
  for (const name of [projects.candidate, projects.scratch]) {
    need(
      new RegExp(`\`OLD_PROJECT\` must be neither [^\\n]*\`${name}\``).test(inventory),
      `inventory: OLD_PROJECT isn't compared with ${name}`,
    );
  }
  for (const command of ['docker ps -a', 'docker volume ls']) {
    const line = new RegExp(
      `${command} --filter label=com\\.docker\\.compose\\.project=${projects.candidate} [^\\n]*and the same with \`${projects.scratch}\``,
    );
    need(line.test(inventory), `inventory: no project label check with ${command}`);
  }
  for (const [number, helper, name] of [
    [11, 'm18_compose', projects.candidate],
    [14, 'm18_scratch', projects.scratch],
  ]) {
    const body = step(prompt, number);
    const recheck = body.indexOf(`Run step 5.14's two \`${name}\` project commands again`);
    const up = body.indexOf(`${helper} up`);
    need(
      recheck !== -1 && up !== -1 && recheck < up,
      `step ${number}: no project recheck before up`,
    );
  }
  return problems;
}
