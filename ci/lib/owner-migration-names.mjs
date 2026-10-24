// The names #18's owner migration prompt uses (docs/operations/owner-migration.md),
// and whether each still exists in the code and docs this checkout ships, so
// the prompt never sends the homelab agent to a variable, command, flag,
// route, operation, code, or Compose name that's gone. It reads the text
// between the prompt's markers, takes every name of a kind it knows, and
// looks each one up in the sources that define it. A name the prompt makes
// itself, such as its run directory's files or its shell helpers, is the
// prompt's own and needs no source.

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Where each kind of name is defined, relative to the repository root. */
export const SOURCES = Object.freeze({
  config: 'apps/web/src/server/config.ts',
  deployment: 'docs/deployment.md',
  configuration: 'docs/configuration.md',
  releasing: 'docs/releasing.md',
  compose: 'deploy/compose.owner.yml',
  operations: 'apps/web/src/server/operations.ts',
  storeCli: 'packages/core/src/cli.ts',
  ownerCli: 'apps/web/bin/owner.mjs',
  configCli: 'apps/web/scripts/config.mjs',
  checkScript: 'apps/web/scripts/check-containment.mjs',
  tools: 'apps/web/scripts/containment-tools.mjs',
  boundary: 'packages/appearance/src/boundary.ts',
  capabilities: 'apps/web/src/server/capabilities.ts',
  containment: 'docs/operations/interim-containment.md',
  packageJson: 'package.json',
});

/** Flags of the host's own tools, which no source here defines. */
export const EXTERNAL_FLAGS = Object.freeze([
  // docker, docker compose, docker buildx
  '--format',
  '--quiet',
  '--no-build',
  '--rm',
  '--name',
  '--env-file',
  '--network',
  '--target',
  '--project-directory',
  '--user',
  '--entrypoint',
  // git
  '--depth',
  '--branch',
  '--porcelain',
  '--ignored',
  '--no-optional-locks',
  // gh
  '--repo',
  '--signer-workflow',
  '--source-ref',
  // coreutils
  '--version',
]);

/** Names the prompt makes itself: its run's files and directories, containers, and markers. */
export const OWN_NAMES = Object.freeze([
  'portfolio-m18-scratch',
  'portfolio-m18-restore',
  'not-a-hash',
]);

/** The prompt itself: the text between its markers. */
export function promptText(markdown) {
  const start = markdown.indexOf('<!-- prompt:start -->');
  const end = markdown.indexOf('<!-- prompt:end -->');
  if (start === -1 || end === -1 || end < start) throw new Error('No prompt markers.');
  return markdown.slice(start, end);
}

/** Every inline code span and every line of a fenced block. */
function codeOf(text) {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map(([, span]) => span);
  const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].flatMap(([, body]) =>
    body.split('\n'),
  );
  return [...spans, ...blocks];
}

const FILE_EXTENSION = /\.(?:md|sh|ya?ml|json|mjs|ts|txt|xml)$/;

/**
 * The names `prompt` uses, by kind, each once, in order. Lines of fenced
 * blocks count, and a name written inside a placeholder (`<...>`) doesn't.
 */
export function promptNames(prompt) {
  const own = new Set([
    ...OWN_NAMES,
    ...[...prompt.matchAll(/\b(m18_[a-z_]+)\(\)/g)].map(([, name]) => name),
  ]);
  const names = {
    env: new Set(),
    storeCommands: new Set(),
    ownerCommands: new Set(),
    scripts: new Set(),
    operations: new Set(),
    routes: new Set(),
    codes: new Set(),
    flags: new Set(),
    tools: new Set(),
    composeNames: new Set(),
    attributes: new Set(),
    profiles: new Set(),
  };
  for (const [, name] of prompt.matchAll(/`([a-z-]+)` profile/g)) names.profiles.add(name);
  for (const raw of [...codeOf(prompt), prompt]) {
    const code = raw.replace(/<[^>\n]*>/g, '<>');
    for (const [name] of code.matchAll(/\bPORTFOLIO_[A-Z0-9_]+\b/g)) names.env.add(name);
    for (const [, name] of code.matchAll(
      /(?:\bm18_store|portfolio-store(?:\.mjs)?)\s+([a-z]+)\b/g,
    )) {
      names.storeCommands.add(name);
    }
    for (const [, name] of code.matchAll(/owner\.mjs\s+([a-z-]+)/g)) names.ownerCommands.add(name);
    for (const [, name] of code.matchAll(/\bpnpm\s+([a-z]+:[a-z-]+)/g)) names.scripts.add(name);
    for (const [, name] of code.matchAll(/\/api\/studio\/([a-zA-Z.]+)/g)) {
      names.operations.add(name);
    }
    for (const [, name] of code.matchAll(/m18_tools\s+([a-z-]+)/g)) names.tools.add(name);
  }
  for (const raw of codeOf(prompt)) {
    const code = raw.replace(/<[^>\n]*>/g, '<>');
    for (const [name] of code.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) names.flags.add(name);
    for (const [name] of code.matchAll(/\bdata-[a-z-]+\b/g)) names.attributes.add(name);
    const span = raw.trim();
    if (
      /^\/[a-z]/.test(span) &&
      !/^\/(?:proc|etc|var\/spool)\//.test(span) &&
      !span.includes('<')
    ) {
      names.routes.add(span.replace(/\/\*$|\*$/g, '').replace(/(.)\/$/, '$1'));
    }
    if (/^[a-z]+(?:_[a-z]+)+$/.test(span) && !own.has(span)) names.codes.add(span);
    if (/^[a-z]+(?:\.[a-zA-Z_]+)+$/.test(span) && !FILE_EXTENSION.test(span) && !own.has(span)) {
      names.codes.add(span);
    }
    if (/^portfolio-[a-z-]+$/.test(span) && !own.has(span)) names.composeNames.add(span);
  }
  return Object.fromEntries(Object.entries(names).map(([kind, set]) => [kind, [...set]]));
}

/** The text of each source, read from `root`. */
export function readSources(root) {
  return Object.fromEntries(
    Object.entries(SOURCES).map(([key, file]) => [
      key,
      readFileSync(path.join(root, file), 'utf8'),
    ]),
  );
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

/**
 * Each name `prompt` uses that its sources don't define, as `<kind>: <name>`.
 * An empty list means every name is current.
 */
export function missingNames(prompt, sources) {
  const names = promptNames(prompt);
  const all = Object.values(sources).join('\n');
  const docs = [sources.deployment, sources.configuration, sources.releasing, sources.compose].join(
    '\n',
  );
  const scripts = Object.keys(JSON.parse(sources.packageJson).scripts ?? {});
  const commands = storeCommands(sources.storeCli);
  const operations = operationNames(sources.operations);
  const cliFlags = [
    sources.storeCli,
    sources.ownerCli,
    sources.configCli,
    sources.checkScript,
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
  check('portfolio-store command', names.storeCommands, (name) => commands.has(name));
  check('owner.mjs command', names.ownerCommands, (name) => sources.ownerCli.includes(`'${name}'`));
  check('pnpm script', names.scripts, (name) => scripts.includes(name));
  check('Studio operation', names.operations, (name) => operations.has(name));
  check('containment tool', names.tools, (name) =>
    new RegExp(`^  (?:'${name}'|${name}): \\{$`, 'm').test(sources.tools),
  );
  check('profile', names.profiles, (name) => sources.capabilities.includes(`'${name}'`));
  check('flag', names.flags, (name) => EXTERNAL_FLAGS.includes(name) || hasWord(cliFlags, name));
  check('route or path', names.routes, (name) =>
    new RegExp(`[\`\\s(]${escape(name)}(?![A-Za-z0-9_.-])`).test(docs),
  );
  check('code or event', names.codes, (name) => hasWord(all, name));
  check('Compose or package name', names.composeNames, (name) => hasWord(all, name));
  check('boundary attribute', names.attributes, (name) => hasWord(all, name));
  return problems;
}
