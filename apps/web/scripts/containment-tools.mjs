#!/usr/bin/env node
/**
 * containment-tools.mjs: read-only helpers for the interim containment prompt
 * (docs/operations/interim-containment.md, issue #21). Every subcommand reads
 * stdin and prints only what the prompt needs, so secrets in Compose files,
 * proxy configs, and access logs never reach the screen.
 *
 *   compose-lines                 Allowlisted lines of a Compose file, numbered.
 *   proxy-lines caddy|nginx       Allowlisted lines of a proxy config, numbered.
 *   compose-edit --service <name> --image <ref> [--target <path>]
 *                                 Writes the Compose file to stdout with that
 *                                 service's image replaced and the mount at
 *                                 <path> (default /data/portfolio.yml) made
 *                                 read-only. Names the changed lines on stderr.
 *   compose-diff                  Filters `diff -U0 old new` output. Exits 1 if
 *                                 a changed line isn't an image line, the
 *                                 portfolio mount, or read_only.
 *   facts                         Prints NAME, ORIGIN, and VARIANT from a
 *                                 portfolio file as shell assignments.
 *   exposure [--before <epoch>]   Counts access-log requests to the authoring
 *                                 paths by day, method, and status class.
 *
 * Needs Node 22 or newer and nothing else. Exit codes: 0 ok, 1 the input
 * can't be handled safely (the message says why), 2 bad arguments.
 */
import { readFileSync } from 'node:fs';

class ToolError extends Error {}
class UsageError extends Error {}

const USAGE = `Usage: node containment-tools.mjs <command> [options] < input
  compose-lines
  proxy-lines caddy|nginx
  compose-edit --service <name> --image <ref> [--target /data/portfolio.yml]
  compose-diff
  facts
  exposure [--before <epoch seconds>]`;

const readStdin = () => readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
const indentOf = (line) => line.length - line.trimStart().length;
const isBlankOrComment = (line) => !line.trim() || line.trimStart().startsWith('#');
const numbered = (n, text) => `${String(n).padStart(4)}: ${text}`;

/** Drop a trailing ` # comment` from an unquoted YAML or config value. */
function stripComment(value) {
  return value.replace(/(^|\s)#.*$/, '').trimEnd();
}

/** Hide the user and password part of any URL, such as a Git build context with a token. */
const maskCredentials = (text) => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, '$1<credentials not shown>@');

// ---------------------------------------------------------------------------
// Compose files

/** Keys whose values print. Any other key prints its name only. */
const COMPOSE_VALUE_KEYS = new Set([
  'image', 'container_name', 'restart', 'context', 'dockerfile', 'target', 'source', 'type',
  'read_only', 'published', 'protocol', 'mode', 'external', 'name', 'driver', 'path',
  'required', 'network_mode', 'pull_policy', 'user', 'working_dir', 'create_host_path',
  'host_ip', 'app_protocol', 'extends', 'condition',
]);
/** Keys whose value and list items print in full. */
const COMPOSE_LIST_KEYS = new Set(['ports', 'volumes', 'env_file', 'networks', 'depends_on', 'profiles', 'aliases']);
/** Blocks whose entries print as names only, because their values are where secrets live. */
const COMPOSE_NAME_BLOCKS = new Set(['environment', 'labels', 'args', 'driver_opts', 'options']);

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
  return { indent, itemIndent, contentIndent, key: (m[1] ?? m[2] ?? m[3]).trim(), value: (m[4] ?? '').trim() };
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
      stack.push({ indent: parsed.contentIndent, key: parsed.key, open: value === '' || /^&\S+$/.test(value) });
    }
  }
  return lines;
}

function composeLines(text) {
  const out = [];
  let hidden = 0;
  walkYaml(text, (n, line, info) => {
    if (info.scalar) {
      hidden++;
      return;
    }
    const keys = info.path.filter((k) => k !== '-');
    const parent = keys[keys.length - 1];
    const inNameBlock = COMPOSE_NAME_BLOCKS.has(parent);
    const lead = info.isItem ? `${' '.repeat(info.itemIndent)}- ` : ' '.repeat(info.indent);
    const show = (text) => out.push(numbered(n, `${lead}${maskCredentials(text)}`));
    if (info.key !== null) {
      const value = stripComment(info.value);
      const printable =
        !inNameBlock &&
        !/^[|>&*!]/.test(value) &&
        (COMPOSE_VALUE_KEYS.has(info.key) || COMPOSE_LIST_KEYS.has(info.key));
      if (!value) show(`${info.key}:`);
      else if (printable) show(`${info.key}: ${value}`);
      else {
        show(`${info.key}: <value not shown>`);
        hidden++;
      }
      return;
    }
    if (inNameBlock) {
      // Print the name only: everything up to the first `=`, `:`, or space.
      const entry = stripComment(info.value).replace(/^["']|["']$/g, '');
      const name = entry.match(/^[^=:\s]*/)[0];
      if (name === entry) show(name);
      else {
        show(`${name}${entry[name.length] === '=' ? '=' : ' '}<value not shown>`);
        hidden++;
      }
    } else if (COMPOSE_LIST_KEYS.has(parent)) show(stripComment(info.value));
    else {
      show('<value not shown>');
      hidden++;
    }
  });
  out.push(`(${hidden} values not shown)`);
  return out.join('\n');
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

function composeEdit(text, { service, image, target }) {
  if (!/^[\w./:@-]+$/.test(image)) throw new ToolError(`The image reference has unexpected characters: ${image}`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const records = [];
  const lines = walkYaml(text, (n, line, info) => records.push({ n, ...info }));
  const svc = records.find(
    (r) => !r.scalar && !r.isItem && r.key === service && r.path.length === 1 && r.path[0] === 'services',
  );
  if (!svc) throw new ToolError(`No service "${service}" under services: in this file.`);
  const end = records.find((r) => r.n > svc.n && !r.scalar && r.indent <= svc.indent);
  const block = records.filter((r) => r.n > svc.n && (!end || r.n < end.n) && !r.scalar);
  const children = block.filter((r) => !r.isItem && r.key !== null && r.path.length === 2);
  if (!children.length) throw new ToolError(`Service "${service}" has no keys.`);
  for (const key of ['<<', 'extends']) {
    if (children.some((c) => c.key === key)) {
      throw new ToolError(`Service "${service}" uses "${key}", so its image or mounts can come from elsewhere. Ask the owner.`);
    }
  }
  const childIndent = children[0].indent;
  const inserts = [];
  const changes = [];

  const imageLine = children.find((c) => c.key === 'image');
  if (imageLine) {
    if (/^[&*]/.test(imageLine.value)) throw new ToolError('The image line uses a YAML anchor or alias. Ask the owner.');
    lines[imageLine.n - 1] = `${' '.repeat(childIndent)}image: ${image}`;
    changes.push(`image: line ${imageLine.n} replaced`);
  } else {
    inserts.push({ after: svc.n, text: `${' '.repeat(childIndent)}image: ${image}` });
    changes.push(`image: inserted after line ${svc.n}`);
  }

  const volumes = children.find((c) => c.key === 'volumes');
  if (!volumes) throw new ToolError(`Service "${service}" has no volumes, so nothing mounts ${target}.`);
  if (stripComment(volumes.value)) throw new ToolError('The volumes list is written inline or by reference. Ask the owner.');
  const inVolumes = block.filter((r) => r.n > volumes.n && r.path[2] === 'volumes' && r.path.length >= 4);
  const items = inVolumes.filter((r) => r.isItem && r.path.length === 4);
  let mountChange = null;
  for (const item of items) {
    if (item.key === null) {
      const result = readOnlySpec(stripComment(item.value), target);
      if (!result) continue;
      lines[item.n - 1] = `${' '.repeat(item.itemIndent)}- ${result.spec}`;
      mountChange = `mount: line ${item.n} set read-only (was ${result.was})`;
      break;
    }
    const next = items.find((r) => r.n > item.n);
    const fields = inVolumes.filter((r) => r.n >= item.n && (!next || r.n < next.n) && r.key !== null && r.path.length === 4);
    const unquote = (v) => stripComment(v).replace(/^["']|["']$/g, '');
    const targetField = fields.find((f) => f.key === 'target' && unquote(f.value) === target);
    if (!targetField) continue;
    const readOnly = fields.find((f) => f.key === 'read_only');
    if (readOnly) {
      lines[readOnly.n - 1] = readOnly.isItem
        ? `${' '.repeat(readOnly.itemIndent)}- read_only: true`
        : `${' '.repeat(readOnly.indent)}read_only: true`;
      mountChange = `mount: line ${readOnly.n} set to read_only: true`;
    } else {
      inserts.push({ after: targetField.n, text: `${' '.repeat(targetField.contentIndent)}read_only: true` });
      mountChange = `mount: read_only: true inserted after line ${targetField.n}`;
    }
    break;
  }
  if (!mountChange) throw new ToolError(`No mount in service "${service}" targets ${target}.`);
  changes.push(mountChange);

  for (const ins of inserts.sort((a, b) => b.after - a.after)) lines.splice(ins.after, 0, ins.text);
  return { text: lines.join(eol), changes };
}

const DIFF_ALLOWED = [
  /^\s*image:\s*\S+\s*$/,
  /^\s*-\s*["']?[^\s"']*:\/data\/portfolio\.yml(:[a-z,]+)?["']?\s*$/,
  /^\s*(-\s*)?target:\s*["']?\/data\/portfolio\.yml["']?\s*$/,
  /^\s*(-\s*)?read_only:\s*(true|false)\s*$/,
];

function composeDiff(text) {
  const out = [];
  let unexpected = 0;
  let inHunks = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      inHunks = true;
      out.push(line);
    } else if (!inHunks && (line.startsWith('---') || line.startsWith('+++'))) {
      out.push(line);
    } else if (line.startsWith('-') || line.startsWith('+')) {
      if (DIFF_ALLOWED.some((re) => re.test(line.slice(1)))) out.push(line);
      else {
        out.push(`${line[0]} <changed line not shown>`);
        unexpected++;
      }
    } else if (line.startsWith('\\')) out.push(line);
  }
  out.push(
    unexpected
      ? `${unexpected} changed lines are not the image, the portfolio mount, or read_only`
      : 'only the image and portfolio mount lines changed',
  );
  return { text: out.join('\n'), unexpected };
}

// ---------------------------------------------------------------------------
// Proxy configs

// Directives that route requests or say where logs go. Anything else (headers,
// auth, TLS, rewrites that can carry a key upstream) prints as hidden.
const CADDY_DIRECTIVES = new Set([
  'reverse_proxy', 'handle', 'handle_path', 'route', 'respond', 'redir', 'root', 'file_server',
  'encode', 'log', 'output', 'format', 'import', 'bind', 'abort', 'error', 'try_files', 'to',
  'skip_log', 'log_skip', 'auto_https', 'http_port', 'https_port',
]);
const CADDY_MATCHERS = new Set(['path', 'path_regexp', 'method', 'host', 'protocol']);
const NGINX_DIRECTIVES = new Set([
  'http', 'server', 'listen', 'server_name', 'location', 'proxy_pass', 'return', 'access_log',
  'error_log', 'include', 'root', 'alias', 'try_files', 'upstream', 'index', 'events',
]);

function proxyLines(text, kind) {
  const caddy = kind === 'caddy';
  const out = [];
  const stack = []; // 'block' or 'matcher' for each printed open block
  let hiddenDepth = 0;
  let hidden = 0;
  let seenContent = false;
  let braceless = false; // a Caddyfile with one site and no braces around its directives
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      if (!hiddenDepth && trimmed.includes('kgn-21 containment')) out.push(numbered(n, raw.trimEnd()));
      else hidden++;
      return;
    }
    const line = stripComment(raw);
    const body = line.trim();
    const opens = /(^|\s)\{$/.test(body);
    const closes = body.startsWith('}') && !opens;
    const firstLine = !seenContent;
    seenContent = true;
    if (hiddenDepth) {
      if (opens) hiddenDepth++;
      if (closes) hiddenDepth--;
      hidden++;
      return;
    }
    if (closes) {
      stack.pop();
      out.push(numbered(n, line));
      return;
    }
    const pad = raw.slice(0, indentOf(raw));
    const tokens = body.replace(/\s*[{;]$/, '').trim().split(/\s+/);
    const first = tokens[0] ?? '';
    let show;
    let blockKind = 'block';
    if (!caddy) {
      show = NGINX_DIRECTIVES.has(first);
    } else if (firstLine && !opens && first !== 'import') {
      // A site address on its own line: the directives below it have no braces.
      braceless = true;
      show = true;
    } else if (!stack.length && !braceless && (opens || first === 'import')) {
      // Top level: global options, snippets, imports, and site addresses.
      show = true;
    } else if (first.startsWith('@')) {
      const type = tokens[1];
      if (opens && tokens.length === 1) {
        show = true;
        blockKind = 'matcher';
      } else if (CADDY_MATCHERS.has(type) || (type === 'not' && CADDY_MATCHERS.has(tokens[2]))) {
        show = true;
      } else {
        out.push(numbered(n, `${pad}${first} <matcher not shown>`));
        hidden++;
        if (opens) hiddenDepth = 1;
        return;
      }
    } else if (stack[stack.length - 1] === 'matcher') {
      show = CADDY_MATCHERS.has(first) || (first === 'not' && CADDY_MATCHERS.has(tokens[1]));
    } else {
      show = CADDY_DIRECTIVES.has(first);
    }
    if (!show) {
      hidden++;
      if (opens) {
        out.push(numbered(n, `${pad}${first} { <block not shown> }`));
        hiddenDepth = 1;
      }
      return;
    }
    if (caddy && first === 'import' && tokens.length > 2) {
      // Snippet arguments can carry credentials.
      out.push(numbered(n, `${pad}import ${tokens[1]} <arguments not shown>${opens ? ' {' : ''}`));
      hidden++;
    } else out.push(numbered(n, maskCredentials(line)));
    if (opens) stack.push(blockKind);
  });
  out.push(`(${hidden} lines not shown)`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Portfolio facts

const SIMPLE_ESCAPES = {
  n: '\n', t: '\t', r: '\r', 0: '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ',
  e: '\x1b', a: '\x07', b: '\b', f: '\f', v: '\v', N: '\u0085', _: ' ',
};

/** Parse one YAML scalar written on a single line. */
function parseScalar(raw, where, { flow = false } = {}) {
  let s = raw.trim().replace(/^!\S*\s*/, '').replace(/^&\S+\s*/, '');
  if (!s || s.startsWith('#')) return '';
  if (s.startsWith('*')) throw new ToolError(`${where} is a YAML alias. Read it by hand.`);
  if (/^[|>]/.test(s)) throw new ToolError(`${where} is a multi-line block. Read it by hand.`);
  if (/^[[{]/.test(s)) throw new ToolError(`${where} is a list or mapping, not text. Read it by hand.`);
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
        if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex)) throw new ToolError(`${where} has a bad escape. Read it by hand.`);
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
  if (rest.startsWith('*')) throw new ToolError(`${parent} is a YAML alias. Read ${where} by hand.`);
  if (rest.startsWith('{')) {
    let flow = rest;
    let scan = scanFlow(flow);
    for (let i = entry.line + 1; scan.end < 0 && i < doc.lines.length; i++) {
      flow += ` ${doc.lines[i].trim()}`;
      scan = scanFlow(flow);
    }
    if (scan.end < 0) throw new ToolError(`${parent} has an unbalanced flow mapping. Read ${where} by hand.`);
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
    if (next && indentOf(next) > indent) throw new ToolError(`${where} spans several lines. Read it by hand.`);
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
    throw new ToolError('identity.name is missing or empty, so the identity check has nothing to look for. Stop and ask the owner.');
  }
  if (/[\r\n]/.test(name)) throw new ToolError('identity.name spans several lines. Read it by hand.');
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
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(variant))) throw new ToolError(`variant "${variant}" is not a variant slug.`);
  return {
    text: [`NAME=${shellQuote(name.trim())}`, `ORIGIN=${shellQuote(origin)}`, `VARIANT=${shellQuote(variant)}`].join('\n'),
    notes,
  };
}

// ---------------------------------------------------------------------------
// Access-log exposure counts

const BUCKETS = ['/admin', '/variants', '/api/portfolio', '/api/variant', '/api/customize'];
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const COMBINED = /^\S+ \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3})\b(?:.*"([^"]*)"\s*$)?/;
// The user agent check-containment.mjs sends, so an earlier run's probes can be told apart.
const CHECK_AGENT = 'check-containment (keyurgolani.name #21)';

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

function parseTime(value) {
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  if (typeof value !== 'string') return NaN;
  if (/^\d+(\.\d+)?$/.test(value)) return parseTime(Number(value));
  return Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
}

/** Time, method, path, and status of one access-log line, or null. */
function parseEntry(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('{')) {
    let o;
    try {
      o = JSON.parse(trimmed);
    } catch {
      return null;
    }
    const req = typeof o.request === 'object' && o.request ? o.request : {};
    const method = req.method ?? o.RequestMethod ?? o.method ?? o.request_method;
    const target = req.uri ?? o.RequestPath ?? o.uri ?? o.path ?? o.request_uri ?? o.url;
    if (!method || !target) return null;
    const status = Number(o.status ?? o.DownstreamStatus ?? o.OriginStatus ?? o.status_code);
    const headers = typeof req.headers === 'object' && req.headers ? req.headers : {};
    const agent = [headers['User-Agent'], o['request_User-Agent'], o.user_agent, o.http_user_agent].flat().find(Boolean);
    return {
      time: parseTime(o.ts ?? o.StartUTC ?? o.time ?? o.timestamp ?? o['@timestamp']),
      method: String(method).toUpperCase(),
      target,
      status,
      agent: String(agent ?? ''),
    };
  }
  const m = trimmed.match(COMBINED);
  if (!m) return null;
  return { time: parseCombinedTime(m[1]), method: m[2].toUpperCase(), target: m[3], status: Number(m[4]), agent: m[5] ?? '' };
}

function exposure(text, before) {
  const rows = new Map();
  const tally = { read: 0, requests: 0, late: 0, untimed: 0, unknown: 0, ours: 0 };
  let first = Infinity;
  let last = -Infinity;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    tally.read++;
    const e = parseEntry(line);
    if (!e) {
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
    if (e.agent.includes(CHECK_AGENT)) tally.ours++;
    const day = new Date(e.time).toISOString().slice(0, 10);
    const key = `${day} ${bucket} ${e.method}`;
    const row = rows.get(key) ?? { day, bucket, method: e.method, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
    const cls = e.status >= 200 && e.status < 600 ? `${Math.floor(e.status / 100)}xx` : 'other';
    row[cls]++;
    rows.set(key, row);
  }
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const out = [
    `read ${tally.read} lines: ${tally.requests} requests, ${tally.late} at or after the start time (not counted), ` +
      `${tally.untimed} without a usable time (not counted), ${tally.unknown} not recognized as requests`,
    Number.isFinite(first)
      ? `counted requests run from ${day(first)} to ${day(last)} (UTC)`
      : 'no dated requests before the start time',
    `${tally.ours} of the counted requests carry check-containment's user agent, so an earlier run of this check sent them`,
  ];
  const sorted = [...rows.values()].sort(
    (a, b) => a.day.localeCompare(b.day) || BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || a.method.localeCompare(b.method),
  );
  if (!sorted.length) out.push(`no requests to ${BUCKETS.join(', ')}`);
  else {
    out.push('date        path            method  2xx  3xx  4xx  5xx  other');
    for (const r of sorted) {
      out.push(
        [r.day.padEnd(10), r.bucket.padEnd(14), r.method.padEnd(6), ...['2xx', '3xx', '4xx', '5xx'].map((c) => String(r[c]).padStart(3)), String(r.other).padStart(5)].join('  '),
      );
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------

function option(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw new UsageError(`${name} needs a value`);
  return value;
}

function main([command, ...args]) {
  switch (command) {
    case 'compose-lines':
      console.log(composeLines(readStdin()));
      return 0;
    case 'proxy-lines':
      if (args[0] !== 'caddy' && args[0] !== 'nginx') throw new UsageError('proxy-lines needs caddy or nginx');
      console.log(proxyLines(readStdin(), args[0]));
      return 0;
    case 'compose-edit': {
      const service = option(args, '--service');
      const image = option(args, '--image');
      if (!service || !image) throw new UsageError('compose-edit needs --service and --image');
      const { text, changes } = composeEdit(readStdin(), { service, image, target: option(args, '--target') ?? '/data/portfolio.yml' });
      process.stdout.write(text);
      console.error(changes.join('\n'));
      return 0;
    }
    case 'compose-diff': {
      const { text, unexpected } = composeDiff(readStdin());
      console.log(text);
      return unexpected ? 1 : 0;
    }
    case 'facts': {
      const { text, notes } = facts(readStdin());
      console.log(text);
      for (const note of notes) console.error(note);
      return 0;
    }
    case 'exposure': {
      const raw = option(args, '--before');
      if (raw !== undefined && !/^\d+$/.test(raw)) throw new UsageError('--before takes epoch seconds');
      console.log(exposure(readStdin(), raw === undefined ? null : Number(raw)));
      return 0;
    }
    case '-h':
    case '--help':
      console.log(USAGE);
      return 0;
    default:
      throw new UsageError(command ? `Unknown command: ${command}` : 'Missing command');
  }
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
