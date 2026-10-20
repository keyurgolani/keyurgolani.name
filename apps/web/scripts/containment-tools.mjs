#!/usr/bin/env node
/**
 * containment-tools.mjs: read-only helpers for the interim containment prompt
 * (docs/operations/interim-containment.md, issue #21). Each subcommand reads
 * stdin and prints only what the prompt needs, so secrets in Compose output,
 * proxy configs, and access logs never reach the screen.
 *
 *   compose-facts [--service <name> [--expect-image <ref>] [--expect-read-only <path>]]
 *       Allowlisted facts from `docker compose config --format json`.
 *   compose-locate --service <name> [--target <path>]
 *       Where one Compose file holds the service, its image and build keys,
 *       and the mount at <path>, as line numbers, and whether compose-edit
 *       can edit it there.
 *   compose-edit --service <name> --image <ref> [--target <path>]
 *       The Compose file with that service's image set and the mount at
 *       <path> made read-only. Names the changed lines on stderr.
 *   compose-diff [--target <path>]
 *       Filters `diff -U0 old new`. Exits 1 if a changed line isn't an image
 *       line, the mount at <path>, or read_only.
 *   config-check --exit <status>
 *       Summarizes `docker compose config --quiet` output without printing it.
 *   validate-check --exit <status>
 *       Summarizes `caddy validate` or `nginx -t` output as the exit status and
 *       the error locations, without the messages.
 *   proxy-lines caddy|nginx
 *       Allowlisted lines of a proxy config, numbered.
 *   proxy-insert --rule <file> --after <line> [--after <line> ...]
 *       The proxy config with the rule inserted after each given line.
 *   ports-same <before> <after>
 *       Compares two `{{json .HostConfig.PortBindings}}` values.
 *   facts
 *       NAME, ORIGIN, and VARIANT from a portfolio file as shell assignments.
 *   exposure [--before <epoch seconds>]
 *       Counts access-log requests to the authoring paths by day, path,
 *       method, and status class.
 *
 * Needs Node 22 or newer and nothing else. Exit codes: 0 ok, 1 the input
 * can't be handled safely or a check failed (the message says why), 2 bad
 * arguments.
 */
import { readFileSync } from 'node:fs';

class ToolError extends Error {}
class UsageError extends Error {}

const USAGE = `Usage: node containment-tools.mjs <command> [options] < input
  compose-facts [--service <name> [--expect-image <ref>] [--expect-read-only <path>]]
  compose-locate --service <name> [--target /data/portfolio.yml]
  compose-edit --service <name> --image <ref> [--target /data/portfolio.yml]
  compose-diff [--target /data/portfolio.yml]
  config-check --exit <status>
  validate-check --exit <status>
  proxy-lines caddy|nginx
  proxy-insert --rule <file> --after <line> [--after <line> ...]
  ports-same <before> <after>
  facts
  exposure [--before <epoch seconds>]`;

const DEFAULT_TARGET = '/data/portfolio.yml';
// The comment every copy of the deny rule starts with.
const MARKER = 'kgn-21 containment';

const readStdin = () => readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
const indentOf = (line) => line.length - line.trimStart().length;
const isBlankOrComment = (line) => !line.trim() || line.trimStart().startsWith('#');
const numbered = (n, text) => `${String(n).padStart(4)}: ${text}`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A value from the input, with control characters replaced so it prints on one line. */
const printable = (v) => String(v).replace(/[\u0000-\u001f\u007f]/g, '?');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Drop a trailing ` # comment` from an unquoted YAML or config value. */
function stripComment(value) {
  return value.replace(/(^|\s)#.*$/, '').trimEnd();
}

/** Hide the user and password part of any URL, such as a Git build context with a token. */
const maskCredentials = (text) =>
  text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, '$1<credentials not shown>@');

// ---------------------------------------------------------------------------
// Compose: facts from `docker compose config --format json`

const HIDDEN_SERVICE_FIELDS =
  'environment, labels, command, entrypoint, healthcheck, build args, secrets, configs';

function describePort(p) {
  if (!p || typeof p !== 'object') return 'port: <not in long form, not shown>';
  const published =
    p.published === undefined || p.published === null || p.published === ''
      ? ''
      : printable(p.published);
  const target = `${printable(p.target ?? '?')}/${printable(p.protocol ?? 'tcp')}`;
  if (!published) return `port: ${target}, not published`;
  return p.host_ip
    ? `port: ${printable(p.host_ip)}:${published} -> ${target}`
    : `port: ${published} -> ${target}, every interface`;
}

function describeVolume(v) {
  if (!v || typeof v !== 'object') return 'volume: <not in long form, not shown>';
  const source = v.source ? `${printable(v.source)} -> ` : '';
  return `volume: ${printable(v.type ?? 'unknown')} ${source}${printable(v.target ?? '?')}, ${v.read_only ? 'read-only' : 'read-write'}`;
}

function composeFacts(text, { service, expectImage, expectReadOnly }) {
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    // JSON.parse quotes the input in its message, so say nothing about it.
    throw new ToolError(
      text.trim()
        ? 'The input is not JSON, so it is not Compose config output. Nothing from it is shown.'
        : 'Compose printed nothing. Run the config check to see whether Compose fails. If it passes, this Compose may not know --no-env-resolution: run the pipeline again without that flag.',
    );
  }
  const services = config && typeof config === 'object' ? config.services : null;
  if (!services || typeof services !== 'object' || Array.isArray(services)) {
    throw new ToolError('The JSON has no services, so it is not Compose config output.');
  }
  if (service !== undefined && !Object.hasOwn(services, service))
    throw new ToolError(`No service "${service}" in the Compose config.`);
  const out = [];
  if (typeof config.name === 'string') out.push(`project: ${printable(config.name)}`);
  for (const name of service !== undefined ? [service] : Object.keys(services)) {
    const s = services[name] && typeof services[name] === 'object' ? services[name] : {};
    out.push(`service ${printable(name)}`);
    if (s.container_name) out.push(`  container_name: ${printable(s.container_name)}`);
    out.push(`  image: ${s.image ? printable(s.image) : 'not set'}`);
    if (s.build && typeof s.build === 'object') {
      const dockerfile = s.build.dockerfile ? ` (dockerfile ${printable(s.build.dockerfile)})` : '';
      out.push(
        `  build context: ${maskCredentials(printable(s.build.context ?? '.'))}${dockerfile}`,
      );
    } else if (typeof s.build === 'string')
      out.push(`  build context: ${maskCredentials(printable(s.build))}`);
    for (const e of [s.env_file ?? []].flat()) {
      const path = typeof e === 'string' ? e : e?.path;
      if (path)
        out.push(`  env_file: ${printable(path)}${e?.required === false ? ' (optional)' : ''}`);
    }
    for (const p of Array.isArray(s.ports) ? s.ports : []) out.push(`  ${describePort(p)}`);
    for (const v of Array.isArray(s.volumes) ? s.volumes : []) out.push(`  ${describeVolume(v)}`);
    const networks = s.network_mode
      ? [`${printable(s.network_mode)} (network_mode)`]
      : Object.keys(s.networks && typeof s.networks === 'object' ? s.networks : {}).map(printable);
    if (networks.length) out.push(`  networks: ${networks.join(', ')}`);
  }
  for (const [name, n] of Object.entries(
    config.networks && typeof config.networks === 'object' ? config.networks : {},
  )) {
    if (!n || typeof n !== 'object') continue;
    out.push(
      `network ${printable(name)}: ${printable(n.name ?? name)}${n.external ? ' (external)' : ''}`,
    );
  }
  out.push(`not shown: ${HIDDEN_SERVICE_FIELDS}`);

  const failures = [];
  const s = service !== undefined ? (services[service] ?? {}) : {};
  if (expectImage !== undefined && s.image !== expectImage) {
    failures.push(`image is ${s.image ? printable(s.image) : 'not set'}, expected ${expectImage}`);
  }
  if (expectReadOnly !== undefined) {
    const mount = (Array.isArray(s.volumes) ? s.volumes : []).find(
      (v) => v?.target === expectReadOnly,
    );
    if (!mount) failures.push(`no mount targets ${expectReadOnly}`);
    else if (!mount.read_only) failures.push(`the mount at ${expectReadOnly} is read-write`);
  }
  return { text: out.join('\n'), failures };
}

/** Summarize `config --quiet` output: its warnings and errors can quote values. */
function configCheck(text, exit) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  let first = 'none';
  if (lines.length) {
    const level =
      lines[0].match(/\blevel=([a-z]+)/i) ?? lines[0].match(/^(WARN|ERRO|FATA|INFO|DEBU)\[/);
    const names = { WARN: 'warning', ERRO: 'error', FATA: 'fatal', INFO: 'info', DEBU: 'debug' };
    first = level
      ? (names[level[1]] ?? level[1].toLowerCase())
      : lines[0]
          .trim()
          .split(/\s+/)[0]
          .replace(/[^A-Za-z0-9_.:-]/g, '')
          .slice(0, 24) || 'other';
  }
  const ok = exit === 0 && lines.length === 0;
  return {
    text: `config --quiet: exit ${exit}, ${plural(lines.length, 'line')} of output (not shown), first line kind: ${first}${ok ? '' : '. Stop here.'}`,
    ok,
  };
}

/**
 * Summarize a proxy validator's output (caddy validate, nginx -t) as its exit
 * status and the file and line of each error. The messages can quote tokens
 * from the config, so they never print.
 */
function validateCheck(text, exit) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const locations = new Set();
  for (const line of lines) {
    if (!/\[emerg\]|\berror\b|"level":"error"/i.test(line)) continue;
    for (const m of line.matchAll(/((?:\/[\w.@+-]+)+|Caddyfile):(\d+)/g))
      locations.add(`${m[1]}:${m[2]}`);
  }
  const where = locations.size ? [...locations].join(', ') : 'none given';
  return {
    text:
      exit === 0
        ? `validator: exit 0, config is valid`
        : `validator: exit ${exit}, ${plural(lines.length, 'line')} of output (not shown), error locations: ${where}`,
    ok: exit === 0,
  };
}

// ---------------------------------------------------------------------------
// Compose: the image and mount edit, done on the file text

const KEY_RE = /^(?:"([^"]*)"|'([^']*)'|([^\s#'"[{][^#]*?))\s*:(?:\s+(.*))?$/;

/** Split a YAML line into its indent, list-item marker, key, and value. */
function parseYamlLine(line) {
  const indent = indentOf(line);
  let content = line.slice(indent);
  let itemIndent = -1;
  let contentIndent = indent;
  if (content === '-' || content.startsWith('- ')) {
    itemIndent = indent;
    const rest = content.slice(1);
    contentIndent = indent + 1 + (rest.length - rest.trimStart().length);
    content = rest.trim();
  }
  const m = content.match(KEY_RE);
  if (!m || (itemIndent < 0 && content.startsWith('-'))) {
    return { indent, itemIndent, contentIndent, key: null, value: content };
  }
  return {
    indent,
    itemIndent,
    contentIndent,
    key: (m[1] ?? m[2] ?? m[3]).trim(),
    value: (m[4] ?? '').trim(),
  };
}

/**
 * Walk a YAML file and call visit(n, line, info) for each content line.
 * info.path is the chain of enclosing keys, with list items as '-'. Lines in
 * a block scalar body arrive with info.scalar set.
 */
function walkYaml(text, visit) {
  const lines = text.split(/\r?\n/);
  const stack = [];
  let scalarIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrComment(line)) continue;
    const indent = indentOf(line);
    if (scalarIndent >= 0) {
      if (indent > scalarIndent) {
        visit(i + 1, line, { scalar: true, indent, path: stack.map((s) => s.key) });
        continue;
      }
      scalarIndent = -1;
    }
    const parsed = parseYamlLine(line);
    const isItem = parsed.itemIndent >= 0;
    while (stack.length) {
      const top = stack[stack.length - 1];
      // A list may sit at the same indent as the key that holds it.
      const listUnderKey = isItem && top.key !== '-' && top.open && top.indent === indent;
      if (top.indent >= indent && !listUnderKey) stack.pop();
      else break;
    }
    if (isItem) stack.push({ indent: parsed.itemIndent, key: '-', open: true });
    visit(i + 1, line, { ...parsed, isItem, path: stack.map((s) => s.key) });
    if (parsed.key !== null) {
      const value = stripComment(parsed.value);
      if (/^[|>][-+0-9]*$/.test(value)) scalarIndent = parsed.contentIndent;
      stack.push({
        indent: parsed.contentIndent,
        key: parsed.key,
        open: value === '' || /^&\S+$/.test(value),
      });
    }
  }
  return lines;
}

/** Rebuild a short-syntax volume spec with the mode made read-only. */
function readOnlySpec(spec, target) {
  const quote = /^["']/.test(spec) ? spec[0] : '';
  const bare = quote ? spec.slice(1, spec.lastIndexOf(quote)) : spec;
  const parts = bare.split(':');
  if (parts.length < 2 || parts[1] !== target) return null;
  const modes = parts[2] ? parts[2].split(',').filter((m) => m && m !== 'rw') : [];
  if (!modes.includes('ro')) modes.unshift('ro');
  const rebuilt = [parts[0], parts[1], modes.join(','), ...parts.slice(3)].join(':');
  return { spec: `${quote}${rebuilt}${quote}`, was: parts[2] || 'no mode' };
}

const modeText = (mode) => mode.replace(/[^a-z,]/gi, '').slice(0, 32) || '?';

/**
 * Find the service, its image and build keys, and the mount at target in one
 * Compose file. `refusal` says why compose-edit must not edit it there.
 */
function analyzeService(text, service, target) {
  const records = [];
  const lines = walkYaml(text, (n, line, info) => records.push({ n, ...info }));
  const a = {
    lines,
    svc: null,
    imageLine: null,
    buildLine: null,
    mount: null,
    refusal: null,
    childIndent: 0,
  };
  const refuse = (reason) => {
    a.refusal ??= reason;
  };
  const svc = records.find(
    (r) =>
      !r.scalar &&
      !r.isItem &&
      r.key === service &&
      r.path.length === 1 &&
      r.path[0] === 'services',
  );
  if (!svc) {
    refuse(`No service "${service}" under services: in this file.`);
    return a;
  }
  a.svc = svc;
  const svcValue = stripComment(svc.value);
  if (svcValue.startsWith('&'))
    refuse(
      `The service "${service}" carries a YAML anchor, so other services can share its settings. Ask the owner.`,
    );
  else if (svcValue.startsWith('*'))
    refuse(`The service "${service}" is a YAML alias of another node. Ask the owner.`);
  else if (svcValue) refuse(`The service "${service}" is written inline. Ask the owner.`);
  const end = records.find((r) => r.n > svc.n && !r.scalar && r.indent <= svc.indent);
  const block = records.filter((r) => r.n > svc.n && (!end || r.n < end.n) && !r.scalar);
  const children = block.filter((r) => !r.isItem && r.key !== null && r.path.length === 2);
  if (!children.length) {
    refuse(`Service "${service}" has no keys.`);
    return a;
  }
  a.childIndent = children[0].indent;
  for (const key of ['<<', 'extends']) {
    if (children.some((c) => c.key === key))
      refuse(
        `Service "${service}" uses "${key}", so its image or mounts can come from elsewhere. Ask the owner.`,
      );
  }
  a.imageLine = children.find((c) => c.key === 'image') ?? null;
  a.buildLine = children.find((c) => c.key === 'build') ?? null;
  if (a.imageLine && /^[&*!]/.test(stripComment(a.imageLine.value)))
    refuse('The image line uses a YAML anchor, alias, or tag. Ask the owner.');

  const volumes = children.find((c) => c.key === 'volumes');
  if (!volumes) return a;
  if (stripComment(volumes.value)) {
    refuse('The volumes list is written inline or by reference. Ask the owner.');
    return a;
  }
  const inVolumes = block.filter(
    (r) => r.n > volumes.n && r.path[2] === 'volumes' && r.path.length >= 4,
  );
  const items = inVolumes.filter((r) => r.isItem && r.path.length === 4);
  if (items.some((r) => /^[&*]/.test(stripComment(r.value)))) {
    refuse('An entry in the volumes list uses a YAML anchor or alias. Ask the owner.');
    return a;
  }
  for (const item of items) {
    if (item.key === null) {
      const result = readOnlySpec(stripComment(item.value), target);
      if (!result) continue;
      a.mount = {
        kind: 'short',
        n: item.n,
        item,
        result,
        mode: result.was === 'no mode' ? 'no mode' : `mode ${modeText(result.was)}`,
      };
      break;
    }
    const next = items.find((r) => r.n > item.n);
    const fields = inVolumes.filter(
      (r) => r.n >= item.n && (!next || r.n < next.n) && r.key !== null && r.path.length === 4,
    );
    const unquote = (v) => stripComment(v).replace(/^["']|["']$/g, '');
    const targetField = fields.find((f) => f.key === 'target' && unquote(f.value) === target);
    if (!targetField) continue;
    const readOnly = fields.find((f) => f.key === 'read_only');
    const mode = readOnly ? `read_only ${modeText(unquote(readOnly.value))}` : 'read_only not set';
    a.mount = { kind: 'long', n: item.n, item, targetField, readOnly, mode };
    break;
  }
  return a;
}

function composeLocate(text, { service, target }) {
  const a = analyzeService(text, service, target);
  if (!a.svc)
    return [`service ${service}: not in this file`, `edit here: no (${a.refusal})`].join('\n');
  const reason = a.refusal ?? (a.mount ? null : `no mount targets ${target} in this file`);
  return [
    `service ${service}: line ${a.svc.n}`,
    `image: ${a.imageLine ? `line ${a.imageLine.n}` : 'not in this file'}`,
    `build: ${a.buildLine ? `line ${a.buildLine.n}` : 'not in this file'}`,
    `mount ${target}: ${a.mount ? `line ${a.mount.n}, ${a.mount.kind} syntax, ${a.mount.mode}` : 'not in this file'}`,
    `edit here: ${reason ? `no (${reason})` : 'yes'}`,
  ].join('\n');
}

function composeEdit(text, { service, image, target }) {
  if (!/^[\w./:@-]+$/.test(image))
    throw new ToolError('The image reference has unexpected characters.');
  const a = analyzeService(text, service, target);
  if (a.refusal) throw new ToolError(a.refusal);
  if (!a.mount) throw new ToolError(`No mount in service "${service}" targets ${target}.`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const { lines } = a;
  const inserts = [];
  const changes = [];
  const pad = ' '.repeat(a.childIndent);
  if (a.imageLine) {
    lines[a.imageLine.n - 1] = `${pad}image: ${image}`;
    changes.push(`image: line ${a.imageLine.n} replaced`);
  } else {
    inserts.push({ after: a.svc.n, text: `${pad}image: ${image}` });
    changes.push(`image: inserted after line ${a.svc.n}`);
  }
  const m = a.mount;
  if (m.kind === 'short') {
    lines[m.n - 1] = `${' '.repeat(m.item.itemIndent)}- ${m.result.spec}`;
    changes.push(`mount: line ${m.n} set read-only (was ${m.mode})`);
  } else if (m.readOnly) {
    lines[m.readOnly.n - 1] = m.readOnly.isItem
      ? `${' '.repeat(m.readOnly.itemIndent)}- read_only: true`
      : `${' '.repeat(m.readOnly.indent)}read_only: true`;
    changes.push(`mount: line ${m.readOnly.n} set to read_only: true`);
  } else {
    inserts.push({
      after: m.targetField.n,
      text: `${' '.repeat(m.targetField.contentIndent)}read_only: true`,
    });
    changes.push(`mount: read_only: true inserted after line ${m.targetField.n}`);
  }
  for (const ins of inserts.sort((x, y) => y.after - x.after)) lines.splice(ins.after, 0, ins.text);
  return { text: lines.join(eol), changes };
}

function composeDiff(text, target) {
  const t = escapeRe(target);
  const allowed = [
    /^\s*image:\s*\S+\s*$/,
    new RegExp(`^\\s*-\\s*["']?[^\\s"']*:${t}(:[a-z,]+)?["']?\\s*$`),
    new RegExp(`^\\s*(-\\s*)?target:\\s*["']?${t}["']?\\s*$`),
    /^\s*(-\s*)?read_only:\s*(true|false)\s*$/,
  ];
  const out = [];
  let unexpected = 0;
  let inHunks = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      inHunks = true;
      out.push(line.replace(/^(@@[^@]*@@).*$/, '$1'));
    } else if (!inHunks && (line.startsWith('---') || line.startsWith('+++'))) {
      out.push(line);
    } else if (line.startsWith('-') || line.startsWith('+')) {
      // A trailing comment can hold anything, so it is dropped before matching and printing.
      const content = stripComment(line.slice(1));
      if (allowed.some((re) => re.test(content))) out.push(`${line[0]}${content}`);
      else {
        out.push(`${line[0]} <changed line not shown>`);
        unexpected++;
      }
    } else if (line.startsWith('\\')) out.push(line);
  }
  out.push(
    unexpected
      ? `${plural(unexpected, 'changed line')} ${unexpected === 1 ? 'is' : 'are'} not the image, the mount at ${target}, or read_only`
      : `only the image and the mount at ${target} changed`,
  );
  return { text: out.join('\n'), unexpected };
}

// ---------------------------------------------------------------------------
// Proxy configs

// Directives that route requests or say where logs go. Anything else (headers,
// auth, TLS, rewrites that can carry a key upstream) prints as hidden.
const CADDY_DIRECTIVES = new Set([
  'reverse_proxy',
  'handle',
  'handle_path',
  'route',
  'respond',
  'redir',
  'root',
  'file_server',
  'encode',
  'log',
  'output',
  'format',
  'import',
  'bind',
  'abort',
  'error',
  'try_files',
  'to',
  'skip_log',
  'log_skip',
  'auto_https',
  'http_port',
  'https_port',
]);
// Blocks whose every line can be a credential, hidden whatever their contents.
const CADDY_SECRET_BLOCKS = new Set(['basic_auth', 'basicauth', 'forward_auth']);
const CADDY_MATCHERS = new Set(['path', 'path_regexp', 'method', 'host', 'protocol']);
const NGINX_DIRECTIVES = new Set([
  'http',
  'server',
  'listen',
  'server_name',
  'location',
  'proxy_pass',
  'return',
  'access_log',
  'error_log',
  'include',
  'root',
  'alias',
  'try_files',
  'upstream',
  'index',
  'events',
]);

/** Whether a Caddyfile token can be a site address, such as example.com, :8080, or http://host:port. */
function isSiteAddress(token) {
  const t = token.replace(/,$/, '');
  if (!t) return true;
  return (
    /^https?:\/\/\S+$/i.test(t) ||
    /^:\d{1,5}$/.test(t) ||
    /^\{\$[A-Za-z0-9_]+(:[^}]*)?\}(:\d{1,5})?$/.test(t) ||
    /^localhost(:\d{1,5})?$/i.test(t) ||
    /^\[[0-9a-f:.]+\](:\d{1,5})?$/i.test(t) ||
    /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\.?(:\d{1,5})?(\/\S*)?$/i.test(t)
  );
}

/**
 * Tokenize one Caddyfile line. `quote` is the quote a previous line left open.
 * Returns the tokens, the line without its comment, the comment, and the quote
 * still open at the end of the line, if any.
 */
function scanCaddyLine(raw, quote) {
  const tokens = [];
  let cur = '';
  let inToken = quote !== null;
  let commentAt = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      cur += c;
      if (quote === '"' && c === '\\' && i + 1 < raw.length) cur += raw[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      if (inToken) tokens.push(cur);
      cur = '';
      inToken = false;
      continue;
    }
    if (c === '#' && !inToken) {
      commentAt = i;
      break;
    }
    if (c === '"' || c === '`') quote = c;
    cur += c;
    inToken = true;
  }
  if (inToken) tokens.push(cur);
  const body = (commentAt >= 0 ? raw.slice(0, commentAt) : raw).trimEnd();
  return { tokens, body, comment: commentAt >= 0 ? raw.slice(commentAt) : null, quote };
}

function caddyLines(text) {
  const out = [];
  const stack = []; // 'top', 'block', or 'matcher' for each printed open block
  let hidden = 0;
  let hiddenDepth = 0;
  let heredoc = null; // the marker that ends the heredoc body being skipped
  let quote = null; // a quote left open by the previous line
  let mode = 'start'; // then 'normal', 'braceless' (one site, no braces), or 'fragment' (an imported file)
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    if (heredoc) {
      hidden++;
      const t = raw.trim();
      if (t === heredoc || t.startsWith(`${heredoc} `) || t.startsWith(`${heredoc}\t`))
        heredoc = null;
      return;
    }
    const scan = scanCaddyLine(raw, quote);
    if (quote) {
      // The rest of a quoted token that started on an earlier line.
      hidden++;
      quote = scan.quote;
      if (!quote && scan.tokens.length > 1 && scan.tokens[scan.tokens.length - 1] === '{')
        hiddenDepth++;
      return;
    }
    const { tokens } = scan;
    if (!tokens.length) {
      if (scan.comment) {
        if (!hiddenDepth && scan.comment.includes(MARKER)) out.push(numbered(n, raw.trimEnd()));
        else hidden++;
      }
      return;
    }
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    const opensQuote = scan.quote !== null;
    const heredocStart = opensQuote ? null : last.match(/^<<([A-Za-z0-9_-]+)$/);
    const opens = !opensQuote && last === '{';
    const after = () => {
      if (heredocStart) heredoc = heredocStart[1];
      if (opensQuote) quote = scan.quote;
    };
    if (hiddenDepth) {
      hidden++;
      if (first === '}') hiddenDepth--;
      if (opens) hiddenDepth++;
      after();
      return;
    }
    if (first === '}') {
      stack.pop();
      out.push(numbered(n, `${raw.slice(0, indentOf(raw))}}`));
      return;
    }
    const pad = raw.slice(0, indentOf(raw));

    if (!stack.length && mode !== 'braceless') {
      const head = tokens.slice(0, -1);
      let top = null;
      if (opens && tokens.length === 1) top = 'global';
      else if (opens && tokens.length === 2 && /^&?\([^()\s]+\)$/.test(first)) top = 'snippet';
      else if (opens && head.length && head.every(isSiteAddress)) top = 'site';
      if (top) {
        mode = 'normal';
        out.push(numbered(n, maskCredentials(scan.body)));
        stack.push('top');
        return;
      }
      if (
        mode === 'start' &&
        !opens &&
        !heredocStart &&
        !opensQuote &&
        first !== 'import' &&
        tokens.every(isSiteAddress)
      ) {
        mode = 'braceless';
        out.push(numbered(n, maskCredentials(scan.body)));
        return;
      }
      // Anything else at the top is a directive: this is an imported fragment.
      if (mode === 'start') mode = first === 'import' ? 'normal' : 'fragment';
    }

    let show;
    let blockKind = 'block';
    // A hidden line keeps its directive or matcher name only when it looks like one.
    const label = /^@?[a-z_][a-z0-9_.-]*$/i.test(first) ? `${first} ` : '';
    if (first.startsWith('@')) {
      const type = tokens[1];
      if (opens && tokens.length === 2) {
        show = true;
        blockKind = 'matcher';
      } else if (CADDY_MATCHERS.has(type) || (type === 'not' && CADDY_MATCHERS.has(tokens[2]))) {
        show = true;
      } else {
        out.push(numbered(n, `${pad}${label}<matcher not shown>`));
        hidden++;
        if (opens) hiddenDepth = 1;
        after();
        return;
      }
    } else if (stack[stack.length - 1] === 'matcher') {
      show = CADDY_MATCHERS.has(first) || (first === 'not' && CADDY_MATCHERS.has(tokens[1]));
    } else {
      show = !CADDY_SECRET_BLOCKS.has(first) && CADDY_DIRECTIVES.has(first);
    }
    if (!show) {
      hidden++;
      if (opens) {
        out.push(numbered(n, `${pad}${label}{ <block not shown> }`));
        hiddenDepth = 1;
      }
      after();
      return;
    }
    if (first === 'import' && (tokens.length > 2 || opens)) {
      // Snippet arguments can carry credentials.
      const name = /^[\w./*{}$-]+$/.test(tokens[1] ?? '') ? tokens[1] : '<name not shown>';
      out.push(numbered(n, `${pad}import ${name} <arguments not shown>`));
      hidden++;
      if (opens) hiddenDepth = 1;
      after();
      return;
    }
    if (opensQuote) {
      out.push(numbered(n, `${pad}${first} <value not shown>`));
      hidden++;
    } else if (heredocStart) {
      out.push(numbered(n, `${maskCredentials(scan.body)} <heredoc not shown>`));
    } else {
      out.push(numbered(n, maskCredentials(scan.body)));
    }
    if (opens) stack.push(blockKind);
    after();
  });
  out.push(`(${plural(hidden, 'line')} not shown)`);
  return out.join('\n');
}

/**
 * Split an nginx config into statements: each ends at `;`, `{`, or `}` outside
 * quotes. Comments are dropped, except the deny rule's own marker comment.
 */
function nginxStatements(text) {
  const statements = [];
  let cur = '';
  let start = 0;
  let line = 1;
  let quote = null;
  let tokenStart = true;
  const push = (end) => {
    statements.push({ line: start || line, text: cur.trim(), end });
    cur = '';
    start = 0;
    tokenStart = true;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\n') line++;
      if (c === '\\' && i + 1 < text.length) {
        cur += text[++i];
        if (text[i] === '\n') line++;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '\n') {
      line++;
      cur += ' ';
      tokenStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      cur += ' ';
      tokenStart = true;
      continue;
    }
    if (c === '#' && tokenStart) {
      let j = i;
      while (j + 1 < text.length && text[j + 1] !== '\n') j++;
      statements.push({ line, text: text.slice(i, j + 1).trimEnd(), end: 'comment' });
      i = j;
      continue;
    }
    if (!start) start = line;
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      tokenStart = false;
      continue;
    }
    if (c === '$' && text[i + 1] === '{') {
      const close = text.indexOf('}', i);
      const stop = close < 0 ? text.length - 1 : close;
      cur += text.slice(i, stop + 1);
      i = stop;
      tokenStart = false;
      continue;
    }
    if (c === ';' || c === '{' || c === '}') {
      push(c);
      continue;
    }
    cur += c;
    tokenStart = false;
  }
  if (cur.trim()) push('');
  return statements;
}

function nginxLines(text) {
  const raw = text.split(/\r?\n/);
  const parts = new Map();
  const add = (n, part) => {
    if (!parts.has(n)) parts.set(n, []);
    parts.get(n).push(part);
  };
  let hiddenDepth = 0;
  let hidden = 0;
  for (const st of nginxStatements(text)) {
    if (st.end === 'comment') {
      if (!hiddenDepth && st.text.includes(MARKER)) add(st.line, st.text);
      else hidden++;
      continue;
    }
    if (hiddenDepth) {
      if (st.end === '{') hiddenDepth++;
      else if (st.end === '}') hiddenDepth--;
      hidden++;
      continue;
    }
    const first = st.text.split(/\s+/).find(Boolean) ?? '';
    // A hidden statement keeps its directive name only when it looks like one.
    const label = /^[a-z_][a-z0-9_]*$/i.test(first) ? `${first} ` : '';
    if (st.end === '}') {
      if (first) {
        // A statement closed by the brace without a semicolon.
        if (NGINX_DIRECTIVES.has(first))
          add(st.line, maskCredentials(st.text.replace(/\s+/g, ' ')));
        else {
          add(st.line, `${label}<not shown>`);
          hidden++;
        }
      }
      add(st.line, '}');
      continue;
    }
    if (!first) continue;
    if (!NGINX_DIRECTIVES.has(first)) {
      hidden++;
      if (st.end === '{') {
        add(st.line, `${label}{ <block not shown> }`);
        hiddenDepth = 1;
      } else add(st.line, `${label}<not shown>`);
      continue;
    }
    add(
      st.line,
      `${maskCredentials(st.text.replace(/\s+/g, ' '))}${st.end === '{' ? ' {' : st.end}`,
    );
  }
  const out = [...parts.keys()]
    .sort((a, b) => a - b)
    .map((n) =>
      numbered(
        n,
        `${(raw[n - 1] ?? '').slice(0, indentOf(raw[n - 1] ?? ''))}${parts.get(n).join(' ')}`,
      ),
    );
  out.push(`(${plural(hidden, 'statement')} not shown)`);
  return out.join('\n');
}

function proxyInsert(text, rule, after) {
  if (text.includes(MARKER)) {
    throw new ToolError(
      'This config already has the kgn-21 rule, so it was not added again. Go straight to the re-run.',
    );
  }
  if (!rule.includes(MARKER)) throw new ToolError(`The rule file has no "# ${MARKER}" comment.`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const ruleLines = rule.replace(/(\r?\n)+$/, '').split(/\r?\n/);
  const targets = [...new Set(after)].sort((a, b) => b - a);
  for (const n of targets) {
    if (n < 1 || n > lines.length) throw new ToolError(`Line ${n} is not in the file.`);
    if (!/(^|\s)\{$/.test(stripComment(lines[n - 1]).trim()))
      throw new ToolError(`Line ${n} doesn't end with {, so it doesn't open a block.`);
  }
  for (const n of targets) lines.splice(n, 0, ...ruleLines);
  return lines.join(eol);
}

function portBindings(json, label) {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ToolError(`The ${label} value is not JSON.`);
  }
  if (value === null) return [];
  if (typeof value !== 'object' || Array.isArray(value))
    throw new ToolError(`The ${label} value is not a port binding map.`);
  const out = [];
  for (const [port, bindings] of Object.entries(value)) {
    for (const b of Array.isArray(bindings) ? bindings : []) {
      // An empty host address and 0.0.0.0 both mean every interface.
      const ip = !b?.HostIp || b.HostIp === '0.0.0.0' ? 'every interface' : printable(b.HostIp);
      out.push(`${printable(b?.HostPort ?? '?')} -> ${printable(port)} (${ip})`);
    }
  }
  return out.sort();
}

function portsSame(before, after) {
  const a = portBindings(before, 'before');
  const b = portBindings(after, 'after');
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  const list = (l) => (l.length ? l.join(', ') : 'none');
  return {
    same,
    text: same
      ? `published ports unchanged: ${list(a)}`
      : `published ports changed: ${list(a)} became ${list(b)}`,
  };
}

// ---------------------------------------------------------------------------
// Portfolio facts

const SIMPLE_ESCAPES = {
  n: '\n',
  t: '\t',
  r: '\r',
  0: '\0',
  '"': '"',
  '\\': '\\',
  '/': '/',
  ' ': ' ',
  e: '\x1b',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
  N: '\u0085',
  _: ' ',
};

/** Parse one YAML scalar written on a single line. */
function parseScalar(raw, where, { flow = false } = {}) {
  let s = raw
    .trim()
    .replace(/^!\S*\s*/, '')
    .replace(/^&\S+\s*/, '');
  if (!s || s.startsWith('#')) return '';
  if (s.startsWith('*')) throw new ToolError(`${where} is a YAML alias. Read it by hand.`);
  if (/^[|>]/.test(s)) throw new ToolError(`${where} is a multi-line block. Read it by hand.`);
  if (/^[[{]/.test(s))
    throw new ToolError(`${where} is a list or mapping, not text. Read it by hand.`);
  const afterQuote = (rest) => {
    const tail = rest.trim();
    if (tail && !tail.startsWith('#') && !(flow && /^[,}]/.test(tail))) {
      throw new ToolError(`${where} has text after its closing quote. Read it by hand.`);
    }
  };
  if (s.startsWith('"')) {
    let value = '';
    for (let i = 1; i < s.length; i++) {
      const c = s[i];
      if (c === '"') {
        afterQuote(s.slice(i + 1));
        return value;
      }
      if (c !== '\\') {
        value += c;
        continue;
      }
      const e = s[++i];
      if (e in SIMPLE_ESCAPES) value += SIMPLE_ESCAPES[e];
      else if (e === 'x' || e === 'u' || e === 'U') {
        const len = { x: 2, u: 4, U: 8 }[e];
        const hex = s.slice(i + 1, i + 1 + len);
        if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex))
          throw new ToolError(`${where} has a bad escape. Read it by hand.`);
        value += String.fromCodePoint(parseInt(hex, 16));
        i += len;
      } else throw new ToolError(`${where} has a bad escape. Read it by hand.`);
    }
    throw new ToolError(`${where} has no closing quote on its line. Read it by hand.`);
  }
  if (s.startsWith("'")) {
    let value = '';
    for (let i = 1; i < s.length; i++) {
      if (s[i] !== "'") value += s[i];
      else if (s[i + 1] === "'") {
        value += "'";
        i++;
      } else {
        afterQuote(s.slice(i + 1));
        return value;
      }
    }
    throw new ToolError(`${where} has no closing quote on its line. Read it by hand.`);
  }
  return stripComment(s);
}

/**
 * Scan a flow mapping that opens at text[0]. Returns the index of its closing
 * brace (-1 if it doesn't close) and its top-level entries as key/value text.
 * A quote opens a string only where a scalar starts, so O'Brien stays plain.
 */
function scanFlow(text) {
  const entries = [];
  let current = '';
  let quote = null;
  let depth = 0;
  let atStart = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') {
        current += c + (text[++i] ?? '');
        continue;
      }
      current += c;
      if (c === quote && quote === "'" && text[i + 1] === "'") current += text[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (/\s/.test(c)) {
      if (depth) current += c;
      continue;
    }
    if (atStart && (c === '"' || c === "'")) {
      quote = c;
      atStart = false;
      current += c;
      continue;
    }
    if (c === '{' || c === '[') {
      depth++;
      if (depth === 1) {
        atStart = true;
        continue;
      }
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        if (current.trim()) entries.push(current);
        return { end: i, entries: parseEntries(entries) };
      }
    } else if (depth === 1 && c === ',') {
      entries.push(current);
      current = '';
      atStart = true;
      continue;
    }
    current += c;
    atStart = depth === 1 && c === ':' && (i + 1 >= text.length || /\s/.test(text[i + 1]));
  }
  return { end: -1, entries: [] };
}

function parseEntries(entries) {
  return entries
    .map((entry) => entry.trim().match(/^(?:"([^"]*)"|'([^']*)'|([^:]+?))\s*:(?:\s+(.*))?$/s))
    .filter(Boolean)
    .map((m) => ({ key: (m[1] ?? m[2] ?? m[3]).trim(), value: m[4] ?? '' }));
}

const TOP_KEY_RE = /^(?:"([^"]*)"|'([^']*)'|([A-Za-z_][\w.-]*))\s*:(?:\s+(.*))?$/;

function topLevel(text) {
  const lines = text.split(/\r?\n/);
  const top = new Map();
  lines.forEach((line, i) => {
    if (isBlankOrComment(line) || /^\s/.test(line) || /^(---|\.\.\.)(\s|$)/.test(line)) return;
    const m = line.match(TOP_KEY_RE);
    if (!m) return;
    const key = m[1] ?? m[2] ?? m[3];
    if (!top.has(key)) top.set(key, { line: i, rest: (m[4] ?? '').trim() });
  });
  return { lines, top };
}

/** Read parent.child from a top-level mapping, in block or flow form. */
function mappingValue(doc, parent, child) {
  const where = `${parent}.${child}`;
  const entry = doc.top.get(parent);
  if (!entry) return undefined;
  const rest = entry.rest.replace(/^!\S*\s*/, '').replace(/^&\S+\s*/, '');
  if (rest.startsWith('*'))
    throw new ToolError(`${parent} is a YAML alias. Read ${where} by hand.`);
  if (rest.startsWith('{')) {
    let flow = rest;
    let scan = scanFlow(flow);
    for (let i = entry.line + 1; scan.end < 0 && i < doc.lines.length; i++) {
      flow += ` ${doc.lines[i].trim()}`;
      scan = scanFlow(flow);
    }
    if (scan.end < 0)
      throw new ToolError(`${parent} has an unbalanced flow mapping. Read ${where} by hand.`);
    const found = scan.entries.find((e) => e.key === child);
    return found ? parseScalar(found.value, where, { flow: true }) : undefined;
  }
  if (stripComment(rest)) throw new ToolError(`${parent} isn't a mapping. Read ${where} by hand.`);
  let childIndent = -1;
  for (let i = entry.line + 1; i < doc.lines.length; i++) {
    const line = doc.lines[i];
    if (isBlankOrComment(line)) continue;
    const indent = indentOf(line);
    if (indent === 0) break;
    if (childIndent < 0) childIndent = indent;
    if (indent !== childIndent) continue;
    const m = line.slice(indent).match(TOP_KEY_RE);
    if (!m || (m[1] ?? m[2] ?? m[3]) !== child) continue;
    const value = parseScalar(m[4] ?? '', where);
    const next = doc.lines.slice(i + 1).find((l) => !isBlankOrComment(l));
    if (next && indentOf(next) > indent)
      throw new ToolError(`${where} spans several lines. Read it by hand.`);
    return value;
  }
  return undefined;
}

const shellQuote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

function facts(text) {
  const notes = [];
  let name;
  let url;
  let variant;
  if (text.trim().startsWith('{')) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new ToolError('The file looks like JSON but does not parse. Read the values by hand.');
    }
    name = obj?.identity?.name;
    url = obj?.meta?.url;
    variant = obj?.variant;
  } else {
    const doc = topLevel(text);
    name = mappingValue(doc, 'identity', 'name');
    url = mappingValue(doc, 'meta', 'url');
    const v = doc.top.get('variant');
    variant = v ? parseScalar(v.rest, 'variant') : undefined;
  }
  if (typeof name !== 'string' || !name.trim()) {
    throw new ToolError(
      'identity.name is missing or empty, so the identity check has nothing to look for. Stop and ask the owner.',
    );
  }
  if (/[\r\n]/.test(name))
    throw new ToolError('identity.name spans several lines. Read it by hand.');
  let origin = '';
  if (!url) notes.push('meta.url is not set, so ORIGIN is empty.');
  else {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') origin = parsed.origin;
      else notes.push('meta.url is not an http or https URL, so ORIGIN is empty.');
    } catch {
      notes.push('meta.url is not a URL, so ORIGIN is empty.');
    }
  }
  if (variant === undefined || variant === '') {
    variant = 'editorial';
    notes.push('variant is not set; the schema default is editorial.');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(variant)))
    throw new ToolError(`variant "${variant}" is not a variant slug.`);
  return {
    text: [
      `NAME=${shellQuote(name.trim())}`,
      `ORIGIN=${shellQuote(origin)}`,
      `VARIANT=${shellQuote(variant)}`,
    ].join('\n'),
    notes,
  };
}

// ---------------------------------------------------------------------------
// Access-log exposure counts

const BUCKETS = ['/admin', '/variants', '/api/portfolio', '/api/variant', '/api/customize'];
const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const COMBINED = /^\S+ \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3})\b/;
// The user agent check-containment.mjs sends (its USER_AGENT), so an earlier run's probes can be told apart.
const CHECK_AGENT = 'check-containment (keyurgolani.name #21)';
const TIME_KEYS = [
  'ts',
  'StartUTC',
  'time',
  'timestamp',
  '@timestamp',
  'time_iso8601',
  'time_local',
  'msec',
  'start_time',
];
const TARGET_KEYS = ['RequestPath', 'uri', 'request_uri', 'path', 'url'];
const STATUS_KEYS = [
  'status',
  'DownstreamStatus',
  'OriginStatus',
  'status_code',
  'response_status',
];

/** Path only, percent-decoded once, lowercased, with dot segments and repeated slashes resolved. */
function normalizePath(target) {
  let p = String(target);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      return null;
    }
  }
  p = p.split(/[?#]/)[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    p = p.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  const parts = [];
  for (const seg of p.toLowerCase().split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join('/')}`;
}

function bucketOf(path) {
  if (path === '/admin' || path.startsWith('/admin/')) return '/admin';
  return BUCKETS.includes(path) ? path : null;
}

function parseCombinedTime(value) {
  const m = value.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/);
  const month = m && MONTHS[m[2].toLowerCase()];
  if (month === undefined || month === null) return NaN;
  const utc = Date.UTC(+m[3], month, +m[1], +m[4], +m[5], +m[6]);
  return utc - (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) * 60_000;
}

/** Epoch numbers in seconds, milliseconds, microseconds, or nanoseconds, told apart by size. */
function epochToMs(x) {
  const a = Math.abs(x);
  if (a < 1e11) return x * 1000;
  if (a < 1e14) return x;
  if (a < 1e17) return x / 1000;
  return x / 1e6;
}

function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? epochToMs(value) : NaN;
  if (typeof value !== 'string') return NaN;
  const s = value.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return epochToMs(Number(s));
  const combined = parseCombinedTime(s);
  if (Number.isFinite(combined)) return combined;
  return Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
}

/** Whether any string inside value, other than the skipped ones, contains the check script's agent. */
function mentionsAgent(value, skip) {
  if (typeof value === 'string') return !skip.has(value) && value.includes(CHECK_AGENT);
  if (Array.isArray(value)) return value.some((v) => mentionsAgent(v, skip));
  if (value && typeof value === 'object')
    return Object.values(value).some((v) => mentionsAgent(v, skip));
  return false;
}

/** Classify one access-log line: a request, another kind of log line, or unreadable. */
function parseEntry(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('{')) {
    let o;
    try {
      o = JSON.parse(trimmed);
    } catch {
      return { kind: 'unknown' };
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { kind: 'unknown' };
    let method;
    let target;
    let requestLine = null;
    if (o.request && typeof o.request === 'object') {
      method = o.request.method;
      target = o.request.uri;
    } else if (typeof o.request === 'string') {
      requestLine = o.request;
      const m = o.request.match(/^(\S+)\s+(\S+)/);
      if (m) [, method, target] = m;
    }
    method ??= o.RequestMethod ?? o.method ?? o.request_method;
    target ??= TARGET_KEYS.map((k) => o[k]).find((v) => typeof v === 'string' && v);
    if (!method && !target && requestLine === null) return { kind: 'other' };
    if (!method || !target) return { kind: 'unknown' };
    const time = parseTime(
      TIME_KEYS.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== ''),
    );
    const status = Number(
      STATUS_KEYS.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== ''),
    );
    const skip = new Set([String(target), ...(requestLine === null ? [] : [requestLine])]);
    return {
      kind: 'request',
      time,
      method: String(method).toUpperCase(),
      target: String(target),
      status,
      ours: mentionsAgent(o, skip),
    };
  }
  const m = trimmed.match(COMBINED);
  if (!m) return { kind: 'unknown' };
  // The first quoted field is the request line; the agent can sit in any later one.
  const quoted = [...trimmed.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((q) => q[1]);
  return {
    kind: 'request',
    time: parseCombinedTime(m[1]),
    method: m[2].toUpperCase(),
    target: m[3],
    status: Number(m[4]),
    ours: quoted.slice(1).some((q) => q.includes(CHECK_AGENT)),
  };
}

function exposure(text, before) {
  const rows = new Map();
  const tally = { read: 0, requests: 0, other: 0, unknown: 0, late: 0, untimed: 0, ours: 0 };
  let first = Infinity;
  let last = -Infinity;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    tally.read++;
    const e = parseEntry(line);
    if (e.kind === 'other') {
      tally.other++;
      continue;
    }
    if (e.kind === 'unknown') {
      tally.unknown++;
      continue;
    }
    tally.requests++;
    if (!Number.isFinite(e.time)) {
      tally.untimed++;
      continue;
    }
    if (before !== null && e.time >= before * 1000) {
      tally.late++;
      continue;
    }
    first = Math.min(first, e.time);
    last = Math.max(last, e.time);
    const path = normalizePath(e.target);
    const bucket = path && bucketOf(path);
    if (!bucket) continue;
    if (e.ours) tally.ours++;
    const day = new Date(e.time).toISOString().slice(0, 10);
    const key = `${day} ${bucket} ${e.method}`;
    const row = rows.get(key) ?? {
      day,
      bucket,
      method: e.method,
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0,
      other: 0,
    };
    const cls = e.status >= 200 && e.status < 600 ? `${Math.floor(e.status / 100)}xx` : 'other';
    row[cls]++;
    rows.set(key, row);
  }
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const unreadable = tally.unknown + tally.untimed;
  const out = [];
  if (unreadable) out.push(`counts incomplete: ${plural(unreadable, 'line')} could not be read`);
  out.push(
    `read ${plural(tally.read, 'line')}: ${plural(tally.requests, 'request')}, ${plural(tally.other, 'other log line')}, ${tally.unknown} not recognized`,
    `not counted: ${tally.late} at or after the start time, ${tally.untimed} without a usable time`,
    Number.isFinite(first)
      ? `counted requests run from ${day(first)} to ${day(last)} (UTC)`
      : 'no dated requests before the start time',
    `${tally.ours} of the counted requests carry check-containment's user agent, so an earlier run of this check sent them`,
  );
  const sorted = [...rows.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) ||
      a.method.localeCompare(b.method),
  );
  if (!sorted.length) out.push(`no requests to ${BUCKETS.join(', ')}`);
  else {
    out.push('date        path            method  2xx  3xx  4xx  5xx  other');
    for (const r of sorted) {
      out.push(
        [
          r.day.padEnd(10),
          r.bucket.padEnd(14),
          r.method.padEnd(6),
          ...['2xx', '3xx', '4xx', '5xx'].map((c) => String(r[c]).padStart(3)),
          String(r.other).padStart(5),
        ].join('  '),
      );
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------

/** Parse --flag value and --flag=value options. Unknown flags and stray arguments are errors. */
function parseArgs(args, { flags = {}, positional = 0 }) {
  const values = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-') && arg.length > 1) {
      const eq = arg.indexOf('=');
      const name = eq < 0 ? arg : arg.slice(0, eq);
      const spec = flags[name];
      if (!spec) throw new UsageError(`Unknown option ${name}`);
      const value = eq < 0 ? args[++i] : arg.slice(eq + 1);
      if (value === undefined || value === '') throw new UsageError(`${name} needs a value`);
      if (value.startsWith('--')) throw new UsageError(`${name} needs a value, not another option`);
      if (spec.pattern && !spec.pattern.test(value))
        throw new UsageError(`${name} takes ${spec.what}`);
      if (spec.repeat) (values[name] ??= []).push(value);
      else if (Object.hasOwn(values, name)) throw new UsageError(`${name} given twice`);
      else values[name] = value;
    } else rest.push(arg);
  }
  if (rest.length !== positional) {
    throw new UsageError(
      rest.length > positional ? `Unexpected argument ${rest[positional]}` : 'Missing argument',
    );
  }
  return { values, rest };
}

const NUMBER = { pattern: /^\d+$/, what: 'a whole number' };

const COMMANDS = {
  'compose-facts': {
    spec: { flags: { '--service': {}, '--expect-image': {}, '--expect-read-only': {} } },
    run({ values }) {
      if ((values['--expect-image'] || values['--expect-read-only']) && !values['--service']) {
        throw new UsageError('--expect-image and --expect-read-only need --service');
      }
      const { text, failures } = composeFacts(readStdin(), {
        service: values['--service'],
        expectImage: values['--expect-image'],
        expectReadOnly: values['--expect-read-only'],
      });
      console.log(text);
      if (failures.length) throw new ToolError(`Check failed: ${failures.join('; ')}.`);
      return 0;
    },
  },
  'compose-locate': {
    spec: { flags: { '--service': {}, '--target': {} } },
    run({ values }) {
      if (!values['--service']) throw new UsageError('compose-locate needs --service');
      console.log(
        composeLocate(readStdin(), {
          service: values['--service'],
          target: values['--target'] ?? DEFAULT_TARGET,
        }),
      );
      return 0;
    },
  },
  'compose-edit': {
    spec: { flags: { '--service': {}, '--image': {}, '--target': {} } },
    run({ values }) {
      if (!values['--service'] || !values['--image'])
        throw new UsageError('compose-edit needs --service and --image');
      const { text, changes } = composeEdit(readStdin(), {
        service: values['--service'],
        image: values['--image'],
        target: values['--target'] ?? DEFAULT_TARGET,
      });
      process.stdout.write(text);
      console.error(changes.join('\n'));
      return 0;
    },
  },
  'compose-diff': {
    spec: { flags: { '--target': {} } },
    run({ values }) {
      const { text, unexpected } = composeDiff(readStdin(), values['--target'] ?? DEFAULT_TARGET);
      console.log(text);
      return unexpected ? 1 : 0;
    },
  },
  'config-check': {
    spec: { flags: { '--exit': NUMBER } },
    run({ values }) {
      if (values['--exit'] === undefined) throw new UsageError('config-check needs --exit');
      const { text, ok } = configCheck(readStdin(), Number(values['--exit']));
      console.log(text);
      return ok ? 0 : 1;
    },
  },
  'validate-check': {
    spec: { flags: { '--exit': NUMBER } },
    run({ values }) {
      if (values['--exit'] === undefined) throw new UsageError('validate-check needs --exit');
      const { text, ok } = validateCheck(readStdin(), Number(values['--exit']));
      console.log(text);
      return ok ? 0 : 1;
    },
  },
  'proxy-lines': {
    spec: { positional: 1 },
    run({ rest: [kind] }) {
      if (kind === 'caddy') console.log(caddyLines(readStdin()));
      else if (kind === 'nginx') console.log(nginxLines(readStdin()));
      else throw new UsageError('proxy-lines needs caddy or nginx');
      return 0;
    },
  },
  'proxy-insert': {
    spec: { flags: { '--rule': {}, '--after': { ...NUMBER, repeat: true } } },
    run({ values }) {
      if (!values['--rule'] || !values['--after'])
        throw new UsageError('proxy-insert needs --rule and at least one --after');
      let rule;
      try {
        rule = readFileSync(values['--rule'], 'utf8');
      } catch {
        throw new ToolError('Could not read the rule file.');
      }
      process.stdout.write(proxyInsert(readStdin(), rule, values['--after'].map(Number)));
      return 0;
    },
  },
  'ports-same': {
    spec: { positional: 2 },
    run({ rest: [before, after] }) {
      const { same, text } = portsSame(before, after);
      console.log(text);
      return same ? 0 : 1;
    },
  },
  facts: {
    spec: {},
    run() {
      const { text, notes } = facts(readStdin());
      console.log(text);
      for (const note of notes) console.error(note);
      return 0;
    },
  },
  exposure: {
    spec: { flags: { '--before': { pattern: /^\d+$/, what: 'epoch seconds' } } },
    run({ values }) {
      console.log(
        exposure(readStdin(), values['--before'] === undefined ? null : Number(values['--before'])),
      );
      return 0;
    },
  },
};

function main([command, ...args]) {
  if (command === '-h' || command === '--help') {
    console.log(USAGE);
    return 0;
  }
  const entry = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : null;
  if (!entry) throw new UsageError(command ? `Unknown command ${command}` : 'Missing command');
  return entry.run(parseArgs(args, entry.spec));
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`${err.message}\n${USAGE}`);
    process.exitCode = 2;
  } else if (err instanceof ToolError) {
    console.error(err.message);
    process.exitCode = 1;
  } else throw err;
}
