import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCompose,
  checkDockerfile,
  checkPlaywrightImage,
  checkWorkflow,
  imageProblem,
  usesProblem,
} from './check-pins.mjs';

const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const messages = (problems) => problems.map((p) => p.message);

test('uses: accepts full commit SHAs, local actions, and digest-pinned docker actions', () => {
  assert.equal(usesProblem(`actions/checkout@${SHA}`), null);
  assert.equal(usesProblem(`github/codeql-action/init@${SHA}`), null);
  assert.equal(usesProblem('./.github/actions/setup'), null);
  assert.equal(usesProblem(`docker://alpine@${DIGEST}`), null);
});

test('uses: rejects tags, branches, short SHAs, and undigested docker actions', () => {
  assert.match(usesProblem('actions/checkout@v4'), /not a full commit SHA/);
  assert.match(usesProblem('actions/checkout@main'), /not a full commit SHA/);
  assert.match(usesProblem('actions/checkout@abc1234'), /not a full commit SHA/);
  assert.match(usesProblem('actions/checkout'), /no ref/);
  assert.match(usesProblem('docker://alpine:3'), /no @sha256 digest/);
});

test('images need a digest and cannot come from expressions', () => {
  assert.equal(imageProblem(`node:22-alpine@${DIGEST}`), null);
  assert.match(imageProblem('node:22-alpine'), /no @sha256 digest/);
  assert.match(imageProblem('${{ matrix.image }}'), /expression/);
});

test('workflows: checks steps, reusable workflows, containers, and services', () => {
  const workflow = `
jobs:
  ok:
    runs-on: ubuntu-24.04
    container:
      image: mcr.microsoft.com/playwright:v1.58.2-noble@${DIGEST}
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
  bad:
    runs-on: ubuntu-24.04
    container: node:22
    services:
      db:
        image: postgres:16
    steps:
      - uses: actions/setup-node@v6
  reuse:
    uses: org/repo/.github/workflows/x.yml@main
`;
  const problems = checkWorkflow(workflow, 'ci.yml');
  assert.deepEqual(messages(problems), [
    'jobs.bad.container node:22 has no @sha256 digest',
    'jobs.bad.services.db postgres:16 has no @sha256 digest',
    'uses: actions/setup-node@v6 is pinned to "v6", not a full commit SHA',
    'jobs.reuse.uses: org/repo/.github/workflows/x.yml@main is pinned to "main", not a full commit SHA',
  ]);
  assert.equal(problems[0].line, 11);
});

test('composite actions: checks their steps', () => {
  const action = 'runs:\n  using: composite\n  steps:\n    - uses: actions/cache@v4\n';
  assert.deepEqual(messages(checkWorkflow(action, 'action.yml')), [
    'uses: actions/cache@v4 is pinned to "v4", not a full commit SHA',
  ]);
});

test('Dockerfiles: syntax, FROM, and external --from sources need digests; stages do not', () => {
  const dockerfile = [
    '# syntax=docker/dockerfile:1',
    `FROM node:22-alpine@${DIGEST} AS deps`,
    'FROM deps AS builder',
    'FROM --platform=$BUILDPLATFORM node:22 AS cross',
    'FROM scratch',
    'COPY --from=builder /app /app',
    'COPY --from=busybox:1 /bin/sh /bin/sh',
    'RUN --mount=type=bind,from=alpine:3,target=/x true',
    `COPY --from=alpine@${DIGEST} /etc/os-release /x`,
    'FROM $BASE',
  ].join('\n');
  assert.deepEqual(messages(checkDockerfile(dockerfile, 'Dockerfile')), [
    'syntax directive docker/dockerfile:1 has no @sha256 digest',
    'FROM node:22 has no @sha256 digest',
    '--from=busybox:1 names an image with no @sha256 digest',
    '--from=alpine:3 names an image with no @sha256 digest',
    'FROM $BASE uses a build argument, so its pin cannot be checked',
  ]);
});

test('Compose: literal images need digests; built images and the image under test do not', () => {
  const compose = `
services:
  built:
    build: .
    image: portfolio:latest
  under-test:
    image: \${PORTFOLIO_IMAGE:?set it}
  plain-var:
    image: \${PORTFOLIO_IMAGE}
  defaulted:
    image: \${IMAGE:-caddy:2}
  pinned:
    image: caddy:2-alpine@${DIGEST}
  floating:
    image: caddy:2-alpine
`;
  assert.deepEqual(messages(checkCompose(compose, 'compose.yml')), [
    'services.defaulted.image ${IMAGE:-caddy:2} has no @sha256 digest',
    'services.floating.image caddy:2-alpine has no @sha256 digest',
  ]);
});

test('the Playwright container must match @playwright/test', () => {
  const text = `image: mcr.microsoft.com/playwright:v1.58.2-noble@${DIGEST}`;
  assert.deepEqual(checkPlaywrightImage(text, 'ci.yml', '1.58.2'), []);
  assert.deepEqual(messages(checkPlaywrightImage(text, 'ci.yml', '1.59.0')), [
    'Playwright image v1.58.2 does not match @playwright/test 1.59.0',
  ]);
});
