// The variant source audit (#5, Slice 3, item 5), which `pnpm check:variants`
// runs over every registered variant: what a variant's code and styles may
// not do, so it renders the same on the server, in #7's preview frame, and in
// #9's browser render, reaches no network or storage, and stays inside its
// own [data-variant] scope. The clock and randomness rules also cover
// @portfolio/kit/sections and every kit module it imports.

import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { parseCss, splitSelectors, type CssNode } from './css';

/** Every audit code, with what fixes it. */
export const AUDIT_CODES = {
  'audit.async-component':
    'Render from the input you get: a variant renders synchronously, on the server, in a preview frame, and in a browser.',
  'audit.server-module':
    'A variant runs in browsers too. Use the render input, @portfolio/kit, @portfolio/schema, and @portfolio/variant-contract instead.',
  'audit.environment': 'A variant reads no environment: what it needs is in the render input.',
  'audit.github-fetch':
    'GitHub data reaches a variant through input.derived (#10). Until then the shared github renderer shows the profile link.',
  'audit.network': 'A variant fetches nothing: everything it renders is in the render input.',
  'audit.storage':
    "A variant keeps nothing in the visitor's browser: the host owns cookies and storage.",
  'audit.clock': 'Use input.env.now, so every render of the same input is the same.',
  'audit.random': 'Use seededRandom(input.env.seed) from @portfolio/kit/sections.',
  'audit.inner-html':
    'Render markdown with RichText from @portfolio/kit/sections, the one path #10 sanitizes.',
  'audit.css-import':
    'Put the styles in the stylesheet your ./styles.css export names. The host imports it.',
  'audit.client-input':
    'Pass a client component only the data it renders, so the rest stays out of the page payload.',
  'audit.css-unscoped':
    'Start every selector with [data-variant="<id>"], so your styles reach only your own page.',
  'audit.css-remote-import':
    'Ship the styles in the package, so the page reaches no host outside the app.',
  'audit.css-physical':
    'Use the logical form, such as margin-inline-start, inset-inline-end, or text-align: start.',
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
    auditCss(fs.readFileSync(file, 'utf8'), target, (code, at, message) =>
      findings.push(finding(target.packageName, rel, code, at, message)),
    );
  }
  return findings;
}

/**
 * The clock and randomness findings in @portfolio/kit/sections and each kit
 * module it imports, from `entry`, the subpath's file, within `kitDir`.
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
const NETWORK = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']);
const STORAGE = new Set(['localStorage', 'sessionStorage', 'indexedDB', 'cookieStore']);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);
/** Types that carry the whole render input or the whole portfolio. */
const WHOLE_INPUT = new Set(['VariantRenderInput', 'PublicPortfolio', 'Portfolio', 'PublicView']);

function scriptKind(file: string): ts.ScriptKind {
  if (/\.[cm]?tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** Why a module specifier is server-only, or undefined when a variant may import it. */
function serverOnly(specifier: string): string | undefined {
  if (
    specifier.startsWith('node:') ||
    BUILTINS.has(specifier) ||
    BUILTINS.has(specifier.split('/')[0]!)
  ) {
    return `${specifier}, a Node module`;
  }
  if (specifier === 'server-only') return 'server-only';
  if (specifier === 'next' || specifier.startsWith('next/'))
    return `${specifier}, part of the host's framework`;
  if (specifier === '@portfolio/core' || specifier.startsWith('@portfolio/core/')) {
    return `${specifier}, the server's own code`;
  }
  return undefined;
}

/** Checks one module, and returns every module it imports. */
function auditSource(text: string, file: string, options: SourceOptions): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const { report } = options;
  const variant = options.rules === 'variant';
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
  const wholeInput = new Set<string>();

  const specifier = (node: ts.Node, name: string) => {
    imports.push(name);
    if (!variant) return;
    const why = serverOnly(name);
    if (why) report('audit.server-module', at(node), `imports ${why}.`);
    if (/\.css(?:\?.*)?$/.test(name)) report('audit.css-import', at(node), `imports ${name}.`);
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
      const [argument] = node.arguments;
      const callee = node.expression;
      if (
        (callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === 'require')) &&
        argument !== undefined &&
        ts.isStringLiteralLike(argument)
      ) {
        specifier(argument, argument.text);
      }
      if (isMember(callee, 'Date', 'now'))
        report('audit.clock', at(node), 'reads the clock with Date.now().');
      if (isMember(callee, 'Math', 'random'))
        report('audit.random', at(node), 'calls Math.random().');
    } else if (ts.isNewExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Date' &&
        !node.arguments?.length
      ) {
        report('audit.clock', at(node), 'reads the clock with new Date().');
      }
    }

    if (variant) {
      if (isAsyncComponent(node))
        report('audit.async-component', at(node), 'is an async component.');
      if (ts.isPropertyAccessExpression(node)) {
        const target = node.expression;
        const name = node.name.text;
        if (ts.isIdentifier(target) && target.text === 'process' && name === 'env') {
          report('audit.environment', at(node), 'reads process.env.');
        } else if (isDocument(target) && name === 'cookie') {
          report('audit.storage', at(node), 'uses document.cookie.');
        } else if (name === 'sendBeacon') {
          report('audit.network', at(node), 'uses navigator.sendBeacon.');
        } else if (ts.isIdentifier(target) && GLOBAL_OBJECTS.has(target.text)) {
          if (NETWORK.has(name)) report('audit.network', at(node), `uses ${name}.`);
          if (STORAGE.has(name)) report('audit.storage', at(node), `uses ${name}.`);
        }
      } else if (ts.isElementAccessExpression(node)) {
        const target = node.expression;
        const key = node.argumentExpression;
        if (
          ts.isIdentifier(target) &&
          target.text === 'process' &&
          ts.isStringLiteralLike(key) &&
          key.text === 'env'
        ) {
          report('audit.environment', at(node), 'reads process.env.');
        }
      } else if (ts.isIdentifier(node) && node.text === 'fetchGitHubData') {
        // Its import counts too: the kit's GitHub client is server code.
        report('audit.github-fetch', at(node), 'uses fetchGitHubData.');
      } else if (ts.isIdentifier(node) && isReference(node)) {
        if (NETWORK.has(node.text)) report('audit.network', at(node), `uses ${node.text}.`);
        else if (STORAGE.has(node.text)) report('audit.storage', at(node), `uses ${node.text}.`);
      } else if (
        ts.isJsxAttribute(node) &&
        node.name.getText(source) === 'dangerouslySetInnerHTML'
      ) {
        report('audit.inner-html', at(node), 'sets dangerouslySetInnerHTML.');
      } else if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        node.name.getText(source).replace(/['"]/g, '') === 'dangerouslySetInnerHTML'
      ) {
        report('audit.inner-html', at(node), 'sets dangerouslySetInnerHTML.');
      } else if (
        client &&
        !options.enhancementEntry &&
        ts.isTypeReferenceNode(node) &&
        WHOLE_INPUT.has(node.typeName.getText(source).split('.').pop()!)
      ) {
        const name = node.typeName.getText(source);
        if (!wholeInput.has(name)) {
          wholeInput.add(name);
          report('audit.client-input', at(node), `is a client module that takes ${name}.`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function isMember(node: ts.Expression, object: string, member: string): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === object &&
    node.name.text === member
  );
}

function isDocument(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === 'document';
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'document' &&
    ts.isIdentifier(node.expression) &&
    GLOBAL_OBJECTS.has(node.expression.text)
  );
}

/** Whether an identifier refers to a value, rather than naming a property or a new binding. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
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
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent))
    return false;
  if (ts.isExportSpecifier(parent)) return false;
  if (ts.isJsxAttribute(parent)) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  return true;
}

function isAsync(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
  );
}

/** An async function that renders: a PascalCase name, or JSX in its body. */
function isAsyncComponent(node: ts.Node): boolean {
  if (
    !(
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) ||
    !isAsync(node)
  ) {
    return false;
  }
  const name =
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name
      ? node.name.text
      : ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
        ? node.parent.name.text
        : undefined;
  return (name !== undefined && /^[A-Z]/.test(name)) || containsJsx(node);
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

// CSS.

const GLOBAL_AT_RULES = new Set([
  '@font-face',
  '@page',
  '@property',
  '@counter-style',
  '@font-feature-values',
  '@font-palette-values',
]);
const REMOTE = /^(?:url\(\s*)?['"]?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i;

function auditCss(text: string, target: AuditTarget, report: Report) {
  const scope = new RegExp(
    `^\\[\\s*data-variant\\s*=\\s*(?:"${escape(target.id)}"|'${escape(target.id)}'|${escape(target.id)})\\s*\\]`,
  );
  const walk = (nodes: readonly CssNode[], scoped: boolean) => {
    for (const node of nodes) {
      if (node.type === 'at-rule') {
        if (node.name === '@import') {
          if (REMOTE.test(node.prelude.trim())) {
            report('audit.css-remote-import', node.at, 'imports a stylesheet from another host.');
          }
        } else if (GLOBAL_AT_RULES.has(node.name) && !scoped) {
          report(
            'audit.css-unscoped',
            node.at,
            `has ${node.name}, which applies to the whole page.`,
          );
        }
        if (node.children) walk(node.children, scoped);
      } else if (node.type === 'rule') {
        if (!scoped) {
          for (const selector of splitSelectors(node.selector)) {
            if (!scope.test(selector)) {
              report(
                'audit.css-unscoped',
                node.at,
                `has the selector ${selector}, which isn't under [data-variant="${target.id}"].`,
              );
            }
          }
        }
        walk(node.children, true);
      } else if (target.rtl) {
        const physical = physicalProperty(node.property, node.value);
        if (physical) {
          report(
            'audit.css-physical',
            node.at,
            `uses ${physical}, which doesn't flip for right-to-left text.`,
          );
        }
      }
    }
  };
  walk(parseCss(text), false);
}

const PHYSICAL_PROPERTY =
  /^(?:left|right|(?:margin|padding|scroll-margin|scroll-padding)-(?:left|right)|border-(?:left|right)(?:-(?:width|style|color))?|border-(?:top|bottom)-(?:left|right)-radius)$/;

/** The physical part of a declaration, or undefined when it's logical. */
function physicalProperty(property: string, value: string): string | undefined {
  if (PHYSICAL_PROPERTY.test(property)) return property;
  if (
    ['text-align', 'float', 'clear'].includes(property) &&
    /^(?:left|right)\b/i.test(value.trim())
  ) {
    return `${property}: ${value.trim()}`;
  }
  return undefined;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
