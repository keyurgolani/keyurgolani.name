import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const TOOL = fileURLToPath(new URL('./containment-tools.mjs', import.meta.url));
const IMAGE = 'ghcr.io/keyurgolani/keyurgolani.name@sha256:' + 'a'.repeat(64);

function tool(args, input) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { input, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const assertNoCanary = (text, label) => {
  const leaks = text.match(/canary-[a-z0-9-]+/g);
  assert.equal(leaks, null, `${label} printed ${leaks}`);
};

const SECRET_COMPOSE = `# password: canary-comment
x-secret: canary-top
services:
  web:
    build:
      context: .
      args:
        NPM_TOKEN: canary-arg
    image: portfolio:latest   # pinned later
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
      - ./portfolio.yml:/data/portfolio.yml:rw
      - ./assets:/app/apps/web/public/assets:ro
    healthcheck:
      test: ["CMD", "curl", "-H", "Authorization: Bearer canary-health", "http://127.0.0.1:3000/api/health"]
  worker:
    image: worker:1
    environment:
      - API_KEY=canary-env-list
      - PASSTHROUGH
      - "API_SECRET: canary-env-colon"
    volumes:
    - ./portfolio.yml:/data/portfolio.yml
  tools:
    build:
      context: https://canary-git-token@github.com/owner/tools.git#main
    image: tools:1
networks:
  edge:
    external: true
    name: kgn21-edge
  backend:
    labels:
      - "com.example.token=canary-net-label"
volumes:
  share:
    driver: local
    driver_opts:
      type: cifs
      o: "username=owner,password=canary-cifs-pass"
      device: "//nas.lan/share"
`;

test('compose-lines shows structure and allowlisted values only', () => {
  const { code, stdout } = tool(['compose-lines'], SECRET_COMPOSE);
  assert.equal(code, 0);
  assertNoCanary(stdout, 'compose-lines');
  for (const shown of [
    '   9:     image: portfolio:latest',
    '      - "3000:3000"',
    '      - app.env',
    '      - ./portfolio.yml:/data/portfolio.yml:rw',
    '    - ./portfolio.yml:/data/portfolio.yml',
    'SECRET_TOKEN: <value not shown>',
    'API_KEY=<value not shown>',
    '- PASSTHROUGH',
    'NPM_TOKEN: <value not shown>',
    'command: <value not shown>',
    'name: kgn21-edge',
    '- API_SECRET <value not shown>',
    'context: https://<credentials not shown>@github.com/owner/tools.git#main',
    '- com.example.token=<value not shown>',
    'driver: local',
    'o: <value not shown>',
    'device: <value not shown>',
  ]) {
    assert.ok(stdout.includes(shown), `missing ${shown}\n${stdout}`);
  }
});

test('compose-edit changes only the image and the portfolio mount', () => {
  const { code, stdout, stderr } = tool(['compose-edit', '--service', 'web', '--image', IMAGE], SECRET_COMPOSE);
  assert.equal(code, 0, stderr);
  assert.match(stderr, /image: line 9 replaced/);
  assert.match(stderr, /mount: line 24 set read-only \(was rw\)/);
  const before = SECRET_COMPOSE.split('\n');
  const after = stdout.split('\n');
  assert.equal(after.length, before.length);
  const changed = before.map((l, i) => (l === after[i] ? null : i + 1)).filter(Boolean);
  assert.deepEqual(changed, [9, 24]);
  const doc = parseYaml(stdout);
  assert.equal(doc.services.web.image, IMAGE);
  assert.deepEqual(doc.services.web.volumes, ['./portfolio.yml:/data/portfolio.yml:ro', './assets:/app/apps/web/public/assets:ro']);
  assert.deepEqual(doc.services.worker.volumes, ['./portfolio.yml:/data/portfolio.yml'], 'touched another service');
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
      input: 'services:\n  web:\n    image: x\n    volumes:\n      - ./p.yml:/data/portfolio.yml:rw,z\n',
      volumes: ['./p.yml:/data/portfolio.yml:ro,z'],
    },
    {
      name: 'long syntax without read_only',
      input: 'services:\n  web:\n    image: x\n    volumes:\n      - type: bind\n        source: ./p.yml\n        target: /data/portfolio.yml\n      - type: volume\n        source: data\n        target: /data/other\n',
      volumes: [
        { type: 'bind', source: './p.yml', target: '/data/portfolio.yml', read_only: true },
        { type: 'volume', source: 'data', target: '/data/other' },
      ],
    },
    {
      name: 'long syntax with read_only: false',
      input: 'services:\n  web:\n    volumes:\n      - target: /data/portfolio.yml\n        source: ./p.yml\n        type: bind\n        read_only: false\n    image: x\n',
      volumes: [{ target: '/data/portfolio.yml', source: './p.yml', type: 'bind', read_only: true }],
    },
    {
      name: 'no image key',
      input: 'services:\n  web:\n    build: .\n    volumes:\n      - ./p.yml:/data/portfolio.yml:rw\n',
      volumes: ['./p.yml:/data/portfolio.yml:ro'],
    },
  ];
  for (const c of cases) {
    const { code, stdout, stderr } = tool(['compose-edit', '--service', 'web', '--image', IMAGE], c.input);
    assert.equal(code, 0, `${c.name}: ${stderr}`);
    const doc = parseYaml(stdout);
    assert.equal(doc.services.web.image, IMAGE, c.name);
    assert.deepEqual(doc.services.web.volumes, c.volumes, c.name);
  }
  const crlf = tool(['compose-edit', '--service', 'web', '--image', IMAGE], cases[0].input.replaceAll('\n', '\r\n'));
  assert.equal(crlf.code, 0);
  assert.ok(crlf.stdout.includes(`image: ${IMAGE}\r\n`), 'lost CRLF line endings');
});

test('compose-edit stops on files it cannot edit safely', () => {
  for (const [input, message] of [
    ['services:\n  api:\n    image: x\n', /No service "web"/],
    ['services:\n  web:\n    <<: *defaults\n    volumes:\n      - ./p.yml:/data/portfolio.yml\n', /uses "<<"/],
    ['services:\n  web:\n    extends: base\n', /uses "extends"/],
    ['services:\n  web:\n    image: x\n', /has no volumes/],
    ['services:\n  web:\n    image: x\n    volumes:\n      - ./p.yml:/data/other.yml\n', /No mount .* targets/],
    ['services:\n  web:\n    image: x\n    volumes: ["./p.yml:/data/portfolio.yml"]\n', /written inline/],
    ['services:\n  web:\n    image: *img\n    volumes:\n      - ./p.yml:/data/portfolio.yml\n', /anchor or alias/],
  ]) {
    const { code, stderr } = tool(['compose-edit', '--service', 'web', '--image', IMAGE], input);
    assert.equal(code, 1, input);
    assert.match(stderr, message);
  }
  assert.equal(tool(['compose-edit', '--service', 'web', '--image', 'x y'], 'services: {}\n').code, 1);
  assert.equal(tool(['compose-edit', '--service', 'web'], '').code, 2);
});

test('compose-diff passes the expected change and hides anything else', () => {
  const good = '--- a\n+++ b\n@@ -6 +6 @@\n-    image: portfolio:latest\n+    image: ' + IMAGE + '\n@@ -18 +18 @@\n-      - ./portfolio.yml:/data/portfolio.yml:rw\n+      - ./portfolio.yml:/data/portfolio.yml:ro\n';
  const ok = tool(['compose-diff'], good);
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.stdout, /only the image and portfolio mount lines changed/);
  const bad = good + '@@ -9 +9 @@\n-      SECRET: canary-old\n+      SECRET: canary-new\n';
  const flagged = tool(['compose-diff'], bad);
  assert.equal(flagged.code, 1);
  assertNoCanary(flagged.stdout, 'compose-diff');
  assert.match(flagged.stdout, /2 changed lines are not the image/);
});

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
  for (const shown of [
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
  ]) {
    assert.ok(stdout.includes(shown), `missing ${shown}\n${stdout}`);
  }

  // One site, no braces: the first line is the address and the rest are its directives.
  const braceless = tool(
    ['proxy-lines', 'caddy'],
    'site.test\nreverse_proxy app:3000\nbasic_auth {\n\tadmin $2a$14$canary-braceless\n}\nlog {\n\toutput file /var/log/caddy/site.log\n}\n',
  );
  assert.equal(braceless.code, 0);
  assertNoCanary(braceless.stdout, 'proxy-lines caddy without braces');
  for (const shown of ['1: site.test', 'reverse_proxy app:3000', 'basic_auth { <block not shown> }', 'output file /var/log/caddy/site.log']) {
    assert.ok(braceless.stdout.includes(shown), `missing ${shown}\n${braceless.stdout}`);
  }
});

test('proxy-lines nginx shows routing and hides credentials', () => {
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
}
`;
  const { code, stdout } = tool(['proxy-lines', 'nginx'], conf);
  assert.equal(code, 0);
  assertNoCanary(stdout, 'proxy-lines nginx');
  for (const shown of [
    'server {',
    'listen 443 ssl;',
    'server_name site.test;',
    'access_log /var/log/nginx/site.log;',
    'location ^~ /admin',
    'location ~ ^/api/(?!health$)',
    'proxy_pass http://app:3000;',
    'if { <block not shown> }',
    'location /legacy { proxy_pass http://<credentials not shown>@legacy:8080; }',
  ]) {
    assert.ok(stdout.includes(shown), `missing ${shown}\n${stdout}`);
  }
});

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
    const env = spawnSync('sh', ['-c', `${stdout}\nprintf '%s\\n%s\\n%s' "$NAME" "$ORIGIN" "$VARIANT"`], { encoding: 'utf8' }).stdout.split('\n');
    assert.equal(env[0], doc.identity.name, fixture);
    assert.equal(env[1], doc.meta?.url ? new URL(doc.meta.url).origin : '', fixture);
    assert.equal(env[2], doc.variant ?? 'editorial', fixture);
  }
  const json = tool(['facts'], JSON.stringify({ identity: { name: 'Json Name' }, meta: { url: 'https://j.test' }, variant: 'editorial' }));
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

test('exposure normalizes paths, splits status classes, and prints no client data', () => {
  const caddy = (ts, method, uri, status, agent = 'canary-agent') =>
    JSON.stringify({ ts, request: { remote_ip: '203.0.113.7', client_ip: '203.0.113.7', method, uri, headers: { 'User-Agent': [agent] } }, status });
  const day = Date.parse('2026-10-17T12:00:00Z') / 1000;
  const log = [
    caddy(day, 'GET', '/admin', 404, 'check-containment (keyurgolani.name #21)'),
    caddy(day, 'GET', '/admin', 200),
    caddy(day, 'GET', '/%61dmin?tab=raw', 200),
    caddy(day, 'GET', '/ADMIN/', 308),
    caddy(day, 'GET', '//api//portfolio', 200),
    caddy(day, 'GET', '/x/../api/portfolio', 200),
    caddy(day, 'PUT', '/api/portfolio', 200),
    caddy(day, 'PUT', '/api/Variant', 400),
    caddy(day, 'PUT', '/api/customize', 500),
    caddy(day, 'GET', '/variants', 200),
    caddy(day, 'GET', '/variants/kinetic-cosmos/a.png', 200),
    caddy(day, 'GET', '/', 200),
    caddy(day + 86_400, 'PUT', '/api/portfolio', 200),
    '198.51.100.23 - - [16/Oct/2026:23:59:59 -0700] "PUT /api/customize HTTP/1.1" 204 0 "-" "canary-ua"',
    JSON.stringify({ StartUTC: '2026-10-16T08:00:00.123456789Z', RequestMethod: 'GET', RequestPath: '/admin', DownstreamStatus: 401, ClientHost: '192.0.2.55' }),
    JSON.stringify({ level: 'info', ts: day, msg: 'serving initial configuration' }),
    'not a log line canary-junk',
  ].join('\n');
  const { code, stdout } = tool(['exposure', '--before', String(day + 3600)], log);
  assert.equal(code, 0);
  assertNoCanary(stdout, 'exposure');
  for (const ip of ['203.0.113.7', '198.51.100.23', '192.0.2.55']) assert.ok(!stdout.includes(ip), `printed ${ip}`);
  assert.match(stdout, /read 17 lines: 15 requests, 1 at or after the start time \(not counted\), 0 without a usable time \(not counted\), 2 not recognized as requests/);
  assert.match(stdout, /1 of the counted requests carry check-containment's user agent/);
  const rows = stdout.split('\n').filter((l) => /^\d{4}-/.test(l)).map((l) => l.trim().split(/\s+/));
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

test('usage errors exit 2', () => {
  assert.equal(tool([], '').code, 2);
  assert.equal(tool(['bogus'], '').code, 2);
  assert.equal(tool(['proxy-lines', 'apache'], '').code, 2);
  assert.equal(tool(['compose-edit', '--service', '--image', IMAGE], '').code, 2);
});
