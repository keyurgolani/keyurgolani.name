import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const TOOL = fileURLToPath(new URL('./containment-tools.mjs', import.meta.url));
const CHECK = fileURLToPath(new URL('./check-containment.mjs', import.meta.url));
const IMAGE = 'ghcr.io/keyurgolani/keyurgolani.name@sha256:' + 'a'.repeat(64);

function tool(args, input = '') {
  const r = spawnSync(process.execPath, [TOOL, ...args], { input, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
}

// Every secret in these fixtures contains "canary", so one pattern finds a leak anywhere.
const assertNoCanary = (text, label) => {
  const leaks = text.match(/canary[a-z0-9$-]*/gi);
  assert.equal(leaks, null, `${label} printed ${leaks}`);
};

const includesAll = (text, wanted) => {
  for (const shown of wanted) assert.ok(text.includes(shown), `missing ${shown}\n${text}`);
};

// ---------------------------------------------------------------------------
// compose-facts

// The shape `docker compose config --format json --no-env-resolution` prints
// (Compose v5.6.0), with a secret in every field the tool must not print.
const COMPOSE_JSON = {
  name: 'portfolio',
  services: {
    web: {
      build: {
        context: '/srv/portfolio',
        dockerfile: 'Dockerfile',
        args: { NPM_TOKEN: 'canary-build-arg' },
      },
      command: ['node', 'server.js', '--token', 'canary-command'],
      configs: [{ source: 'app_conf', target: '/etc/app.conf' }],
      container_name: 'portfolio',
      entrypoint: ['/bin/sh', '-c', 'echo canary-entrypoint'],
      env_file: [
        { path: '/srv/portfolio/app.env' },
        { path: '/srv/portfolio/extra.env', required: false },
      ],
      environment: { PORTFOLIO_PATH: '/data/portfolio.yml', SECRET_TOKEN: 'canary-env-value' },
      healthcheck: { test: ['CMD', 'curl', '-H', 'Authorization: Bearer canary-health'] },
      image: 'portfolio:latest',
      labels: { 'traefik.http.middlewares.auth.basicauth.users': 'admin:$apr1$canary-label-hash' },
      networks: { default: null, edge: null },
      ports: [
        { mode: 'ingress', target: 3000, published: '13021', protocol: 'tcp' },
        { mode: 'ingress', host_ip: '127.0.0.1', target: 9229, published: '9229', protocol: 'tcp' },
      ],
      restart: 'unless-stopped',
      secrets: [{ source: 'db_pass', target: '/run/secrets/db_pass' }],
      volumes: [
        {
          type: 'bind',
          source: '/srv/portfolio/portfolio.yml',
          target: '/data/portfolio.yml',
          bind: {},
        },
        {
          type: 'bind',
          source: '/srv/portfolio/assets',
          target: '/app/apps/web/public/assets',
          read_only: true,
          bind: {},
        },
        { type: 'volume', source: 'cache', target: '/cache' },
      ],
    },
    tools: {
      build: { context: 'https://canary-git-token@github.com/owner/tools.git#main' },
      image: 'tools:1',
    },
  },
  networks: {
    default: { name: 'portfolio_default', ipam: {} },
    edge: { name: 'kgn21-edge', ipam: {}, external: true },
  },
  volumes: {
    cache: {
      name: 'portfolio_cache',
      driver: 'local',
      driver_opts: { o: 'username=owner,password=canary-cifs-pass' },
    },
  },
  secrets: {
    db_pass: { name: 'portfolio_db_pass', file: '/srv/portfolio/canary-secret-file.txt' },
  },
  configs: { app_conf: { name: 'portfolio_app_conf', content: 'api_key = canary-config-content' } },
};

test('compose-facts prints only the allowlisted fields', () => {
  const { code, stdout, all } = tool(['compose-facts'], JSON.stringify(COMPOSE_JSON));
  assert.equal(code, 0, all);
  assertNoCanary(all, 'compose-facts');
  includesAll(stdout, [
    'project: portfolio',
    'service web',
    '  container_name: portfolio',
    '  image: portfolio:latest',
    '  build context: /srv/portfolio (dockerfile Dockerfile)',
    '  env_file: /srv/portfolio/app.env',
    '  env_file: /srv/portfolio/extra.env (optional)',
    '  port: 13021 -> 3000/tcp, every interface',
    '  port: 127.0.0.1:9229 -> 9229/tcp',
    '  volume: bind /srv/portfolio/portfolio.yml -> /data/portfolio.yml, read-write',
    '  volume: bind /srv/portfolio/assets -> /app/apps/web/public/assets, read-only',
    '  volume: volume cache -> /cache, read-write',
    '  networks: default, edge',
    'service tools',
    '  build context: https://<credentials not shown>@github.com/owner/tools.git#main',
    'network edge: kgn21-edge (external)',
    'not shown: environment, labels, command, entrypoint, healthcheck, build args, secrets, configs',
  ]);
});

test('compose-facts checks the image and the read-only mount', () => {
  const json = JSON.stringify(COMPOSE_JSON);
  const failing = tool(
    [
      'compose-facts',
      '--service',
      'web',
      '--expect-image',
      IMAGE,
      '--expect-read-only',
      '/data/portfolio.yml',
    ],
    json,
  );
  assert.equal(failing.code, 1);
  assertNoCanary(failing.all, 'compose-facts check');
  assert.match(
    failing.stderr,
    /image is portfolio:latest, expected ghcr\.io.*the mount at \/data\/portfolio\.yml is read-write/,
  );

  const edited = structuredClone(COMPOSE_JSON);
  edited.services.web.image = IMAGE;
  edited.services.web.volumes[0].read_only = true;
  const passing = tool(
    [
      'compose-facts',
      '--service=web',
      `--expect-image=${IMAGE}`,
      '--expect-read-only',
      '/data/portfolio.yml',
    ],
    JSON.stringify(edited),
  );
  assert.equal(passing.code, 0, passing.all);
  assert.ok(!passing.stdout.includes('service tools'), 'printed a service it was not asked for');

  const missing = tool(
    ['compose-facts', '--service', 'web', '--expect-read-only', '/data/other.yml'],
    json,
  );
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /no mount targets \/data\/other\.yml/);
  assert.equal(tool(['compose-facts', '--expect-image', IMAGE], json).code, 2);
  assert.match(tool(['compose-facts', '--service', 'api'], json).stderr, /No service "api"/);
});

test('compose-facts never echoes input it cannot parse', () => {
  for (const input of [
    '{"services": {"web": {"environment": {"X": "canary-broken-json"',
    'WARN canary-warning-line\n{}',
    'canary-plain-text',
  ]) {
    const r = tool(['compose-facts'], input);
    assert.equal(r.code, 1, input);
    assertNoCanary(r.all, 'compose-facts parse error');
    assert.match(r.stderr, /not JSON/);
  }
  assert.match(tool(['compose-facts'], '').stderr, /Compose printed nothing/);
  assert.match(tool(['compose-facts'], '{"name": "x"}').stderr, /no services/);
});

test('config-check summarizes config --quiet output without printing it', () => {
  const clean = tool(['config-check', '--exit', '0'], '');
  assert.equal(clean.code, 0);
  assert.match(clean.stdout, /exit 0, 0 lines of output \(not shown\), first line kind: none$/m);
  const warning = tool(
    ['config-check', '--exit=0'],
    'time="2026-10-20T10:37:45Z" level=warning msg="/srv/x.yml: the attribute `version` is obsolete canary-warn"\n',
  );
  assert.equal(warning.code, 1);
  assert.match(
    warning.stdout,
    /1 line of output \(not shown\), first line kind: warning\. Stop here\./,
  );
  const failure = tool(
    ['config-check', '--exit', '1'],
    'invalid interpolation format for services.web.environment.BAD.\nYou may need to escape any $ with another $.\n"canary-interp-${oops"\n',
  );
  assert.equal(failure.code, 1);
  assert.match(failure.stdout, /exit 1, 3 lines of output \(not shown\), first line kind: invalid/);
  assertNoCanary(warning.all + failure.all, 'config-check');
  assert.equal(tool(['config-check'], '').code, 2);
  assert.equal(tool(['config-check', '--exit', 'one'], '').code, 2);
});

test('validate-check gives the exit status and error locations, not the messages', () => {
  const ok = tool(
    ['validate-check', '--exit', '0'],
    '{"level":"info","msg":"using config from file"}\nValid configuration\n',
  );
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /validator: exit 0, config is valid/);
  const caddy = tool(
    ['validate-check', '--exit', '1'],
    'Error: adapting config using caddyfile: /dev/stdin:14 - Error during parsing: unrecognized directive: canary-token-directive\n',
  );
  assert.equal(caddy.code, 1);
  assert.match(
    caddy.stdout,
    /exit 1, 1 line of output \(not shown\), error locations: \/dev\/stdin:14/,
  );
  const nginx = tool(
    ['validate-check', '--exit', '1'],
    'nginx: [emerg] unknown directive "canary-nginx-token" in /etc/nginx/conf.d/default.conf:5\nnginx: configuration file /etc/nginx/nginx.conf test failed\n',
  );
  assert.match(nginx.stdout, /error locations: \/etc\/nginx\/conf\.d\/default\.conf:5$/m);
  const vague = tool(
    ['validate-check', '--exit', '1'],
    'Error: loading http app module: canary-provision-detail at upstream app:3000\n',
  );
  assert.match(vague.stdout, /error locations: none given/);
  assertNoCanary(caddy.all + nginx.all + vague.all, 'validate-check');
  assert.equal(tool(['validate-check'], '').code, 2);
});

// ---------------------------------------------------------------------------
// compose-locate, compose-edit, compose-diff

const SECRET_COMPOSE = `# password: canary-comment
x-secret: canary-top
services:
  web:
    build:
      context: .
      args:
        NPM_TOKEN: canary-arg
    image: portfolio:latest   # pinned later canary-image-comment
    container_name: portfolio
    ports:
      - "3000:3000"
    env_file:
      - app.env
    environment:
      SECRET_TOKEN: canary-env-map
    command: ["node", "server.js", "--token", "canary-cmd"]
    entrypoint: |
      echo canary-block
      exec node server.js
    labels:
      traefik.http.middlewares.auth.basicauth.users: "admin:$$apr1$$canary-hash"
    volumes:
      - ./portfolio.yml:/data/portfolio.yml:rw   # canary-mount-comment
      - ./assets:/app/apps/web/public/assets:ro
    healthcheck:
      test: ["CMD", "curl", "-H", "Authorization: Bearer canary-health", "http://127.0.0.1:3000/api/health"]
  worker:
    image: worker:1
    environment:
      - API_KEY=canary-env-list
    volumes:
    - ./portfolio.yml:/data/portfolio.yml
networks:
  edge:
    external: true
    name: kgn21-edge
`;

test('compose-locate gives line numbers and no values', () => {
  const web = tool(['compose-locate', '--service', 'web'], SECRET_COMPOSE);
  assert.equal(web.code, 0, web.all);
  assertNoCanary(web.all, 'compose-locate');
  assert.equal(
    web.stdout.trim(),
    [
      'service web: line 4',
      'image: line 9',
      'build: line 5',
      'mount /data/portfolio.yml: line 24, short syntax, mode rw',
      'edit here: yes',
    ].join('\n'),
  );
  const worker = tool(['compose-locate', '--service', 'worker'], SECRET_COMPOSE);
  assert.match(
    worker.stdout,
    /mount \/data\/portfolio\.yml: line 33, short syntax, no mode\nedit here: yes/,
  );
  const other = tool(
    ['compose-locate', '--service', 'web', '--target', '/data/other.yml'],
    SECRET_COMPOSE,
  );
  assert.match(
    other.stdout,
    /mount \/data\/other\.yml: not in this file\nedit here: no \(no mount targets \/data\/other\.yml in this file\)/,
  );
  const absent = tool(['compose-locate', '--service', 'api'], SECRET_COMPOSE);
  assert.match(absent.stdout, /service api: not in this file\nedit here: no/);
  assert.equal(tool(['compose-locate'], SECRET_COMPOSE).code, 2);
});

test('compose-edit changes only the image and the portfolio mount', () => {
  const { code, stdout, stderr } = tool(
    ['compose-edit', '--service', 'web', '--image', IMAGE],
    SECRET_COMPOSE,
  );
  assert.equal(code, 0, stderr);
  assertNoCanary(stderr, 'compose-edit');
  assert.match(stderr, /image: line 9 replaced/);
  assert.match(stderr, /mount: line 24 set read-only \(was mode rw\)/);
  const before = SECRET_COMPOSE.split('\n');
  const after = stdout.split('\n');
  assert.equal(after.length, before.length);
  const changed = before.map((l, i) => (l === after[i] ? null : i + 1)).filter(Boolean);
  assert.deepEqual(changed, [9, 24]);
  const doc = parseYaml(stdout);
  assert.equal(doc.services.web.image, IMAGE);
  assert.deepEqual(doc.services.web.volumes, [
    './portfolio.yml:/data/portfolio.yml:ro',
    './assets:/app/apps/web/public/assets:ro',
  ]);
  assert.deepEqual(
    doc.services.worker.volumes,
    ['./portfolio.yml:/data/portfolio.yml'],
    'touched another service',
  );
});

test('compose-edit handles the other mount and image forms', () => {
  const cases = [
    {
      name: 'no mode, quoted, list at the key indent',
      input: 'services:\n  web:\n    image: x\n    volumes:\n    - "./p.yml:/data/portfolio.yml"\n',
      volumes: ['./p.yml:/data/portfolio.yml:ro'],
    },
    {
      name: 'extra mode flags',
      input:
        'services:\n  web:\n    image: x\n    volumes:\n      - ./p.yml:/data/portfolio.yml:rw,z\n',
      volumes: ['./p.yml:/data/portfolio.yml:ro,z'],
    },
    {
      name: 'long syntax without read_only',
      input:
        'services:\n  web:\n    image: x\n    volumes:\n      - type: bind\n        source: ./p.yml\n        target: /data/portfolio.yml\n      - type: volume\n        source: data\n        target: /data/other\n',
      volumes: [
        { type: 'bind', source: './p.yml', target: '/data/portfolio.yml', read_only: true },
        { type: 'volume', source: 'data', target: '/data/other' },
      ],
    },
    {
      name: 'long syntax with read_only: false',
      input:
        'services:\n  web:\n    volumes:\n      - target: /data/portfolio.yml\n        source: ./p.yml\n        type: bind\n        read_only: false\n    image: x\n',
      volumes: [
        { target: '/data/portfolio.yml', source: './p.yml', type: 'bind', read_only: true },
      ],
    },
    {
      name: 'no image key',
      input:
        'services:\n  web:\n    build: .\n    volumes:\n      - ./p.yml:/data/portfolio.yml:rw\n',
      volumes: ['./p.yml:/data/portfolio.yml:ro'],
    },
  ];
  for (const c of cases) {
    const { code, stdout, stderr } = tool(
      ['compose-edit', '--service', 'web', '--image', IMAGE],
      c.input,
    );
    assert.equal(code, 0, `${c.name}: ${stderr}`);
    const doc = parseYaml(stdout);
    assert.equal(doc.services.web.image, IMAGE, c.name);
    assert.deepEqual(doc.services.web.volumes, c.volumes, c.name);
  }
  const crlf = tool(
    ['compose-edit', '--service', 'web', '--image', IMAGE],
    cases[0].input.replaceAll('\n', '\r\n'),
  );
  assert.equal(crlf.code, 0);
  assert.ok(crlf.stdout.includes(`image: ${IMAGE}\r\n`), 'lost CRLF line endings');
  const custom = tool(
    ['compose-edit', '--service', 'web', '--image', IMAGE, '--target', '/srv/p.yml'],
    'services:\n  web:\n    image: x\n    volumes:\n      - ./p.yml:/srv/p.yml\n',
  );
  assert.equal(custom.code, 0, custom.stderr);
  assert.deepEqual(parseYaml(custom.stdout).services.web.volumes, ['./p.yml:/srv/p.yml:ro']);
});

test('compose-edit stops on files it cannot edit safely', () => {
  for (const [input, message] of [
    ['services:\n  api:\n    image: x\n', /No service "web"/],
    [
      'services:\n  web:\n    <<: *defaults\n    volumes:\n      - ./p.yml:/data/portfolio.yml\n',
      /uses "<<"/,
    ],
    [
      'x-defaults: &defaults\n  restart: always\nservices:\n  web:\n    <<: [*defaults]\n    image: x\n    volumes:\n      - ./p.yml:/data/portfolio.yml\n',
      /uses "<<"/,
    ],
    [
      'services:\n  web: &web\n    image: x\n    volumes:\n      - ./p.yml:/data/portfolio.yml\n  web2:\n    <<: *web\n',
      /carries a YAML anchor/,
    ],
    ['x-base: &base\n  image: x\nservices:\n  web: *base\n', /YAML alias/],
    ['services:\n  web: {image: x}\n', /written inline/],
    ['services:\n  web:\n    extends: base\n', /uses "extends"/],
    ['services:\n  web:\n    image: x\n', /No mount in service "web" targets/],
    [
      'services:\n  web:\n    image: x\n    volumes:\n      - ./p.yml:/data/other.yml\n',
      /No mount .* targets/,
    ],
    [
      'services:\n  web:\n    image: x\n    volumes: ["./p.yml:/data/portfolio.yml"]\n',
      /written inline/,
    ],
    [
      'services:\n  web:\n    image: x\n    volumes: &vols\n      - ./p.yml:/data/portfolio.yml\n',
      /written inline or by reference/,
    ],
    [
      'services:\n  web:\n    image: x\n    volumes:\n      - &mount ./p.yml:/data/portfolio.yml\n',
      /anchor or alias/,
    ],
    ['services:\n  web:\n    image: x\n    volumes:\n      - *mount\n', /anchor or alias/],
    [
      'services:\n  web:\n    image: *img\n    volumes:\n      - ./p.yml:/data/portfolio.yml\n',
      /anchor, alias, or tag/,
    ],
  ]) {
    const { code, stderr } = tool(['compose-edit', '--service', 'web', '--image', IMAGE], input);
    assert.equal(code, 1, input);
    assert.match(stderr, message, input);
  }
  assert.equal(
    tool(['compose-edit', '--service', 'web', '--image', 'x y'], 'services: {}\n').code,
    1,
  );
  assert.equal(tool(['compose-edit', '--service', 'web'], '').code, 2);
});

test('compose-diff passes the expected change and hides anything else', () => {
  const good =
    '--- a\n+++ b\n@@ -9 +9 @@ services:\n-    image: portfolio:latest   # pinned canary-image-comment\n+    image: ' +
    IMAGE +
    '\n@@ -24 +24 @@\n-      - ./portfolio.yml:/data/portfolio.yml:rw   # canary-mount-comment\n+      - ./portfolio.yml:/data/portfolio.yml:ro\n';
  const ok = tool(['compose-diff'], good);
  assert.equal(ok.code, 0, ok.stdout);
  assertNoCanary(ok.all, 'compose-diff comments');
  includesAll(ok.stdout, [
    '-    image: portfolio:latest\n',
    '@@ -9 +9 @@\n',
    'only the image and the mount at /data/portfolio.yml changed',
  ]);
  const bad = good + '@@ -12 +12 @@\n-      SECRET: canary-old\n+      SECRET: canary-new\n';
  const flagged = tool(['compose-diff'], bad);
  assert.equal(flagged.code, 1);
  assertNoCanary(flagged.all, 'compose-diff');
  assert.match(flagged.stdout, /2 changed lines are not the image/);
  const custom = '@@ -5 +5 @@\n-      - ./p.yml:/srv/p.yml\n+      - ./p.yml:/srv/p.yml:ro\n';
  assert.equal(tool(['compose-diff'], custom).code, 1, 'matched a target it was not given');
  const withTarget = tool(['compose-diff', '--target', '/srv/p.yml'], custom);
  assert.equal(withTarget.code, 0, withTarget.stdout);
  assert.match(withTarget.stdout, /only the image and the mount at \/srv\/p\.yml changed/);
});

// ---------------------------------------------------------------------------
// proxy-lines

test('proxy-lines caddy shows routing and hides credentials', () => {
  const caddyfile = `{
	email owner-canary-mail@example.org
	acme_dns cloudflare canary-dns-token
}

(common) {
	header X-Api-Key canary-snippet
}

# kgn-21 containment: deny the authoring surface, keep /api/health
site.test, www.site.test {
	@kgn21_deny {
		path /admin* /variants* /preview/* /api/* /_next/image*
		not path /api/health
	}
	handle @kgn21_deny {
		respond 404
	}
	@secret header Authorization "Bearer canary-matcher"
	basic_auth /private/* {
		admin $2a$14$canary-hash
	}
	tls {
		dns cloudflare canary-tls-token
	}
	import common canary-import-arg
	uri query +key=canary-uri
	rewrite * /x?key=canary-rewrite
	log {
		output file /var/log/caddy/access.log
	}
	reverse_proxy app:3000 {
		header_up X-Token canary-header-up
	}
}
`;
  const { code, stdout } = tool(['proxy-lines', 'caddy'], caddyfile);
  assert.equal(code, 0);
  assertNoCanary(stdout, 'proxy-lines caddy');
  includesAll(stdout, [
    '# kgn-21 containment',
    'site.test, www.site.test {',
    '@kgn21_deny {',
    'path /admin* /variants* /preview/* /api/* /_next/image*',
    'not path /api/health',
    'handle @kgn21_deny {',
    'respond 404',
    '@secret <matcher not shown>',
    'basic_auth { <block not shown> }',
    'tls { <block not shown> }',
    'output file /var/log/caddy/access.log',
    'reverse_proxy app:3000 {',
    'import common <arguments not shown>',
  ]);

  // One site, no braces: the first line is the address and the rest are its directives.
  const braceless = tool(
    ['proxy-lines', 'caddy'],
    'site.test\nreverse_proxy app:3000\nbasic_auth {\n\tadmin $2a$14$canary-braceless\n}\nlog {\n\toutput file /var/log/caddy/site.log\n}\n',
  );
  assert.equal(braceless.code, 0);
  assertNoCanary(braceless.stdout, 'proxy-lines caddy without braces');
  includesAll(braceless.stdout, [
    '1: site.test',
    'reverse_proxy app:3000',
    'basic_auth { <block not shown> }',
    'output file /var/log/caddy/site.log',
  ]);
});

test('proxy-lines caddy hides imported fragments, heredocs, and multi-line quotes', () => {
  // An imported file that starts inside a site: its first line is a directive, not an address.
  const fragment = tool(
    ['proxy-lines', 'caddy'],
    'basic_auth /admin/* {\n\troot $2a$14$canary-root-hash\n}\nreverse_proxy app:3000\n',
  );
  assert.equal(fragment.code, 0);
  assertNoCanary(fragment.stdout, 'imported fragment');
  includesAll(fragment.stdout, ['basic_auth { <block not shown> }', 'reverse_proxy app:3000']);

  const forward = tool(
    ['proxy-lines', 'caddy'],
    'site.test {\n\tforward_auth authelia:9091 {\n\t\turi /api/verify?token=canary-forward\n\t\tto canary-upstream:1\n\t}\n}\n',
  );
  assertNoCanary(forward.stdout, 'forward_auth');
  assert.match(forward.stdout, /forward_auth \{ <block not shown> \}/);

  const heredoc = tool(
    ['proxy-lines', 'caddy'],
    'site.test {\n\trespond <<EOF\n\t\timport canary-heredoc-import\n\t\treverse_proxy canary-heredoc-proxy\n\t\tEOF 200\n\treverse_proxy app:3000\n}\n',
  );
  assert.equal(heredoc.code, 0);
  assertNoCanary(heredoc.stdout, 'heredoc');
  includesAll(heredoc.stdout, [
    'respond <<EOF <heredoc not shown>',
    '   6: \treverse_proxy app:3000',
    '   7: }',
  ]);

  const quoted = tool(
    ['proxy-lines', 'caddy'],
    'site.test {\n\trespond "first line\n\timport canary-quote-import\n\tlast line" 200\n\treverse_proxy app:3000\n}\n',
  );
  assertNoCanary(quoted.stdout, 'multi-line quote');
  includesAll(quoted.stdout, ['respond <value not shown>', 'reverse_proxy app:3000']);

  const addresses = tool(
    ['proxy-lines', 'caddy'],
    ':8080 {\n\trespond 200\n}\nlocalhost, {$SITE_ADDRESS} {\n\trespond 200\n}\nhttp://127.0.0.1:18021 {\n\treverse_proxy app:3000\n}\n',
  );
  includesAll(addresses.stdout, [
    '1: :8080 {',
    '4: localhost, {$SITE_ADDRESS} {',
    '7: http://127.0.0.1:18021 {',
    'reverse_proxy app:3000',
  ]);

  const odd = tool(['proxy-lines', 'caddy'], '"canary-quoted-site" {\n\trespond 200\n}\n');
  assertNoCanary(odd.stdout, 'quoted first token');
});

test('proxy-lines nginx filters each statement on a line', () => {
  const conf = `server {
	listen 443 ssl;
	server_name site.test;
	ssl_certificate_key /etc/ssl/private/canary-key.pem;
	access_log /var/log/nginx/site.log;
	# kgn-21 containment: deny the authoring surface, keep /api/health
	location ^~ /admin       { return 404; }
	location ~ ^/api/(?!health$) { return 404; }
	location / {
		proxy_pass http://app:3000;
		proxy_set_header Authorization "Basic canary-basic";
		auth_basic_user_file /etc/nginx/canary-htpasswd;
	}
	if ($http_x_token = "canary-if") {
		return 403;
	}
	rewrite ^/old /new?key=canary-rewrite permanent;
	location /legacy { proxy_pass http://canary-user:canary-pass@legacy:8080; }
	location /api { proxy_set_header Authorization "Basic canary-nginx-b64"; proxy_pass http://app:3000; }
	proxy_pass http://app:3000; proxy_set_header X-Api-Key canary-multidirective;
	set $token "canary-set { not a block ; }";
	add_header X-Debug "\${canary_var}";
	"canary-quoted-directive" on;
}
`;
  const { code, stdout } = tool(['proxy-lines', 'nginx'], conf);
  assert.equal(code, 0);
  assertNoCanary(stdout, 'proxy-lines nginx');
  includesAll(stdout, [
    '   1: server {',
    'listen 443 ssl;',
    'server_name site.test;',
    'access_log /var/log/nginx/site.log;',
    '# kgn-21 containment',
    'location ^~ /admin { return 404; }',
    'location ~ ^/api/(?!health$) { return 404; }',
    'proxy_pass http://app:3000;',
    'if { <block not shown> }',
    'location /legacy { proxy_pass http://<credentials not shown>@legacy:8080; }',
    '  19: \tlocation /api { proxy_set_header <not shown> proxy_pass http://app:3000; }',
    '  20: \tproxy_pass http://app:3000; proxy_set_header <not shown>',
    '  21: \tset <not shown>',
    '  23: \t<not shown>',
    '  24: }',
  ]);
});

// ---------------------------------------------------------------------------
// proxy-insert and ports-same

test('proxy-insert adds the rule after each site line, once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kgn21-rule-'));
  try {
    const rule = join(dir, 'rule.txt');
    writeFileSync(
      rule,
      '\t# kgn-21 containment: deny\n\thandle @kgn21_deny {\n\t\trespond 404\n\t}\n',
    );
    const config = 'a.test {\n\treverse_proxy app:3000\n}\nb.test {\n\treverse_proxy app:3000\n}\n';
    const r = tool(['proxy-insert', '--rule', rule, '--after', '1', '--after=4'], config);
    assert.equal(r.code, 0, r.stderr);
    const lines = r.stdout.split('\n');
    assert.equal(lines[1], '\t# kgn-21 containment: deny');
    assert.equal(lines[7], 'b.test {');
    assert.equal(lines[8], '\t# kgn-21 containment: deny');
    assert.equal(lines.filter((l) => l.includes('kgn-21 containment')).length, 2);
    const again = tool(['proxy-insert', '--rule', rule, '--after', '1'], r.stdout);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already has the kgn-21 rule/);
    assert.match(
      tool(['proxy-insert', '--rule', rule, '--after', '2'], config).stderr,
      /Line 2 doesn't end with \{/,
    );
    assert.match(
      tool(['proxy-insert', '--rule', rule, '--after', '99'], config).stderr,
      /Line 99 is not in the file/,
    );
    writeFileSync(rule, 'respond 404\n');
    assert.match(
      tool(['proxy-insert', '--rule', rule, '--after', '1'], config).stderr,
      /no "# kgn-21 containment" comment/,
    );
    assert.match(
      tool(['proxy-insert', '--rule', join(dir, 'missing'), '--after', '1'], config).stderr,
      /Could not read the rule file/,
    );
    assert.equal(tool(['proxy-insert', '--rule', rule, '--after', 'one'], config).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ports-same compares published ports', () => {
  const before = '{"3000/tcp":[{"HostIp":"","HostPort":"13021"}]}';
  const same = tool([
    'ports-same',
    before,
    '{"3000/tcp":[{"HostIp":"0.0.0.0","HostPort":"13021"}]}',
  ]);
  assert.equal(same.code, 0, same.stdout);
  assert.match(same.stdout, /published ports unchanged: 13021 -> 3000\/tcp \(every interface\)/);
  const changed = tool([
    'ports-same',
    before,
    '{"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"13021"}]}',
  ]);
  assert.equal(changed.code, 1);
  assert.match(changed.stdout, /became 13021 -> 3000\/tcp \(127\.0\.0\.1\)/);
  assert.equal(tool(['ports-same', 'null', '{}']).code, 0);
  assert.equal(tool(['ports-same', before, 'not json']).code, 1);
  assert.equal(tool(['ports-same', before]).code, 2);
});

// ---------------------------------------------------------------------------
// facts

test('facts reads name, origin, and variant like the YAML parser does', () => {
  const fixtures = [
    'identity:\n  name: "Rhea Canary" # display name\n  tagline: x\nmeta:\n  url: https://Rhea.Test/portfolio/\nvariant: kinetic-cosmos\n',
    "identity:\n  avatar:\n    name: not this one\n  name: 'O''Brien & Co'\nvariant: editorial # default\n",
    'variant: editorial\nidentity: { name: Plain Name, tagline: "a, b" }\nmeta: {url: "https://x.test"}\n',
    "identity: {\n  name: O'Brien,\n  tagline: Two\n}\n",
    'identity:\n    name: Plain Name   # trailing comment\n',
    'identity:\n  name: "Esc\\u00e9 \\"Q\\""\n',
  ];
  for (const fixture of fixtures) {
    const { code, stdout, stderr } = tool(['facts'], fixture);
    assert.equal(code, 0, `${fixture}: ${stderr}`);
    const doc = parseYaml(fixture);
    const env = spawnSync(
      'sh',
      ['-c', `${stdout}\nprintf '%s\\n%s\\n%s' "$NAME" "$ORIGIN" "$VARIANT"`],
      { encoding: 'utf8' },
    ).stdout.split('\n');
    assert.equal(env[0], doc.identity.name, fixture);
    assert.equal(env[1], doc.meta?.url ? new URL(doc.meta.url).origin : '', fixture);
    assert.equal(env[2], doc.variant ?? 'editorial', fixture);
  }
  const json = tool(
    ['facts'],
    JSON.stringify({
      identity: { name: 'Json Name' },
      meta: { url: 'https://j.test' },
      variant: 'editorial',
    }),
  );
  assert.match(json.stdout, /NAME='Json Name'\nORIGIN='https:\/\/j.test'\nVARIANT='editorial'/);
});

test('facts stops when it cannot read the name safely', () => {
  for (const [input, message] of [
    ['identity:\n  tagline: x\n', /identity.name is missing or empty/],
    ['identity:\n  name: ""\n', /identity.name is missing or empty/],
    ['identity:\n  name: *who\n', /alias/],
    ['identity:\n  name: |\n    Two\n    Lines\n', /multi-line/],
    ['identity:\n  name: Long\n    continued\n', /spans several lines/],
    ['identity:\n  name: "unterminated\n', /no closing quote/],
    ['identity:\n  name: x\nvariant: ../etc\n', /not a variant slug/],
    ['{not json', /does not parse/],
  ]) {
    const { code, stderr } = tool(['facts'], input);
    assert.equal(code, 1, input);
    assert.match(stderr, message);
  }
  const noUrl = tool(['facts'], 'identity:\n  name: x\n');
  assert.equal(noUrl.code, 0);
  assert.match(noUrl.stdout, /ORIGIN=''/);
  assert.match(noUrl.stderr, /meta.url is not set/);
});

// ---------------------------------------------------------------------------
// exposure

const AGENT = 'check-containment (keyurgolani.name #21)';
const DAY = Date.parse('2026-10-17T12:00:00Z') / 1000;
const caddy = (ts, method, uri, status, agent = 'canary-agent') =>
  JSON.stringify({
    ts,
    request: {
      remote_ip: '203.0.113.7',
      client_ip: '203.0.113.7',
      method,
      uri,
      headers: { 'User-Agent': [agent] },
    },
    status,
  });

test('exposure normalizes paths, splits status classes, and prints no client data', () => {
  const log = [
    caddy(DAY, 'GET', '/admin', 404, AGENT),
    caddy(DAY, 'GET', '/admin', 200),
    caddy(DAY, 'GET', '/%61dmin?tab=raw', 200),
    caddy(DAY, 'GET', '/ADMIN/', 308),
    caddy(DAY, 'GET', '//api//portfolio', 200),
    caddy(DAY, 'GET', '/x/../api/portfolio', 200),
    caddy(DAY, 'PUT', '/api/portfolio', 200),
    caddy(DAY, 'PUT', '/api/Variant', 400),
    caddy(DAY, 'PUT', '/api/customize', 500),
    caddy(DAY, 'GET', '/variants', 200),
    caddy(DAY, 'GET', '/variants/kinetic-cosmos/a.png', 200),
    caddy(DAY, 'GET', '/', 200),
    caddy(DAY + 86_400, 'PUT', '/api/portfolio', 200),
    '198.51.100.23 - - [16/Oct/2026:23:59:59 -0700] "PUT /api/customize HTTP/1.1" 204 0 "-" "canary-ua"',
    JSON.stringify({
      StartUTC: '2026-10-16T08:00:00.123456789Z',
      RequestMethod: 'GET',
      RequestPath: '/admin',
      DownstreamStatus: 401,
      ClientHost: '192.0.2.55',
    }),
    JSON.stringify({ level: 'info', ts: DAY, msg: 'serving initial configuration' }),
    'not a log line canary-junk',
  ].join('\n');
  const { code, stdout } = tool(['exposure', '--before', String(DAY + 3600)], log);
  assert.equal(code, 0);
  assertNoCanary(stdout, 'exposure');
  for (const ip of ['203.0.113.7', '198.51.100.23', '192.0.2.55'])
    assert.ok(!stdout.includes(ip), `printed ${ip}`);
  includesAll(stdout, [
    'counts incomplete: 1 line could not be read\n',
    'read 17 lines: 15 requests, 1 other log line, 1 not recognized\n',
    'not counted: 1 at or after the start time, 0 without a usable time\n',
    '1 of the counted requests carry check-containment',
  ]);
  const rows = stdout
    .split('\n')
    .filter((l) => /^\d{4}-/.test(l))
    .map((l) => l.trim().split(/\s+/));
  assert.deepEqual(rows, [
    ['2026-10-16', '/admin', 'GET', '0', '0', '1', '0', '0'],
    ['2026-10-17', '/admin', 'GET', '2', '1', '1', '0', '0'],
    ['2026-10-17', '/variants', 'GET', '1', '0', '0', '0', '0'],
    ['2026-10-17', '/api/portfolio', 'GET', '2', '0', '0', '0', '0'],
    ['2026-10-17', '/api/portfolio', 'PUT', '1', '0', '0', '0', '0'],
    ['2026-10-17', '/api/variant', 'PUT', '0', '0', '1', '0', '0'],
    ['2026-10-17', '/api/customize', 'PUT', '1', '0', '0', '1', '0'],
  ]);
  assert.equal(tool(['exposure', '--before', 'yesterday'], '').code, 2);
});

test('exposure reads epoch units, nginx JSON fields, and the agent in any quoted field', () => {
  const ms = DAY * 1000;
  const log = [
    JSON.stringify({ ts: DAY, request: { method: 'GET', uri: '/admin' }, status: 200 }),
    JSON.stringify({ ts: ms, request: { method: 'GET', uri: '/admin' }, status: 200 }),
    JSON.stringify({ ts: ms * 1000, request: { method: 'GET', uri: '/admin' }, status: 200 }),
    JSON.stringify({ ts: ms * 1e6, request: { method: 'GET', uri: '/admin' }, status: 200 }),
    JSON.stringify({ ts: String(DAY), request: { method: 'GET', uri: '/admin' }, status: 200 }),
    JSON.stringify({
      time_local: '17/Oct/2026:05:00:00 -0700',
      request: 'PUT /api/customize HTTP/1.1',
      status: '204',
      http_user_agent: AGENT,
    }),
    JSON.stringify({
      time_iso8601: '2026-10-17T10:00:00+00:00',
      request_method: 'GET',
      request_uri: '/api/portfolio?x=1',
      status: 200,
    }),
    JSON.stringify({
      msec: `${DAY}.906`,
      request: 'GET /variants HTTP/2.0',
      status: 200,
      extra: { agent: AGENT },
    }),
    `198.51.100.23 - - [17/Oct/2026:05:00:00 -0700] "GET /admin HTTP/1.1" 404 0 "-" "${AGENT}" "canary-trailing-field"`,
    `198.51.100.23 - - [17/Oct/2026:05:00:00 -0700] "GET /admin?ua=${encodeURIComponent(AGENT)} HTTP/1.1" 404 0 "-" "canary-ua"`,
    JSON.stringify({ request: 'GET /admin HTTP/1.1', status: 200 }),
    JSON.stringify({ request: '-', status: 400 }),
  ].join('\n');
  const { code, stdout } = tool(['exposure', '--before', String(DAY + 86_400)], log);
  assert.equal(code, 0);
  assertNoCanary(stdout, 'exposure formats');
  includesAll(stdout, [
    'counts incomplete: 2 lines could not be read\n',
    'read 12 lines: 11 requests, 0 other log lines, 1 not recognized\n',
    'not counted: 0 at or after the start time, 1 without a usable time\n',
    'counted requests run from 2026-10-17 to 2026-10-17 (UTC)',
    '3 of the counted requests carry check-containment',
  ]);
  const rows = stdout
    .split('\n')
    .filter((l) => /^\d{4}-/.test(l))
    .map((l) => l.trim().split(/\s+/));
  assert.deepEqual(rows, [
    ['2026-10-17', '/admin', 'GET', '5', '0', '2', '0', '0'],
    ['2026-10-17', '/variants', 'GET', '1', '0', '0', '0', '0'],
    ['2026-10-17', '/api/portfolio', 'GET', '1', '0', '0', '0', '0'],
    ['2026-10-17', '/api/customize', 'PUT', '1', '0', '0', '0', '0'],
  ]);
});

test('exposure knows the user agent check-containment sends', () => {
  const sent = readFileSync(CHECK, 'utf8').match(/const USER_AGENT = '([^']+)'/)?.[1];
  const counted = readFileSync(TOOL, 'utf8').match(/const CHECK_AGENT = '([^']+)'/)?.[1];
  assert.ok(sent, 'check-containment.mjs has no USER_AGENT constant');
  assert.equal(counted, sent);
  assert.equal(AGENT, sent);
});

// ---------------------------------------------------------------------------

test('arguments are checked strictly', () => {
  assert.equal(tool([]).code, 2);
  assert.equal(tool(['bogus']).code, 2);
  assert.equal(tool(['proxy-lines', 'apache']).code, 2);
  assert.equal(tool(['proxy-lines']).code, 2);
  assert.equal(tool(['proxy-lines', 'caddy', 'extra']).code, 2);
  assert.equal(tool(['compose-edit', '--service', '--image', IMAGE]).code, 2);
  assert.equal(tool(['compose-edit', '--service', 'web', '--image', IMAGE, '--force']).code, 2);
  assert.equal(
    tool(['compose-edit', '--service', 'web', '--service', 'api', '--image', IMAGE]).code,
    2,
  );
  assert.equal(tool(['compose-edit', '--service=', '--image', IMAGE]).code, 2);
  assert.equal(tool(['exposure', '--before', '1', '--after', '2']).code, 2);
  assert.equal(tool(['facts', '-v']).code, 2);
  assert.match(tool(['facts', '--json']).stderr, /Unknown option --json/);
  const eq = tool(
    ['compose-locate', '--service=web', '--target=/data/portfolio.yml'],
    'services:\n  web:\n    image: x\n',
  );
  assert.equal(eq.code, 0, eq.all);
  assert.equal(tool(['--help']).code, 0);
});
