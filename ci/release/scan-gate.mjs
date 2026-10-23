#!/usr/bin/env node
// The release scan's verdict over Grype's JSON (docs/releasing.md).
//
//   node ci/release/scan-gate.mjs exceptions
//   node ci/release/scan-gate.mjs image <grype.json>...
//   node ci/release/scan-gate.mjs deps <head-grype.json> <base-grype.json>
//   (each with --report=<file> for the full report)
//
// What it prints, writes to the job summary, and annotates is public, on
// tag runs too: pass or fail and counts only, never a finding's id,
// package, version, or fix. The full report goes to --report's file, which
// the workflow uploads as an artifact kept for one day.
//
// image fails on a fixable Critical or High finding in the image, on every
// platform scanned. deps fails on a High or Critical finding in the
// production dependencies (ci/release/prod-deps.mjs) that the baseline
// doesn't have: the PR's base on a dry run, the previous final release on a
// release candidate, and nothing for the first one. An entry in
// ci/release/scan-exceptions.yml lets one finding through until its expiry,
// and every mode fails while any entry has expired or isn't valid, whether
// or not it matches anything.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * A refusal whose message names no finding and quotes no file, so run()
 * prints it. Any other error prints as a bare failure.
 */
export class ScanError extends Error {}
export const EXCEPTIONS_FILE = path.join(HERE, 'scan-exceptions.yml');
/** The longest an exception may run from the day it's checked. */
export const MAX_EXCEPTION_DAYS = 90;
export const BLOCKING = new Set(['critical', 'high']);

const ID = /^(CVE-\d{4}-\d{4,}|GHSA(-[23456789cfghjmpqrvwx]{4}){3})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIELDS = ['id', 'package', 'reason', 'owner', 'expires'];
const DAY = 86_400_000;

/** A YYYY-MM-DD date as UTC midnight, or null when it isn't a real date. */
export function parseDate(value) {
  const match = DATE.exec(String(value ?? ''));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = Date.UTC(year, month - 1, day);
  const back = new Date(date);
  return back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day
    ? date
    : null;
}

/** Today's date, UTC midnight. */
export const today = (now = Date.now()) => Math.floor(now / DAY) * DAY;

/**
 * Reads the exceptions file: { exceptions, problems }. An entry is valid
 * when it has exactly id, package, reason, owner, and expires; the id is a
 * CVE or GHSA id; expires is a date no earlier than today and no more than
 * MAX_EXCEPTION_DAYS after it; and no other entry has its id and package.
 */
export function readExceptions(text, { on = today() } = {}) {
  let data;
  try {
    data = parse(text, { schema: 'core', uniqueKeys: true });
  } catch (error) {
    return { exceptions: [], problems: [`isn't valid YAML: ${error.message.split('\n')[0]}`] };
  }
  const list = data?.exceptions;
  if (!data || typeof data !== 'object' || !Array.isArray(list)) {
    return { exceptions: [], problems: ['has no exceptions: list (use exceptions: [] for none)'] };
  }
  const extraTop = Object.keys(data).filter((key) => key !== 'exceptions');
  const problems = extraTop.length ? [`has unknown top-level keys: ${extraTop.join(', ')}`] : [];
  const exceptions = [];
  const seen = new Set();
  list.forEach((entry, index) => {
    const at = `entry ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at} isn't a map`);
      return;
    }
    // The file is public, so a problem may name the entry's own id, and no more.
    const label = `${at} (${typeof entry.id === 'string' ? entry.id : 'no id'})`;
    const missing = FIELDS.filter(
      (field) => typeof entry[field] !== 'string' || !entry[field].trim(),
    );
    const unknown = Object.keys(entry).filter((key) => !FIELDS.includes(key));
    if (missing.length) problems.push(`${label} lacks ${missing.join(', ')}`);
    if (unknown.length) problems.push(`${label} has unknown keys: ${unknown.join(', ')}`);
    if (missing.length || unknown.length) return;
    let valid = true;
    if (!ID.test(entry.id)) {
      problems.push(`${label}: the id isn't a CVE or GHSA id`);
      valid = false;
    }
    const expires = parseDate(entry.expires);
    if (expires === null) {
      problems.push(`${label}: expires ${entry.expires} isn't a YYYY-MM-DD date`);
      valid = false;
    } else if (expires < on) {
      problems.push(
        `${label} expired on ${entry.expires}. Fix the finding, or renew the entry with a new reason`,
      );
      valid = false;
    } else if (expires > on + MAX_EXCEPTION_DAYS * DAY) {
      problems.push(
        `${label} expires ${entry.expires}, more than ${MAX_EXCEPTION_DAYS} days out. Pick a date within ${MAX_EXCEPTION_DAYS} days`,
      );
      valid = false;
    }
    const key = `${entry.id.toUpperCase()} ${entry.package}`;
    if (seen.has(key)) {
      problems.push(`${label} repeats an earlier entry`);
      valid = false;
    }
    seen.add(key);
    if (valid) exceptions.push({ ...entry, id: entry.id.toUpperCase() });
  });
  return { exceptions, problems };
}

/** A Grype match as { id, ids, package, version, severity, fixable, fixedIn, type }. */
export function findingOf(match) {
  const vulnerability = match?.vulnerability ?? {};
  const ids = [vulnerability.id, ...(match?.relatedVulnerabilities ?? []).map((v) => v?.id)]
    .filter(Boolean)
    .map((id) => String(id).toUpperCase());
  return {
    id: String(vulnerability.id ?? 'unknown').toUpperCase(),
    ids: [...new Set(ids)],
    package: String(match?.artifact?.name ?? 'unknown'),
    version: String(match?.artifact?.version ?? ''),
    type: String(match?.artifact?.type ?? ''),
    severity: String(vulnerability.severity ?? 'Unknown'),
    fixable: vulnerability.fix?.state === 'fixed',
    fixedIn: vulnerability.fix?.versions ?? [],
  };
}

/** Every finding in a Grype JSON document. Throws when it isn't one. */
export function findingsOf(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.matches)) {
    throw new ScanError("isn't Grype JSON output: it has no matches list");
  }
  // An ignore rule in .grype.yaml or on the command line would let a finding
  // through with no expiry. Exceptions live in scan-exceptions.yml only.
  if (Array.isArray(report.ignoredMatches) && report.ignoredMatches.length > 0) {
    throw new ScanError(
      `Grype ignored ${report.ignoredMatches.length} match(es) by its own rules. Remove the ignore rule, and add an expiring entry to ci/release/scan-exceptions.yml instead`,
    );
  }
  return report.matches.map(findingOf);
}

const blocking = (finding) => BLOCKING.has(finding.severity.toLowerCase());
/** The exception that lets `finding` through, if any: same id (or an alias) and package. */
export const exceptionFor = (finding, exceptions) =>
  exceptions.find((entry) => finding.ids.includes(entry.id) && entry.package === finding.package);
const findingKey = (finding) => `${finding.id} ${finding.package}`;

/**
 * The image verdict: { ok, failing, excepted, unfixable }. Fails on a
 * fixable Critical or High finding no exception covers. Unfixable ones are
 * reported, not failed.
 */
export function evaluateImage(findings, exceptions) {
  const failing = [];
  const excepted = [];
  const unfixable = [];
  const seen = new Set();
  for (const finding of findings.filter(blocking)) {
    const key = `${findingKey(finding)} ${finding.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!finding.fixable) unfixable.push(finding);
    else if (exceptionFor(finding, exceptions)) excepted.push(finding);
    else failing.push(finding);
  }
  return { ok: failing.length === 0, failing, excepted, unfixable };
}

/**
 * The dependency verdict: { ok, failing, excepted, known }. Fails on a High
 * or Critical finding the baseline doesn't have (by id and package) and no
 * exception covers. Fixable or not, a new one fails.
 */
export function evaluateDeps(headFindings, baseFindings, exceptions) {
  const baseline = new Set(
    baseFindings.filter(blocking).flatMap((f) => f.ids.map((id) => `${id} ${f.package}`)),
  );
  const failing = [];
  const excepted = [];
  const known = [];
  const seen = new Set();
  for (const finding of headFindings.filter(blocking)) {
    const key = `${findingKey(finding)} ${finding.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (finding.ids.some((id) => baseline.has(`${id} ${finding.package}`))) known.push(finding);
    else if (exceptionFor(finding, exceptions)) excepted.push(finding);
    else failing.push(finding);
  }
  return { ok: failing.length === 0, failing, excepted, known };
}

const SEVERITIES = ['Critical', 'High'];
const CATEGORIES = [
  ['failing', 'failing'],
  ['excepted', 'let through by an exception'],
  ['unfixable', 'with no fix yet, reported only'],
  ['known', 'already in the baseline'],
];

/** How many findings of each blocking severity a list holds: "2 Critical, 5 High". */
export function severityCounts(findings) {
  return SEVERITIES.map(
    (severity) =>
      `${findings.filter((f) => f.severity.toLowerCase() === severity.toLowerCase()).length} ${severity}`,
  ).join(', ');
}

/**
 * The public summary: pass or fail, and a count per category and severity.
 * Run logs, job summaries, and annotations are public, tag runs' included,
 * so it never names a finding, a package, a version, or a fix.
 */
export function renderSummary(title, verdict, exceptionProblems) {
  const ok = verdict.ok && exceptionProblems.length === 0;
  const counts = CATEGORIES.filter(([key]) => Array.isArray(verdict[key])).map(
    ([key, label]) => `- ${verdict[key].length} ${label} (${severityCounts(verdict[key])})`,
  );
  return [
    `### ${title}: ${ok ? 'passed' : 'failed'}`,
    '',
    ...(exceptionProblems.length
      ? [
          '**Scan exceptions** (ci/release/scan-exceptions.yml)',
          '',
          ...exceptionProblems.map((p) => `- ${p}.`),
          '',
        ]
      : []),
    ...(counts.length ? ['Critical and High findings:', '', ...counts, ''] : []),
    ...(counts.length && !verdict.ok
      ? ["The full report is in this run's reports artifact, kept for one day.", '']
      : []),
  ].join('\n');
}

const row = (f) =>
  `| ${f.id} | ${f.package} ${f.version} | ${f.severity} | ${f.fixedIn.length ? f.fixedIn.join(', ') : 'no fix'} |`;

/** The full report, every finding named, for the one-day artifact only. */
export function renderReport(title, verdict) {
  const lines = [`# ${title}: ${verdict.ok ? 'passed' : 'failed'}`, ''];
  for (const [key, label] of CATEGORIES) {
    const findings = verdict[key];
    if (!Array.isArray(findings) || findings.length === 0) continue;
    lines.push(
      `## ${findings.length} ${label}`,
      '',
      '| Finding | Package | Severity | Fixed in |',
      '| --- | --- | --- | --- |',
      ...findings.map(row),
      '',
    );
  }
  return lines.join('\n');
}

const readJson = (file) => {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new ScanError(`${path.basename(file)} can't be read`);
  }
  try {
    return JSON.parse(text);
  } catch {
    // Never pass the parser's message on: it quotes the file.
    throw new ScanError(`${path.basename(file)} isn't JSON`);
  }
};

/**
 * The CLI. `io` stands in for the console, the environment, the exceptions
 * file, and today in tests. With --report=<file>, the full report goes to
 * that file, which the workflow uploads with a one-day retention, and
 * nowhere else.
 */
export function main(argv, io = {}) {
  const log = io.log ?? console.log;
  const env = io.env ?? process.env;
  const report = argv.find((arg) => arg.startsWith('--report='))?.slice('--report='.length);
  const [mode, ...files] = argv.filter((arg) => !arg.startsWith('--'));
  const { exceptions, problems } = readExceptions(
    io.exceptionsText ?? readFileSync(EXCEPTIONS_FILE, 'utf8'),
    io.on === undefined ? {} : { on: io.on },
  );
  let title;
  let verdict;
  if (mode === 'exceptions') {
    title = 'scan exceptions';
    verdict = { ok: true };
  } else if (mode === 'image' && files.length > 0) {
    title = 'image scan';
    verdict = evaluateImage(
      files.flatMap((f) => findingsOf(readJson(f))),
      exceptions,
    );
  } else if (mode === 'deps' && files.length === 2) {
    title = 'production dependency scan';
    verdict = evaluateDeps(
      findingsOf(readJson(files[0])),
      findingsOf(readJson(files[1])),
      exceptions,
    );
  } else {
    log(
      'usage: node ci/release/scan-gate.mjs exceptions | image <grype.json>... | deps <head.json> <base.json> [--report=<file>]',
    );
    return 2;
  }
  if (report) {
    mkdirSync(path.dirname(report), { recursive: true });
    writeFileSync(report, `${renderReport(title, verdict)}\n`);
  }
  const summary = renderSummary(title, verdict, problems);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  log(summary);
  for (const problem of problems) log(`::error title=scan exceptions::${problem}`);
  const failing = verdict.failing ?? [];
  if (failing.length > 0) {
    log(
      `::error title=${title}::${failing.length} Critical or High finding(s) fail the scan (${severityCounts(failing)}). The full report is in this run's reports artifact, kept for one day.`,
    );
  }
  return verdict.ok && problems.length === 0 ? 0 : 1;
}

/**
 * main() behind a catch that fails closed: a refusal prints its own
 * message, which names no finding, and anything else prints no message
 * at all, since an unexpected error may quote what it read.
 */
export function run(argv, io = {}) {
  const log = io.log ?? console.log;
  try {
    return main(argv, io);
  } catch (error) {
    log(
      error instanceof ScanError
        ? `::error title=scan::${error.message}`
        : '::error title=scan::scan-gate stopped on an unexpected error, so the scan fails',
    );
    return 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(run(process.argv.slice(2)));
}
