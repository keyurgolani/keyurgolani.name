#!/usr/bin/env node
// The docs check: pnpm check:docs, and pnpm check:links for external links.
//
// Over every tracked Markdown file but test fixtures:
//   - each relative link and image resolves to a file or directory in the
//     tree, and each #anchor to a heading or an id= in its target;
//   - each `pnpm <script>` in code, inline or fenced, names a root script or
//     a pnpm command, and each `pnpm --filter <package> <script>` a script of
//     that workspace package.
// With --external it also requests each http(s) link once (HEAD, then GET),
// which only the scheduled workflow does. It never requests a local or
// reserved name, a loopback, private, or link-local address, or the live
// site, which CI doesn't probe, and it follows redirects by hand, checking
// each hop's host the same way, for at most 5 hops. A 401, 403, or 429, and
// a link it won't request, whether the docs name it or a redirect leads to
// it, are warnings that don't fail, since sites refuse automated clients.
//
// Pure Node with no dependencies. Each problem is a failure record when the
// check runs under ci/run.mjs, and a row in the job summary.
import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  currentGate,
  escapeData,
  REPO_ROOT,
  reportError,
  writeFailureRecord,
} from './lib/reports.mjs';

const SKIP_FILES = [/(^|\/)__fixtures__\//, /(^|\/)node_modules\//];

// ---- Markdown ---------------------------------------------------------------

/**
 * Splits Markdown into prose lines (code removed) and code spans and blocks,
 * each with its 1-based line number.
 */
export function splitMarkdown(text) {
  const prose = [];
  const code = [];
  let fence = null;
  let block = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const lineNo = i + 1;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) {
        code.push(block);
        fence = null;
        block = null;
      } else {
        block.text += `${line}\n`;
      }
      return;
    }
    if (marker) {
      fence = marker[1];
      block = { line: lineNo + 1, text: '' };
      return;
    }
    const spans = [];
    const stripped = line.replace(/(`+)([^`]|[^`].*?[^`])\1(?!`)/g, (_, ticks, inner) => {
      spans.push(inner.trim());
      return ' '.repeat(ticks.length * 2 + inner.length);
    });
    for (const span of spans) code.push({ line: lineNo, text: span });
    prose.push({ line: lineNo, text: stripped });
  });
  if (block) code.push(block);
  return { prose, code };
}

/** Links in prose: inline, images, reference definitions, and autolinks. */
export function extractLinks(prose) {
  const links = [];
  for (const { line, text } of prose) {
    for (const m of text.matchAll(
      /!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g,
    )) {
      links.push({ line, url: m[1] });
    }
    const def = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+["'(].*)?$/.exec(text);
    if (def) links.push({ line, url: def[1] });
    for (const m of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) links.push({ line, url: m[1] });
    for (const m of text.matchAll(/<a\s[^>]*href="([^"]+)"/gi)) links.push({ line, url: m[1] });
    for (const m of text.matchAll(/<img\s[^>]*src="([^"]+)"/gi)) links.push({ line, url: m[1] });
  }
  return links;
}

/** GitHub's heading anchors for a Markdown document, plus any id= or name=. */
export function anchorsOf(text) {
  const anchors = new Set();
  const counts = new Map();
  const { prose } = splitMarkdown(text);
  for (const { text: line } of prose) {
    for (const m of line.matchAll(/\b(?:id|name)="([^"]+)"/g)) anchors.add(m[1]);
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = slug(heading[1]);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  // Code spans were blanked out of prose; headings keep their text.
  for (const m of text.matchAll(/^\s{0,3}#{1,6}\s+(.*`.*?)\s*#*\s*$/gm)) {
    const base = slug(m[1]);
    if (!anchors.has(base)) anchors.add(base);
  }
  return anchors;
}

/** GitHub's slug for a heading's text. */
export function slug(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/(\*\*|__|\*)/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

// ---- pnpm references --------------------------------------------------------

// pnpm's own commands, which aren't scripts.
const PNPM_COMMANDS = new Set([
  'add',
  'audit',
  'config',
  'create',
  'dlx',
  'env',
  'exec',
  'fetch',
  'i',
  'import',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'ls',
  'outdated',
  'pack',
  'prune',
  'publish',
  'rebuild',
  'remove',
  'root',
  'run',
  'setup',
  'store',
  'unlink',
  'update',
  'why',
]);

/** `pnpm` invocations in a piece of code: { filter, script }. */
export function pnpmReferences(code) {
  const refs = [];
  for (const m of code.matchAll(
    /(?:^|[\s;&|(`$])pnpm((?:\s+(?:--filter[= ]\S+|-F\s+\S+|-r|--recursive|-w|--workspace-root|--silent|-s))*)\s+(?:run\s+)?([a-z@][\w:.@/-]*)(?=$|[\s;&|)`'"])/g,
  )) {
    const filter = /(?:--filter[= ]|-F\s+)(\S+)/.exec(m[1])?.[1] ?? null;
    const recursive = /(^|\s)(-r|--recursive)(\s|$)/.test(m[1]);
    refs.push({ filter, recursive, script: m[2] });
  }
  return refs;
}

/** The problem with one reference, or null. */
export function pnpmProblem({ filter, recursive, script }, rootScripts, packages) {
  if (PNPM_COMMANDS.has(script) || script.startsWith('-') || recursive) return null;
  if (filter) {
    const pkg = packages.get(filter);
    // A filter that's a pattern or path is left alone; a package name isn't.
    if (!pkg)
      return filter.startsWith('@') && !/[*{]/.test(filter)
        ? `no workspace package ${filter}`
        : null;
    return pkg.has(script) ? null : `${filter} has no script ${script}`;
  }
  // `pnpm test` and `pnpm start` run the script of that name.
  return rootScripts.has(script) ? null : `package.json has no script ${script}`;
}

// ---- the tree ---------------------------------------------------------------

function markdownFiles(root) {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md'],
    { cwd: root, encoding: 'utf8' },
  );
  return [...new Set(out.split('\0'))]
    .filter((f) => f && !SKIP_FILES.some((re) => re.test(f)) && existsSync(path.join(root, f)))
    .sort();
}

function workspaceScripts(root) {
  const packages = new Map();
  for (const base of ['apps', 'packages']) {
    let entries = [];
    try {
      entries = readdirSync(path.join(root, base), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(root, base, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      packages.set(manifest.name, new Set(Object.keys(manifest.scripts ?? {})));
    }
  }
  return packages;
}

// Names CI never requests: local and reserved names, and the live site,
// which CI doesn't probe. Matched after a trailing dot is dropped.
const REFUSED_NAME =
  /^(?:localhost|.*\.(?:localhost|test|local|example|invalid|internal|home\.arpa)|(?:.*\.)?example\.(?:com|net|org)|(?:.*\.)?keyurgolani\.name)$/;

/** Whether an IPv4 address is in a loopback, private, link-local, shared, or reserved range. */
export function privateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    // Azure's WireServer, reachable from every Azure VM, GitHub's runners among them.
    address === '168.63.129.16' ||
    a >= 224
  );
}

/**
 * Whether an IPv6 address is loopback, unspecified, unique-local,
 * link-local, site-local, multicast, discard-only, documentation, or carries
 * an IPv4 address (mapped, compatible, NAT64, 6to4, Teredo), any of which
 * can reach a private host.
 */
export function privateIPv6(address) {
  const a = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (a === '::' || a === '::1') return true;
  if (a.includes('.') || /^::(ffff:)?[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(a)) return true;
  if (/^::ffff:/.test(a) || a.startsWith('64:ff9b:') || a.startsWith('2002:')) return true;
  if (/^f[cd]/.test(a) || /^fe[89a-f]/.test(a) || a.startsWith('ff') || a.startsWith('2001:db8'))
    return true;
  // Teredo, 2001::/32, and discard-only, 100::/64.
  if (/^2001:(0{0,4}:|:)/.test(a) || /^100:(0{0,4}:){0,3}(:|0{0,4}:)/.test(a) || a === '100::')
    return true;
  return false;
}

const isIPv4 = (host) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

/** Whether a host is one CI may request: no refused name, no private address. */
export function publicHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (host === '' || REFUSED_NAME.test(host)) return false;
  if (host.startsWith('[')) return !privateIPv6(host);
  if (isIPv4(host)) return !privateIPv4(host);
  return true;
}

/** Whether --external requests this URL. */
export function externallyChecked(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  if (parsed.username || parsed.password) return false;
  if (/[<>{}]|\$\{/.test(url)) return false;
  return publicHost(parsed.hostname);
}

/** Checks the tree, or the files given. Returns { problems, warnings, links }. */
export function checkDocs({ root = REPO_ROOT, files = markdownFiles(root) } = {}) {
  const problems = [];
  const external = new Map();
  const rootScripts = new Set(
    Object.keys(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {}),
  );
  const packages = workspaceScripts(root);
  const anchorCache = new Map();
  const anchorsFor = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(readFileSync(file, 'utf8')));
    return anchorCache.get(file);
  };

  for (const file of files) {
    const abs = path.join(root, file);
    const text = readFileSync(abs, 'utf8');
    const { prose, code } = splitMarkdown(text);
    for (const { line, url } of extractLinks(prose)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        if (/^https?:/i.test(url)) {
          external.set(url, [...(external.get(url) ?? []), `${file}:${line}`]);
        }
        continue;
      }
      const [target, anchor] = decodeURI(url).split('#');
      const resolved = target
        ? target.startsWith('/')
          ? path.join(root, target)
          : path.resolve(path.dirname(abs), target.split('?')[0])
        : abs;
      if (target && !resolved.startsWith(root)) {
        problems.push({ file, line, url, message: `${url} points outside the repository` });
        continue;
      }
      if (!existsSync(resolved)) {
        problems.push({ file, line, url, message: `${url} names no file in the tree` });
        continue;
      }
      if (anchor && statSync(resolved).isFile() && resolved.endsWith('.md')) {
        if (!anchorsFor(resolved).has(anchor.toLowerCase()) && !anchorsFor(resolved).has(anchor)) {
          problems.push({
            file,
            line,
            url,
            message: `${url}: ${path.relative(root, resolved)} has no heading or id #${anchor}`,
          });
        }
      }
    }
    for (const { line, text: snippet } of code) {
      for (const ref of pnpmReferences(snippet)) {
        const message = pnpmProblem(ref, rootScripts, packages);
        if (message)
          problems.push({ file, line, url: '', message: `pnpm ${ref.script}: ${message}` });
      }
    }
  }
  return { problems, external, files };
}

export const MAX_REDIRECTS = 5;

/**
 * Requests each external link once, HEAD and then GET where HEAD isn't
 * answered. Redirects are followed by hand, and each hop's host goes through
 * externallyChecked and a DNS lookup again, so a redirect or a name that
 * resolves to a private address never gets a request. fetchImpl and
 * lookupImpl are injectable for tests.
 */
export async function checkExternal(
  external,
  {
    fetchImpl = fetch,
    lookupImpl = (host) => lookup(host, { all: true, verbatim: true }),
    concurrency = 4,
    timeoutMs = 15_000,
  } = {},
) {
  const problems = [];
  const warnings = [];
  const urls = [...external.keys()].filter(externallyChecked).sort();
  // A link the docs name directly that CI won't request is reported, never dropped.
  for (const url of [...external.keys()].filter((u) => !externallyChecked(u)).sort()) {
    warnings.push({
      url,
      where: external.get(url),
      status: undefined,
      message: `${url} is a host CI doesn't request; not requested`,
    });
  }

  /** Throws a Refused when the URL's host may not be requested. */
  const admit = async (url) => {
    if (!externallyChecked(url)) throw new Refused(`${url} is a host CI doesn't request`);
    const host = new URL(url).hostname.replace(/\.+$/, '');
    if (host.startsWith('[') || isIPv4(host)) return;
    const addresses = await lookupImpl(host);
    for (const { address, family } of addresses) {
      if (family === 6 ? privateIPv6(address) : privateIPv4(address)) {
        throw new Refused(`${url} resolves to a private address`);
      }
    }
  };

  const request = async (start, method) => {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await admit(url);
      const response = await fetchImpl(url, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'keyurgolani.name docs check (scheduled CI)' },
      });
      const location = response.headers?.get?.('location');
      if (response.status < 300 || response.status >= 400 || !location) return response;
      url = new URL(location, url).href;
    }
    throw new Error(`more than ${MAX_REDIRECTS} redirects`);
  };

  const one = async (url) => {
    let status;
    let error;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let response = await request(url, 'HEAD');
        if (response.status === 405 || response.status === 404 || response.status === 403) {
          response = await request(url, 'GET');
        }
        status = response.status;
        error = null;
        if (status < 500 && status !== 429) break;
      } catch (e) {
        error = e;
        if (e instanceof Refused) break;
      }
    }
    const where = external.get(url);
    const entry = { url, where, status, message: '' };
    if (error instanceof Refused)
      warnings.push({ ...entry, message: `${error.message}; not requested` });
    else if (error)
      problems.push({ ...entry, message: `${url} failed: ${error.cause?.code ?? error.message}` });
    else if (status === 401 || status === 403 || status === 429)
      warnings.push({ ...entry, message: `${url} answered ${status}; not verifiable from CI` });
    else if (status >= 400) problems.push({ ...entry, message: `${url} answered ${status}` });
  };
  const queue = [...urls];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) await one(queue.shift());
    }),
  );
  return { problems, warnings, checked: urls.length };
}

class Refused extends Error {}

/** A job-summary table cell: one line, its pipes escaped. */
const summaryCell = (text) =>
  String(text)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\|/g, '\\|');

export function renderSummary({ title, problems, warnings = [], checked }) {
  const lines = [
    `### ${title}: ${problems.length === 0 ? 'passed' : `${problems.length} problems`}`,
    '',
  ];
  if (checked !== undefined) lines.push(`${checked} checked.`, '');
  const rows = [...problems.map((p) => ['problem', p]), ...warnings.map((w) => ['warning', w])];
  if (rows.length > 0) {
    lines.push('| Kind | Where | Problem |', '| --- | --- | --- |');
    for (const [kind, p] of rows) {
      const where = p.where ? p.where.join(', ') : `${p.file}:${p.line}`;
      lines.push(`| ${kind} | ${summaryCell(where)} | ${summaryCell(p.message)} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  const { problems, external, files } = checkDocs();
  let all = problems;
  let warnings = [];
  let checked = files.length;
  let title = 'docs';
  if (argv.includes('--external')) {
    const result = await checkExternal(external);
    all = [...problems, ...result.problems];
    warnings = result.warnings;
    checked = result.checked;
    title = 'links';
  }
  const gate = currentGate();
  for (const p of all) {
    const where = p.where?.[0] ?? `${p.file}:${p.line}`;
    const [file, line] = where.split(/:(?=\d+$)/);
    reportError(p.message, { file, line: Number(line), title });
    if (gate) {
      writeFailureRecord({
        ...gate,
        test: p.message,
        asset: where,
        ...(p.status ? { actual: String(p.status), expected: '2xx or 3xx' } : {}),
      });
    }
  }
  for (const w of warnings) console.log(`::warning title=${title}::${escapeData(w.message)}`);
  const summary = renderSummary({ title, problems: all, warnings, checked });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  console.log(
    all.length === 0
      ? `[${title}] ${argv.includes('--external') ? `${checked} external links` : `${files.length} Markdown files`} checked`
      : `[${title}] ${all.length} problem(s)`,
  );
  return all.length === 0 ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
