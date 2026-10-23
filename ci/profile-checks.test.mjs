// The offline cores of `pnpm smoke:profiles`'s #12 checks
// (ci/lib/profile-checks.mjs): each given what a container runtime reports
// for a hardened container, and for one that drops each piece, since only
// CI runs the containers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { CANARY_BODY, encodings, SUMMARY_FIELDS } from '../tests/harness/canaries.mjs';
import {
  anonymousLeaks,
  ARTIFACT_LIMIT,
  CACHE_DIR,
  caseStudyIn,
  caseStudyProblems,
  composeProblems,
  DYNAMIC_ROUTES,
  dynamicRouteProblems,
  isDynamic,
  MADE_UP_EXPECTATIONS,
  SAMPLES,
  DATA_DIR,
  fatalCodes,
  HARDENING,
  hermeticProblems,
  hopsLabel,
  HOST_PROBES,
  hostProblems,
  inspectProblems,
  leakProblems,
  isDurable,
  maskCommands,
  MEDIA_CACHE,
  mediaCacheFor,
  mediaMissProblems,
  newAuditRecords,
  partsOf,
  persistenceProblems,
  PREVIEW_ORIGIN,
  processProblems,
  redact,
  redactArtifacts,
  renditionIn,
  renditionProblems,
  reproFor,
  signedInLeaks,
  sourceProblems,
  SPOOFED_HOST,
  spoofProblems,
  stopProblems,
  successSourceProblems,
  UNCHECKED_STUB,
  WRITE_TARGETS,
  writeProblems,
} from './lib/profile-checks.mjs';

/** `docker inspect` for a container started with HARDENING, as the smoke starts them. */
function inspected(profile, change = () => {}) {
  const info = {
    HostConfig: {
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      CapAdd: null,
      SecurityOpt: ['no-new-privileges:true'],
      Privileged: false,
      NetworkMode: 'portfolio-ci-profiles-1-net',
      Tmpfs: { [CACHE_DIR]: '' },
      PortBindings: {},
    },
    Mounts: [
      { Type: 'bind', Destination: '/run/canary-secret', RW: false },
      { Type: 'bind', Destination: '/canary-source', RW: false },
      ...(profile === 'owner' ? [{ Type: 'volume', Destination: DATA_DIR, RW: true }] : []),
    ],
    Config: {
      Env: [
        'PORTFOLIO_PROFILE=' + profile,
        'PORTFOLIO_AUTH_PASSWORD_HASH_FILE=/run/canary-secret/owner_password_hash',
      ],
    },
  };
  change(info);
  return info;
}

test('HARDENING is the flags the Compose examples run with', () => {
  assert.deepEqual(HARDENING, [
    '--read-only',
    '--tmpfs',
    CACHE_DIR,
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges:true',
  ]);
});

const REPO = fileURLToPath(new URL('..', import.meta.url));

test('read-only and demo get the media cache tmpfs the Compose examples give them, and owner none (#10)', () => {
  const tmpfs = (file) =>
    (parseYaml(readFileSync(path.join(REPO, file), 'utf8')).services.web.tmpfs ?? []).filter(
      (entry) => entry.startsWith(`${MEDIA_CACHE}:`),
    );
  for (const [profile, file] of [
    ['read-only', 'docker-compose.yml'],
    ['demo', 'deploy/compose.demo.yml'],
    ['owner', 'deploy/compose.owner.yml'],
  ]) {
    assert.deepEqual(
      mediaCacheFor(profile),
      tmpfs(file).flatMap((entry) => ['--tmpfs', entry]),
      profile,
    );
  }
  assert.deepEqual(mediaCacheFor('owner'), []);
});

test('inspect: a hardened container passes under every profile', () => {
  for (const profile of ['read-only', 'demo', 'owner']) {
    assert.deepEqual(inspectProblems(inspected(profile), { profile, secrets: ['s3cr3t'] }), []);
  }
});

test('inspect: each missing flag, an added capability, and privilege fail', () => {
  const cases = [
    [(i) => void (i.HostConfig.ReadonlyRootfs = false), /root filesystem is not read-only/],
    [(i) => void (i.HostConfig.CapDrop = []), /capabilities are not all dropped/],
    [(i) => void (i.HostConfig.CapAdd = ['NET_ADMIN']), /capabilities added: NET_ADMIN/],
    [(i) => void (i.HostConfig.SecurityOpt = []), /no-new-privileges is not set/],
    [(i) => void (i.HostConfig.Privileged = true), /privileged/],
    [(i) => void (i.HostConfig.NetworkMode = 'host'), /host network/],
    [(i) => void (i.HostConfig.Tmpfs = {}), /no tmpfs at/],
  ];
  for (const [change, expected] of cases) {
    const problems = inspectProblems(inspected('demo', change), { profile: 'demo' });
    assert.equal(problems.length, 1, `${expected}: ${problems.join('; ')}`);
    assert.match(problems[0], expected);
  }
});

test('inspect: a port published beyond 127.0.0.1 fails', () => {
  const info = inspected('demo', (i) => {
    i.HostConfig.PortBindings = {
      '3000/tcp': [
        { HostIp: '127.0.0.1', HostPort: '3000' },
        { HostIp: '', HostPort: '3001' },
      ],
    };
  });
  assert.deepEqual(inspectProblems(info, { profile: 'demo' }), [
    '3000/tcp is published on every address',
  ]);
});

test("inspect: the data directory is owner's only writable persistent mount", () => {
  // A writable bind anywhere, or the data volume outside owner, fails.
  const bind = inspected('read-only', (i) => {
    i.Mounts.push({ Type: 'bind', Destination: '/canary-source', RW: true });
  });
  assert.deepEqual(inspectProblems(bind, { profile: 'read-only' }), [
    '/canary-source is a writable bind mount',
  ]);
  const data = inspected('demo', (i) => {
    i.Mounts.push({ Type: 'volume', Destination: DATA_DIR, RW: true });
  });
  assert.deepEqual(inspectProblems(data, { profile: 'demo' }), [
    `${DATA_DIR} is a writable volume mount`,
  ]);
  const second = inspected('owner', (i) => {
    i.Mounts.push({ Type: 'volume', Destination: '/app/apps/web/public/assets', RW: true });
  });
  assert.deepEqual(inspectProblems(second, { profile: 'owner' }), [
    '/app/apps/web/public/assets is a writable volume mount',
  ]);
  const none = inspected('owner', (i) => {
    i.Mounts = i.Mounts.filter((m) => m.Destination !== DATA_DIR);
  });
  assert.deepEqual(inspectProblems(none, { profile: 'owner' }), [
    `${DATA_DIR} is not a writable mount`,
  ]);
});

test('inspect: the hash reaches owner only through its _FILE', () => {
  const direct = inspected('owner', (i) => {
    i.Config.Env.push('PORTFOLIO_AUTH_PASSWORD_HASH=$scrypt$ln=17,r=8,p=1$c2FsdA$a2V5');
  });
  assert.deepEqual(inspectProblems(direct, { profile: 'owner', secrets: ['a2V5'] }), [
    'the password hash is in the environment, not a _FILE',
    "a run secret is in the container's environment",
  ]);
  const other = inspected('owner', (i) => void i.Config.Env.push('SOMETHING=has-a2V5-in-it'));
  assert.deepEqual(inspectProblems(other, { profile: 'owner', secrets: ['a2V5'] }), [
    "a run secret is in the container's environment",
  ]);
});

const STATUS = [
  'Name:\tnode',
  'Umask:\t0022',
  'State:\tS (sleeping)',
  'Uid:\t1001\t1001\t1001\t1001',
  'Gid:\t1001\t1001\t1001\t1001',
  'CapInh:\t0000000000000000',
  'CapPrm:\t0000000000000000',
  'CapEff:\t0000000000000000',
  'CapBnd:\t0000000000000000',
  'CapAmb:\t0000000000000000',
  'NoNewPrivs:\t1',
  'Seccomp:\t2',
].join('\n');

test('/proc/1/status: uid and gid 1001, no capability, and NoNewPrivs pass', () => {
  assert.deepEqual(processProblems(STATUS), []);
});

test('/proc/1/status: root, a capability left, or privileges to gain fail', () => {
  assert.deepEqual(
    processProblems(STATUS.replace('Uid:\t1001\t1001\t1001\t1001', 'Uid:\t0\t0\t0\t0')),
    ['Uid is 0\t0\t0\t0, not 1001 throughout'],
  );
  assert.deepEqual(
    processProblems(STATUS.replace('Gid:\t1001\t1001\t1001\t1001', 'Gid:\t1001\t1001\t0\t1001')),
    ['Gid is 1001\t1001\t0\t1001, not 1001 throughout'],
  );
  // Docker's default set, which --cap-drop=ALL removes.
  assert.deepEqual(
    processProblems(STATUS.replace('CapBnd:\t0000000000000000', 'CapBnd:\t00000000a80425fb')),
    ['CapBnd is 00000000a80425fb'],
  );
  assert.deepEqual(processProblems(STATUS.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0')), [
    'NoNewPrivs is 0',
  ]);
  assert.equal(processProblems('').length, 8, 'nothing read is every field unread');
});

/** The write probe's answer for a hardened container under `profile`. */
const writes = (profile) =>
  Object.fromEntries(
    WRITE_TARGETS.map((dir) => [
      dir,
      dir === CACHE_DIR || (profile === 'owner' && dir === DATA_DIR) ? 'written' : 'EROFS',
    ]),
  );

test('write probe: only the cache tmpfs, and under owner the data directory, take a file', () => {
  for (const profile of ['read-only', 'demo', 'owner']) {
    assert.deepEqual(writeProblems(writes(profile), profile), []);
  }
});

test('write probe: a writable app tree, a lost data directory, or a skipped path fail', () => {
  assert.deepEqual(writeProblems({ ...writes('demo'), '/app': 'written' }, 'demo'), [
    '/app is writable',
  ]);
  assert.deepEqual(writeProblems({ ...writes('demo'), '/tmp': 'written' }, 'demo'), [
    '/tmp is writable',
  ]);
  assert.deepEqual(writeProblems({ ...writes('demo'), [DATA_DIR]: 'written' }, 'demo'), [
    `${DATA_DIR} is writable`,
  ]);
  assert.deepEqual(writeProblems({ ...writes('owner'), [DATA_DIR]: 'EACCES' }, 'owner'), [
    `${DATA_DIR} is not writable (EACCES)`,
  ]);
  const skipped = writes('read-only');
  delete skipped['/app/apps/web/public'];
  assert.deepEqual(writeProblems(skipped, 'read-only'), [
    'the write probe skipped /app/apps/web/public',
  ]);
  assert.deepEqual(writeProblems(undefined, 'demo'), ['the write probe reported nothing']);
  for (const dir of ['/', '/app', '/app/apps/web', '/app/apps/web/public', '/app/node_modules']) {
    assert.ok(WRITE_TARGETS.includes(dir), dir);
  }
});

test('shutdown: exit 143 or 0 under 10 seconds passes; SIGKILL, slowness, or memory fail', () => {
  assert.deepEqual(stopProblems({ exitCode: 143, elapsedMs: 800 }), []);
  assert.deepEqual(stopProblems({ exitCode: 0, elapsedMs: 800 }), []);
  assert.deepEqual(stopProblems({ exitCode: 137, elapsedMs: 10_400 }), [
    'exited 137 on SIGTERM, not 143 or 0',
    'took 10400 ms to stop, not under 10000',
  ]);
  assert.deepEqual(stopProblems({ exitCode: 143, elapsedMs: 900, oomKilled: true }), [
    'was killed for memory',
  ]);
  // Where the next container needs the claim released, only Next's own exit counts.
  assert.deepEqual(stopProblems({ exitCode: 143, elapsedMs: 90 }, 10_000, [143]), []);
  assert.deepEqual(stopProblems({ exitCode: 0, elapsedMs: 90 }, 10_000, [143]), [
    'exited 0 on SIGTERM, not 143',
  ]);
  assert.deepEqual(stopProblems({ exitCode: null, elapsedMs: 12 }), [
    'exited never on SIGTERM, not 143 or 0',
  ]);
});

test('the data volume: durable files kept and the audit log only grown pass', () => {
  const before = {
    'store.json': '{"layout":1}',
    'publication/live.json': '{"revision":"rev_1"}',
    'publication/server.json': '{"pid":7}',
    'revisions/rev_1/manifest.json': '{}',
    'audit/2026-10.jsonl': '{"type":"login"}\n',
    'ephemeral/auth/sessions/a.json': '{}',
  };
  const after = {
    'store.json': '{"layout":1}',
    'publication/live.json': '{"revision":"rev_1"}',
    'revisions/rev_1/manifest.json': '{}',
    'audit/2026-10.jsonl': '{"type":"login"}\n{"type":"logout"}\n',
  };
  assert.deepEqual(persistenceProblems(before, after), []);
  assert.ok(!isDurable('ephemeral/auth/fingerprint'));
  assert.ok(!isDurable('revisions/.staging-rev_2/manifest.json'));
  assert.ok(!isDurable('publication/lock'));
  assert.ok(isDurable('publication/events/1.json'));
});

test('the data volume: a lost or changed file, or a rewritten audit log, fail', () => {
  const before = {
    'store.json': '{"layout":1}',
    'publication/live.json': '{"revision":"rev_1"}',
    'audit/2026-10.jsonl': '{"type":"login"}\n',
  };
  assert.deepEqual(
    persistenceProblems(before, {
      'store.json': '{"layout":1}',
      'audit/2026-10.jsonl': '{"type":"other"}\n',
    }),
    ['publication/live.json is gone', 'audit/2026-10.jsonl changed'],
  );
  assert.deepEqual(persistenceProblems(before, { ...before, 'store.json': '{"layout":2}' }), [
    'store.json changed',
  ]);
  assert.deepEqual(persistenceProblems({ 'ephemeral/x': '1' }, {}), [
    'the data directory held nothing durable to keep',
  ]);
});

const ORIGIN = 'https://rowan.test';

test('spoofed headers: an answer on the canonical origin passes', () => {
  assert.deepEqual(
    spoofProblems(
      {
        status: 200,
        headers: { 'content-type': 'application/xml' },
        body: `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/work/a</loc></url></urlset>`,
      },
      ORIGIN,
      '/sitemap.xml',
    ),
    [],
  );
  assert.deepEqual(
    spoofProblems(
      { status: 303, headers: { location: `${ORIGIN}/studio/sign-in` }, body: '' },
      ORIGIN,
      '/studio',
    ),
    [],
  );
  assert.deepEqual(
    spoofProblems(
      { status: 303, headers: { location: '/studio/sign-in' }, body: '' },
      ORIGIN,
      '/studio',
    ),
    [],
  );
});

test('spoofed headers: the spoofed host anywhere, a redirect off origin, or a foreign URL fail', () => {
  assert.deepEqual(
    spoofProblems(
      { status: 200, headers: { link: `<https://${SPOOFED_HOST}/>` }, body: `x ${SPOOFED_HOST}` },
      ORIGIN,
      '/',
    ),
    ['a header names the spoofed host', 'the body names the spoofed host'],
  );
  assert.deepEqual(
    spoofProblems(
      { status: 303, headers: { location: 'http://rowan.test/studio/sign-in' }, body: '' },
      ORIGIN,
      '/studio',
    ),
    ['redirects to http://rowan.test/studio/sign-in, off https://rowan.test'],
  );
  assert.deepEqual(
    spoofProblems(
      {
        status: 200,
        headers: {},
        body: '<urlset><url><loc>http://rowan.test/</loc></url></urlset>',
      },
      ORIGIN,
      '/sitemap.xml',
    ),
    ['the sitemap lists http://rowan.test/'],
  );
  assert.deepEqual(
    spoofProblems({ status: 200, headers: {}, body: '<urlset/>' }, ORIGIN, '/sitemap.xml'),
    ['the sitemap lists no URL'],
  );
  assert.deepEqual(spoofProblems({ error: 'ECONNRESET' }, ORIGIN, '/'), ['no answer (ECONNRESET)']);
});

const failed = (source) => ({ type: 'login_failed', refs: { source } });

test('sign-in sources: none at 0 hops, and only the last X-Forwarded-For entry at 1', () => {
  assert.deepEqual(sourceProblems([failed('unknown'), { type: 'login', refs: {} }], 0), []);
  assert.deepEqual(sourceProblems([failed('203.0.113.0/24')], 1), []);
  assert.deepEqual(sourceProblems([failed('198.51.100.0/24')], 0), [
    'at 0 hops, failed sign-ins came from 198.51.100.0/24, not unknown',
  ]);
  // The entry the client wrote is never believed.
  assert.deepEqual(sourceProblems([failed('203.0.113.0/24'), failed('198.51.100.0/24')], 1), [
    'at 1 hops, failed sign-ins came from 198.51.100.0/24, not 203.0.113.0/24',
  ]);
  assert.deepEqual(sourceProblems([failed('unknown')], 1), [
    'at 1 hops, failed sign-ins came from unknown, not 203.0.113.0/24',
  ]);
  assert.deepEqual(sourceProblems([], 1), ['the audit log holds no failed sign-in']);
});

test('the audit records a step added are its new lines', () => {
  const before = { 'audit/2026-10.jsonl': '{"n":1}\n', 'store.json': '{"n":0}' };
  const after = {
    'audit/2026-10.jsonl': '{"n":1}\n{"n":2}\nnot json\n',
    'audit/2026-11.jsonl': '{"n":3}\n',
    'store.json': '{"n":9}',
  };
  assert.deepEqual(newAuditRecords(before, after), [{ n: 2 }, { n: 3 }]);
});

/** `docker compose config --format json` for a hardened example. */
const composed = (change = () => {}) => {
  const config = {
    services: {
      web: {
        ports: [{ mode: 'ingress', host_ip: '127.0.0.1', target: 3000, published: '3000' }],
        read_only: true,
        cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'],
      },
    },
  };
  change(config.services.web);
  return config;
};

test('Compose examples: a loopback publish and the hardening pass', () => {
  assert.deepEqual(composeProblems(composed()), []);
});

test('Compose examples: a wide publish, a writable root, or a missing flag fail', () => {
  assert.deepEqual(composeProblems(composed((web) => void (web.ports[0].host_ip = '0.0.0.0'))), [
    'web publishes 3000 on 0.0.0.0',
  ]);
  assert.deepEqual(composeProblems(composed((web) => void delete web.ports[0].host_ip)), [
    'web publishes 3000 on every address',
  ]);
  assert.deepEqual(composeProblems(composed((web) => void (web.ports = []))), [
    'web publishes no port',
  ]);
  assert.deepEqual(composeProblems(composed((web) => void (web.read_only = false))), [
    'web has a writable root',
  ]);
  assert.deepEqual(composeProblems(composed((web) => void delete web.cap_drop)), [
    'web keeps its capabilities',
  ]);
  assert.deepEqual(composeProblems(composed((web) => void (web.security_opt = []))), [
    "web doesn't set no-new-privileges",
  ]);
  assert.deepEqual(composeProblems({}), ['the example has no service']);
});

test('hermetic: in CI no GitHub token reaches the smoke', () => {
  assert.deepEqual(hermeticProblems({ CI: 'true' }), []);
  assert.deepEqual(hermeticProblems({ CI: 'true', GITHUB_TOKEN: 'x', GH_TOKEN: '' }), [
    'GITHUB_TOKEN is set in the job',
  ]);
  assert.deepEqual(hermeticProblems({ GITHUB_TOKEN: 'x' }), [], 'a local run may have one');
});

test('redaction: every run secret leaves a message, longest first', () => {
  assert.equal(
    redact('carries abc and abcdef and x', ['abc', 'abcdef']),
    'carries [run secret] and [run secret] and x',
  );
  assert.equal(redact('nothing here', ['']), 'nothing here');
});

test('artifacts: a report holding a run secret is named and redacted in place', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profile-artifacts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  mkdirSync(path.join(dir, 'failures'), { recursive: true });
  writeFileSync(path.join(dir, 'profiles', 'owner.log'), 'line canary-run-0123 and more');
  writeFileSync(path.join(dir, 'failures', 'profiles-1.json'), '{"actual":"clean"}');
  assert.deepEqual(redactArtifacts(dir, ['canary-run-0123']), {
    redacted: ['profiles/owner.log'],
    unchecked: [],
  });
  assert.equal(
    readFileSync(path.join(dir, 'profiles', 'owner.log'), 'utf8'),
    'line [run secret] and more',
  );
  assert.equal(
    readFileSync(path.join(dir, 'failures', 'profiles-1.json'), 'utf8'),
    '{"actual":"clean"}',
  );
  assert.deepEqual(
    redactArtifacts(dir, ['canary-run-0123']),
    { redacted: [], unchecked: [] },
    'nothing left to find',
  );
  assert.deepEqual(redactArtifacts(path.join(dir, 'absent'), ['x']), {
    redacted: [],
    unchecked: [],
  });
});

test('masking: each run secret gets ::add-mask:: in Actions, and nothing elsewhere', () => {
  assert.deepEqual(maskCommands(['a', '', 'b'], { GITHUB_ACTIONS: 'true' }), [
    '::add-mask::a',
    '::add-mask::b',
  ]);
  assert.deepEqual(maskCommands(['a'], {}), []);
});

test('SMOKE_PROFILES picks the parts, in run order, and each failure names its rerun', () => {
  assert.deepEqual(partsOf(undefined), ['read-only', 'demo', 'owner', 'rows']);
  assert.deepEqual(partsOf('rows, owner'), ['owner', 'rows']);
  assert.throws(() => partsOf('owner,studio'), /SMOKE_PROFILES names studio/);
  assert.equal(reproFor('owner'), 'SMOKE_PROFILES=owner pnpm smoke:profiles');
  // The failure record's reproCommand pattern takes it.
  const schema = JSON.parse(
    readFileSync(path.join(import.meta.dirname, 'failure-record.schema.json'), 'utf8'),
  );
  const pattern = new RegExp(schema.properties.reproCommand.pattern);
  for (const part of partsOf(undefined)) assert.match(reproFor(part), pattern);
});

test("spoofed headers: demo's empty sitemap passes, and lists only canonical URLs too", () => {
  const empty = { status: 200, headers: {}, body: '<urlset/>' };
  assert.deepEqual(spoofProblems(empty, ORIGIN, '/sitemap.xml', { indexable: false }), []);
  const foreign = {
    status: 200,
    headers: {},
    body: '<urlset><url><loc>https://elsewhere.test/</loc></url></urlset>',
  };
  assert.deepEqual(spoofProblems(foreign, ORIGIN, '/sitemap.xml', { indexable: false }), [
    'the sitemap lists https://elsewhere.test/',
  ]);
});

test('artifacts: a report too large to read fails, and is cut so it is never uploaded unread', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'profile-artifacts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'big.log'), `${'x'.repeat(64)} canary-run-0123`);
  writeFileSync(path.join(dir, 'small.log'), 'fine');
  assert.deepEqual(redactArtifacts(dir, ['canary-run-0123'], 32), {
    redacted: [],
    unchecked: ['big.log'],
  });
  assert.equal(readFileSync(path.join(dir, 'big.log'), 'utf8'), UNCHECKED_STUB);
  assert.equal(readFileSync(path.join(dir, 'small.log'), 'utf8'), 'fine');
  assert.equal(ARTIFACT_LIMIT, 64 * 1024 * 1024);
});

test("signed-in leaks: the run's secrets, owner's, and the data directory, but not the summary", () => {
  const runSecrets = encodings('canary-run-0123');
  const leaks = signedInLeaks('/app/apps/web', ['the-password'], runSecrets);
  for (const value of ['canary-run-0123', 'the-password', DATA_DIR, CANARY_BODY, '/app/apps/web']) {
    assert.ok(leaks.includes(value), value);
  }
  for (const field of SUMMARY_FIELDS) assert.ok(!leaks.includes(field), field);
});

test('leaks: a canary in a header or the body is found, and a clean answer passes', () => {
  const leaks = ['canary-run-0123'];
  assert.deepEqual(leakProblems({ headers: { a: 'b' }, body: 'clean' }, leaks), []);
  assert.deepEqual(
    leakProblems(
      { headers: { 'set-cookie': 'x=canary-run-0123' }, body: 'canary-run-0123' },
      leaks,
    ),
    ['a header carries canary-run-0123', 'the body carries canary-run-0123'],
  );
  assert.deepEqual(leakProblems(undefined, leaks), []);
});

test('the spoofed sign-in: unknown at 0 hops, the last X-Forwarded-For entry at 1', () => {
  const succeeded = (source) => ({ type: 'login_succeeded', refs: { source } });
  assert.deepEqual(successSourceProblems([succeeded('unknown')], 0), []);
  assert.deepEqual(successSourceProblems([succeeded('203.0.113.0/24')], 1), []);
  assert.deepEqual(successSourceProblems([succeeded('198.51.100.0/24')], 1), [
    'at 1 hops, the sign-in came from 198.51.100.0/24, not 203.0.113.0/24',
  ]);
  assert.deepEqual(successSourceProblems([succeeded('203.0.113.0/24')], 0), [
    'at 0 hops, the sign-in came from 203.0.113.0/24, not unknown',
  ]);
  assert.deepEqual(successSourceProblems([{ type: 'login_failed', refs: {} }], 0), [
    'the audit log holds no sign-in',
  ]);
});

const STATUS_DOCUMENT = '<!doctype html><title>Preview</title>';
const answer = (status, body, type = 'text/html; charset=utf-8') => ({
  status,
  headers: { 'content-type': type },
  body,
});

test('host rule: each probe sets X-Forwarded-Host to the other origin, and Host decides', () => {
  assert.equal(new URL(PREVIEW_ORIGIN).host, 'preview.rowan.test');
  for (const probe of HOST_PROBES) assert.notEqual(probe.host, probe.forwarded);
  const expects = new Set(HOST_PROBES.map((probe) => probe.expect));
  assert.deepEqual([...expects].sort(), ['plain', 'site', 'status', 'unknown']);
  assert.ok(
    HOST_PROBES.some((p) => p.host === 'rowan.test' && p.forwarded === 'preview.rowan.test'),
  );
  assert.ok(
    HOST_PROBES.some((p) => p.host === 'preview.rowan.test' && p.forwarded === 'rowan.test'),
  );
});

test('host rule: the answers the rule gives pass, and the ones a header-led rule gives fail', () => {
  const expected = { fixtureName: 'Rowan Fixture', statusDocument: STATUS_DOCUMENT };
  const right = {
    site: answer(200, '<h1>Rowan Fixture</h1>'),
    unknown: answer(404, '<h1>Page not found</h1>'),
    status: answer(404, STATUS_DOCUMENT),
    plain: answer(404, 'Not found.', 'text/plain; charset=utf-8'),
  };
  for (const probe of HOST_PROBES) {
    assert.deepEqual(hostProblems(probe, right[probe.expect], expected), [], probe.path);
  }
  const [main, , previewHome, , previewFrame, other] = HOST_PROBES;
  // The main host treated as the preview origin.
  assert.equal(hostProblems(main, right.unknown, expected).length, 1);
  // The preview host given the whole site.
  assert.equal(hostProblems(previewHome, right.site, expected).length, 1);
  // The preview host refused even what a frame loads.
  assert.equal(hostProblems(previewFrame, right.unknown, expected).length, 1);
  // A host the deployment doesn't name given a page.
  assert.equal(hostProblems(other, right.site, expected).length, 1);
  assert.equal(hostProblems(other, right.unknown, expected).length, 1);
  assert.match(hostProblems(main, { error: 'ECONNRESET' }, expected)[0], /no answer/);
});

test('anonymous leaks: the summary fields too, beside the run secrets and the data directory', () => {
  const leaks = anonymousLeaks('/app/apps/web', ['the-password'], encodings('canary-run-0123'));
  for (const value of ['canary-run-0123', 'the-password', DATA_DIR, ...SUMMARY_FIELDS]) {
    assert.ok(leaks.includes(value), value);
  }
});

test('fatal codes: each config.fatal line, in order, and nothing else', () => {
  const text = [
    'not json',
    '{"level":"fatal","event":"config.fatal","key":"PORTFOLIO_DATA_DIR","code":"data_dir_in_use"}',
    '{"level":"warn","event":"config.warning","key":"X","code":"y"}',
    '{"level":"fatal","event":"config.fatal","code":"startup_failed"}',
    '{broken',
  ].join('\n');
  assert.deepEqual(fatalCodes(text), [
    'PORTFOLIO_DATA_DIR:data_dir_in_use',
    'unkeyed:startup_failed',
  ]);
  assert.deepEqual(fatalCodes(''), []);
});

test('hop labels read as a person would say them', () => {
  assert.equal(hopsLabel(0), 'at 0 trusted hops');
  assert.equal(hopsLabel(1), 'at 1 trusted hop');
});

test("/media's probe path is the plain uncached 404, and a real rendition is 200, its own type, immutable, and nosniff (#10)", () => {
  const miss = (status, type, cache) => ({
    status,
    headers: { 'content-type': type, 'cache-control': cache },
  });
  assert.deepEqual(mediaMissProblems(miss(404, 'text/plain; charset=utf-8', 'no-store')), []);
  assert.deepEqual(mediaMissProblems(miss(200, 'image/webp', 'no-store')), [
    'answered 200, not 404',
    'is image/webp, not the plain 404',
  ]);
  assert.deepEqual(mediaMissProblems(miss(404, 'text/plain', 'public, max-age=60')), [
    'no Cache-Control: no-store',
  ]);

  const hex = 'a'.repeat(64);
  const path = `/media/anamika-portrait/${hex}/w480-a1.webp`;
  assert.equal(renditionIn(`<img src="${path}" srcset="/media/x/${hex}/w960-a1.jpg 960w">`), path);
  assert.equal(renditionIn('<img src="https://images.rowan.test/a.png">'), null);
  assert.equal(renditionIn(undefined), null);

  const served = (status, headers) => ({ status, headers });
  const good = {
    'content-type': 'image/webp',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };
  assert.deepEqual(renditionProblems(path, served(200, good)), []);
  assert.deepEqual(
    renditionProblems(
      path,
      served(404, { ...good, 'content-type': 'text/plain', 'cache-control': 'no-store' }),
    ),
    [
      'answered 404, not 200',
      'is text/plain, not image/webp',
      "has Cache-Control no-store, not a year's immutable",
    ],
  );
  assert.deepEqual(
    renditionProblems(
      path.replace('.webp', '.jpg'),
      served(200, { ...good, 'x-content-type-options': undefined }),
    ),
    ['is image/webp, not image/jpeg', 'no nosniff'],
  );
});

/** The route table's patterns, read from its source: what smoke:profiles reads through tsx. */
function routeTablePatterns() {
  const source = readFileSync(
    fileURLToPath(new URL('../apps/web/src/server/routes.ts', import.meta.url)),
    'utf8',
  );
  return [...source.matchAll(/pattern: '([^']+)'/g)]
    .map(([, pattern]) => pattern)
    .filter((pattern) => pattern !== '/api/studio/[name]');
}

test('every dynamic pattern in the route table has a made-up path expectation or a sample, and nothing else is listed (#12)', () => {
  const patterns = routeTablePatterns();
  assert.ok(patterns.some(isDynamic), 'the source holds dynamic patterns');
  assert.deepEqual(dynamicRouteProblems(patterns), []);
  // #79's media keeps its two checks: the made-up path's plain 404, and demo's real rendition.
  assert.deepEqual(DYNAMIC_ROUTES['/media/[...path]'], {
    madeUp: 'media-miss',
    sample: 'rendition',
  });
  assert.equal(SAMPLES.rendition.required, true);
  assert.deepEqual(SAMPLES.rendition.profiles, ['demo']);
  // /work/<slug> (#10b): a slug nothing has is the 404 page; a case study / links to is a page.
  assert.deepEqual(DYNAMIC_ROUTES['/work/[slug]'], { madeUp: 'not-found', sample: 'case-study' });
  for (const entry of Object.values(DYNAMIC_ROUTES)) {
    assert.ok(MADE_UP_EXPECTATIONS.includes(entry.madeUp), JSON.stringify(entry));
  }
});

test('a dynamic pattern with neither a made-up expectation nor a sample fails, as do unknown ones and stale entries (#12)', () => {
  const table = {
    '/a/[id]': { madeUp: 'not-found' },
    '/b/[[...rest]]': { sample: 'case-study' },
  };
  assert.deepEqual(dynamicRouteProblems(['/a/[id]', '/b/[[...rest]]', '/static'], table), []);
  const [missing] = dynamicRouteProblems(['/a/[id]', '/b/[[...rest]]', '/c/[slug]'], table);
  assert.match(missing, /^\/c\/\[slug\] has a dynamic segment, and DYNAMIC_ROUTES .* neither/);
  assert.equal(dynamicRouteProblems(['/a/[id]'], { '/a/[id]': {} }).length, 1);
  assert.match(
    dynamicRouteProblems(['/a/[id]'], { '/a/[id]': { madeUp: 'teapot' } })[0],
    /expects teapot, not one of not-found, media-miss, served, status-document/,
  );
  assert.match(
    dynamicRouteProblems(['/a/[id]'], { '/a/[id]': { madeUp: 'served', sample: 'nope' } })[0],
    /sample nope is none SAMPLES knows/,
  );
  assert.deepEqual(
    dynamicRouteProblems(['/a/[id]'], {
      '/a/[id]': { madeUp: 'served' },
      '/gone/[x]': { madeUp: 'served' },
    }),
    ["DYNAMIC_ROUTES has /gone/[x], which the route table doesn't"],
  );
  // A static pattern needs nothing, such as the catalog fixture's Studio page (#6).
  assert.deepEqual(dynamicRouteProblems(['/studio/_catalog-fixture'], {}), []);
});

test("a case study sample is the first /work/<slug> a page links to, and its answer is a page with the app's request id (#10b)", () => {
  assert.equal(
    caseStudyIn('<a href="/sample">x</a><a href="/work/ledger">Ledger</a><a href="/work/atlas">'),
    '/work/ledger',
  );
  assert.equal(caseStudyIn('<a href="/work/">x</a><a href="/work/Bad_Slug">'), null);
  assert.equal(caseStudyIn(undefined), null);
  const page = {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-request-id': '0b1e7c2a-3d4f-4a5b-8c6d-7e8f9a0b1c2d',
    },
  };
  assert.deepEqual(caseStudyProblems('/work/ledger', page), []);
  assert.deepEqual(
    caseStudyProblems('/work/ledger', { status: 404, headers: { 'content-type': 'text/plain' } }),
    ['answered 404, not 200', 'is text/plain, not a page', 'no x-request-id'],
  );
});
