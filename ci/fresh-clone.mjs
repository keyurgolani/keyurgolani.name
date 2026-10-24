#!/usr/bin/env node
// `pnpm fresh-clone` (#12, item 8): follows the public guide from a fresh
// clone with the sample config, and nothing else.
//
// It clones the commit under test into an empty directory (what's
// committed, so no untracked or generated file and no build output comes
// along), and runs the guide's own commands there, with HOME and every XDG
// directory an empty one of its own, no token, and no cache: STEPS names
// each one by its exact text in docs/getting-started.md, README.md, or
// docs/deployment.md, and the run fails when a doc no longer has it, as
// ci/fresh-clone-guide.test.mjs does. Every sh fence in getting-started.md
// and README.md is a step or in SKIPPED with the reason, so a command added
// to the guide has to join the run.
//
// Natively, as the guide runs it, and here as in CI:
//   - `pnpm install`, then `pnpm dev`, which renders the bundled sample, and
//     the guide's demo dev server, which serves /sample;
//   - the guide's validation of the copied sample, and `pnpm build`;
//   - the guide's production `pnpm start` under read-only on the untouched
//     sample, which refuses it (sample_identity), then the guide's identity
//     step, after which it starts and renders the new name;
//   - deployment.md's demo `pnpm start` on the sample.
// In containers, only where FRESH_CLONE_CONTAINERS=1 (CI), with Docker:
//   - deployment.md's read-only Compose run on the untouched sample, which
//     refuses it, then again after the identity step, which starts;
//   - the owner hash, scripted (--stdin), and deployment.md's owner Compose
//     run, which refuses the untouched sample; after the identity step it no
//     longer refuses the identity, and it reaches ready once the default
//     composition is registered (pending until #13, as PENDING says);
//   - deployment.md's demo Compose run, which serves the sample.
//
// Each native server listens on 127.0.0.1 with the harness egress guard
// preloaded, so a request outside the machine fails its step. The install
// and the image builds keep network access, as a new user's would.
//
// Environment:
//   FRESH_CLONE_SOURCE      the repository to clone (default: this checkout)
//   FRESH_CLONE_REF         the commit to check out (default: HEAD)
//   FRESH_CLONE_CONTAINERS  1: run the container steps too (needs Docker)
//   FRESH_CLONE_PNPM_STORE  a pnpm store for the install to reuse, for a local run only
//   FRESH_CLONE_KEEP        keep the clone, for a look after
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fatalCodes, maskCommands, redactArtifacts } from './lib/profile-checks.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';
import { defaultComposition, LANDED, pendingProblems, registeredVariants } from './lib/pending.mjs';

export const REPRO = 'pnpm fresh-clone';
/** The bundled sample's name, which a production server refuses (#1). */
export const SAMPLE_NAME = 'Anamika Devi';
/** The name the guide's identity step gives the copied sample: a fixture's. */
export const FIXTURE_NAME = 'Rowan Fresh-Clone';
/** The docs whose every sh fence the run covers. */
export const COVERED_DOCS = ['docs/getting-started.md', 'README.md'];

// ---- the guide's fences --------------------------------------------------------

/** Every fenced block in Markdown: { lang, line (of its first line), lines }. */
export function fences(text) {
  const out = [];
  let open = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
    if (open) {
      if (
        marker &&
        marker[1][0] === open.fence[0] &&
        marker[1].length >= open.fence.length &&
        !marker[2]
      ) {
        out.push({ lang: open.lang, line: open.line, lines: open.lines });
        open = null;
      } else open.lines.push(line);
    } else if (marker) {
      open = { fence: marker[1], lang: marker[2], line: i + 2, lines: [] };
    }
  });
  return out;
}

/** The sh fences' commands: each line, with a backslash continuation joined to the next, and its line number. */
export function shCommands(text) {
  const out = [];
  for (const block of fences(text).filter((b) => b.lang === 'sh')) {
    let pending = null;
    block.lines.forEach((raw, i) => {
      const line = raw.replace(/\s+$/, '');
      if (pending) pending.text += `\n${line}`;
      else if (line.trim() !== '') pending = { text: line, line: block.line + i };
      else return;
      if (!line.endsWith('\\')) {
        out.push(pending);
        pending = null;
      }
    });
    if (pending) out.push(pending);
  }
  return out;
}

/**
 * The guide's steps, in the order the run takes them. `command` is the
 * doc's text exactly, a continuation line included. `scripted`, where
 * there is one, is what runs instead and why: an interactive step, or a
 * placeholder the guide leaves to the reader.
 */
export const STEPS = [
  {
    id: 'clone',
    doc: 'docs/getting-started.md',
    command: 'git clone https://github.com/keyurgolani/keyurgolani.name.git',
    kind: 'clone',
    scripted: 'clones the commit under test, not the public URL, which is deferred to the backlog',
  },
  {
    id: 'cd',
    doc: 'docs/getting-started.md',
    command: 'cd keyurgolani.name',
    kind: 'cd',
    into: '.',
  },
  {
    id: 'install',
    doc: 'docs/getting-started.md',
    command: 'pnpm install',
    kind: 'run',
    timeoutMs: 900_000,
  },
  {
    id: 'dev',
    doc: 'docs/getting-started.md',
    command: 'pnpm dev',
    kind: 'serve',
    path: '/',
    expect: { status: 200, includes: [SAMPLE_NAME] },
  },
  {
    id: 'copy-portfolio',
    doc: 'docs/getting-started.md',
    command: 'cp portfolio.example.yml config/portfolio.yml',
    kind: 'run',
  },
  {
    id: 'copy-site',
    doc: 'docs/getting-started.md',
    command: 'cp site.example.yml config/site.yml',
    kind: 'run',
  },
  {
    id: 'validate',
    doc: 'docs/getting-started.md',
    command: 'node skills/portfolio-author/scripts/validate.mjs config',
    kind: 'run',
  },
  {
    id: 'demo-dev',
    doc: 'docs/getting-started.md',
    command: 'PORTFOLIO_PROFILE=demo PORTFOLIO_SOURCE_DIR= pnpm dev',
    kind: 'serve',
    path: '/sample',
    expect: { status: 200, includes: [SAMPLE_NAME] },
  },
  {
    id: 'build',
    doc: 'docs/getting-started.md',
    command: 'pnpm build',
    kind: 'run',
    timeoutMs: 900_000,
  },
  {
    id: 'read-only-refuses-sample',
    doc: 'docs/getting-started.md',
    command:
      'PORTFOLIO_PROFILE=read-only PORTFOLIO_ORIGIN=https://jane.name \\\n  PORTFOLIO_SOURCE_DIR=../../config pnpm start',
    kind: 'refuse',
    fatal: ['PORTFOLIO_SOURCE_DIR:sample_identity'],
  },
  {
    id: 'identity',
    doc: 'docs/getting-started.md',
    command: '# edit config/portfolio.yml',
    kind: 'identity',
    file: 'config/portfolio.yml',
    scripted: `sets identity.name to ${FIXTURE_NAME}, the guide's first edit`,
  },
  {
    id: 'read-only-starts',
    doc: 'docs/getting-started.md',
    command:
      'PORTFOLIO_PROFILE=read-only PORTFOLIO_ORIGIN=https://jane.name \\\n  PORTFOLIO_SOURCE_DIR=../../config pnpm start',
    kind: 'serve',
    path: '/',
    // The sample's content names its author in other places too (a quote,
    // the authors of a paper), so only the new name is checked here.
    expect: { status: 200, includes: [FIXTURE_NAME] },
  },
  {
    id: 'demo-starts',
    doc: 'docs/deployment.md',
    command: 'PORTFOLIO_PROFILE=demo PORTFOLIO_ORIGIN=https://demo.jane.name pnpm start',
    kind: 'serve',
    path: '/',
    expect: { status: 200, includes: [SAMPLE_NAME] },
  },
  // ---- containers: CI only ----
  {
    id: 'compose-copy-portfolio',
    doc: 'docs/deployment.md',
    command: 'cp portfolio.example.yml config/portfolio.yml   # then make it yours',
    kind: 'run',
    container: true,
  },
  {
    id: 'compose-copy-site',
    doc: 'docs/deployment.md',
    command:
      'cp site.example.yml config/site.yml             # its appearance and which sections show',
    kind: 'run',
    container: true,
  },
  {
    id: 'compose-env',
    doc: 'docs/deployment.md',
    command: "echo 'PORTFOLIO_ORIGIN=https://jane.name' > .env",
    kind: 'run',
    container: true,
  },
  {
    id: 'compose-read-only-refuses-sample',
    doc: 'docs/deployment.md',
    command: 'docker compose up --build',
    kind: 'compose-refuse',
    compose: [],
    fatal: ['PORTFOLIO_SOURCE_DIR:sample_identity'],
    container: true,
  },
  {
    id: 'compose-identity',
    doc: 'docs/getting-started.md',
    command: '# edit config/portfolio.yml',
    kind: 'identity',
    file: 'config/portfolio.yml',
    scripted: `sets identity.name to ${FIXTURE_NAME}, the guide's first edit`,
    container: true,
  },
  {
    id: 'compose-read-only-starts',
    doc: 'docs/deployment.md',
    command: 'docker compose up --build',
    kind: 'compose-serve',
    compose: [],
    path: '/',
    // The sample's content names its author in other places too (a quote,
    // the authors of a paper), so only the new name is checked here.
    expect: { status: 200, includes: [FIXTURE_NAME] },
    container: true,
  },
  {
    id: 'deploy-dir',
    doc: 'docs/deployment.md',
    command: 'cd deploy',
    kind: 'cd',
    into: 'deploy',
    container: true,
  },
  {
    id: 'secrets-dir',
    doc: 'docs/deployment.md',
    command: 'mkdir -m 0700 secrets && sudo chown 1001:1001 secrets',
    kind: 'run',
    container: true,
  },
  {
    id: 'hash',
    doc: 'docs/deployment.md',
    command:
      'docker run --rm -it --user 1001:1001 -v "$PWD/secrets:/out" <image> \\\n  node apps/web/bin/owner.mjs hash-password --out /out/owner_password_hash',
    kind: 'hash',
    scripted:
      'runs it with -i and --stdin, the password made for the run given twice on standard input, on the image the Compose run built, portfolio:latest',
    script: (command) =>
      command
        .replace(' -it ', ' -i ')
        .replace('<image>', 'portfolio:latest')
        .replace('hash-password --out', 'hash-password --stdin --out'),
    container: true,
  },
  {
    id: 'back-to-root',
    doc: 'docs/getting-started.md',
    command: 'cd keyurgolani.name',
    kind: 'cd',
    into: '.',
    container: true,
  },
  {
    id: 'owner-copy-portfolio',
    doc: 'docs/deployment.md',
    command: 'cp portfolio.example.yml config/portfolio.yml   # then make it yours',
    kind: 'run',
    container: true,
  },
  {
    id: 'owner-deploy-dir',
    doc: 'docs/deployment.md',
    command: 'cd deploy',
    kind: 'cd',
    into: 'deploy',
    container: true,
  },
  {
    id: 'owner-env',
    doc: 'docs/deployment.md',
    command: "echo 'PORTFOLIO_ORIGIN=https://jane.name' > .env",
    kind: 'run',
    container: true,
  },
  {
    id: 'compose-owner-refuses-sample',
    doc: 'docs/deployment.md',
    command: 'docker compose -f compose.owner.yml up --build',
    kind: 'compose-refuse',
    compose: ['-f', 'compose.owner.yml'],
    fatal: ['PORTFOLIO_SOURCE_DIR:sample_identity'],
    container: true,
  },
  {
    id: 'owner-identity',
    doc: 'docs/getting-started.md',
    command: '# edit config/portfolio.yml',
    kind: 'identity',
    file: '../config/portfolio.yml',
    scripted: `sets identity.name to ${FIXTURE_NAME}, the guide's first edit`,
    container: true,
  },
  {
    // Past the identity, owner's first start imports the pair, which needs
    // the default composition registered: until then it refuses that alone.
    id: 'compose-owner-accepts-identity',
    doc: 'docs/deployment.md',
    command: 'docker compose -f compose.owner.yml up --build',
    kind: 'compose-refuse',
    compose: ['-f', 'compose.owner.yml'],
    fatal: [],
    notFatal: ['PORTFOLIO_SOURCE_DIR:sample_identity'],
    container: true,
  },
  {
    id: 'demo-env',
    doc: 'docs/deployment.md',
    command: "echo 'PORTFOLIO_ORIGIN=https://demo.jane.name' > .env",
    kind: 'run',
    container: true,
  },
  {
    id: 'compose-demo-starts',
    doc: 'docs/deployment.md',
    command: 'docker compose -f compose.demo.yml up --build',
    kind: 'compose-serve',
    compose: ['-f', 'compose.demo.yml'],
    path: '/',
    expect: { status: 200, includes: [SAMPLE_NAME] },
    container: true,
  },
];

/** Steps declared but not yet run, each with what it waits on (ci/rehearsal.mjs's LANDED). */
export const PENDING = Object.freeze([
  {
    id: 'compose-owner-ready',
    title:
      "deployment.md's owner Compose run reaches ready on the copied sample after the identity step",
    waitsOn: 'default-composition',
  },
]);

/**
 * sh fence lines in COVERED_DOCS the run doesn't take, each with why. A
 * line a doc gains that's neither a step nor here fails the run.
 */
export const SKIPPED = Object.freeze({
  'README.md': {
    'pnpm install': 'the guide step of the same text runs it',
    'pnpm dev': 'the guide step of the same text runs it',
    'docker compose up --build': "deployment.md's read-only Compose steps run it",
  },
  'docs/getting-started.md': {},
});

/**
 * Problems between the docs and STEPS: a step whose command its doc's sh
 * fences no longer hold, and a command in a covered doc that's neither a
 * step nor skipped.
 */
export function guideProblems(read = (doc) => readFileSync(path.join(REPO_ROOT, doc), 'utf8')) {
  const problems = [];
  const commands = new Map();
  const of = (doc) => {
    if (!commands.has(doc)) commands.set(doc, shCommands(read(doc)));
    return commands.get(doc);
  };
  for (const step of STEPS) {
    if (!of(step.doc).some((c) => c.text === step.command)) {
      problems.push(`${step.doc} has no sh command "${step.command}", which step ${step.id} runs`);
    }
  }
  for (const doc of COVERED_DOCS) {
    const skipped = SKIPPED[doc] ?? {};
    for (const { text, line } of of(doc)) {
      const taken = STEPS.some((step) => step.doc === doc && step.command === text);
      if (!taken && !(text in skipped)) {
        problems.push(
          `${doc}:${line}: "${text}" is a guide command the fresh-clone run doesn't take: add it to STEPS, or to SKIPPED with the reason`,
        );
      }
    }
    for (const text of Object.keys(skipped)) {
      if (!of(doc).some((c) => c.text === text))
        problems.push(`${doc} no longer has "${text}", which SKIPPED names`);
    }
  }
  return problems;
}

/**
 * The guide's identity step on a copied sample: `identity.name`, the sample's,
 * becomes `name`, the rest byte for byte. Null when the document doesn't
 * start with the sample's name under identity. No YAML parser, so the run
 * needs no install of its own.
 */
export function withIdentityName(text, name) {
  const pattern = new RegExp(
    `^(identity:[^\\n]*\\n(?:(?:[ \\t]+[^\\n]*|[ \\t]*#[^\\n]*|)\\n)*?[ \\t]+name:[ \\t]*)${SAMPLE_NAME}[ \\t]*$`,
    'm',
  );
  return pattern.test(text) ? text.replace(pattern, `$1${name}`) : null;
}

/** The shell text a command runs as: a comment-only line runs nothing, and a trailing comment goes. */
export const runnable = (command) => command.replace(/\s+#.*$/, '');

// ---- running it ----------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A body's problems against a step's `expect`. */
export function responseProblems(response, expect) {
  const problems = [];
  if (response.status !== expect.status)
    problems.push(`answered ${response.status}, not ${expect.status}`);
  for (const text of expect.includes ?? [])
    if (!response.body.includes(text)) problems.push(`doesn't show ${text}`);
  for (const text of expect.excludes ?? [])
    if (response.body.includes(text)) problems.push(`shows ${text}`);
  return problems;
}

async function get(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: 0, body: String(error.cause?.code ?? error.message) };
  }
}

class Clone {
  constructor(scratch, secrets) {
    this.scratch = scratch;
    this.secrets = secrets;
    this.root = path.join(scratch, 'keyurgolani.name');
    this.cwd = scratch;
    this.home = path.join(scratch, 'home');
    for (const dir of ['home', 'tmp', 'bin'])
      mkdirSync(path.join(scratch, dir), { recursive: true });
    this.log = [];
    this.bin = path.join(scratch, 'bin');
    // pnpm, as the guide's prerequisites ask for it: Corepack's where none is on PATH.
    const onPath = spawnSync('sh', ['-c', 'command -v pnpm'], { encoding: 'utf8' }).status === 0;
    if (!onPath) {
      writeFileSync(path.join(this.bin, 'pnpm'), '#!/bin/sh\nexec corepack pnpm "$@"\n');
      chmodSync(path.join(this.bin, 'pnpm'), 0o755);
    }
  }

  /** What every guide command gets: an empty HOME and XDG, no token, no cache, and nothing else of this one's. */
  env(extra = {}) {
    const keep = ['PATH', 'CI', 'LANG', 'TERM', 'DOCKER_HOST', 'FRESH_CLONE_PNPM_STORE'];
    const env = Object.fromEntries(
      keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]),
    );
    const store = env.FRESH_CLONE_PNPM_STORE;
    delete env.FRESH_CLONE_PNPM_STORE;
    return {
      ...env,
      PATH: [this.bin, path.dirname(process.execPath), process.env.PATH ?? '/usr/bin:/bin'].join(
        path.delimiter,
      ),
      HOME: this.home,
      XDG_CONFIG_HOME: path.join(this.home, '.config'),
      XDG_CACHE_HOME: path.join(this.home, '.cache'),
      XDG_DATA_HOME: path.join(this.home, '.local', 'share'),
      XDG_STATE_HOME: path.join(this.home, '.local', 'state'),
      TMPDIR: path.join(this.scratch, 'tmp'),
      TZ: 'UTC',
      NEXT_TELEMETRY_DISABLED: '1',
      npm_config_update_notifier: 'false',
      CI_RUN_CANARY: this.secrets.runCanary,
      ...(store ? { npm_config_store_dir: store } : {}),
      ...extra,
    };
  }

  /** The egress guard, for a server: this clone's own copy of it. */
  guarded() {
    return {
      NODE_OPTIONS: `--require ${path.join(this.root, 'tests', 'harness', 'egress-guard.cjs')}`,
    };
  }

  sh(command, { env = {}, timeoutMs = 300_000, input, withheld = false } = {}) {
    const result = spawnSync('sh', ['-c', command], {
      cwd: this.cwd,
      env: this.env(env),
      encoding: 'utf8',
      input,
      timeout: timeoutMs,
      maxBuffer: 256 << 20,
    });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`;
    this.log.push(
      `$ ${command}\n${withheld ? '[output withheld]\n' : out}[exit ${result.status ?? result.signal}]\n`,
    );
    return { status: result.status, out };
  }

  /** Starts `command` in its own process group; returns { stop, output }. */
  start(command, env) {
    const child = spawn('sh', ['-c', command], {
      cwd: this.cwd,
      env: this.env(env),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    const exited = new Promise((resolve) =>
      child.on('exit', (code, signal) => resolve(code ?? signal)),
    );
    let code;
    exited.then((c) => (code = c));
    return {
      output: () => out,
      exited: () => code,
      async stop() {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // Gone already.
        }
        const done = await Promise.race([exited, sleep(15_000).then(() => 'timeout')]);
        if (done === 'timeout') {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // Gone already.
          }
          await exited;
        }
        return out;
      },
    };
  }
}

class StepFailure extends Error {}
function expect(condition, message, out) {
  if (!condition)
    throw new StepFailure(
      out ? `${message}\n--- output ---\n${String(out).slice(-4000)}` : message,
    );
}

const egressRefusals = (text) =>
  String(text)
    .split('\n')
    .filter((l) => l.includes('[egress-guard] refused'));

async function runStep(clone, step) {
  const command = step.script ? step.script(step.command) : runnable(step.command);
  switch (step.kind) {
    case 'clone': {
      const source = process.env.FRESH_CLONE_SOURCE || REPO_ROOT;
      const ref =
        process.env.FRESH_CLONE_REF ||
        spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
      const cloned = clone.sh(
        `git clone --quiet --no-hardlinks ${JSON.stringify(source)} keyurgolani.name`,
      );
      expect(cloned.status === 0, 'the commit under test clones', cloned.out);
      clone.cwd = clone.root;
      const checkout = clone.sh(`git checkout --quiet --detach ${JSON.stringify(ref)}`);
      expect(checkout.status === 0, `the clone checks out ${ref}`, checkout.out);
      const untracked = clone.sh('git status --porcelain --ignored');
      expect(
        untracked.out.replace(/\[exit 0\]/, '').trim() === '',
        'the clone holds nothing but what is committed',
        untracked.out,
      );
      clone.cwd = clone.scratch;
      return;
    }
    case 'cd':
      clone.cwd = path.join(clone.root, step.into);
      return;
    case 'run': {
      const result = clone.sh(command, { timeoutMs: step.timeoutMs });
      expect(result.status === 0, `"${step.command}" exits 0, not ${result.status}`, result.out);
      return;
    }
    case 'identity': {
      const file = path.resolve(clone.cwd, step.file);
      const before = readFileSync(file, 'utf8');
      const after = withIdentityName(before, FIXTURE_NAME);
      expect(after !== null, `${step.file} starts with the sample's identity.name`);
      writeFileSync(file, after);
      clone.log.push(`# the identity step: ${step.file} identity.name is ${FIXTURE_NAME}\n`);
      return;
    }
    case 'refuse': {
      const port = await freePort();
      const server = clone.start(command, { PORT: String(port), ...clone.guarded() });
      const deadline = Date.now() + 180_000;
      while (server.exited() === undefined && Date.now() < deadline) await sleep(250);
      const out = await server.stop();
      clone.log.push(`$ ${command}\n${out}[exit ${server.exited()}]\n`);
      expect(
        server.exited() !== undefined && server.exited() !== 0,
        `"${step.command}" refuses to start`,
        out,
      );
      const codes = fatalCodes(out);
      for (const code of step.fatal)
        expect(
          codes.includes(code),
          `it refuses with ${code}, not ${codes.join(', ') || 'no config.fatal'}`,
          out,
        );
      expect(egressRefusals(out).length === 0, 'it reached no host outside the machine', out);
      return;
    }
    case 'serve': {
      const port = await freePort();
      const server = clone.start(command, { PORT: String(port), ...clone.guarded() });
      let response = { status: 0, body: '' };
      try {
        const deadline = Date.now() + 300_000;
        while (Date.now() < deadline && server.exited() === undefined) {
          response = await get(`http://127.0.0.1:${port}${step.path}`);
          if (response.status !== 0) break;
          await sleep(1000);
        }
      } finally {
        await server.stop();
      }
      const out = server.output();
      clone.log.push(`$ ${command}\n${out}\n[GET ${step.path}: ${response.status}]\n`);
      expect(response.status !== 0, `"${step.command}" serves ${step.path}`, out);
      const problems = responseProblems(response, step.expect);
      expect(problems.length === 0, `GET ${step.path} ${problems.join(', ')}`, out);
      expect(fatalCodes(out).length === 0, 'it logs no config.fatal', out);
      expect(egressRefusals(out).length === 0, 'it reached no host outside the machine', out);
      return;
    }
    case 'hash': {
      const password = `fresh-clone-password-${randomBytes(12).toString('hex')}`;
      clone.secrets.extra.push(password);
      for (const line of maskCommands([password], process.env)) console.log(line);
      const result = clone.sh(command, { input: `${password}\n${password}\n`, withheld: true });
      expect(result.status === 0, `the hash step exits 0, not ${result.status}`);
      const hash = readSecret(clone, path.join(clone.cwd, 'secrets', 'owner_password_hash'));
      clone.secrets.extra.push(hash);
      for (const line of maskCommands([hash], process.env)) console.log(line);
      expect(/^\$scrypt\$/.test(hash), 'the hash step wrote a scrypt hash');
      return;
    }
    case 'compose-refuse':
    case 'compose-serve':
      return composeStep(clone, step, command);
    default:
      throw new Error(`step ${step.id} has an unknown kind, ${step.kind}`);
  }
}

/** A file the server's user owns, read through the image, as the runner's user may not read it. */
function readSecret(clone, file) {
  const result = spawnSync('sudo', ['cat', file], { encoding: 'utf8' });
  return (result.status === 0 ? result.stdout : '').replace(/\n$/, '');
}

/** One Compose run as the guide gives it: up, watched until it serves or refuses, then down. */
async function composeStep(clone, step, command) {
  const compose = (args) =>
    clone.sh(`docker compose ${[...step.compose, ...args].join(' ')}`, { timeoutMs: 120_000 });
  const up = clone.start(command, {});
  try {
    const deadline = Date.now() + 900_000;
    if (step.kind === 'compose-refuse') {
      let codes = [];
      while (Date.now() < deadline) {
        codes = fatalCodes(compose(['logs', '--no-color']).out);
        if (codes.length > 0) break;
        expect(
          up.exited() === undefined,
          `"${step.command}" ended before the server started`,
          up.output(),
        );
        await sleep(3000);
      }
      const logs = compose(['logs', '--no-color']).out;
      expect(codes.length > 0, `"${step.command}" refuses to start`, `${up.output()}\n${logs}`);
      for (const code of step.fatal)
        expect(codes.includes(code), `it refuses with ${code}, not ${codes.join(', ')}`, logs);
      for (const code of step.notFatal ?? [])
        expect(!codes.includes(code), `it no longer refuses with ${code}`, logs);
    } else {
      let response = { status: 0, body: '' };
      while (Date.now() < deadline) {
        response = await get(`http://127.0.0.1:3000${step.path}`);
        if (response.status !== 0) break;
        expect(up.exited() === undefined, `"${step.command}" ended before it served`, up.output());
        await sleep(3000);
      }
      const logs = compose(['logs', '--no-color']).out;
      expect(
        response.status !== 0,
        `"${step.command}" serves ${step.path}`,
        `${up.output()}\n${logs}`,
      );
      const problems = responseProblems(response, step.expect);
      expect(problems.length === 0, `GET ${step.path} ${problems.join(', ')}`, logs);
      expect(fatalCodes(logs).length === 0, 'it logs no config.fatal', logs);
    }
  } finally {
    compose(['down', '--volumes', '--timeout', '10']);
    await up.stop();
    clone.log.push(`$ ${command}\n${up.output()}\n`);
  }
}

/** One summary row per step and pending step. */
export function renderSummary(results) {
  const lines = ['### fresh-clone', '', '| Step | Outcome | Command |', '| --- | --- | --- |'];
  for (const r of results)
    lines.push(
      `| \`${r.id}\` | ${r.outcome} | \`${r.command.replace(/\s*\\\n\s*/g, ' ').replace(/\|/g, '\\|')}\` |`,
    );
  return `${lines.join('\n')}\n`;
}

async function main() {
  const reports = path.join(reportsDir(), 'fresh-clone');
  rmSync(reports, { recursive: true, force: true });
  mkdirSync(reports, { recursive: true });
  const secrets = { runCanary: `canary-fresh-clone-${randomBytes(12).toString('hex')}`, extra: [] };
  for (const line of maskCommands([secrets.runCanary], process.env)) console.log(line);
  const scratch = mkdtempSync(path.join(tmpdir(), 'portfolio-fresh-clone-'));
  const clone = new Clone(scratch, secrets);
  const containers = process.env.FRESH_CLONE_CONTAINERS === '1';
  const results = [];
  const problems = [];
  const gate = currentGate();
  const fail = (id, message) => {
    problems.push(`${id}: ${message}`);
    reportError(`${id}: ${message.split('\n')[0]}`, { title: 'fresh-clone' });
    if (gate)
      writeFailureRecord({ ...gate, test: `fresh-clone ${id}`, actual: message.split('\n')[0] });
  };

  for (const problem of guideProblems()) fail('guide', problem);
  let stopped = problems.length > 0;
  try {
    for (const step of STEPS) {
      const row = { id: step.id, command: step.command };
      if (step.container && !containers) {
        results.push({
          ...row,
          outcome: 'not run: needs FRESH_CLONE_CONTAINERS=1 and Docker (CI)',
        });
        continue;
      }
      if (stopped) {
        results.push({ ...row, outcome: 'not run: an earlier step failed' });
        continue;
      }
      const started = Date.now();
      try {
        await runStep(clone, step);
        results.push({
          ...row,
          outcome: step.scripted ? `passed (scripted: ${step.scripted})` : 'passed',
        });
        console.log(
          `[fresh-clone] PASS ${step.id} (${((Date.now() - started) / 1000).toFixed(1)}s): ${step.command}`,
        );
      } catch (error) {
        stopped = true;
        results.push({ ...row, outcome: 'failed' });
        fail(step.id, error instanceof StepFailure ? error.message : String(error?.stack ?? error));
      }
    }
    for (const row of PENDING) {
      results.push({
        id: row.id,
        command: row.title,
        outcome: `pending: waits on ${LANDED[row.waitsOn].what}`,
      });
      console.log(`[fresh-clone] PENDING ${row.id}: ${row.title}`);
    }
    // The clone's own registry, which its build wrote, says what it registers.
    if (
      existsSync(
        path.join(clone.root, 'apps', 'web', 'src', 'lib', 'generated', 'asset-manifest.json'),
      )
    ) {
      const state = {
        registered: registeredVariants(clone.root),
        defaultId: defaultComposition(clone.root),
      };
      for (const problem of pendingProblems(PENDING, state)) fail('pending', problem);
    } else if (!stopped) {
      fail(
        'pending',
        "the clone's build wrote no asset manifest to read the registered compositions from",
      );
    }
  } finally {
    writeFileSync(path.join(reports, 'commands.log'), clone.log.join('\n'));
    if (containers)
      spawnSync('sudo', ['rm', '-rf', path.join(clone.root, 'deploy', 'secrets')], {
        stdio: 'ignore',
      });
    if (process.env.FRESH_CLONE_KEEP) console.log(`[fresh-clone] kept ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }

  const { redacted, unchecked } = redactArtifacts(reportsDir(), [
    secrets.runCanary,
    ...secrets.extra,
  ]);
  for (const file of redacted) fail('canary', `${file} held a per-run secret, now redacted`);
  for (const file of unchecked)
    fail('canary', `${file} was too large to check for a per-run secret`);
  const summary = renderSummary(results);
  writeFileSync(path.join(reports, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  console.log(`\n${summary}`);
  console.log(
    problems.length === 0
      ? '[fresh-clone] passed'
      : `[fresh-clone] ${problems.length} problem(s). Reproduce with: ${REPRO}`,
  );
  return problems.length === 0 ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
