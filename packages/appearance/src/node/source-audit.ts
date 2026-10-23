// The appearance source audit (#19, Slice 5, item 12): `pnpm check:appearance`
// reads every variant package and `packages/kit/src` for appearance that
// belongs to a pack, so a composition or the kit can't carry a palette, a
// font, or a material of its own past review. It flags:
//
// - `color-literal`: a hex color, `rgb()`, `hsl()`, `hwb()`, `lab()`,
//   `lch()`, `oklab()`, `oklch()`, or `color()`, in a stylesheet or in a
//   string in code, such as a canvas fill or an inline style;
// - `font-family`: a `font-family` or `font` that isn't a `var(--type-*)`;
// - `font-face`: an `@font-face`, which only a typography pack declares;
// - `import`: an `@import`;
// - `shadow`: a `box-shadow` or `text-shadow` that isn't `none` or a token;
// - `radius`: a nonzero `border-radius`, or one of its longhands, that isn't
//   a token;
// - `blur`: a `blur()` in a `filter` or `backdrop-filter` that isn't a token;
// - `timing`: a duration or a delay in `transition` or `animation`, or one
//   of their longhands, written as a literal time;
// - `legacy-property`: the retired v1 properties, `--paper`, `--ink`, and
//   any `--kc-` or `--vt-` one.
//
// A reviewed exception in packages/appearance/audit-exceptions.json names a
// file, a rule, why the file may break it, and who reviewed it, such as a
// photograph's own colors. An exception no finding needs anymore fails the
// audit too, so the list only ever holds what's still true.
//
// It's a lint over code the build already trusts: it reads text, line by
// line, without running anything, and it skips tests, fixtures, and test
// support, which hold known-bad values on purpose.

import fs from 'node:fs';
import path from 'node:path';

export const SOURCE_AUDIT_RULES = [
  'color-literal',
  'font-family',
  'font-face',
  'import',
  'shadow',
  'radius',
  'blur',
  'timing',
  'legacy-property',
] as const;
export type SourceAuditRule = (typeof SOURCE_AUDIT_RULES)[number];

/** What fixes each rule's finding. */
export const SOURCE_AUDIT_REMEDIES: Readonly<Record<SourceAuditRule, string>> = {
  'color-literal':
    "Read the color scheme's token, var(--color-<role>), or, in a canvas, the boundary's computed value of one.",
  'font-family': 'Set the text in a role: data-type-role, or var(--type-<role>-font-family).',
  'font-face': 'Ship the font in a typography pack, whose compiler writes its @font-face.',
  import: 'Put the rules in the one stylesheet your package exports.',
  shadow: "Use the design language's shadow, var(--ui-shadow-card) or another --ui-shadow-* token.",
  radius:
    "Use the design language's radius, such as var(--ui-radius-card) or var(--ui-radius-media).",
  blur: "Use the design language's blur, var(--ui-backdrop-blur).",
  timing: 'Take durations from the design language: var(--ui-motion-fast), -standard, or -slow.',
  'legacy-property': "The v1 properties are gone: read #19's --color-, --ui-, and --type- tokens.",
};

export interface SourceAuditFinding {
  /** Relative to the repository root, with `/` separators. */
  readonly path: string;
  readonly line: number;
  readonly rule: SourceAuditRule;
  /** What the line holds. */
  readonly found: string;
}

export interface AuditException {
  readonly path: string;
  readonly rule: SourceAuditRule;
  readonly reason: string;
  readonly reviewer: string;
}

const CSS = /\.css$/;
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED_DIRS = new Set([
  'node_modules',
  '__fixtures__',
  '__tests__',
  'test-support',
  'fixtures',
  'dist',
  'coverage',
]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Every audited file under `dir`: stylesheets and code, without tests, fixtures, or dependencies. */
export function auditedFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(full);
      } else if (
        CSS.test(entry.name) ||
        (CODE.test(entry.name) && !entry.name.endsWith('.d.ts') && !TEST_FILE.test(entry.name))
      ) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found.sort();
}

/** The color functions CSS has, by name. */
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
/** A hex color: three, four, six, or eight digits, not part of a longer word. */
const HEX = /(?<![\w&-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;
const LEGACY = /--(?:paper|ink)(?![\w-])|--(?:kc|vt)-[\w-]+/;
const TIME = /(?<![\w.-])\d*\.?\d+m?s(?![\w-])/;
/** A hex color in a string in code: the whole string, or a value after a space, colon, comma, or parenthesis, as CSS text has it. */
const HEX_IN_CODE = /(?:^|[\s:,(])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;

/** `css` without its comments, keeping every newline, so line numbers hold. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** Whether a value reads only tokens and keywords: no literal of its own past `var()`. */
function onlyTokens(value: string, keywords: RegExp): boolean {
  const rest = value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ').trim();
  return rest === '' || keywords.test(rest);
}

/** The findings in one stylesheet's text. */
export function auditStylesheetText(
  text: string,
): { line: number; rule: SourceAuditRule; found: string }[] {
  const findings: { line: number; rule: SourceAuditRule; found: string }[] = [];
  const lines = withoutComments(text).split('\n');
  lines.forEach((source, index) => {
    const line = index + 1;
    const report = (rule: SourceAuditRule) => findings.push({ line, rule, found: source.trim() });
    if (/@font-face\b/i.test(source)) report('font-face');
    if (/@import\b/i.test(source)) report('import');
    if (LEGACY.test(source)) report('legacy-property');
    for (const match of source.matchAll(/(?<![\w-])([a-z-]+)\s*:\s*([^;{}]*)/gi)) {
      const property = match[1]!.toLowerCase();
      const value = match[2]!.trim();
      if (value === '') continue;
      if (HEX.test(value) || COLOR_FUNCTION.test(value)) report('color-literal');
      // A layout property of the variant's own holds a length, never appearance.
      if (property.startsWith('--layout-')) continue;
      if (
        (property === 'font-family' || property === 'font') &&
        !onlyTokens(value, /^(?:inherit|initial|unset|revert|revert-layer)$/)
      ) {
        report('font-family');
      }
      if (
        (property === 'box-shadow' || property === 'text-shadow') &&
        !onlyTokens(value, /^(?:none|inherit|initial|unset|revert|revert-layer)$/)
      ) {
        report('shadow');
      }
      if (
        /^border(?:-(?:start|end|top|bottom)-(?:start|end|left|right))?-radius$/.test(property) &&
        !onlyTokens(value, /^(?:0(?:px|rem|em|%)?|inherit|initial|unset|revert|revert-layer)$/)
      ) {
        report('radius');
      }
      if (
        (property === 'filter' || property === 'backdrop-filter') &&
        /(?<![\w-])blur\(\s*(?!var\()/.test(value)
      ) {
        report('blur');
      }
      if (
        /^(?:transition|animation)(?:-duration|-delay)?$/.test(property) &&
        TIME.test(value.replace(/var\([^()]*\)/g, ' '))
      ) {
        report('timing');
      }
    }
  });
  return findings;
}

/** The findings in one module's text: color literals and legacy properties in its strings. */
export function auditCodeText(
  text: string,
): { line: number; rule: SourceAuditRule; found: string }[] {
  const findings: { line: number; rule: SourceAuditRule; found: string }[] = [];
  // Comments go first, keeping newlines, so prose such as "#10b's route" never counts.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  code.split('\n').forEach((source, index) => {
    const line = index + 1;
    for (const [, , literal] of source.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const value = literal ?? '';
      if (HEX_IN_CODE.test(value) || COLOR_FUNCTION.test(value)) {
        findings.push({ line, rule: 'color-literal', found: source.trim() });
      }
      if (LEGACY.test(value))
        findings.push({ line, rule: 'legacy-property', found: source.trim() });
      if (/@font-face\b/i.test(value))
        findings.push({ line, rule: 'font-face', found: source.trim() });
    }
  });
  return findings;
}

/** Every finding in `dirs`, each path relative to `root`. */
export function auditSources(root: string, dirs: readonly string[]): SourceAuditFinding[] {
  return dirs.flatMap((dir) =>
    auditedFiles(dir).flatMap((file) => {
      const text = fs.readFileSync(file, 'utf8');
      const relative = path.relative(root, file).split(path.sep).join('/');
      const found = CSS.test(file) ? auditStylesheetText(text) : auditCodeText(text);
      return found.map((finding) => ({ path: relative, ...finding }));
    }),
  );
}

/** A reason that says nothing, which no review accepts. */
const PLACEHOLDER = /^(?:todo|tbd|fixme|n\/?a|none|-+|\.+|x+|test)$/i;

/** The exceptions file's problems, by entry. */
export function exceptionProblems(entries: unknown): string[] {
  if (!Array.isArray(entries)) return ['audit-exceptions.json holds an array of exceptions.'];
  const problems: string[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const at = `Exception ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at} isn't an object with path, rule, reason, and reviewer.`);
      return;
    }
    const keys = Object.keys(entry).sort().join(',');
    if (keys !== 'path,reason,reviewer,rule') {
      problems.push(
        `${at} has the keys ${keys}; it takes path, rule, reason, and reviewer, and nothing else.`,
      );
      return;
    }
    const { path: file, rule, reason, reviewer } = entry as Record<string, unknown>;
    if (
      typeof file !== 'string' ||
      file.trim() === '' ||
      file.startsWith('/') ||
      file.includes('\\')
    ) {
      problems.push(`${at}'s path is a file relative to the repository root, with / separators.`);
    }
    if (typeof rule !== 'string' || !(SOURCE_AUDIT_RULES as readonly string[]).includes(rule)) {
      problems.push(`${at}'s rule is one of ${SOURCE_AUDIT_RULES.join(', ')}.`);
    }
    if (
      typeof reason !== 'string' ||
      reason.trim().length < 20 ||
      PLACEHOLDER.test(reason.trim())
    ) {
      problems.push(`${at}'s reason says why the file may break the rule, in a sentence.`);
    }
    if (typeof reviewer !== 'string' || reviewer.trim() === '') {
      problems.push(`${at} names who reviewed it.`);
    }
    const key = `${String(file)} ${String(rule)}`;
    if (seen.has(key)) problems.push(`${at} repeats ${key}.`);
    seen.add(key);
  });
  return problems;
}

export interface SourceAuditResult {
  /** Findings no exception covers. */
  readonly findings: readonly SourceAuditFinding[];
  /** Exceptions no finding needs: each one fails, so the list stays true. */
  readonly unused: readonly AuditException[];
  readonly exceptionProblems: readonly string[];
}

/** The findings in `dirs`, less what the reviewed exceptions cover. */
export function runSourceAudit(
  root: string,
  dirs: readonly string[],
  exceptions: unknown,
): SourceAuditResult {
  const problems = exceptionProblems(exceptions);
  const accepted = problems.length === 0 ? (exceptions as AuditException[]) : [];
  const all = auditSources(root, dirs);
  const covers = (exception: AuditException, finding: SourceAuditFinding) =>
    exception.path === finding.path && exception.rule === finding.rule;
  return {
    findings: all.filter((finding) => !accepted.some((exception) => covers(exception, finding))),
    unused: accepted.filter((exception) => !all.some((finding) => covers(exception, finding))),
    exceptionProblems: problems,
  };
}

/** The variant packages under `packagesDir`: each directory whose package.json says portfolio.kind is variant, one level of grouping deep. */
export function variantPackageDirs(packagesDir: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        portfolio?: { kind?: string };
      };
      if (pkg.portfolio?.kind === 'variant') found.push(dir);
      return;
    }
    if (depth === 0) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        visit(path.join(dir, entry.name), depth - 1);
      }
    }
  };
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.'))
      visit(path.join(packagesDir, entry.name), 1);
  }
  return found.sort();
}
