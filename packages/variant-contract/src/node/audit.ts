// The variant source audit (#5, Slice 3, item 5), which `pnpm check:variants`
// runs over every registered variant: what a variant's code and styles may
// not do, so it renders the same on the server, in #7's preview frame, and in
// #9's browser render, reaches no network or storage, leaves appearance to
// #19's tokens, and stays inside its own [data-variant] scope.
//
// It's a lint over code the host already trusts, not a sandbox: a variant
// installs at build time with full server trust. It reads each file's syntax,
// follows the globals a variant reaches for through aliases, destructuring,
// string keys, and Reflect.get, and refuses what it can't follow, such as a
// computed key or the global object passed around. The clock and randomness
// rules also cover @portfolio/kit/sections and every kit module a variant's
// imports reach.

import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { auditAppearance, auditStylesheet, type CssReport } from './css-audit';

/** Every audit code, with what fixes it. */
export const AUDIT_CODES = {
  'audit.async-component':
    'Render from the input you get: a variant renders synchronously, on the server, in a preview frame, and in a browser.',
  'audit.server-module':
    'A variant runs in browsers too. Use the render input, @portfolio/kit, @portfolio/schema, and @portfolio/variant-contract instead.',
  'audit.environment': 'A variant reads no environment: what it needs is in the render input.',
  'audit.github-fetch':
    "GitHub data reaches a variant as the github section's snapshot in input.derived: read it with githubSnapshot() from @portfolio/kit/sections.",
  'audit.network': 'A variant fetches nothing: everything it renders is in the render input.',
  'audit.storage':
    "A variant keeps nothing in the visitor's browser: the host owns cookies and storage.",
  'audit.clock': 'Use input.env.now, so every render of the same input is the same.',
  'audit.random': 'Use seededRandom(input.env.seed) from @portfolio/kit/sections.',
  'audit.dynamic-code':
    'Ship code as code: eval, Function, and a timer given a string run text no audit reads.',
  'audit.dynamic-import':
    'Import a module by a literal specifier, so the audit can read what loads.',
  'audit.global-access':
    "Reach a global by name, such as window.matchMedia: the audit can't follow a computed key, or the global object passed around.",
  'audit.inner-html':
    'Render markdown with RichText from @portfolio/kit/sections, the one path #10 sanitizes.',
  'audit.raw-element':
    'Render no <style>, <link>, or <script>: styles go in your stylesheet, code in your modules, and the host owns the document head.',
  'audit.css-import':
    'Put the styles in the stylesheet your ./styles.css export names. Registry generation compiles it, and the host links it on the pages that render you.',
  'audit.client-input':
    'Pass a client component only the data it renders, so the rest stays out of the page payload.',
  'audit.css-unscoped':
    'Start every selector with [data-variant="<id>"], and reach only what is inside it, so your styles land on your own page alone.',
  'audit.css-remote-import':
    'Ship the styles in the package, so the page reaches no host outside the app.',
  'audit.css-remote-url':
    'Ship the asset in the package, so the page reaches no host outside the app.',
  'audit.css-bare-import':
    "Import only your own stylesheets, by relative path: another package's CSS skips this audit.",
  'audit.css-keyframes':
    'Name your keyframes after your id, as <id>-name, so no other stylesheet on the page shares the name.',
  'audit.css-physical':
    'Use the logical form, such as margin-inline-start, inset-inline-end, or text-align: start.',
  'audit.css-appearance':
    "Color, type, radius, and shadow are #19's appearance tokens: use var(--...), currentColor, or inherit.",
} as const;

export type AuditCode = keyof typeof AUDIT_CODES;

export interface AuditFinding {
  readonly code: AuditCode;
  readonly package: string;
  /** Relative to the package, with `/` separators. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly remedy: string;
}

export interface AuditTarget {
  readonly packageName: string;
  /** Where it's installed. */
  readonly dir: string;
  /** Its variant id, the scope its CSS must sit under. */
  readonly id: string;
  /** Whether its manifest declares rtl, which brings the physical-CSS rule. */
  readonly rtl: boolean;
  /** Files, relative to the package, that are declared enhancement entries: client modules that get the input by contract. */
  readonly enhancementEntries?: readonly string[];
}

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED_DIRS = new Set(['node_modules', '__fixtures__', '__tests__', 'coverage']);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** A package's source and style files, without tests, fixtures, declarations, or dependencies. */
export function packageFiles(dir: string): { sources: string[]; styles: string[] } {
  const sources: string[] = [];
  const styles: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(full);
      } else if (entry.name.endsWith('.css')) {
        styles.push(full);
      } else if (
        SOURCE.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        !TEST_FILE.test(entry.name)
      ) {
        sources.push(full);
      }
    }
  };
  walk(dir);
  return { sources: sources.sort(), styles: styles.sort() };
}

/** Every finding in one variant package. */
export function auditVariant(target: AuditTarget): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const { sources, styles } = packageFiles(target.dir);
  const relative = (file: string) => path.relative(target.dir, file).split(path.sep).join('/');
  const entries = new Set(target.enhancementEntries ?? []);
  for (const file of sources) {
    const rel = relative(file);
    auditSource(fs.readFileSync(file, 'utf8'), file, {
      rules: 'variant',
      enhancementEntry: entries.has(rel),
      report: (code, at, message) =>
        findings.push(finding(target.packageName, rel, code, at, message)),
    });
  }
  for (const file of styles) {
    const rel = relative(file);
    const report: CssReport = (code, at, message) =>
      findings.push(finding(target.packageName, rel, code, at, message));
    auditStylesheet(fs.readFileSync(file, 'utf8'), { id: target.id, rtl: target.rtl }, report);
  }
  return findings;
}

/** The appearance findings in a shared stylesheet, such as @portfolio/kit/sections/styles.css. */
export function auditSharedStylesheet(
  packageName: string,
  dir: string,
  file: string,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  auditAppearance(fs.readFileSync(path.join(dir, file), 'utf8'), (code, at, message) =>
    findings.push(finding(packageName, file, code, at, message)),
  );
  return findings;
}

/** The @portfolio/kit subpaths a variant's sources import, such as `./sections`, sorted. */
export function kitImports(dir: string): string[] {
  const found = new Set<string>();
  for (const file of packageFiles(dir).sources) {
    const imports = auditSource(fs.readFileSync(file, 'utf8'), file, {
      rules: 'determinism',
      enhancementEntry: false,
      report: () => {},
    });
    for (const specifier of imports) {
      if (specifier === '@portfolio/kit') found.add('.');
      else if (specifier.startsWith('@portfolio/kit/'))
        found.add(`./${specifier.slice('@portfolio/kit/'.length)}`);
    }
  }
  return [...found].sort();
}

/**
 * The clock and randomness findings in a kit entry, such as
 * @portfolio/kit/sections, and each kit module it imports, from `entry`, the
 * subpath's file, within `kitDir`.
 */
export function auditKitSections(kitDir: string, entry: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const seen = new Set<string>();
  const queue = [path.resolve(kitDir, entry)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(kitDir, file).split(path.sep).join('/');
    const imports = auditSource(text, file, {
      rules: 'determinism',
      enhancementEntry: false,
      report: (code, at, message) =>
        findings.push(finding('@portfolio/kit', rel, code, at, message)),
    });
    for (const specifier of imports) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveRelative(path.dirname(file), specifier);
      if (resolved && !path.relative(kitDir, resolved).startsWith('..')) queue.push(resolved);
    }
  }
  return findings;
}

function resolveRelative(dir: string, specifier: string): string | undefined {
  const base = path.resolve(dir, specifier);
  const candidates = [
    base,
    ...['.ts', '.tsx', '.mts', '.js', '.mjs'].map((extension) => `${base}${extension}`),
    ...['index.ts', 'index.tsx', 'index.js'].map((name) => path.join(base, name)),
  ];
  return candidates.find((candidate) => SOURCE.test(candidate) && isFile(candidate));
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function finding(
  packageName: string,
  file: string,
  code: AuditCode,
  at: { line: number; column: number },
  message: string,
): AuditFinding {
  return {
    code,
    package: packageName,
    file,
    line: at.line,
    column: at.column,
    message,
    remedy: AUDIT_CODES[code],
  };
}

type Report = (code: AuditCode, at: { line: number; column: number }, message: string) => void;

interface SourceOptions {
  /** `variant` checks everything; `determinism` only the clock and randomness. */
  readonly rules: 'variant' | 'determinism';
  /** A declared enhancement entry, which gets the render input by contract. */
  readonly enhancementEntry: boolean;
  readonly report: Report;
}

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
/** Types that carry the whole render input or the whole portfolio. */
const WHOLE_INPUT = new Set(['VariantRenderInput', 'PublicPortfolio', 'Portfolio', 'PublicView']);

/** A global a variant reaches, then each member read off it: ['Math', 'random']. */
type GlobalPath = readonly string[];
/** What an expression reaches: a global's path, one the audit can't read, or nothing global. */
type Reach = GlobalPath | 'dynamic' | undefined;

/** The global object, by each of its names: a member of one is the global of that name. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);
/** Globals the audit follows through aliases, destructuring, and string keys. */
const ROOTS = new Set([
  ...GLOBAL_OBJECTS,
  'process',
  'Date',
  'Math',
  'crypto',
  'performance',
  'Intl',
  'Temporal',
  'document',
  'navigator',
  'Reflect',
]);

/** What a global may not be used for, by the path it starts with, longest first. */
const FORBIDDEN: readonly (readonly [GlobalPath, AuditCode, string])[] = [
  [['process', 'getBuiltinModule'], 'audit.server-module', 'loads Node modules'],
  [['process'], 'audit.environment', 'reads the server process'],
  [['fetch'], 'audit.network', 'fetches'],
  [['XMLHttpRequest'], 'audit.network', 'fetches'],
  [['WebSocket'], 'audit.network', 'opens a connection'],
  [['EventSource'], 'audit.network', 'opens a connection'],
  [['WebTransport'], 'audit.network', 'opens a connection'],
  [['navigator', 'sendBeacon'], 'audit.network', 'sends a request'],
  [['localStorage'], 'audit.storage', 'stores in the browser'],
  [['sessionStorage'], 'audit.storage', 'stores in the browser'],
  [['indexedDB'], 'audit.storage', 'stores in the browser'],
  [['cookieStore'], 'audit.storage', 'stores in the browser'],
  [['caches'], 'audit.storage', 'stores in the browser'],
  [['document', 'cookie'], 'audit.storage', 'reads or writes a cookie'],
  [['eval'], 'audit.dynamic-code', 'runs text as code'],
  [['Function'], 'audit.dynamic-code', 'runs text as code'],
  [['Date', 'now'], 'audit.clock', 'reads the clock'],
  [['performance', 'now'], 'audit.clock', 'reads the clock'],
  [['performance', 'timeOrigin'], 'audit.clock', 'reads the clock'],
  [['Temporal', 'Now'], 'audit.clock', 'reads the clock'],
  [['Math', 'random'], 'audit.random', 'draws a random number'],
  [['crypto', 'getRandomValues'], 'audit.random', 'draws random numbers'],
  [['crypto', 'randomUUID'], 'audit.random', 'draws a random id'],
];
/** Globals the audit resolves by name besides the roots: those FORBIDDEN starts with, and the timers. */
const NAMED = new Set([
  ...FORBIDDEN.map(([[head]]) => head!).filter((head) => !ROOTS.has(head)),
  'setTimeout',
  'setInterval',
]);
/** Elements the host owns: a variant renders none of them. */
const RAW_ELEMENTS = new Set(['style', 'link', 'script']);
/** Calls that create an element from a tag name. */
const ELEMENT_FACTORIES = new Set(['createElement', 'jsx', 'jsxs', 'jsxDEV', '_jsx', '_jsxs']);

/** A global path without the global object it was read through: window.fetch is fetch. */
function normal(globalPath: GlobalPath): GlobalPath {
  let start = 0;
  while (start < globalPath.length - 1 && GLOBAL_OBJECTS.has(globalPath[start]!)) start++;
  return globalPath.slice(start);
}

function forbiddenUse(globalPath: GlobalPath): readonly [AuditCode, string] | undefined {
  for (const [prefix, code, what] of FORBIDDEN) {
    if (prefix.every((part, index) => globalPath[index] === part)) return [code, what];
  }
  return undefined;
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.[cm]?tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** Why a module specifier is out of bounds, or undefined when a variant may import it. */
function forbiddenSpecifier(specifier: string): readonly [AuditCode, string] | undefined {
  if (
    specifier.startsWith('node:') ||
    BUILTINS.has(specifier) ||
    BUILTINS.has(specifier.split('/')[0]!)
  ) {
    return ['audit.server-module', `imports ${specifier}, a Node module.`];
  }
  if (specifier === 'server-only') return ['audit.server-module', 'imports server-only.'];
  if (specifier === 'next' || specifier.startsWith('next/')) {
    return ['audit.server-module', `imports ${specifier}, part of the host's framework.`];
  }
  if (specifier === '@portfolio/core' || specifier.startsWith('@portfolio/core/')) {
    return ['audit.server-module', `imports ${specifier}, the server's own code.`];
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(specifier)) {
    return ['audit.network', `imports code from ${specifier}, outside the package.`];
  }
  return undefined;
}

/** A string literal's text, or a number's: what a computed key names when the audit can read it. */
function literalKey(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return literalKey(node.expression);
  return undefined;
}

/** A property name's text, when it's written out. */
function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return literalKey(name.expression);
  return undefined;
}

/** Wrappers that change an expression's type, not its value. */
function unwrap(node: ts.Expression): ts.Expression {
  for (;;) {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      node = node.expression;
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.CommaToken
    ) {
      node = node.right;
    } else {
      return node;
    }
  }
}

/** The nearest ancestor that isn't such a wrapper, and the child of it on the way. */
function outer(node: ts.Node): { parent: ts.Node | undefined; child: ts.Node } {
  let child = node;
  let parent = node.parent;
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.CommaToken &&
        parent.right === child))
  ) {
    child = parent;
    parent = parent.parent;
  }
  return { parent, child };
}

/** Checks one module, and returns every module it imports. */
function auditSource(text: string, file: string, options: SourceOptions): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const variant = options.rules === 'variant';
  const reported = new Set<string>();
  const report: Report = (code, at, message) => {
    if (!variant && code !== 'audit.clock' && code !== 'audit.random') return;
    // One finding per rule on a line: a destructured global and its source, say.
    const key = `${code}:${at.line}`;
    if (reported.has(key)) return;
    reported.add(key);
    options.report(code, at, message);
  };
  const at = (node: ts.Node) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    return { line: line + 1, column: character + 1 };
  };
  const imports: string[] = [];
  const first = source.statements[0];
  const client =
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use client';

  // Every name the module binds, and which of them alias a global.
  const declared = new Set<string>();
  const aliases = new Map<string, GlobalPath>();
  const declarations: { name: ts.BindingName; init: ts.Expression }[] = [];
  const formatters = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      bindingNames(node.name, declared);
      if (node.initializer) declarations.push({ name: node.name, init: node.initializer });
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined
    ) {
      declared.add(node.name.text);
    } else if (ts.isParameter(node)) {
      bindingNames(node.name, declared);
    } else if (ts.isImportClause(node) && node.name) {
      declared.add(node.name.text);
    } else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      declared.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const reach = (node: ts.Node): Reach => {
    const expression = ts.isExpression(node) ? unwrap(node) : node;
    if (ts.isIdentifier(expression)) {
      const alias = aliases.get(expression.text);
      if (alias) return alias;
      if (declared.has(expression.text)) return undefined;
      return ROOTS.has(expression.text) || NAMED.has(expression.text)
        ? [expression.text]
        : undefined;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const base = reach(expression.expression);
      return Array.isArray(base) ? normal([...base, expression.name.text]) : base;
    }
    if (ts.isElementAccessExpression(expression)) {
      const base = reach(expression.expression);
      if (!Array.isArray(base)) return base;
      const key = literalKey(expression.argumentExpression);
      return key === undefined ? 'dynamic' : normal([...base, key]);
    }
    if (ts.isCallExpression(expression)) {
      const callee = reach(expression.expression);
      // Reflect.get(<global>, 'name') reads the member.
      if (Array.isArray(callee) && callee.join('.') === 'Reflect.get') {
        const [target, key] = expression.arguments;
        const base = target === undefined ? undefined : reach(target);
        if (!Array.isArray(base)) return base;
        const name = literalKey(key);
        return name === undefined ? 'dynamic' : normal([...base, name]);
      }
    }
    return undefined;
  };

  // Aliases of aliases resolve once the ones they name have.
  const bind = (name: ts.BindingName, base: GlobalPath): boolean => {
    let changed = false;
    if (ts.isIdentifier(name)) {
      if (!aliases.has(name.text)) {
        aliases.set(name.text, base);
        changed = true;
      }
    } else if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (element.dotDotDotToken) {
          changed = bind(element.name, base) || changed;
          continue;
        }
        const key = element.propertyName
          ? propertyNameText(element.propertyName)
          : ts.isIdentifier(element.name)
            ? element.name.text
            : undefined;
        if (key !== undefined) changed = bind(element.name, normal([...base, key])) || changed;
      }
    }
    return changed;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const { name, init } of declarations) {
      const base = reach(init);
      if (Array.isArray(base)) changed = bind(name, base) || changed;
    }
  }
  for (const { name, init } of declarations) {
    const value = unwrap(init);
    if (ts.isIdentifier(name) && isDateFormat(value, reach)) formatters.add(name.text);
  }

  const specifier = (node: ts.Node, name: string) => {
    imports.push(name);
    const why = forbiddenSpecifier(name);
    if (why) report(why[0], at(node), why[1]);
    if (/\.css(?:\?.*)?$/.test(name)) report('audit.css-import', at(node), `imports ${name}.`);
  };

  /** Whether a bare global object may stand here: a check, a comparison, or the source of a tracked alias. */
  const followable = (node: ts.Node): boolean => {
    const { parent, child } = outer(node);
    if (!parent) return false;
    if (ts.isTypeOfExpression(parent)) return true;
    if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken)
      return true;
    if ((ts.isIfStatement(parent) || ts.isWhileStatement(parent)) && parent.expression === child)
      return true;
    if (ts.isBinaryExpression(parent)) {
      const operator = parent.operatorToken.kind;
      if (
        operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        operator === ts.SyntaxKind.EqualsEqualsToken ||
        operator === ts.SyntaxKind.ExclamationEqualsToken
      ) {
        return true;
      }
      if (
        (operator === ts.SyntaxKind.InstanceOfKeyword || operator === ts.SyntaxKind.InKeyword) &&
        parent.right === child
      ) {
        return true;
      }
      return false;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === child) {
      return ts.isIdentifier(parent.name) || ts.isObjectBindingPattern(parent.name);
    }
    if ((ts.isNewExpression(parent) || ts.isCallExpression(parent)) && parent.expression === child)
      return true;
    if (ts.isCallExpression(parent) && parent.arguments[0] === child) {
      const callee = reach(parent.expression);
      return Array.isArray(callee) && callee.join('.') === 'Reflect.get';
    }
    return false;
  };

  /** A reference that ends a member chain: Math.random in Math.random(), not Math. */
  const chainEnd = (node: ts.Node): boolean => {
    const { parent, child } = outer(node);
    if (
      parent &&
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === child
    ) {
      return false;
    }
    if (ts.isIdentifier(node)) return isReference(node);
    if (ts.isCallExpression(node)) {
      const callee = reach(node.expression);
      return Array.isArray(callee) && callee.join('.') === 'Reflect.get';
    }
    return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
  };

  const checkReference = (node: ts.Node) => {
    const reached = reach(node);
    if (reached === undefined) return;
    if (reached === 'dynamic') {
      report('audit.global-access', at(node), "reads a global with a key the audit can't read.");
      return;
    }
    // A destructured or aliased global was reported where it was taken.
    if (ts.isIdentifier(node) && aliases.has(node.text) && forbiddenUse(reached)) return;
    // typeof only asks whether the global exists.
    const { parent } = outer(node);
    if (parent && ts.isTypeOfExpression(parent)) return;
    const rule = forbiddenUse(reached);
    if (rule) {
      report(rule[0], at(node), `${rule[1]}: ${reached.join('.')}.`);
    } else if (reached.length === 1 && ROOTS.has(reached[0]!) && !followable(node)) {
      report(
        'audit.global-access',
        at(node),
        `uses ${reached[0]} in a way the audit can't follow.`,
      );
    }
  };

  /** The globals a destructuring pattern takes from `base`, each checked where it's taken. */
  const checkPattern = (pattern: ts.BindingName, base: GlobalPath) => {
    if (!ts.isObjectBindingPattern(pattern)) return;
    for (const element of pattern.elements) {
      if (element.dotDotDotToken) continue;
      const key = element.propertyName
        ? propertyNameText(element.propertyName)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
      if (key === undefined) {
        report(
          'audit.global-access',
          at(element),
          `takes a member of ${base.join('.')} by a key the audit can't read.`,
        );
        continue;
      }
      const taken = normal([...base, key]);
      const rule = forbiddenUse(taken);
      if (rule) report(rule[0], at(element), `${rule[1]}: ${taken.join('.')}.`);
      checkPattern(element.name, taken);
    }
  };

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier))
        specifier(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (ts.isStringLiteral(expression)) specifier(expression, expression.text);
    } else if (ts.isCallExpression(node)) {
      checkCall(node);
    } else if (ts.isNewExpression(node)) {
      const callee = reach(node.expression);
      if (Array.isArray(callee) && callee.join('.') === 'Date' && !node.arguments?.length) {
        report('audit.clock', at(node), 'reads the clock with new Date().');
      }
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      const base = reach(node.initializer);
      if (Array.isArray(base)) checkPattern(node.name, base);
    }

    if (chainEnd(node)) checkReference(node);

    if (variant) {
      if (isAsyncComponent(node))
        report('audit.async-component', at(node), 'is an async component.');
      if (ts.isIdentifier(node) && node.text === 'fetchGitHubData') {
        // Its import counts too: the kit's GitHub client is server code.
        report('audit.github-fetch', at(node), 'uses fetchGitHubData.');
      }
      checkMarkup(node);
      if (client && !options.enhancementEntry) checkClientInput(node);
    }
    ts.forEachChild(node, visit);
  };

  const checkCall = (node: ts.CallExpression) => {
    const [argument] = node.arguments;
    const callee = node.expression;
    if (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && callee.text === 'require' && !declared.has('require'))
    ) {
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        specifier(argument, argument.text);
      } else if (variant) {
        report(
          'audit.dynamic-import',
          at(node),
          `${callee.kind === ts.SyntaxKind.ImportKeyword ? 'import()' : 'require()'} takes a specifier the audit can't read.`,
        );
      }
      return;
    }
    const reached = reach(callee);
    if (Array.isArray(reached)) {
      const name = reached.join('.');
      if (name === 'Date') report('audit.clock', at(node), 'reads the clock with Date().');
      if (
        (name === 'setTimeout' || name === 'setInterval') &&
        argument !== undefined &&
        (ts.isStringLiteralLike(argument) || ts.isTemplateExpression(argument))
      ) {
        report('audit.dynamic-code', at(node), `${name}() runs a string as code.`);
      }
    }
    // A date formatter's format() with no date formats now.
    if (
      ts.isPropertyAccessExpression(callee) &&
      (callee.name.text === 'format' || callee.name.text === 'formatToParts') &&
      node.arguments.length === 0
    ) {
      const target = unwrap(callee.expression);
      if (isDateFormat(target, reach) || (ts.isIdentifier(target) && formatters.has(target.text))) {
        report(
          'audit.clock',
          at(node),
          `formats the current time with ${callee.name.text}() and no date.`,
        );
      }
    }
  };

  const checkMarkup = (node: ts.Node) => {
    const innerHtml = 'dangerouslySetInnerHTML';
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      if (name === innerHtml) report('audit.inner-html', at(node), `sets ${innerHtml}.`);
      if (name === 'srcDoc') report('audit.inner-html', at(node), "sets an iframe's srcDoc.");
    } else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      if (propertyNameText(node.name) === innerHtml) {
        report('audit.inner-html', at(node), `sets ${innerHtml}.`);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const target = unwrap(node.left);
      const key = ts.isPropertyAccessExpression(target)
        ? target.name.text
        : ts.isElementAccessExpression(target)
          ? literalKey(target.argumentExpression)
          : undefined;
      if (key === 'innerHTML' || key === 'outerHTML' || key === innerHtml) {
        report('audit.inner-html', at(node), `sets ${key}.`);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : undefined;
      if (
        name === 'insertAdjacentHTML' ||
        name === 'setHTMLUnsafe' ||
        name === 'createContextualFragment'
      ) {
        report('audit.inner-html', at(node), `writes HTML with ${name}().`);
      }
      const reached = reach(callee);
      if (
        Array.isArray(reached) &&
        (reached.join('.') === 'document.write' || reached.join('.') === 'document.writeln')
      ) {
        report('audit.inner-html', at(node), `writes HTML with ${reached.join('.')}().`);
      }
      const tag = literalKey(node.arguments[0]);
      if (name !== undefined && ELEMENT_FACTORIES.has(name) && tag && RAW_ELEMENTS.has(tag)) {
        report('audit.raw-element', at(node), `creates a <${tag}> element.`);
      }
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (RAW_ELEMENTS.has(tag)) report('audit.raw-element', at(node), `renders a <${tag}>.`);
    }
  };

  const reportedInput = new Set<string>();
  const checkClientInput = (node: ts.Node) => {
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(source);
      if (!WHOLE_INPUT.has(name.split('.').pop()!) || reportedInput.has(name)) return;
      // One field of it, or the fields Pick names, is only what the component renders.
      const parent = node.parent;
      if (ts.isIndexedAccessTypeNode(parent) && parent.objectType === node) return;
      if (
        ts.isTypeReferenceNode(parent) &&
        parent.typeName.getText(source) === 'Pick' &&
        parent.typeArguments?.[0] === node
      ) {
        return;
      }
      reportedInput.add(name);
      report('audit.client-input', at(node), `is a client module that takes ${name}.`);
      return;
    }
    // A component taking `input`, the render input's name, whatever type it's given.
    if (isFunctionLike(node) && componentName(node) !== undefined) {
      const [props] = node.parameters;
      if (!props) return;
      if (ts.isObjectBindingPattern(props.name)) {
        for (const element of props.name.elements) {
          const key = element.propertyName
            ? propertyNameText(element.propertyName)
            : ts.isIdentifier(element.name)
              ? element.name.text
              : undefined;
          if (key === 'input') {
            report('audit.client-input', at(element), 'is a client component that takes input.');
          }
        }
      } else if (ts.isIdentifier(props.name)) {
        const name = props.name.text;
        const uses = (child: ts.Node): void => {
          if (
            ts.isPropertyAccessExpression(child) &&
            ts.isIdentifier(child.expression) &&
            child.expression.text === name &&
            child.name.text === 'input'
          ) {
            report('audit.client-input', at(child), 'is a client component that takes input.');
          }
          ts.forEachChild(child, uses);
        };
        if (node.body) uses(node.body);
      }
    }
  };

  visit(source);
  return imports;
}

/** Each name a binding pattern binds. */
function bindingNames(name: ts.BindingName, into: Set<string>) {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) bindingNames(element.name, into);
  }
}

/** Whether `node` makes an Intl.DateTimeFormat. */
function isDateFormat(node: ts.Expression, reach: (node: ts.Node) => Reach): boolean {
  if (!ts.isNewExpression(node) && !ts.isCallExpression(node)) return false;
  const callee = reach(node.expression);
  return Array.isArray(callee) && callee.join('.') === 'Intl.DateTimeFormat';
}

/** Whether an identifier refers to a value, rather than naming a property, a type, or a new binding. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent)) return false;
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return false;
  if (ts.isExpressionWithTypeArguments(parent) && ts.isHeritageClause(parent.parent)) {
    return (
      parent.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(parent.parent.parent)
    );
  }
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent))
    return false;
  if (ts.isExportSpecifier(parent)) return false;
  if (ts.isJsxAttribute(parent)) return false;
  if (ts.isJsxOpeningElement(parent) || ts.isJsxClosingElement(parent)) return false;
  if (ts.isJsxSelfClosingElement(parent)) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  return true;
}

type FunctionLike =
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isAsync(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
  );
}

const PASCAL = /^[A-Z]/;
const WRAPPERS = new Set(['memo', 'forwardRef']);

/**
 * The component a function is, by how it's declared: a PascalCase name, the
 * module's default export, a function memo() or forwardRef() wraps, or a
 * class's render(). An event handler, whatever it renders, isn't one.
 */
function componentName(node: FunctionLike): string | undefined {
  if (ts.isMethodDeclaration(node)) {
    return ts.isIdentifier(node.name) && node.name.text === 'render' ? 'render' : undefined;
  }
  if (node.name && PASCAL.test(node.name.text)) return node.name.text;
  if (ts.isFunctionDeclaration(node)) {
    const modifiers = ts.getModifiers(node) ?? [];
    return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      ? 'default'
      : undefined;
  }
  const { parent } = outer(node);
  if (!parent) return undefined;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return PASCAL.test(parent.name.text) ? parent.name.text : undefined;
  }
  if (ts.isExportAssignment(parent)) return 'default';
  if (ts.isCallExpression(parent)) {
    const callee = unwrap(parent.expression);
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : undefined;
    return name !== undefined && WRAPPERS.has(name) ? name : undefined;
  }
  return undefined;
}

/** An async function that is a component. */
function isAsyncComponent(node: ts.Node): boolean {
  return isFunctionLike(node) && isAsync(node) && componentName(node) !== undefined;
}
