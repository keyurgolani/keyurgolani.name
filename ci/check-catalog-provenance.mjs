#!/usr/bin/env node
// The catalog provenance check: pnpm check:catalog-provenance (#20, #12),
// which only the scheduled workflow runs.
//
// It reads the catalog's own packages, never a fixture package: each pack
// package under packages/ (a package.json `portfolio.kind` of
// design-language, color-scheme, or typography, and no `fixture`), its
// shipping packs (packs/), its held packs (held/), its Research records
// (research/), and its generated schemes' records (generated/). Then:
//
//   - dead: each source URL (a manifest's provenance.source.url and
//     provenance.derivedFrom.url, a Research record's source.url) is
//     requested with HEAD, then GET where HEAD isn't answered with a 2xx.
//     A 404, 410, 5xx, DNS failure, timeout, or other network failure is
//     retried twice with backoff, then is dead, and so is a sixth redirect.
//     A generated scheme's source file that isn't in the tree is dead too.
//   - unverified: a 401, 403, 429, or any other answer, and a URL the check
//     won't request (not https, carrying credentials, or a local, reserved,
//     private, or live-site host, ci/docs-check.mjs's rule), at the start or
//     on any redirect hop.
//   - license-drift and copyright-drift: for a pack under an upstream
//     license (MIT, Apache-2.0, OFL-1.1) whose source is pinned to a GitHub
//     tag, the license file at that tag, from raw.githubusercontent.com,
//     must be the license the manifest names, and carry its copyright line.
//     A pinned tag that's gone from the repository is dead.
//   - newer-upstream: the repository's latest release, or its highest tag,
//     is a newer major or minor than the pin.
//
// dead, license-drift, and copyright-drift fail the check, each a failure
// record under ci/run.mjs, which the scheduled report files. unverified and
// newer-upstream don't fail: they go to the job summary and the log only,
// since the report shows every record it finds as a failure.
//
// Requests are https only, at most 4 at once, each with a 12 s timeout, no
// cookies, and no credentials, with redirects followed by hand. GITHUB_TOKEN,
// when set, goes to api.github.com alone, never to another host or a
// redirect off it, and never into a log, a record, or the summary. Without
// one, each repository's API answers are cached for the run, so the
// unauthenticated limit of 60 an hour holds.
//
// Pure Node with no dependencies. --root <dir> checks another tree.
import { lookup } from 'node:dns/promises';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateIPv4, privateIPv6, publicHost } from './docs-check.mjs';
import {
  currentGate,
  escapeData,
  REPO_ROOT,
  reportError,
  writeFailureRecord,
} from './lib/reports.mjs';

export const GATE = 'catalog-provenance';
/** The kinds that fail the check, each a failure record. */
export const FAILING = Object.freeze(['dead', 'license-drift', 'copyright-drift']);
/** The kinds that only inform: the job summary and the log. */
export const INFORMATIONAL = Object.freeze(['unverified', 'newer-upstream']);
export const UPSTREAM_LICENSES = Object.freeze(['MIT', 'Apache-2.0', 'OFL-1.1']);
export const MAX_REDIRECTS = 5;
export const RETRIES = 2;
export const BACKOFF_MS = Object.freeze([2_000, 5_000]);
export const TIMEOUT_MS = 12_000;
export const CONCURRENCY = 4;
export const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const USER_AGENT = 'keyurgolani.name catalog provenance check (scheduled CI)';
/** The license files tried at a pinned tag, in order. */
export const LICENSE_FILES = Object.freeze([
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'OFL.txt',
  'COPYING',
]);
const AXES = Object.freeze({
  'design-language': 'designLanguage',
  'color-scheme': 'colorScheme',
  typography: 'typography',
});

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const isDir = (dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
const listDirs = (dir) =>
  isDir(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];
const listJson = (dir) =>
  isDir(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .sort()
    : [];

/** A version tag, as [major, minor, patch], or null: v3.4.17, 3.4, and so on. */
export function parseVersion(tag) {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(tag ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** Whether `latest` is a newer major or minor than `pinned`. */
export function newerMinor(pinned, latest) {
  return latest[0] > pinned[0] || (latest[0] === pinned[0] && latest[1] > pinned[1]);
}

/**
 * The GitHub repository and version tag a source URL pins, or null: a
 * github.com blob, tree, raw, or release-tag URL, or a raw.githubusercontent
 * URL, whose ref is a version tag.
 */
export function githubPin(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  let m = null;
  if (u.hostname === 'github.com') {
    m = /^\/([^/]+)\/([^/]+)\/(?:blob|tree|raw|releases\/tag)\/([^/]+)/.exec(u.pathname);
  } else if (u.hostname === 'raw.githubusercontent.com') {
    m = /^\/([^/]+)\/([^/]+)\/(?:refs\/tags\/)?([^/]+)\//.exec(u.pathname);
  }
  if (!m) return null;
  const ref = decodeURIComponent(m[3]);
  const version = parseVersion(ref);
  if (!version) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ''), ref, version };
}

/**
 * What the catalog's own packages declare: `sources`, every URL to request;
 * `upstream`, every pack under an upstream license, pinned or not; and
 * `files`, every generated scheme's source file. Fixture packages are never
 * read.
 */
export function catalogEntries(root = REPO_ROOT) {
  const sources = [];
  const upstream = [];
  const files = [];
  const packages = path.join(root, 'packages');
  const rel = (file) => path.relative(root, file).split(path.sep).join('/');
  for (const dir of listDirs(packages)) {
    const pkgFile = path.join(packages, dir, 'package.json');
    if (!existsSync(pkgFile)) continue;
    const portfolio = readJson(pkgFile).portfolio;
    const axis = AXES[portfolio?.kind];
    if (!axis || portfolio.fixture === true || /fixture/.test(dir)) continue;
    const base = path.join(packages, dir);
    const packsDir = path.resolve(base, portfolio.packs ?? './packs');
    for (const packs of [packsDir, path.join(base, 'held')]) {
      for (const id of listDirs(packs)) {
        const file = path.join(packs, id, 'manifest.json');
        if (!existsSync(file)) continue;
        const manifest = readJson(file);
        const pack = manifest.id ?? id;
        const asset = rel(file);
        const provenance = manifest.provenance ?? {};
        if (provenance.source?.url) {
          sources.push({
            pack,
            axis,
            asset,
            field: 'provenance.source.url',
            url: provenance.source.url,
          });
        }
        if (provenance.derivedFrom?.url) {
          sources.push({
            pack,
            axis,
            asset,
            field: 'provenance.derivedFrom.url',
            url: provenance.derivedFrom.url,
          });
        }
        if (UPSTREAM_LICENSES.includes(provenance.license)) {
          upstream.push({
            pack,
            axis,
            asset,
            field: 'provenance.source.url',
            url: provenance.source?.url,
            license: provenance.license,
            copyright: provenance.copyright,
            pin: githubPin(provenance.source?.url),
          });
        }
      }
    }
    for (const name of listJson(path.join(base, 'research'))) {
      const file = path.join(base, 'research', name);
      const record = readJson(file);
      if (!record.source?.url) continue;
      sources.push({
        pack: record.id ?? name.replace(/\.json$/, ''),
        axis: AXES[record.kind] ?? axis,
        asset: rel(file),
        field: 'source.url',
        url: record.source.url,
      });
    }
    for (const name of listJson(path.join(base, 'generated'))) {
      const file = path.join(base, 'generated', name);
      const record = readJson(file);
      const source = record?.source;
      if (!source || typeof source !== 'object') continue;
      const pack = record.scheme ?? name.replace(/\.json$/, '');
      if (typeof source.url === 'string') {
        sources.push({ pack, axis, asset: rel(file), field: 'source.url', url: source.url });
      }
      if (typeof source.file === 'string') {
        files.push({ pack, axis, asset: rel(file), field: 'source.file', file: source.file });
      }
    }
  }
  return { sources, upstream, files };
}

/** The SPDX identifier a license file's text is, among the upstream ones, or null. */
export function detectSpdx(text) {
  const tagged = /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)/.exec(text);
  if (tagged) return tagged[1];
  const t = String(text).replace(/\s+/g, ' ');
  if (/SIL OPEN FONT LICENSE,? Version 1\.1/i.test(t)) return 'OFL-1.1';
  if (/Apache License,? Version 2\.0/i.test(t)) return 'Apache-2.0';
  if (
    /Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(t) &&
    /The above copyright notice and this permission notice shall be included/i.test(t)
  ) {
    return 'MIT';
  }
  return null;
}

/** A license file's copyright lines, its templates' placeholders left out. */
export function copyrightLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => /^copyright\b/i.test(line) && !/[[{<]/.test(line));
}

const normalizeCopyright = (line) =>
  String(line).trim().replace(/\s+/g, ' ').replace(/©/g, '(c)').toLowerCase();

class Refused extends Error {}
class TooManyRedirects extends Error {}

const isIPv4 = (host) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

/**
 * The token a request to `url` may carry: GITHUB_TOKEN to https
 * api.github.com on its default port, and nothing anywhere else.
 */
export function tokenFor(url, token) {
  if (!token) return undefined;
  let u;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const api = new URL(API);
  return u.protocol === api.protocol &&
    u.hostname === api.hostname &&
    u.port === '' &&
    !u.username &&
    !u.password
    ? token
    : undefined;
}

/**
 * The check's HTTP client. Every hop goes through admit(), so no request
 * reaches a URL that isn't https or a host the check refuses, and the token
 * is chosen per hop, so a redirect off api.github.com drops it.
 */
export function client({
  fetchImpl = fetch,
  lookupImpl = (host) => lookup(host, { all: true, verbatim: true }),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  token,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const redact = (text) => (token ? String(text).split(token).join('***') : String(text));

  const admit = async (url) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Refused(`${url} isn't a URL`);
    }
    if (u.protocol !== 'https:') throw new Refused(`${url} isn't https`);
    if (u.username || u.password) throw new Refused(`${u.hostname} carries credentials`);
    if (!publicHost(u.hostname)) throw new Refused(`${u.hostname} is a host this check refuses`);
    const host = u.hostname.replace(/\.+$/, '');
    if (host.startsWith('[') || isIPv4(host)) return;
    const addresses = await lookupImpl(host);
    for (const { address, family } of addresses) {
      if (family === 6 ? privateIPv6(address) : privateIPv4(address)) {
        throw new Refused(`${host} resolves to a private address`);
      }
    }
  };

  const discard = async (response) => {
    try {
      await response?.body?.cancel?.();
    } catch {
      // Nothing to read.
    }
  };

  /** One request, redirects followed by hand: { status, response, url }. */
  const request = async (start, { method = 'GET', accept } = {}) => {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await admit(url);
      const headers = { 'user-agent': USER_AGENT };
      if (accept) headers.accept = accept;
      const bearer = tokenFor(url, token);
      if (bearer) {
        headers.authorization = `Bearer ${bearer}`;
        headers['x-github-api-version'] = '2022-11-28';
      }
      const response = await fetchImpl(url, {
        method,
        headers,
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const location = response.headers?.get?.('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await discard(response);
        url = new URL(location, url).href;
        continue;
      }
      return { status: response.status, response, url };
    }
    throw new TooManyRedirects(`more than ${MAX_REDIRECTS} redirects`);
  };

  const failure = (error) => {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return `timed out after ${timeoutMs / 1000} s`;
    }
    const code = error?.code ?? error?.cause?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `DNS lookup failed (${code})`;
    return redact(code ?? error?.message ?? String(error));
  };

  /** How one status reads: ok, retried then dead, or unverified. */
  const classify = (status) => {
    if (status >= 200 && status < 300) return { kind: 'ok', status };
    if (status === 404 || status === 410 || status >= 500) {
      return { kind: 'dead', retry: true, status, reason: `answered ${status}` };
    }
    return { kind: 'unverified', status, reason: `answered ${status}` };
  };

  /** Runs `attempt` until it needs no retry, at most RETRIES more times, with backoff. */
  const withRetries = async (attempt) => {
    let result;
    for (let n = 0; n <= RETRIES; n++) {
      if (n > 0) await sleep(BACKOFF_MS[n - 1] ?? BACKOFF_MS.at(-1));
      result = await attempt();
      if (!result.retry) return { ...result, attempts: n + 1 };
    }
    return { ...result, attempts: RETRIES + 1 };
  };

  const caught = (error) => {
    if (error instanceof Refused) {
      return { kind: 'unverified', reason: `not requested: ${redact(error.message)}` };
    }
    if (error instanceof TooManyRedirects) return { kind: 'dead', reason: error.message };
    return { kind: 'dead', retry: true, reason: failure(error) };
  };

  /** The dead-URL check: { kind: ok | dead | unverified, status?, reason?, attempts }. */
  const probe = (url) =>
    withRetries(async () => {
      try {
        let answer = await request(url, { method: 'HEAD' });
        if (answer.status < 200 || answer.status >= 300) {
          await discard(answer.response);
          answer = await request(url, { method: 'GET' });
        }
        await discard(answer.response);
        return classify(answer.status);
      } catch (error) {
        return caught(error);
      }
    });

  /** A GET whose body is read: { kind, status?, reason?, text? }. */
  const getText = (url, accept) =>
    withRetries(async () => {
      try {
        const answer = await request(url, { method: 'GET', accept });
        const status = classify(answer.status);
        if (status.kind !== 'ok') {
          await discard(answer.response);
          // A missing file is an answer, not a transient failure, for a read.
          return answer.status === 404 ? { ...status, retry: false } : status;
        }
        return { ...status, text: await answer.response.text() };
      } catch (error) {
        return caught(error);
      }
    });

  return { probe, getText, redact };
}

/** Runs `fn` over `items`, at most `limit` at once, in order of the results. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

/**
 * The upstream checks for one pinned repository and tag, cached for the run
 * so each repository's API answers are read once: { tag, latest, license }.
 */
function upstreamChecker(http) {
  const tags = new Map();
  const latest = new Map();
  const licenses = new Map();
  const api = (route) => http.getText(`${API}${route}`, 'application/vnd.github+json');
  const json = (answer) => {
    try {
      return JSON.parse(answer.text);
    } catch {
      return undefined;
    }
  };
  const once = (map, key, fn) => {
    if (!map.has(key)) map.set(key, fn());
    return map.get(key);
  };
  return {
    /** Whether the tag is there: { kind: ok | gone | unverified, reason? }. */
    tag: ({ owner, repo, ref }) =>
      once(tags, `${owner}/${repo}@${ref}`, async () => {
        const answer = await api(`/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(ref)}`);
        if (answer.kind === 'ok') return { kind: 'ok' };
        if (answer.status === 404) return { kind: 'gone' };
        return { kind: 'unverified', reason: `the tag lookup ${answer.reason}` };
      }),
    /** The newest version: { tag, version } or { reason }. */
    latest: ({ owner, repo }) =>
      once(latest, `${owner}/${repo}`, async () => {
        const release = await api(`/repos/${owner}/${repo}/releases/latest`);
        const tag = release.kind === 'ok' ? json(release)?.tag_name : undefined;
        if (parseVersion(tag)) return { tag, version: parseVersion(tag) };
        if (release.kind !== 'ok' && release.status !== 404) {
          return { reason: `the latest release lookup ${release.reason}` };
        }
        const answer = await api(`/repos/${owner}/${repo}/tags?per_page=100`);
        if (answer.kind !== 'ok') return { reason: `the tags lookup ${answer.reason}` };
        const versions = (json(answer) ?? [])
          .map((t) => ({ tag: t?.name, version: parseVersion(t?.name) }))
          .filter((t) => t.version)
          .sort(
            (a, b) =>
              b.version[0] - a.version[0] ||
              b.version[1] - a.version[1] ||
              b.version[2] - a.version[2],
          );
        return versions[0] ?? { reason: 'no release or tag is a version' };
      }),
    /** The license file at the tag: { name, text }, { missing: true }, or { reason }. */
    license: ({ owner, repo, ref }) =>
      once(licenses, `${owner}/${repo}@${ref}`, async () => {
        for (const name of LICENSE_FILES) {
          const answer = await http.getText(
            `${RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/${name}`,
          );
          if (answer.kind === 'ok') return { name, text: answer.text };
          if (answer.status !== 404) return { reason: `${name} ${answer.reason}` };
        }
        return { missing: true };
      }),
  };
}

/** One finding: a kind, where it is, and what was expected and found. */
const finding = (entry, kind, fields) => ({
  kind,
  pack: entry.pack,
  axis: entry.axis,
  field: entry.field,
  url: entry.url ?? entry.file,
  asset: entry.asset,
  ...fields,
});

/** Every finding for the tree at `root`, sorted. */
export async function checkProvenance({ root = REPO_ROOT, ...options } = {}) {
  const http = client(options);
  const { sources, upstream, files } = catalogEntries(root);
  const findings = [];

  // Each URL is requested once, however many packs name it.
  const urls = [...new Set(sources.map((s) => s.url))].sort();
  const probes = new Map(
    (await pool(urls, options.concurrency ?? CONCURRENCY, http.probe)).map((r, i) => [urls[i], r]),
  );
  for (const entry of sources) {
    const result = probes.get(entry.url);
    if (result.kind === 'dead') {
      const tries = result.attempts > 1 ? ` after ${result.attempts} attempts` : '';
      findings.push(
        finding(entry, 'dead', { expected: '2xx', actual: `${result.reason}${tries}` }),
      );
    } else if (result.kind === 'unverified') {
      findings.push(finding(entry, 'unverified', { actual: result.reason }));
    }
  }

  for (const entry of files) {
    const file = path.resolve(root, entry.file);
    const inside = !path.relative(root, file).startsWith('..') && !path.isAbsolute(entry.file);
    if (!inside || !existsSync(file)) {
      findings.push(
        finding(entry, 'dead', {
          expected: 'a file in the tree',
          actual: inside ? 'missing' : 'outside the tree',
        }),
      );
    }
  }

  const upstreamChecks = upstreamChecker(http);
  for (const entry of upstream) {
    const { pin } = entry;
    if (!pin) {
      // Nothing to hold the license to: say so, so it isn't read as checked.
      findings.push(
        finding(entry, 'unverified', {
          field: 'provenance.license',
          actual: 'its source is no GitHub URL at a version tag, so its license file is not read',
        }),
      );
      continue;
    }
    const at = `${pin.owner}/${pin.repo}@${pin.ref}`;
    const tag = await upstreamChecks.tag(pin);
    if (tag.kind === 'gone') {
      findings.push(
        finding(entry, 'dead', {
          expected: `tag ${pin.ref}`,
          actual: `the pinned tag ${pin.ref} is gone from ${pin.owner}/${pin.repo}`,
        }),
      );
      continue;
    }
    if (tag.kind === 'unverified') {
      findings.push(finding(entry, 'unverified', { actual: `${at}: ${tag.reason}` }));
    }

    const license = await upstreamChecks.license(pin);
    if (license.missing) {
      findings.push(
        finding(entry, 'license-drift', {
          field: 'provenance.license',
          expected: entry.license,
          actual: `no license file at ${at}`,
        }),
      );
    } else if (license.reason) {
      findings.push(finding(entry, 'unverified', { actual: `${at}: ${license.reason}` }));
    } else {
      const spdx = detectSpdx(license.text);
      if (spdx !== entry.license) {
        findings.push(
          finding(entry, 'license-drift', {
            field: 'provenance.license',
            expected: entry.license,
            actual: `${spdx ?? 'an unrecognized license'} in ${license.name} at ${at}`,
          }),
        );
      }
      const lines = copyrightLines(license.text);
      if (lines.length === 0) {
        findings.push(
          finding(entry, 'unverified', {
            field: 'provenance.copyright',
            actual: `${license.name} at ${at} has no copyright line`,
          }),
        );
      } else if (
        !entry.copyright ||
        !lines.some((line) => normalizeCopyright(line) === normalizeCopyright(entry.copyright))
      ) {
        findings.push(
          finding(entry, 'copyright-drift', {
            field: 'provenance.copyright',
            expected: entry.copyright ?? 'a copyright line',
            actual: lines.join(' / '),
          }),
        );
      }
    }

    const newest = await upstreamChecks.latest(pin);
    if (newest.version && newerMinor(pin.version, newest.version)) {
      findings.push(
        finding(entry, 'newer-upstream', {
          expected: pin.ref,
          actual: `${pin.owner}/${pin.repo} has ${newest.tag}`,
        }),
      );
    } else if (newest.reason) {
      findings.push(finding(entry, 'unverified', { actual: `${at}: ${newest.reason}` }));
    }
  }

  const order = [...FAILING, ...INFORMATIONAL];
  findings.sort(
    (a, b) =>
      order.indexOf(a.kind) - order.indexOf(b.kind) ||
      a.pack.localeCompare(b.pack) ||
      a.field.localeCompare(b.field),
  );
  return {
    findings: findings.map((f) => ({
      ...f,
      ...(f.actual !== undefined ? { actual: http.redact(f.actual) } : {}),
    })),
    checked: { urls: urls.length, packs: new Set(sources.map((s) => s.pack)).size },
    redact: http.redact,
  };
}

/** A failing finding as a failure record (schema 1.1, ci/failure-record.schema.json). */
export function recordFor(f, gate) {
  return {
    ...gate,
    schemaVersion: '1.1',
    test: `${f.field}: ${f.url}`,
    pack: f.pack,
    axis: f.axis,
    asset: f.asset,
    rule: f.kind,
    expected: f.expected,
    actual: f.actual,
  };
}

const cell = (text) =>
  String(text ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\|/g, '\\|');

export function renderSummary({ findings, checked }) {
  const failing = findings.filter((f) => FAILING.includes(f.kind));
  const lines = [
    `### catalog provenance: ${failing.length === 0 ? 'passed' : `${failing.length} failing`}, ${findings.length - failing.length} informational`,
    '',
    `${checked.urls} source ${checked.urls === 1 ? 'URL' : 'URLs'} checked across ${checked.packs} packs and records.`,
    '',
  ];
  if (findings.length > 0) {
    lines.push(
      '| Kind | Pack | Axis | Field | URL | Expected | Found |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const f of findings) {
      lines.push(
        `| ${[f.kind, f.pack, f.axis, f.field, f.url, f.expected, f.actual].map(cell).join(' | ')} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  log = console.log,
  failuresDir,
  ...options
} = {}) {
  const at = argv.indexOf('--root');
  const root = at === -1 ? REPO_ROOT : path.resolve(argv[at + 1]);
  const result = await checkProvenance({ root, token: env.GITHUB_TOKEN || undefined, ...options });
  const { findings, redact } = result;
  const gate = currentGate(env);
  for (const f of findings) {
    const message = `${f.kind}: ${f.pack} ${f.field} ${f.url}: ${f.actual}`;
    if (FAILING.includes(f.kind)) {
      reportError(message, { title: GATE });
      if (gate) writeFailureRecord(recordFor(f, gate), failuresDir);
    } else {
      log(`::warning title=${GATE}::${escapeData(message)}`);
    }
  }
  const summary = redact(renderSummary(result));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  log(summary);
  return findings.some((f) => FAILING.includes(f.kind)) ? 1 : 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    const token = process.env.GITHUB_TOKEN;
    const message = String(error?.message ?? error);
    reportError(`the check could not run: ${token ? message.split(token).join('***') : message}`, {
      title: GATE,
    });
    process.exit(2);
  }
}
