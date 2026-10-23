// The static workflow check (#11, Slice 1, item 13), which pnpm quality:meta
// runs: it keeps pull requests away from the repository's secrets. It reads
// every .github/workflows/*.yml and *.yaml with the yaml package and fails:
//
//   - any pull_request_target trigger, which runs a fork's pull request with
//     the base repository's secrets and a writable token;
//   - any job a pull request can run that gets more than contents: read and
//     actions: read, or that references secrets.
//
// A pull request can run a job when the workflow triggers on pull_request,
// or on workflow_call, since a called workflow runs with its caller's event,
// and the job's own if: doesn't limit it to push, tags, or schedule. The if:
// counts when its conditions joined by && include one of: github.event_name
// == 'push' or 'schedule', github.event_name != 'pull_request', github.ref
// == 'refs/heads/...' or 'refs/tags/...', startsWith(github.ref,
// 'refs/heads/') or 'refs/tags/', or github.ref_type == 'tag'. An || counts
// only when each side does, and anything else doesn't count, so a check that
// can't read a condition reads it as letting pull requests in.
//
// A job's token is its own permissions, else the workflow's, else the
// repository default, which may be write and so fails. A job references
// secrets when any expression in it, or in the workflow's env, names the
// secrets context, or when it passes `secrets: inherit` to a called workflow.

import fs from 'node:fs';
import path from 'node:path';
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from 'yaml';
import { REPO_ROOT } from '../../../quality/thresholds';

export const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

export type WorkflowRule = 'pull-request-target' | 'permissions' | 'secrets' | 'parse';

export interface WorkflowProblem {
  readonly file: string;
  readonly line?: number;
  readonly job?: string;
  readonly rule: WorkflowRule;
  readonly message: string;
}

/** What a pull request's token may hold. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  contents: ['read', 'none'],
  actions: ['read', 'none'],
};

// ---- the if: reader -------------------------------------------------------

type Token = {
  readonly kind: 'op' | 'paren' | 'comma' | 'string' | 'name' | 'other';
  readonly text: string;
};

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const space = /^\s+/.exec(rest);
    if (space) {
      index += space[0].length;
      continue;
    }
    const op = /^(?:&&|\|\||==|!=|<=|>=|<|>|!)/.exec(rest);
    if (op) {
      tokens.push({ kind: 'op', text: op[0] });
      index += op[0].length;
      continue;
    }
    if (rest[0] === '(' || rest[0] === ')') {
      tokens.push({ kind: 'paren', text: rest[0] });
      index += 1;
      continue;
    }
    if (rest[0] === ',') {
      tokens.push({ kind: 'comma', text: ',' });
      index += 1;
      continue;
    }
    if (rest[0] === "'") {
      // A GitHub string: single quotes, '' for a quote inside.
      const string = /^'((?:[^']|'')*)'/.exec(rest);
      if (!string) return null;
      tokens.push({ kind: 'string', text: string[1]!.replace(/''/g, "'") });
      index += string[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_.\-*[\]]*/.exec(rest);
    if (name) {
      tokens.push({ kind: 'name', text: name[0] });
      index += name[0].length;
      continue;
    }
    const other = /^[^\s()&|=!<>,']+/.exec(rest);
    if (!other) return null;
    tokens.push({ kind: 'other', text: other[0] });
    index += other[0].length;
  }
  return tokens;
}

type Expression =
  | { readonly type: 'and' | 'or'; readonly left: Expression; readonly right: Expression }
  | { readonly type: 'not'; readonly operand: Expression }
  | {
      readonly type: 'compare';
      readonly op: string;
      readonly left: Expression;
      readonly right: Expression;
    }
  | { readonly type: 'call'; readonly name: string; readonly args: readonly Expression[] }
  | { readonly type: 'name' | 'string' | 'other'; readonly text: string };

/** A recursive-descent reader for the if: grammar: ||, &&, !, comparisons, calls, and parentheses. */
function parseExpression(tokens: readonly Token[]): Expression | null {
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const or = (): Expression | null => {
    let left = and();
    while (left && peek()?.text === '||') {
      take();
      const right = and();
      if (!right) return null;
      left = { type: 'or', left, right };
    }
    return left;
  };
  const and = (): Expression | null => {
    let left = compare();
    while (left && peek()?.text === '&&') {
      take();
      const right = compare();
      if (!right) return null;
      left = { type: 'and', left, right };
    }
    return left;
  };
  const compare = (): Expression | null => {
    const left = unary();
    const op = peek();
    if (left && op?.kind === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(op.text)) {
      take();
      const right = unary();
      return right ? { type: 'compare', op: op.text, left, right } : null;
    }
    return left;
  };
  const unary = (): Expression | null => {
    if (peek()?.text === '!') {
      take();
      const operand = unary();
      return operand ? { type: 'not', operand } : null;
    }
    return primary();
  };
  const primary = (): Expression | null => {
    const token = take();
    if (!token) return null;
    if (token.text === '(') {
      const inner = or();
      if (take()?.text !== ')') return null;
      return inner;
    }
    if (token.kind === 'name' && peek()?.text === '(') {
      take();
      const args: Expression[] = [];
      if (peek()?.text !== ')') {
        for (;;) {
          const arg = or();
          if (!arg) return null;
          args.push(arg);
          if (peek()?.kind === 'comma') take();
          else break;
        }
      }
      if (take()?.text !== ')') return null;
      return { type: 'call', name: token.text.toLowerCase(), args };
    }
    if (token.kind === 'name' || token.kind === 'string' || token.kind === 'other') {
      return { type: token.kind, text: token.text };
    }
    return null;
  };
  const expression = or();
  return expression && at === tokens.length ? expression : null;
}

/** The expression inside ${{ }}, or the whole string when it has no wrapper. */
function unwrap(value: string): string {
  const trimmed = value.trim();
  const match = /^\$\{\{([\s\S]*)\}\}$/.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

const isName = (expression: Expression, name: string) =>
  expression.type === 'name' && expression.text.toLowerCase() === name;
const literal = (expression: Expression) =>
  expression.type === 'string' ? expression.text.toLowerCase() : undefined;

/** A comparison of `name` to a string, either way round: the string, or undefined. */
function compared(expression: Expression & { type: 'compare' }, name: string): string | undefined {
  if (isName(expression.left, name)) return literal(expression.right);
  if (isName(expression.right, name)) return literal(expression.left);
  return undefined;
}

const LIMITING_EVENTS = new Set(['push', 'schedule']);
const PULL_REQUEST_EVENTS = new Set(['pull_request', 'pull_request_target']);

/** Whether `expression`, true, means the event is a push, a tag, or a schedule, never a pull request. */
function limits(expression: Expression): boolean {
  switch (expression.type) {
    case 'and':
      return limits(expression.left) || limits(expression.right);
    case 'or':
      return limits(expression.left) && limits(expression.right);
    case 'compare': {
      // GitHub compares strings without regard to case.
      const event = compared(expression, 'github.event_name');
      if (event !== undefined) {
        return expression.op === '=='
          ? LIMITING_EVENTS.has(event)
          : expression.op === '!=' && event === 'pull_request';
      }
      const ref = compared(expression, 'github.ref');
      if (ref !== undefined && expression.op === '==') {
        return ref.startsWith('refs/heads/') || ref.startsWith('refs/tags/');
      }
      const refType = compared(expression, 'github.ref_type');
      return refType === 'tag' && expression.op === '==';
    }
    case 'call': {
      if (expression.name !== 'startswith' || expression.args.length !== 2) return false;
      const [subject, prefix] = expression.args as [Expression, Expression];
      const value = literal(prefix);
      return (
        isName(subject, 'github.ref') &&
        value !== undefined &&
        (value.startsWith('refs/heads/') || value.startsWith('refs/tags/'))
      );
    }
    default:
      return false;
  }
}

/** Whether a job's if: keeps every pull request event from running it. */
export function ifLimitsToPushTagsOrSchedule(condition: unknown): boolean {
  if (typeof condition === 'boolean') return condition === false;
  if (typeof condition !== 'string') return false;
  const tokens = tokenize(unwrap(condition));
  if (!tokens) return false;
  const expression = parseExpression(tokens);
  return expression !== null && limits(expression);
}

// ---- triggers, permissions, and secrets ----------------------------------

/** The events `on:` names, as GitHub reads a string, a list, or a map. */
export function triggers(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.filter((event): event is string => typeof event === 'string');
  if (on && typeof on === 'object') return Object.keys(on);
  return [];
}

/** What a token holds beyond contents: read and actions: read, or why it can't be read. */
export function extraPermissions(permissions: unknown): string[] {
  if (permissions === undefined || permissions === null) {
    return ["the repository's default token, which may be write"];
  }
  if (typeof permissions === 'string') {
    return permissions === '' ? [] : [permissions];
  }
  if (typeof permissions !== 'object' || Array.isArray(permissions))
    return ["permissions it can't read"];
  return Object.entries(permissions as Record<string, unknown>)
    .filter(([scope, level]) => level !== 'none' && !(ALLOWED[scope] ?? []).includes(String(level)))
    .map(([scope, level]) => `${scope}: ${String(level)}`);
}

/** Whether any expression in `value` names the secrets context. */
function referencesSecrets(value: unknown, isIf = false): boolean {
  if (typeof value === 'string') {
    const expressions = [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => match[1]!);
    // An if: is an expression with or without ${{ }}.
    if (isIf) expressions.push(value);
    return expressions.some((expression) => /(?<![\w.-])secrets\b/i.test(expression));
  }
  if (Array.isArray(value)) return value.some((item) => referencesSecrets(item));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) => referencesSecrets(key) || referencesSecrets(item, key === 'if'),
    );
  }
  return false;
}

/** The line a node starts on, 1-based. */
function lineOf(node: Node | null | undefined, counter: LineCounter): number | undefined {
  const start = node?.range?.[0];
  return start === undefined ? undefined : counter.linePos(start).line;
}

/** The line of `key` in the map `map`, or of the item `key` in the list `map`. */
function keyLine(map: unknown, key: string, counter: LineCounter): number | undefined {
  if (isMap(map)) {
    return lineOf(
      map.items.find((pair) => isScalar(pair.key) && pair.key.value === key)?.key as
        Node | undefined,
      counter,
    );
  }
  if (isSeq(map)) {
    return lineOf(
      map.items.find((item) => isScalar(item) && item.value === key) as Node | undefined,
      counter,
    );
  }
  return undefined;
}

/** Every problem in one workflow's source. `file` names it in the problems. */
export function checkWorkflowSource(file: string, source: string): WorkflowProblem[] {
  const counter = new LineCounter();
  const document = parseDocument(source, { lineCounter: counter, uniqueKeys: true });
  if (document.errors.length > 0) {
    return document.errors.map((error) => ({
      file,
      rule: 'parse' as const,
      message: `isn't valid YAML: ${error.message.split('\n')[0]}`,
    }));
  }
  const workflow = document.toJS() as Record<string, unknown> | null;
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return [{ file, rule: 'parse', message: "isn't a workflow: it has no top-level map." }];
  }
  const root = document.contents;
  const node = (key: string, from: unknown = root): Node | undefined =>
    isMap(from) ? ((from.get(key, true) as Node | undefined) ?? undefined) : undefined;
  const problems: WorkflowProblem[] = [];

  const events = triggers(workflow.on);
  const onNode = node('on');
  if (events.includes('pull_request_target')) {
    const line = keyLine(onNode, 'pull_request_target', counter) ?? lineOf(onNode, counter);
    problems.push({
      file,
      ...(line ? { line } : {}),
      rule: 'pull-request-target',
      message:
        "triggers on pull_request_target, which runs a fork's pull request with the base repository's secrets and a writable token. Use pull_request.",
    });
  }

  // A called workflow runs with its caller's event, which may be a pull request.
  const reachable = events.some(
    (event) => PULL_REQUEST_EVENTS.has(event) || event === 'workflow_call',
  );
  if (!reachable) return problems;

  const jobs = workflow.jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) return problems;
  const jobsNode = node('jobs');
  const workflowSecrets = referencesSecrets(workflow.env);
  for (const [id, raw] of Object.entries(jobs as Record<string, unknown>)) {
    const job = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (ifLimitsToPushTagsOrSchedule(job.if)) continue;
    const jobNode = node(id, jobsNode);
    const line = keyLine(jobsNode, id, counter);
    const at = { file, ...(line ? { line } : {}), job: id };
    const own = 'permissions' in job;
    const extra = extraPermissions(own ? job.permissions : workflow.permissions);
    if (extra.length > 0) {
      // The permissions key the token comes from: the job's, else the workflow's, else the job.
      const from = own
        ? keyLine(jobNode, 'permissions', counter)
        : keyLine(root, 'permissions', counter);
      problems.push({
        ...at,
        ...((from ?? line) ? { line: from ?? line } : {}),
        rule: 'permissions',
        message: `job ${id} runs on pull requests with ${extra.join(', ')}: a pull request's job gets contents: read and actions: read at most.`,
      });
    }
    const inherits = job.secrets === 'inherit';
    if (inherits || workflowSecrets || referencesSecrets(job)) {
      problems.push({
        ...at,
        rule: 'secrets',
        message: inherits
          ? `job ${id} runs on pull requests and passes secrets: inherit to the workflow it calls.`
          : workflowSecrets && !referencesSecrets(job)
            ? `job ${id} runs on pull requests, and the workflow's env references secrets, which it inherits.`
            : `job ${id} runs on pull requests and references secrets.`,
      });
    }
  }
  return problems;
}

/** The workflow files in `dir`, sorted: every *.yml and *.yaml. */
export function workflowFiles(dir: string = WORKFLOWS_DIR): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/** Every problem in every workflow in `dir`, .github/workflows/ unless a test names another. */
export function checkWorkflows(dir: string = WORKFLOWS_DIR): {
  files: string[];
  problems: WorkflowProblem[];
} {
  const files = workflowFiles(dir);
  return {
    files,
    problems: files.flatMap((file) =>
      checkWorkflowSource(path.relative(REPO_ROOT, file) || file, fs.readFileSync(file, 'utf8')),
    ),
  };
}
