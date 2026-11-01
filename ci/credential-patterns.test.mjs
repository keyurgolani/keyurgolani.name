import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// No plaintext *_PASSWORD variable, no direct comparison against a
// password, and no session cookie written from script, anywhere in apps/ or
// packages/ (#2, constraints). The public tree never had cookie or password
// code; this keeps legacy code ported later from bringing it back. The
// owner's password is checked only against its scrypt hash, in constant time.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.next', 'dist', 'coverage', '__fixtures__']);
const SOURCE = /\.[cm]?[jt]sx?$/;

/**
 * An environment-style name ending in _PASSWORD, or _PASSWORD_FILE for the
 * file holding one, such as ADMIN_PASSWORD. A hash, as in _PASSWORD_HASH,
 * isn't one.
 */
const PASSWORD_VARIABLE =
  /(?:^|[^A-Za-z0-9_])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_PASSWORD(?:_FILE)?)(?![A-Za-z0-9_])/;
const PASSWORD_NAME = /password/i;
/** Cookie names script may never write, and the one #19 adds that it may. */
const SENSITIVE_COOKIE = /session|auth|token/i;
const ALLOWED_COOKIES = new Set(['portfolio_appearance']);

const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

/** The expression inside parentheses, casts, and non-null assertions. */
function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** A property's name, written `.name` or `['name']`. */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

/** The name an operand reads by, such as `password` or `input.password`. */
function operandName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

/** `undefined`, `null`, or '': a check that a value is there, not what it is. */
function isPresenceCheck(node) {
  return (
    (ts.isIdentifier(node) && node.text === 'undefined') ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isStringLiteralLike(node) && node.text === '')
  );
}

/** Whether `node` is document.cookie or document['cookie'], on its own or through window or globalThis. */
function isDocumentCookie(node) {
  const target = unwrap(node);
  if (memberName(target) !== 'cookie') return false;
  return operandName(unwrap(target.expression)) === 'document';
}

/** Whether `node` is cookieStore.set or cookieStore.delete, written either way. */
function isCookieStoreWrite(node) {
  const target = unwrap(node);
  return (
    ['set', 'delete'].includes(memberName(target) ?? '') &&
    operandName(unwrap(target.expression)) === 'cookieStore'
  );
}

/** Whether `node` is Object.is. */
function isObjectIs(node) {
  const target = unwrap(node);
  return memberName(target) === 'is' && operandName(unwrap(target.expression)) === 'Object';
}

/**
 * The cookie name a document.cookie value starts with, when its source spells
 * it out: in a literal, a template's head, or the first piece of a `+` chain.
 */
function cookieNameOfValue(node) {
  let value = unwrap(node);
  while (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    value = unwrap(value.left);
  }
  const text = ts.isStringLiteralLike(value)
    ? value.text
    : ts.isTemplateExpression(value)
      ? value.head.text
      : undefined;
  return text?.includes('=') ? text.slice(0, text.indexOf('=')).trim() : undefined;
}

/** The cookie name a cookieStore call names, when its source spells it out. */
function cookieNameOfCall(node) {
  const [first] = node.arguments;
  if (!first) return undefined;
  const value = unwrap(first);
  if (ts.isStringLiteralLike(value)) return value.text;
  if (!ts.isObjectLiteralExpression(value)) return undefined;
  for (const property of value.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      operandName(property.name) === 'name' &&
      ts.isStringLiteralLike(unwrap(property.initializer))
    ) {
      return unwrap(property.initializer).text;
    }
  }
  return undefined;
}

/**
 * What a source file does that the rules forbid, one entry per finding,
 * located by line.
 *
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
function findings(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const found = [];
  const report = (node, what) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${file}:${line + 1}: ${what}`);
  };
  const cookie = (node, name) => {
    if (name === undefined)
      report(node, 'a cookie written from script under a name that is not a literal');
    else if (!ALLOWED_COOKIES.has(name) && SENSITIVE_COOKIE.test(name)) {
      report(node, `the ${name} cookie written from script`);
    }
  };
  const visit = (node) => {
    if (
      ts.isIdentifier(node) ||
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const match = PASSWORD_VARIABLE.exec(node.text);
      if (match) report(node, `a plaintext password variable, ${match[1]}`);
    }
    const password = (side) => PASSWORD_NAME.test(operandName(unwrap(side)) ?? '');
    /** Two values compared for equality, where either is a password and the other more than a presence check. */
    const compares = (left, right) =>
      (password(left) && !isPresenceCheck(unwrap(right))) ||
      (password(right) && !isPresenceCheck(unwrap(left)));
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind)) {
      if (compares(node.left, node.right)) report(node, 'a direct comparison against a password');
    }
    if (ts.isCallExpression(node) && isObjectIs(node.expression) && node.arguments.length >= 2) {
      const [left, right] = node.arguments;
      if (compares(left, right)) report(node, 'a direct comparison against a password');
    }
    if (ts.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && compares(node.expression, clause.expression)) {
          report(clause, 'a direct comparison against a password');
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isDocumentCookie(node.left)
    ) {
      cookie(node, cookieNameOfValue(node.right));
    }
    if (ts.isCallExpression(node) && isCookieStoreWrite(node.expression)) {
      cookie(node, cookieNameOfCall(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sources(dir) {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : sources(relative);
    return SOURCE.test(entry.name) ? [relative] : [];
  });
}

test('apps/ and packages/ hold no plaintext password variable, password comparison, or script-written session cookie', () => {
  const files = [...sources('apps'), ...sources('packages')];
  assert.ok(files.length > 100, `only ${files.length} files found`);
  const problems = files.flatMap((file) =>
    findings(file, readFileSync(path.join(ROOT, file), 'utf8')),
  );
  assert.deepEqual(problems, []);
});

test('the scan finds each pattern it forbids', () => {
  const cases = [
    ['const p = process.env.ADMIN_PASSWORD;', 'a plaintext password variable, ADMIN_PASSWORD'],
    ["const p = env['DB_PASSWORD'];", 'a plaintext password variable, DB_PASSWORD'],
    ['const help = `set ROOT_PASSWORD=${x}`;', 'a plaintext password variable, ROOT_PASSWORD'],
    ['if (input.password === stored) ok();', 'a direct comparison against a password'],
    ['if (secret == (password as string)) ok();', 'a direct comparison against a password'],
    ["if (body['password'] !== expected) fail();", 'a direct comparison against a password'],
    [
      "document.cookie = 'studio_session=' + token;",
      'the studio_session cookie written from script',
    ],
    ['document.cookie = `auth_token=${t}; path=/`;', 'the auth_token cookie written from script'],
    [
      "window.document.cookie = name + '=' + value;",
      'a cookie written from script under a name that is not a literal',
    ],
    ["await cookieStore.set('session', v);", 'the session cookie written from script'],
    [
      'await cookieStore.set({ name: chosen, value: v });',
      'a cookie written from script under a name that is not a literal',
    ],
    ["await cookieStore.delete('auth');", 'the auth cookie written from script'],
    [
      "document['cookie'] = 'studio_session=' + token;",
      'the studio_session cookie written from script',
    ],
    [
      "globalThis.document['cookie'] = chosen;",
      'a cookie written from script under a name that is not a literal',
    ],
    ["await cookieStore['set']('session', v);", 'the session cookie written from script'],
    [
      "await cookieStore['delete'](name);",
      'a cookie written from script under a name that is not a literal',
    ],
    [
      'const file = process.env.ADMIN_PASSWORD_FILE;',
      'a plaintext password variable, ADMIN_PASSWORD_FILE',
    ],
    ['switch (password) { case stored: ok(); }', 'a direct comparison against a password'],
    ['switch (stored) { case input.password: ok(); }', 'a direct comparison against a password'],
    ['if (Object.is(password, stored)) ok();', 'a direct comparison against a password'],
    ["if (Object['is'](expected, body.password)) ok();", 'a direct comparison against a password'],
  ];
  for (const [code, what] of cases) {
    assert.deepEqual(findings('case.ts', code), [`case.ts:1: ${what}`], code);
  }
});

test('the scan allows hash names, presence checks, and the appearance cookie', () => {
  const allowed = [
    'const key = process.env.PORTFOLIO_AUTH_PASSWORD_HASH_FILE;',
    "if (typeof password !== 'string') fail();",
    'if (password === undefined || input.password == null) fail();',
    "if (password === '') fail();",
    'if (timingSafeEqual(derived, stored)) ok();',
    'document.cookie = `portfolio_appearance=${value}; path=/; max-age=31536000`;',
    "await cookieStore.set('theme', 'dark');",
    'const all = document.cookie;',
    'const PASSWORD_MAX = 256;',
    'const file = process.env.PORTFOLIO_AUTH_PASSWORD_HASH_FILE;',
    'switch (password) { case undefined: fail(); }',
    'switch (kind) { case "password": label(); }',
    'if (Object.is(password, null)) fail();',
    "const theme = document['cookie'];",
  ];
  for (const code of allowed) assert.deepEqual(findings('case.ts', code), [], code);
});
