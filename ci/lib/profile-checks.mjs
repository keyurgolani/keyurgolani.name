// The parts of `pnpm smoke:profiles` (#12, 12-3) that read what a container
// runtime reports and decide, so each runs offline in ci/profile-checks.test.mjs:
// the hardening every profile's container runs with and what it enforces,
// graceful shutdown, the data volume across a new container, proxy trust,
// the per-run canaries, and the Compose examples' ports. Pure Node, no
// dependencies. Each function returns the problems it finds, empty when the
// check passes.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Owner's data directory, where deploy/compose.owner.yml mounts it. */
export const DATA_DIR = '/var/lib/portfolio';
/** Next's cache, the one tmpfs every Compose example gives the read-only root. */
export const CACHE_DIR = '/app/apps/web/.next/cache';
/** The server's user and group in the image. */
export const RUNTIME_UID = 1001;

/**
 * What every server container runs with, as the Compose examples run it: a
 * read-only root with a tmpfs at Next's cache, no capabilities, and no way
 * to gain privileges (threat row deploy-2).
 */
export const HARDENING = [
  '--read-only',
  '--tmpfs',
  CACHE_DIR,
  '--cap-drop=ALL',
  '--security-opt',
  'no-new-privileges:true',
];

/**
 * Where the write probe tries to create a file: the root, the app tree and
 * what the server serves from, the temp and home directories, the data
 * directory, and the cache tmpfs.
 */
export const WRITE_TARGETS = [
  '/',
  '/app',
  '/app/apps/web',
  '/app/apps/web/.next',
  '/app/apps/web/.next/static',
  '/app/apps/web/public',
  '/app/node_modules',
  '/app/bin',
  '/tmp',
  '/home',
  DATA_DIR,
  CACHE_DIR,
];

const NO_NEW_PRIVILEGES = /^no-new-privileges(?:[:=]true)?$/;

/**
 * Problems in `docker inspect` output for a running server container: the
 * flags HARDENING sets, no privilege or added capability, every published
 * port on 127.0.0.1, the data directory as the only writable persistent
 * mount and only under owner, and no owner secret in the environment, by
 * name or by value. The hash reaches the server only through its _FILE.
 *
 * @param {any} info one element of `docker inspect`'s array
 * @param {{ profile: string, secrets?: readonly string[] }} options
 * @returns {string[]}
 */
export function inspectProblems(info, { profile, secrets = [] }) {
  const problems = [];
  const host = info?.HostConfig ?? {};
  if (host.ReadonlyRootfs !== true) problems.push('the root filesystem is not read-only');
  if (!(host.CapDrop ?? []).some((cap) => /^(?:CAP_)?ALL$/i.test(cap))) {
    problems.push('capabilities are not all dropped');
  }
  if ((host.CapAdd ?? []).length > 0)
    problems.push(`capabilities added: ${host.CapAdd.join(', ')}`);
  if (!(host.SecurityOpt ?? []).some((opt) => NO_NEW_PRIVILEGES.test(opt))) {
    problems.push('no-new-privileges is not set');
  }
  if (host.Privileged === true) problems.push('the container is privileged');
  if (host.NetworkMode === 'host') problems.push('the container shares the host network');
  if (!Object.keys(host.Tmpfs ?? {}).includes(CACHE_DIR)) {
    problems.push(`no tmpfs at ${CACHE_DIR}`);
  }
  for (const [port, bindings] of Object.entries(host.PortBindings ?? {})) {
    for (const binding of bindings ?? []) {
      if (binding.HostIp !== '127.0.0.1') {
        problems.push(`${port} is published on ${binding.HostIp || 'every address'}`);
      }
    }
  }
  const writable = (info?.Mounts ?? []).filter((mount) => mount.RW && mount.Type !== 'tmpfs');
  for (const mount of writable) {
    if (!(profile === 'owner' && mount.Destination === DATA_DIR)) {
      problems.push(`${mount.Destination} is a writable ${mount.Type} mount`);
    }
  }
  if (profile === 'owner' && !writable.some((mount) => mount.Destination === DATA_DIR)) {
    problems.push(`${DATA_DIR} is not a writable mount`);
  }
  const env = info?.Config?.Env ?? [];
  if (env.some((entry) => entry.startsWith('PORTFOLIO_AUTH_PASSWORD_HASH='))) {
    problems.push('the password hash is in the environment, not a _FILE');
  }
  if (env.some((entry) => secrets.some((secret) => entry.includes(secret)))) {
    problems.push("a run secret is in the container's environment");
  }
  return problems;
}

/**
 * Problems in the server process's /proc/1/status: it runs as uid and gid
 * 1001, every capability set is empty, and NoNewPrivs is on. That's what
 * the flags enforce, read from the process itself.
 *
 * @param {string} status
 * @returns {string[]}
 */
export function processProblems(status) {
  const fields = Object.fromEntries(
    String(status ?? '')
      .split('\n')
      .map((line) => /^([A-Za-z]+):\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim()]),
  );
  const problems = [];
  for (const key of ['Uid', 'Gid']) {
    const ids = (fields[key] ?? '').split(/\s+/).filter(Boolean);
    if (ids.length !== 4 || ids.some((id) => Number(id) !== RUNTIME_UID)) {
      problems.push(`${key} is ${fields[key] ?? 'unread'}, not ${RUNTIME_UID} throughout`);
    }
  }
  for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
    if (!/^0+$/.test(fields[key] ?? '')) problems.push(`${key} is ${fields[key] ?? 'unread'}`);
  }
  if (fields.NoNewPrivs !== '1') problems.push(`NoNewPrivs is ${fields.NoNewPrivs ?? 'unread'}`);
  return problems;
}

/**
 * Problems in the write probe's result, `{ [dir]: 'written' | <error code> }`
 * for each of WRITE_TARGETS: only the cache tmpfs takes a file, and under
 * owner the data directory too. An unwritable app tree and no other
 * writable path.
 *
 * @param {Record<string, string> | undefined} result
 * @param {string} profile
 * @returns {string[]}
 */
export function writeProblems(result, profile) {
  if (!result || typeof result !== 'object') return ['the write probe reported nothing'];
  const expected = new Set([CACHE_DIR, ...(profile === 'owner' ? [DATA_DIR] : [])]);
  const problems = [];
  for (const dir of WRITE_TARGETS) {
    const outcome = result[dir];
    if (outcome === undefined) problems.push(`the write probe skipped ${dir}`);
    else if (expected.has(dir) && outcome !== 'written') {
      problems.push(`${dir} is not writable (${outcome})`);
    } else if (!expected.has(dir) && outcome === 'written') {
      problems.push(`${dir} is writable`);
    }
  }
  return problems;
}

/**
 * Problems with a `docker stop --time 10`: the server exits on SIGTERM, as
 * Next's handler does with 143, or 0, and before the runtime's SIGKILL.
 *
 * @param {{ exitCode: number | null, elapsedMs: number, oomKilled?: boolean }} stop
 * @param {number} [limitMs]
 * @returns {string[]}
 */
export function stopProblems({ exitCode, elapsedMs, oomKilled }, limitMs = 10_000) {
  const problems = [];
  if (exitCode !== 143 && exitCode !== 0) {
    problems.push(`exited ${exitCode ?? 'never'} on SIGTERM, not 143 or 0`);
  }
  if (elapsedMs >= limitMs) problems.push(`took ${elapsedMs} ms to stop, not under ${limitMs}`);
  if (oomKilled) problems.push('was killed for memory');
  return problems;
}

/**
 * Whether a data directory file survives the server: everything but
 * ephemeral/ (sessions and grants, never backed up), a staged publish, and
 * the runtime lock and claim files (packages/core/src/store/layout.ts).
 *
 * @param {string} file a path under the data directory
 */
export function isDurable(file) {
  return !(
    file.startsWith('ephemeral/') ||
    /^revisions\/\.staging-/.test(file) ||
    ['publication/lock', 'publication/lock.break', 'publication/server.json'].includes(file)
  );
}

/**
 * Problems with the data volume under a new container: every durable file
 * the old one left is there, unchanged, and the audit log only grew.
 *
 * @param {Record<string, string>} before path to text, under the data directory
 * @param {Record<string, string>} after
 * @returns {string[]}
 */
export function persistenceProblems(before, after) {
  const durable = Object.keys(before ?? {}).filter(isDurable);
  if (durable.length === 0) return ['the data directory held nothing durable to keep'];
  const problems = [];
  for (const file of durable) {
    const now = after?.[file];
    if (now === undefined) problems.push(`${file} is gone`);
    else if (file.startsWith('audit/') ? !now.startsWith(before[file]) : now !== before[file]) {
      problems.push(`${file} changed`);
    }
  }
  return problems;
}

/** The host a spoofed request claims, which nothing may answer with. */
export const SPOOFED_HOST = 'spoofed-origin.test';

/**
 * Forwarded headers a client could send to move the origin, the scheme, or
 * its own address. With no trusted hop none counts, and with one only the
 * last X-Forwarded-For entry, the trusted proxy's, does.
 */
export const SPOOFED_HEADERS = Object.freeze({
  'x-forwarded-host': SPOOFED_HOST,
  'x-forwarded-proto': 'http',
  'x-forwarded-port': '8443',
  forwarded: `for=198.51.100.7;host=${SPOOFED_HOST};proto=http`,
  'x-real-ip': '198.51.100.7',
});

/**
 * Problems with a response to a spoofed request: nothing in its headers or
 * body names the spoofed host, a redirect stays on the canonical origin, and
 * a sitemap lists only canonical URLs.
 *
 * @param {{ status?: number, headers?: Record<string, string>, body?: string, error?: string }} response
 * @param {string} origin PORTFOLIO_ORIGIN
 * @param {string} pathname
 * @returns {string[]}
 */
export function spoofProblems(response, origin, pathname) {
  if (!response || response.error) return [`no answer (${response?.error})`];
  const problems = [];
  const headers = Object.entries(response.headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
  if (headers.includes(SPOOFED_HOST)) problems.push('a header names the spoofed host');
  if ((response.body ?? '').includes(SPOOFED_HOST))
    problems.push('the body names the spoofed host');
  const location = response.headers?.location;
  if (location && /^[a-z][a-z0-9+.-]*:/i.test(location) && new URL(location).origin !== origin) {
    problems.push(`redirects to ${location}, off ${origin}`);
  }
  if (pathname === '/sitemap.xml') {
    const locs = [...(response.body ?? '').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    if (locs.length === 0) problems.push('the sitemap lists no URL');
    for (const loc of locs) {
      if (!loc.startsWith(`${origin}/`) && loc !== origin)
        problems.push(`the sitemap lists ${loc}`);
    }
  }
  return problems;
}

/**
 * Problems with the sources the audit log gives failed sign-ins sent with
 * X-Forwarded-For `198.51.100.7, 203.0.113.9`: with no trusted hop none is
 * believed, so the source is unknown; with one, only the last entry is, so
 * the source is 203.0.113.0/24 and never the address the client wrote.
 *
 * @param {readonly Record<string, any>[]} records the audit records the attempts added
 * @param {number} hops PORTFOLIO_TRUSTED_PROXY_HOPS
 * @returns {string[]}
 */
export function sourceProblems(records, hops) {
  const sources = records
    .filter((record) => record.type === 'login_failed' || record.type === 'login_throttled')
    .map((record) => String(record.refs?.source));
  if (sources.length === 0) return ['the audit log holds no failed sign-in'];
  const expected = hops === 0 ? 'unknown' : '203.0.113.0/24';
  const wrong = sources.filter((source) => source !== expected);
  return wrong.length === 0
    ? []
    : [
        `at ${hops} hops, failed sign-ins came from ${[...new Set(wrong)].join(', ')}, not ${expected}`,
      ];
}

/**
 * The audit records in `after` that `before` lacks: the files are
 * append-only JSON lines, so a new record is a new line.
 *
 * @param {Record<string, string>} before path to text, under the data directory
 * @param {Record<string, string>} after
 * @returns {Record<string, any>[]}
 */
export function newAuditRecords(before, after) {
  const lines = (files) =>
    Object.entries(files ?? {})
      .filter(([file]) => file.startsWith('audit/'))
      .flatMap(([, text]) => text.split('\n'))
      .filter((line) => line.trim() !== '');
  const seen = new Set(lines(before));
  return lines(after)
    .filter((line) => !seen.has(line))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/**
 * Problems with `docker compose config --format json` for a Compose
 * example: every published port is on 127.0.0.1, and the service keeps the
 * hardening the smoke runs it with.
 *
 * @param {any} config
 * @returns {string[]}
 */
export function composeProblems(config) {
  const services = Object.entries(config?.services ?? {});
  if (services.length === 0) return ['the example has no service'];
  const problems = [];
  for (const [name, service] of services) {
    const ports = service.ports ?? [];
    if (ports.length === 0) problems.push(`${name} publishes no port`);
    for (const port of ports) {
      if (port.host_ip !== '127.0.0.1') {
        problems.push(`${name} publishes ${port.target} on ${port.host_ip || 'every address'}`);
      }
    }
    if (service.network_mode === 'host') problems.push(`${name} shares the host network`);
    if (service.read_only !== true) problems.push(`${name} has a writable root`);
    if (!(service.cap_drop ?? []).some((cap) => /^(?:CAP_)?ALL$/i.test(cap))) {
      problems.push(`${name} keeps its capabilities`);
    }
    if (!(service.security_opt ?? []).some((opt) => NO_NEW_PRIVILEGES.test(opt))) {
      problems.push(`${name} doesn't set no-new-privileges`);
    }
  }
  return problems;
}

/**
 * Problems with a run's own environment: in CI no GitHub token reaches the
 * smoke, so nothing it starts could be handed one.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function hermeticProblems(env) {
  if (env.CI !== 'true') return [];
  return ['GITHUB_TOKEN', 'GH_TOKEN']
    .filter((key) => (env[key] ?? '') !== '')
    .map((key) => `${key} is set in the job`);
}

/**
 * `text` with every per-run secret replaced, so a failure message or a
 * saved log never repeats one.
 *
 * @param {string} text
 * @param {readonly string[]} secrets
 */
export function redact(text, secrets) {
  let out = String(text);
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) out = out.split(secret).join('[run secret]');
  }
  return out;
}

/**
 * Every file under `dir` that holds a per-run secret, each then redacted in
 * place, so the uploaded artifact never carries one. The run fails on each.
 *
 * @param {string} dir
 * @param {readonly string[]} secrets
 * @returns {string[]} the files, relative to `dir`
 */
export function redactArtifacts(dir, secrets) {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && statSync(full).size < 64 * 1024 * 1024) {
        const text = readFileSync(full, 'latin1');
        if (secrets.some((secret) => secret && text.includes(secret))) {
          writeFileSync(full, redact(text, secrets), 'latin1');
          found.push(path.relative(dir, full));
        }
      }
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * Lines that mask each per-run secret in the GitHub Actions log. Outside
 * Actions, none.
 *
 * @param {readonly string[]} secrets
 * @param {Record<string, string | undefined>} env
 */
export function maskCommands(secrets, env) {
  return env.GITHUB_ACTIONS === 'true'
    ? secrets.filter(Boolean).map((secret) => `::add-mask::${secret}`)
    : [];
}

/**
 * The local command that reruns one part of the smoke, for its failure
 * records: SMOKE_PROFILES picks the parts.
 *
 * @param {string} part read-only, demo, owner, or rows
 */
export const reproFor = (part) => `SMOKE_PROFILES=${part} pnpm smoke:profiles`;

/** The parts SMOKE_PROFILES can name, in the order they run. */
export const PARTS = ['read-only', 'demo', 'owner', 'rows'];

/**
 * The parts a run covers: all, or those SMOKE_PROFILES names.
 *
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function partsOf(value) {
  if (!value) return [...PARTS];
  const named = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const unknown = named.filter((part) => !PARTS.includes(part));
  if (unknown.length > 0) {
    throw new Error(`SMOKE_PROFILES names ${unknown.join(', ')}; it takes ${PARTS.join(', ')}`);
  }
  return PARTS.filter((part) => named.includes(part));
}
