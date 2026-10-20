#!/usr/bin/env node
// Rejects mutable references: every workflow `uses:` must name a full commit
// SHA, and every image must carry an @sha256 digest (the multi-arch index
// digest, so every platform resolves to the same image). That covers images
// in workflows (containers, services, and action inputs such as setup-qemu's
// `image` and setup-buildx's `driver-opts: image=`), Dockerfiles, and Compose
// files. Also keeps the Playwright container on the @playwright/test release
// and CI's NODE_VERSION on the Dockerfile's Node release.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCounter, parseDocument } from 'yaml';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /@sha256:[0-9a-f]{64}$/;
const PLAYWRIGHT_IMAGE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)/g;

/** @returns {string | null} why the `uses:` value is not pinned */
export function usesProblem(value) {
  if (typeof value !== 'string' || value === '') return 'is empty';
  if (value.startsWith('./')) return null;
  if (value.startsWith('docker://')) return DIGEST.test(value) ? null : 'has no @sha256 digest';
  const at = value.lastIndexOf('@');
  if (at < 0) return 'has no ref';
  const ref = value.slice(at + 1);
  return COMMIT_SHA.test(ref) ? null : `is pinned to "${ref}", not a full commit SHA`;
}

/** @returns {string | null} why the image reference is not pinned */
export function imageProblem(value) {
  if (typeof value !== 'string' || value === '') return 'is empty';
  if (value.includes('${{')) return 'comes from an expression, so its pin cannot be checked';
  return DIGEST.test(value) ? null : 'has no @sha256 digest';
}

/** The `image=` values in a list input such as setup-buildx's driver-opts. */
export function driverOptImages(value) {
  return String(value)
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.startsWith('image='))
    .map((part) => part.slice('image='.length));
}

/** Parses YAML and returns the plain data plus the line of any node path. */
function yamlDoc(text) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  const lineAt = (nodePath) => {
    const offset = doc.getIn(nodePath, true)?.range?.[0];
    return offset === undefined ? undefined : lineCounter.linePos(offset).line;
  };
  return { data: doc.toJS() ?? {}, lineAt };
}

/** Workflow files and composite actions. */
export function checkWorkflow(text, file) {
  const { data, lineAt } = yamlDoc(text);
  const problems = [];
  const check = (value, nodePath, label, problemOf) => {
    const problem = problemOf(value);
    if (problem)
      problems.push({ file, line: lineAt(nodePath), message: `${label} ${value} ${problem}` });
  };
  const checkStep = (step, at) => {
    if (step?.uses) check(step.uses, [...at, 'uses'], 'uses:', usesProblem);
    const inputs = step?.with ?? {};
    const action = step?.uses?.split('@')[0] ?? 'step';
    if (inputs.image !== undefined) {
      check(String(inputs.image), [...at, 'with', 'image'], `${action} with.image`, imageProblem);
    }
    if (inputs['driver-opts'] !== undefined) {
      for (const image of driverOptImages(inputs['driver-opts'])) {
        check(image, [...at, 'with', 'driver-opts'], `${action} driver-opts image=`, imageProblem);
      }
    }
  };

  (data.runs?.steps ?? []).forEach((step, i) => checkStep(step, ['runs', 'steps', i]));
  for (const [id, job] of Object.entries(data.jobs ?? {})) {
    if (job?.uses) check(job.uses, ['jobs', id, 'uses'], `jobs.${id}.uses:`, usesProblem);
    if (typeof job?.container === 'string') {
      check(job.container, ['jobs', id, 'container'], `jobs.${id}.container`, imageProblem);
    } else if (job?.container?.image) {
      check(
        job.container.image,
        ['jobs', id, 'container', 'image'],
        `jobs.${id}.container`,
        imageProblem,
      );
    }
    for (const [name, service] of Object.entries(job?.services ?? {})) {
      if (service?.image) {
        check(
          service.image,
          ['jobs', id, 'services', name, 'image'],
          `jobs.${id}.services.${name}`,
          imageProblem,
        );
      }
    }
    (job?.steps ?? []).forEach((step, i) => checkStep(step, ['jobs', id, 'steps', i]));
  }
  return problems;
}

export function checkDockerfile(text, file) {
  const problems = [];
  const stages = new Set();
  const add = (index, message) => problems.push({ file, line: index + 1, message });
  text.split('\n').forEach((line, index) => {
    const syntax = /^#\s*syntax\s*=\s*(\S+)/i.exec(line);
    if (syntax) {
      if (!DIGEST.test(syntax[1]))
        add(index, `syntax directive ${syntax[1]} has no @sha256 digest`);
      return;
    }
    const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      const [, image, alias] = from;
      const lower = image.toLowerCase();
      if (lower !== 'scratch' && !stages.has(lower)) {
        if (image.includes('$'))
          add(index, `FROM ${image} uses a build argument, so its pin cannot be checked`);
        else if (!DIGEST.test(image)) add(index, `FROM ${image} has no @sha256 digest`);
      }
      if (alias) stages.add(alias.toLowerCase());
      return;
    }
    const sources = [];
    const copyFrom = /^\s*COPY\s+(?:\S+\s+)*?--from=(\S+)/i.exec(line);
    if (copyFrom) sources.push(copyFrom[1]);
    for (const mount of line.matchAll(/--mount=(\S+)/g)) {
      const from = mount[1].split(',').find((part) => part.startsWith('from='));
      if (from) sources.push(from.slice('from='.length));
    }
    for (const source of sources) {
      if (stages.has(source.toLowerCase()) || /^\d+$/.test(source)) continue;
      if (!DIGEST.test(source))
        add(index, `--from=${source} names an image with no @sha256 digest`);
    }
  });
  return problems;
}

// `${VAR}` or `${VAR:?message}`: the image under test, supplied by the caller.
const IMAGE_UNDER_TEST = /^\$\{[A-Z_][A-Z0-9_]*(?::?\?[^}]*)?\}$/;

export function checkCompose(text, file) {
  const { data, lineAt } = yamlDoc(text);
  const problems = [];
  for (const [name, service] of Object.entries(data.services ?? {})) {
    const image = service?.image;
    // A service with `build:` names its own build output with `image:`.
    if (!image || service.build || IMAGE_UNDER_TEST.test(image)) continue;
    const problem = imageProblem(image);
    if (problem) {
      problems.push({
        file,
        line: lineAt(['services', name, 'image']),
        message: `services.${name}.image ${image} ${problem}`,
      });
    }
  }
  return problems;
}

/** The Playwright container must run the same release as @playwright/test. */
export function checkPlaywrightImage(text, file, version) {
  const problems = [];
  for (const match of text.matchAll(PLAYWRIGHT_IMAGE)) {
    if (match[1] !== version) {
      problems.push({
        file,
        line: text.slice(0, match.index).split('\n').length,
        message: `Playwright image v${match[1]} does not match @playwright/test ${version}`,
      });
    }
  }
  return problems;
}

/**
 * CI tests on the Node release the image ships: every NODE_VERSION in a
 * workflow must equal the release in the Dockerfiles' node:X.Y.Z-* tags.
 *
 * @param {{ file: string, text: string }[]} workflows
 * @param {{ file: string, text: string }[]} dockerfiles
 */
export function checkNodeVersions(workflows, dockerfiles) {
  const problems = [];
  const releases = [];
  for (const { file, text } of dockerfiles) {
    text.split('\n').forEach((line, index) => {
      const from =
        /^\s*FROM\s+(?:--platform=\S+\s+)?(?:docker\.io\/)?(?:library\/)?node:([^\s@]+)/i.exec(
          line,
        );
      if (!from) return;
      const release = /^(\d+\.\d+\.\d+)(?:-|$)/.exec(from[1])?.[1];
      if (release) releases.push({ file, line: index + 1, release });
      else {
        problems.push({
          file,
          line: index + 1,
          message: `node:${from[1]} does not name a full Node release (node:X.Y.Z-...), so NODE_VERSION can't be checked against it`,
        });
      }
    });
  }
  const distinct = [...new Set(releases.map((r) => r.release))];
  if (distinct.length > 1) {
    problems.push({
      file: releases[0].file,
      line: releases[0].line,
      message: `Dockerfiles use more than one Node release: ${distinct.join(', ')}`,
    });
  }
  if (distinct.length !== 1) return problems;

  for (const { file, text } of workflows) {
    const { data, lineAt } = yamlDoc(text);
    const scopes = [
      [['env'], data.env],
      ...Object.entries(data.jobs ?? {}).map(([id, job]) => [['jobs', id, 'env'], job?.env]),
    ];
    for (const [at, env] of scopes) {
      if (env?.NODE_VERSION === undefined) continue;
      if (String(env.NODE_VERSION) !== distinct[0]) {
        problems.push({
          file,
          line: lineAt([...at, 'NODE_VERSION']),
          message: `NODE_VERSION ${env.NODE_VERSION} does not match the Dockerfile's node:${distinct[0]}`,
        });
      }
    }
  }
  return problems;
}

const isWorkflow = (f) =>
  /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || /(^|\/)action\.ya?ml$/.test(f);
const isDockerfile = (f) =>
  /(^|\/)(Dockerfile|Containerfile)[^/]*$/.test(f) || /\.(Dockerfile|Containerfile)$/.test(f);
const isCompose = (f) => /(^|\/)(docker-)?compose(\.[\w-]+)*\.ya?ml$/.test(f);

function repoFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return [...new Set(out.split('\0'))]
    .filter((f) => f && !f.includes('__fixtures__/') && existsSync(path.join(REPO_ROOT, f)))
    .sort();
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const playwright = pkg.devDependencies?.['@playwright/test'];
  const problems = [];
  if (playwright && !/^\d+\.\d+\.\d+$/.test(playwright)) {
    problems.push({
      file: 'package.json',
      message: `@playwright/test is "${playwright}"; pin it exactly so it matches the Playwright container`,
    });
  }
  const workflows = [];
  const dockerfiles = [];
  let composeFiles = 0;
  for (const file of repoFiles()) {
    const text = () => readFileSync(path.join(REPO_ROOT, file), 'utf8');
    if (isWorkflow(file)) {
      workflows.push({ file, text: text() });
    } else if (isDockerfile(file)) {
      dockerfiles.push({ file, text: text() });
    } else if (isCompose(file)) {
      composeFiles += 1;
      problems.push(...checkCompose(text(), file));
    }
  }
  for (const { file, text } of workflows) {
    problems.push(...checkWorkflow(text, file));
    if (playwright) problems.push(...checkPlaywrightImage(text, file, playwright));
  }
  for (const { file, text } of dockerfiles) problems.push(...checkDockerfile(text, file));
  problems.push(...checkNodeVersions(workflows, dockerfiles));

  const gate = currentGate();
  for (const { file, line, message } of problems) {
    reportError(message, { file, line, title: 'unpinned reference' });
    if (gate)
      writeFailureRecord({ ...gate, test: message, asset: line ? `${file}:${line}` : file });
  }
  const scanned = `${workflows.length} workflow files, ${dockerfiles.length} Dockerfiles, ${composeFiles} Compose files`;
  if (problems.length > 0) {
    console.error(`[pins] ${problems.length} problem(s) in ${scanned}`);
    return 1;
  }
  console.log(`[pins] every reference is pinned and Node matches the image (${scanned})`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
