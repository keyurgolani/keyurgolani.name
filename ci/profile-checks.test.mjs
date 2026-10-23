// The offline cores of `pnpm smoke:profiles`'s #12 checks
// (ci/lib/profile-checks.mjs): each given what a container runtime reports
// for a hardened container, and for one that drops each piece, since only
// CI runs the containers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CACHE_DIR,
  composeProblems,
  DATA_DIR,
  HARDENING,
  hermeticProblems,
  inspectProblems,
  isDurable,
  maskCommands,
  newAuditRecords,
  partsOf,
  persistenceProblems,
  processProblems,
  redact,
  redactArtifacts,
  reproFor,
  sourceProblems,
  SPOOFED_HOST,
  spoofProblems,
  stopProblems,
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
  assert.deepEqual(redactArtifacts(dir, ['canary-run-0123']), ['profiles/owner.log']);
  assert.equal(
    readFileSync(path.join(dir, 'profiles', 'owner.log'), 'utf8'),
    'line [run secret] and more',
  );
  assert.equal(
    readFileSync(path.join(dir, 'failures', 'profiles-1.json'), 'utf8'),
    '{"actual":"clean"}',
  );
  assert.deepEqual(redactArtifacts(dir, ['canary-run-0123']), [], 'nothing left to find');
  assert.deepEqual(redactArtifacts(path.join(dir, 'absent'), ['x']), []);
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
