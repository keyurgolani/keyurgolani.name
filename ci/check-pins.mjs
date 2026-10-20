#!/usr/bin/env node
// Rejects mutable references: every workflow `uses:` must name a full commit
// SHA, and every image in a workflow, Dockerfile, or Compose file must carry an
// @sha256 digest (the multi-arch index digest, so every platform resolves to
// the same image). Also keeps the Playwright container on the same version as
// @playwright/test.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
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

function lineOf(text, needle) {
  const index = text.indexOf(needle);
  return index < 0 ? undefined : text.slice(0, index).split('\n').length;
}

/** Workflow files and composite actions. */
export function checkWorkflow(text, file) {
  const doc = parseYaml(text) ?? {};
  const problems = [];
  const check = (value, label, problemOf) => {
    const problem = problemOf(value);
    if (problem)
      problems.push({
        file,
        line: lineOf(text, String(value)),
        message: `${label} ${value} ${problem}`,
      });
  };
  for (const step of doc.runs?.steps ?? []) if (step?.uses) check(step.uses, 'uses:', usesProblem);
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    if (job?.uses) check(job.uses, `jobs.${id}.uses:`, usesProblem);
    const container = typeof job?.container === 'string' ? job.container : job?.container?.image;
    if (container) check(container, `jobs.${id}.container`, imageProblem);
    for (const [name, service] of Object.entries(job?.services ?? {})) {
      if (service?.image) check(service.image, `jobs.${id}.services.${name}`, imageProblem);
    }
    for (const step of job?.steps ?? []) if (step?.uses) check(step.uses, 'uses:', usesProblem);
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
  const doc = parseYaml(text) ?? {};
  const problems = [];
  for (const [name, service] of Object.entries(doc.services ?? {})) {
    const image = service?.image;
    // A service with `build:` names its own build output with `image:`.
    if (!image || service.build || IMAGE_UNDER_TEST.test(image)) continue;
    const problem = imageProblem(image);
    if (problem) {
      problems.push({
        file,
        line: lineOf(text, image),
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
        line: lineOf(text, match[0]),
        message: `Playwright image v${match[1]} does not match @playwright/test ${version}`,
      });
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
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
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
  const counts = { workflows: 0, dockerfiles: 0, compose: 0 };
  for (const file of repoFiles()) {
    const read = () => readFileSync(path.join(REPO_ROOT, file), 'utf8');
    if (isWorkflow(file)) {
      counts.workflows += 1;
      const text = read();
      problems.push(...checkWorkflow(text, file));
      if (playwright) problems.push(...checkPlaywrightImage(text, file, playwright));
    } else if (isDockerfile(file)) {
      counts.dockerfiles += 1;
      problems.push(...checkDockerfile(read(), file));
    } else if (isCompose(file)) {
      counts.compose += 1;
      problems.push(...checkCompose(read(), file));
    }
  }

  const gate = currentGate();
  for (const { file, line, message } of problems) {
    reportError(message, { file, line, title: 'unpinned reference' });
    if (gate)
      writeFailureRecord({ ...gate, test: message, asset: line ? `${file}:${line}` : file });
  }
  const scanned = `${counts.workflows} workflow files, ${counts.dockerfiles} Dockerfiles, ${counts.compose} Compose files`;
  if (problems.length > 0) {
    console.error(`[pins] ${problems.length} unpinned reference(s) in ${scanned}`);
    return 1;
  }
  console.log(`[pins] every reference is pinned (${scanned})`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
