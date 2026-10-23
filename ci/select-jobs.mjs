#!/usr/bin/env node
// Picks the ci.yml jobs a pull request runs from the paths it changes.
//
//   node ci/select-jobs.mjs                  # local: this branch against origin/next
//   node ci/select-jobs.mjs --base <ref>     # local: against another base
//   node ci/select-jobs.mjs --github         # the `changes` job
//
// Selection is for fast feedback on draft PRs only. `gate` passes a PR only
// after a complete run, which every PR that's ready for review gets, so a
// selector that misses a job slows feedback but never lets a PR merge
// without the whole product passing (ci/gate.mjs).
//
// The complete product runs for a push, a PR into main, a PR that's ready
// for review, a workflow or action file, the lockfile, a root config, the
// release inputs, the selector itself, a CI script outside the narrower
// rules below, a deleted or renamed package, and any path no rule maps. A job
// in ci.yml this file doesn't know is always selected. Pure Node with no
// dependencies, so the `changes` job needs no install.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Jobs that aren't checks: they run on every event and read the selection. */
export const CONTROL_JOBS = ['changes', 'selected', 'gate', 'publish'];

/** Every check job in ci.yml, and the ones other lanes are adding. */
export const CHECK_JOBS = [
  'static',
  'unit',
  'build',
  'browser',
  'routes',
  'appearance-browser',
  'check-variants',
  'variants',
  'external-variant',
  'image',
  // The profile containers (#12), on the image job's saved image.
  'profiles',
  'docs',
  // #11's quality cells and the quality gates' own proof (#74).
  'quality-pr',
  'quality-meta',
  // On open branches, mapped ahead of their merge: #7's preview fixture
  // renders (#71), and #6's trace job (6-3).
  'preview-fixtures-browser',
  'trace',
];

const without = (jobs, ...drop) => jobs.filter((job) => !drop.includes(job));

/** Everything a change to the product itself can break: every check but docs. */
const PRODUCT = without(CHECK_JOBS, 'docs');

// First match wins, so narrow rules come before the broad ones they carve
// out of. `static` joins every selection: format, lint, typecheck, and the
// repository-wide checks run on every PR.
export const RULES = [
  {
    class: 'selector',
    complete: true,
    paths: [
      'ci/select-jobs.mjs',
      'ci/select-jobs.test.mjs',
      'ci/gate.mjs',
      'ci/gate.test.mjs',
      'ci/shards.mjs',
      'ci/shards.test.mjs',
      'ci/shard-durations.json',
    ],
  },
  { class: 'workflow', complete: true, paths: ['.github/**'] },
  { class: 'lockfile', complete: true, paths: ['pnpm-lock.yaml'] },
  {
    class: 'root config',
    complete: true,
    paths: [
      'package.json',
      'pnpm-workspace.yaml',
      '.npmrc',
      '.node-version',
      '.nvmrc',
      'tsconfig.base.json',
      'tests/tsconfig.json',
      'eslint.config.mjs',
      '.prettierrc.json',
      '.prettierignore',
      '.dependency-cruiser.cjs',
      'playwright.config.ts',
      '.gitignore',
      '.editorconfig',
      'runtime-budgets.json',
    ],
  },
  { class: 'release', complete: true, paths: ['Dockerfile', '.dockerignore'] },
  {
    // The container helpers, which check-standalone in build imports too.
    class: 'container',
    jobs: ['unit', 'build', 'image', 'profiles'],
    paths: ['ci/lib/container.mjs'],
  },
  {
    // The HTTPS proxy fixture: only image's proxy smoke and tests/proxy use
    // it. browser runs too, on purpose, since its security spec is the
    // suite image runs behind this proxy.
    class: 'container',
    jobs: ['unit', 'browser', 'image'],
    paths: ['tests/harness/proxy-stack.mjs'],
  },
  {
    // The profile smoke and the Compose examples it reads. profiles runs on
    // the image job's image, so image runs too.
    class: 'container',
    jobs: ['unit', 'image', 'profiles'],
    paths: [
      'docker-compose.yml',
      'deploy/**',
      'ci/smoke-profiles.mjs',
      'ci/lib/profile-checks.mjs',
      'ci/profile-checks.test.mjs',
    ],
  },
  {
    class: 'container',
    jobs: ['unit', 'image'],
    paths: [
      'ci/image-smoke.mjs',
      'ci/proxy-smoke.mjs',
      'ci/container.test.mjs',
      'ci/test-security-proxy.mjs',
      'tests/proxy/**',
      'tests/harness/compose/**',
    ],
  },
  {
    class: 'docs check',
    jobs: ['unit', 'docs'],
    paths: ['ci/docs-check.mjs', 'ci/docs-check.test.mjs'],
  },
  {
    // The scheduled workflow's scripts. The workflow file itself is a
    // workflow change, and the reporter's tests run in unit.
    class: 'scheduled',
    jobs: ['unit'],
    paths: ['ci/report-issue.mjs', 'ci/report-issue.test.mjs', 'ci/fixtures/report-issue/**'],
  },
  { class: 'ci script', complete: true, paths: ['ci/**'] },
  {
    class: 'docs',
    // ci/ tests read the guide and the threat model, so unit runs too.
    jobs: ['unit', 'docs'],
    paths: ['docs/**', 'README.md', 'CONTRIBUTING.md', 'SHOWCASE.md', 'LICENSE'],
  },
  // Outside the workspace: nothing installs, builds, lints, or tests it.
  { class: 'legacy', jobs: [], paths: ['legacy/**'] },
  { class: 'skills', jobs: ['unit', 'docs'], paths: ['skills/**'] },
  // The schemas feed validation, every render, and startup in every profile.
  { class: 'schema', jobs: PRODUCT, paths: ['packages/schema/**'] },
  {
    // A shipped pack reaches every render, the image's compiled packs, and
    // the trace's bytes, but no variant's source.
    class: 'pack',
    jobs: without(PRODUCT, 'check-variants'),
    paths: [
      'packages/appearance-schemes/**',
      'packages/appearance-typography/**',
      'packages/appearance-languages/**',
    ],
  },
  {
    // Fixture packs register only under APPEARANCE_FIXTURES=1 or #11's
    // QUALITY_FIXTURES, and build's standalone check proves they stay out.
    class: 'fixture pack',
    jobs: ['unit', 'build', 'appearance-browser', 'quality-pr', 'quality-meta'],
    paths: ['packages/appearance-fixtures-*/**', 'packages/quality-fixtures-*/**'],
  },
  // Before the variant rule: packages/variant-contract isn't a variant.
  {
    class: 'shared package',
    jobs: PRODUCT,
    paths: ['packages/kit/**', 'packages/variant-contract/**', 'packages/appearance/**'],
  },
  {
    class: 'variant',
    jobs: [
      'unit',
      'build',
      'browser',
      'routes',
      'check-variants',
      'variants',
      'external-variant',
      'preview-fixtures-browser',
      'trace',
      'quality-pr',
    ],
    paths: ['packages/variant-*/**', 'packages/fallback-composition/**'],
  },
  {
    // Studio and the owner code behind it: the owner suites run in browser,
    // the route table in routes, the security suite behind the HTTPS proxy
    // in image, owner's container in profiles, and the registered sign-in
    // surface in quality-pr.
    class: 'studio',
    jobs: [
      'unit',
      'build',
      'browser',
      'routes',
      'image',
      'profiles',
      'preview-fixtures-browser',
      'quality-pr',
    ],
    paths: [
      'apps/web/src/app/(studio)/**',
      'apps/web/src/server/owner/**',
      'apps/web/src/server/studio-*',
      'apps/web/src/lib/studio-*',
      'packages/core/**',
    ],
  },
  { class: 'host', jobs: PRODUCT, paths: ['apps/web/**'] },
  {
    class: 'sample',
    jobs: PRODUCT,
    paths: ['portfolio.example.yml', 'site.example.yml', 'example-media/**', 'snapshots/**'],
  },
  { class: 'browser specs', jobs: ['browser'], paths: ['tests/e2e/**'] },
  {
    class: 'route specs',
    jobs: ['routes'],
    paths: ['tests/routes/**', 'tests/fixtures/variants/**'],
  },
  { class: 'appearance specs', jobs: ['appearance-browser'], paths: ['tests/appearance/**'] },
  { class: 'variant specs', jobs: ['variants'], paths: ['tests/variants/**'] },
  {
    class: 'external variant',
    jobs: ['external-variant'],
    paths: ['tests/external-variant/**'],
  },
  {
    class: 'preview fixtures',
    jobs: ['preview-fixtures-browser'],
    paths: ['tests/preview-fixtures/**'],
  },
  {
    class: 'trace',
    jobs: ['unit', 'trace'],
    paths: ['tests/trace/**', 'tests/harness/trace/**'],
  },
  {
    class: 'quality',
    jobs: ['unit', 'quality-pr', 'quality-meta'],
    paths: ['tests/quality/**', 'quality/**'],
  },
  // Every browser suite and the image share the harness and the fixtures.
  { class: 'harness', jobs: PRODUCT, paths: ['tests/harness/**', 'tests/fixtures/**'] },
];

/** A path glob: `**` crosses directories, `*` stays within one segment. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') {
      out += '[^/]*';
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

const COMPILED = RULES.map((rule) => ({ ...rule, regexps: rule.paths.map(globToRegExp) }));

/** The rule a path falls under, or null when none maps it. */
export function classify(file) {
  return COMPILED.find((rule) => rule.regexps.some((re) => re.test(file))) ?? null;
}

const WORKSPACE_MANIFEST = /^(apps|packages|experiments)\/[^/]+\/package\.json$/;

/**
 * Parses `git diff --name-status -z` output into { status, path, oldPath }.
 * A rename or copy lists the old path, then the new one.
 */
export function parseNameStatus(text) {
  const parts = text.split('\0').filter((p) => p !== '');
  const files = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (/^[RC]/.test(status)) {
      files.push({ status: status[0], oldPath: parts[i], path: parts[i + 1] });
      i += 2;
    } else {
      files.push({ status: status[0], path: parts[i] });
      i += 1;
    }
  }
  return files;
}

/** The top-level job ids in a workflow file, read without a YAML parser. */
export function workflowJobIds(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*(#.*)?$/.test(line));
  if (start < 0) return [];
  const ids = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
    if (match) ids.push(match[1]);
  }
  return ids;
}

/**
 * The jobs to run.
 *
 * @param {{
 *   files: { status: string, path: string, oldPath?: string }[],
 *   event: string,
 *   baseRef?: string,
 *   draft?: boolean,
 *   workflowJobs: string[],
 * }} input
 * @returns {{ complete: boolean, jobs: string[], reasons: string[], paths: { path: string, class: string }[] }}
 */
export function selectJobs({ files, event, baseRef, draft, workflowJobs }) {
  const checks = workflowJobs.filter((job) => !CONTROL_JOBS.includes(job));
  const unknown = checks.filter((job) => !CHECK_JOBS.includes(job));
  const reasons = [];
  const paths = [];
  const complete = (why) => {
    reasons.push(why);
    return { complete: true, jobs: checks, reasons, paths };
  };

  if (event !== 'pull_request') return complete(`a ${event || 'non-PR'} run checks everything`);
  if (baseRef === 'main') return complete('a PR into main checks everything');
  if (!draft) return complete('a PR ready for review gets the complete run gate needs');
  if (files.length === 0) return complete('no changed paths were read');

  const selected = new Set(['static']);
  let whole = false;
  for (const file of files) {
    for (const p of [file.oldPath, file.path].filter(Boolean)) {
      const rule = classify(p);
      paths.push({ path: p, class: rule?.class ?? 'unmapped' });
      if (!rule) {
        reasons.push(`${p} is unmapped`);
        whole = true;
      } else if (rule.complete) {
        reasons.push(`${p} is a ${rule.class} change`);
        whole = true;
      } else {
        for (const job of rule.jobs) selected.add(job);
      }
      // A package that goes away can leave anything that imported it broken.
      const gone = file.status === 'D' || (file.status === 'R' && p === file.oldPath);
      if (gone && WORKSPACE_MANIFEST.test(p)) {
        reasons.push(`${p} goes away, so a package is deleted or moved`);
        whole = true;
      }
    }
  }
  if (whole) return complete('the complete product runs');

  for (const job of unknown) {
    reasons.push(`${job} is a ci.yml job the selector doesn't map, so it always runs`);
    selected.add(job);
  }
  return {
    complete: false,
    jobs: checks.filter((job) => selected.has(job)),
    reasons: [...new Set(reasons)],
    paths,
  };
}

/** What a developer runs locally for each job. */
export const LOCAL_COMMANDS = {
  static:
    'pnpm format:check && pnpm lint && pnpm typecheck && pnpm check:skills && pnpm check:registry && pnpm check:appearance && pnpm check:deps && pnpm check:pins && pnpm check:workflows',
  unit: 'pnpm test',
  build:
    'pnpm build && pnpm check:source-maps && pnpm check:standalone && pnpm check:markdown-pass',
  browser: 'pnpm build && pnpm ci:browser',
  routes: 'pnpm test:routes',
  'appearance-browser': 'pnpm test:appearance',
  'check-variants': 'pnpm check:variants',
  variants: 'pnpm build && pnpm test:variants',
  'external-variant': 'pnpm test:external-variant',
  image: 'pnpm ci:image && pnpm ci:proxy && pnpm ci:security-proxy (needs Docker)',
  profiles: 'pnpm smoke:profiles (needs Docker; SMOKE_PROFILES=<part> for one part)',
  docs: 'pnpm check:docs',
  trace: 'pnpm ci:budgets',
};

export const localCommand = (job) => LOCAL_COMMANDS[job] ?? `pnpm ci:${job}`;

export function renderSummary(selection) {
  const lines = [
    `### changes: ${selection.complete ? 'complete run' : `${selection.jobs.length} jobs selected`}`,
    '',
    ...selection.reasons.slice(0, 20).map((r) => `- ${r}`),
    ...(selection.reasons.length > 20 ? [`- and ${selection.reasons.length - 20} more`] : []),
    '',
    '| Job | Local command |',
    '| --- | --- |',
    ...selection.jobs.map((job) => `| ${job} | \`${localCommand(job)}\` |`),
  ];
  if (selection.paths.length > 0) {
    const byClass = new Map();
    for (const { path: p, class: c } of selection.paths) {
      byClass.set(c, [...(byClass.get(c) ?? []), p]);
    }
    lines.push('', '| Change class | Paths |', '| --- | --- |');
    for (const [c, list] of byClass) {
      const shown = list.slice(0, 5).map((p) => `\`${p}\``);
      if (list.length > 5) shown.push(`and ${list.length - 5} more`);
      lines.push(`| ${c} | ${shown.join(', ')} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
}

function main(argv) {
  const workflowJobs = workflowJobIds(
    readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
  );
  let input;
  if (argv.includes('--github')) {
    const event = process.env.GITHUB_EVENT_NAME ?? '';
    // On pull_request the checkout is the merge commit, whose first parent is
    // the base branch's tip, so this diff is the change the merge makes.
    const files =
      event === 'pull_request'
        ? parseNameStatus(git(['diff', '--name-status', '-M', '-z', 'HEAD^1', 'HEAD']))
        : [];
    input = {
      files,
      event,
      baseRef: process.env.BASE_REF ?? '',
      draft: process.env.PR_DRAFT === 'true',
      workflowJobs,
    };
  } else {
    const at = argv.indexOf('--base');
    const base = at === -1 ? 'origin/next' : argv[at + 1];
    // Committed changes since the merge base, plus uncommitted ones, as a
    // draft PR would see them once pushed.
    const committed = parseNameStatus(git(['diff', '--name-status', '-M', '-z', `${base}...HEAD`]));
    const working = parseNameStatus(git(['diff', '--name-status', '-M', '-z', 'HEAD']));
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean)
      .map((p) => ({ status: 'A', path: p }));
    input = {
      files: [...committed, ...working, ...untracked],
      event: 'pull_request',
      baseRef: base.replace(/^origin\//, ''),
      draft: true,
      workflowJobs,
    };
  }

  const selection = selectJobs(input);
  const summary = renderSummary(selection);
  if (process.env.GITHUB_OUTPUT && argv.includes('--github')) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `jobs=${JSON.stringify(selection.jobs)}\ncomplete=${selection.complete}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
