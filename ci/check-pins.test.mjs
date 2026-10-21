import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCompose,
  checkDockerfile,
  checkNodeVersions,
  checkPlaywrightImage,
  checkWorkflow,
  driverOptImages,
  imageProblem,
  latestFlavorProblem,
  latestTagProblems,
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
  assert.deepEqual(
    problems.map((p) => p.line),
    [11, 14, 16, 18],
  );
});

test('workflows: each unpinned reference reports its own line', () => {
  const workflow = [
    'jobs:',
    '  a:',
    '    steps:',
    `      - uses: actions/checkout@${SHA}`,
    '      - uses: actions/cache@v4',
    '  b:',
    '    steps:',
    '      - uses: actions/cache@v4',
  ].join('\n');
  assert.deepEqual(
    checkWorkflow(workflow, 'ci.yml').map((p) => p.line),
    [5, 8],
  );
});

test('workflows: action image inputs and buildx driver-opts need digests', () => {
  const workflow = `
jobs:
  publish:
    steps:
      - uses: docker/setup-qemu-action@${SHA}
        with:
          image: docker.io/tonistiigi/binfmt:qemu-v10.2.3
      - uses: docker/setup-qemu-action@${SHA}
        with:
          image: docker.io/tonistiigi/binfmt:qemu-v10.2.3@${DIGEST}
      - uses: docker/setup-buildx-action@${SHA}
        with:
          driver-opts: |
            network=host
            image=moby/buildkit:v0.34.0
      - uses: docker/setup-buildx-action@${SHA}
        with:
          driver-opts: image=moby/buildkit:v0.34.0@${DIGEST}
`;
  const problems = checkWorkflow(workflow, 'ci.yml');
  assert.deepEqual(messages(problems), [
    'docker/setup-qemu-action with.image docker.io/tonistiigi/binfmt:qemu-v10.2.3 has no @sha256 digest',
    'docker/setup-buildx-action driver-opts image= moby/buildkit:v0.34.0 has no @sha256 digest',
  ]);
  assert.deepEqual(
    problems.map((p) => p.line),
    [7, 13],
  );
});

test('driverOptImages reads image= from newline and comma lists', () => {
  assert.deepEqual(driverOptImages('network=host\nimage=a@x'), ['a@x']);
  assert.deepEqual(driverOptImages('network=host,image=b'), ['b']);
  assert.deepEqual(driverOptImages('network=host'), []);
});

test('NODE_VERSION must match the Dockerfile Node release', () => {
  const dockerfile = (tag) => ({
    file: 'Dockerfile',
    text: `FROM node:${tag}@${DIGEST} AS deps\nFROM deps AS app\n`,
  });
  const workflow = (version) => ({
    file: 'ci.yml',
    text: `env:\n  NODE_VERSION: ${version}\njobs:\n  a:\n    env:\n      NODE_VERSION: ${version}\n`,
  });
  assert.deepEqual(checkNodeVersions([workflow('22.23.3')], [dockerfile('22.23.3-alpine')]), []);
  assert.deepEqual(
    checkNodeVersions([workflow('22.23.2')], [dockerfile('22.23.3-alpine')]).map((p) => [
      p.line,
      p.message,
    ]),
    [
      [2, "NODE_VERSION 22.23.2 does not match the Dockerfile's node:22.23.3"],
      [6, "NODE_VERSION 22.23.2 does not match the Dockerfile's node:22.23.3"],
    ],
  );
  assert.match(
    checkNodeVersions([workflow('22.23.3')], [dockerfile('22-alpine')])[0].message,
    /does not name a full Node release/,
  );
  const mixed = {
    file: 'Dockerfile',
    text: `FROM node:22.23.3-alpine@${DIGEST}\nFROM node:22.24.0-alpine@${DIGEST}\n`,
  };
  assert.match(checkNodeVersions([], [mixed])[0].message, /more than one Node release/);
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

test('metadata-action flavor must set latest=false', () => {
  for (const flavor of [
    'latest=false',
    'prefix=v,latest=false',
    'prefix=v, latest=false',
    'suffix=-x,onlatest=true,latest=false',
    'latest=false\r\nprefix=v',
    'LATEST=false',
    'latest = false',
    '# latest=auto\nlatest=false',
  ]) {
    assert.equal(latestFlavorProblem(flavor), null, flavor);
  }
  assert.match(latestFlavorProblem(undefined), /no latest= entry, so it runs latest=auto/);
  assert.match(latestFlavorProblem('prefix=v'), /no latest= entry/);
  assert.match(latestFlavorProblem('onlatest=false'), /no latest= entry/);
  assert.match(latestFlavorProblem('latest=auto'), /sets latest=auto/);
  assert.match(
    latestFlavorProblem('latest=true'),
    /sets latest=true, which adds latest on every run/,
  );
  assert.match(latestFlavorProblem('latest=False'), /sets latest=False/);
  assert.match(latestFlavorProblem('latest=false # keep latest off'), /sets latest=false # keep/);
  // Commented-out lines don't count, and the action takes the last entry.
  assert.match(latestFlavorProblem('# latest=false'), /no latest= entry/);
  assert.match(latestFlavorProblem('# prefix=v,latest=false'), /no latest= entry/);
  assert.match(latestFlavorProblem('latest=false\nLatest=auto'), /has 2 latest= entries/);
  assert.match(latestFlavorProblem('latest=false,latest = true'), /has 2 latest= entries/);
  // GitHub substitutes expressions first, and CSV quotes can hide entries.
  assert.match(
    latestFlavorProblem("latest=${{ !contains(github.ref_name, '-') }}"),
    /comes from an expression/,
  );
  assert.match(latestFlavorProblem('${{ inputs.flavor }}'), /comes from an expression/);
  assert.match(latestFlavorProblem('latest=false\n"latest=auto"'), /CSV quotes/);
  assert.match(latestFlavorProblem('"prefix=v\nlatest=false\n"'), /CSV quotes/);
});

test('metadata-action tags may add latest only with an enable= condition', () => {
  assert.deepEqual(
    latestTagProblems(
      [
        'type=sha,format=short',
        'type=semver,pattern={{version}}',
        'type=raw,value=latest,enable={{is_default_branch}}',
        "type=raw,value=latest,enable=${{ !contains(github.ref_name, '-') }}",
        'type=raw,value=${{ github.ref_name }}',
        'type=raw,value=latest,enable=false',
        '# type=raw,value=latest',
      ].join('\n'),
    ),
    [],
  );
  assert.deepEqual(latestTagProblems(undefined), []);
  assert.deepEqual(
    latestTagProblems('type=raw,value=latest\nlatest\nvalue=latest,enable=true\n"value=latest"'),
    [
      'entry type=raw,value=latest has no enable= condition, so every run moves latest',
      'entry latest has no enable= condition, so every run moves latest',
      'entry value=latest,enable=true has no enable= condition, so every run moves latest',
      'entry "value=latest" uses CSV quotes, which this check does not read',
    ],
  );
});

test('workflows: a semver-tag metadata-action without a latest flavor is refused', () => {
  // The shape that moved latest on the v0.1.1 tag push: semver tag rules and
  // a raw latest rule gated on the default branch, but no flavor, so
  // latest=auto added latest on the tag anyway.
  const workflow = `
on:
  push:
    tags: ['v*.*.*']
jobs:
  publish:
    steps:
      - uses: docker/metadata-action@${SHA}
        with:
          images: ghcr.io/owner/repo
          tags: |
            type=semver,pattern={{version}}
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/metadata-action@${SHA}
        with:
          images: ghcr.io/owner/repo
          tags: type=sha,format=short
          flavor: |
            latest=false
`;
  const problems = checkWorkflow(workflow, 'publish.yml');
  assert.deepEqual(messages(problems), [
    'docker/metadata-action flavor has no latest= entry, so it runs latest=auto, which adds latest on final versions and tag pushes; set latest=false, and add latest only through a type=raw,value=latest rule with an enable= condition',
  ]);
  assert.deepEqual(
    problems.map((p) => [p.line, p.title]),
    [[8, 'latest tag']],
  );
});

test('workflows: metadata-action is matched without regard to case and by its former name', () => {
  const workflow = `
jobs:
  publish:
    steps:
      - uses: Docker/Metadata-Action@${SHA}
      - uses: crazy-max/ghaction-docker-meta@${SHA}
        with:
          flavor: latest=true
      - uses: docker/metadata-action@${SHA}
        with:
          tags: |
            type=sha
            type=raw,value=latest
          flavor: latest=false
`;
  const problems = checkWorkflow(workflow, 'publish.yml');
  assert.deepEqual(
    problems.map((p) => [p.line, p.message.split(';')[0]]),
    [
      [
        5,
        'Docker/Metadata-Action flavor has no latest= entry, so it runs latest=auto, which adds latest on final versions and tag pushes',
      ],
      [8, 'crazy-max/ghaction-docker-meta flavor sets latest=true, which adds latest on every run'],
      [
        11,
        'docker/metadata-action tags entry type=raw,value=latest has no enable= condition, so every run moves latest',
      ],
    ],
  );
});
