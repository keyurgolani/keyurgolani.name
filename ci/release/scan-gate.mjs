#!/usr/bin/env node
// The release scan's verdict over Grype's JSON (docs/releasing.md).
//
//   node ci/release/scan-gate.mjs exceptions
//   node ci/release/scan-gate.mjs image <grype.json>...
//   node ci/release/scan-gate.mjs deps <head-grype.json> <base-grype.json>
//
// image fails on a fixable Critical or High finding in the image, on every
// platform scanned. deps fails on a High or Critical finding in the
// production dependencies (ci/release/prod-deps.mjs) that the baseline
// doesn't have: the PR's base on a dry run, the previous final release on a
// release candidate, and nothing for the first one. An entry in
// ci/release/scan-exceptions.yml lets one finding through until its expiry,
// and every mode fails while any entry has expired or isn't valid, whether
// or not it matches anything.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
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
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day
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
    const label = `${at} (${entry.id ?? 'no id'} in ${entry.package ?? 'no package'})`;
    const missing = FIELDS.filter((field) => typeof entry[field] !== 'string' || !entry[field].trim());
    const unknown = Object.keys(entry).filter((key) => !FIELDS.includes(key));
    if (missing.length) problems.push(`${label} lacks ${missing.join(', ')}`);
    if (unknown.length) problems.push(`${label} has unknown keys: ${unknown.join(', ')}`);
    if (missing.length || unknown.length) return;
    let valid = true;
    if (!ID.test(entry.id)) {
      problems.push(`${label}: ${entry.id} isn't a CVE or GHSA id`);
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
    throw new Error("isn't Grype JSON output: it has no matches list");
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

const row = (f) =>
  `| ${f.id} | ${f.package} ${f.version} | ${f.severity} | ${f.fixedIn.length ? f.fixedIn.join(', ') : 'no fix'} |`;
const table = (title, findings) =>
  findings.length === 0
    ? []
    : [
        `**${title}** (${findings.length})`,
        '',
        '| Finding | Package | Severity | Fixed in |',
        '| --- | --- | --- | --- |',
        ...findings.map(row),
        '',
      ];

export function renderSummary(title, verdict, exceptionProblems) {
  const ok = verdict.ok && exceptionProblems.length === 0;
  return [
    `### ${title}: ${ok ? 'passed' : 'failed'}`,
    '',
    ...(exceptionProblems.length
      ? ['**Scan exceptions** (ci/release/scan-exceptions.yml)', '', ...exceptionProblems.map((p) => `- ${p}.`), '']
      : []),
    ...table('Failing', verdict.failing ?? []),
    ...table('Let through by an exception', verdict.excepted ?? []),
    ...table('Unfixable, reported only', verdict.unfixable ?? []),
    ...table('Already in the baseline', verdict.known ?? []),
    ...(ok && !(verdict.excepted ?? []).length && !(verdict.unfixable ?? []).length && !(verdict.known ?? []).length
      ? ['No Critical or High finding.', '']
      : []),
  ].join('\n');
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
};

function main(argv) {
  const [mode, ...files] = argv;
  const { exceptions, problems } = readExceptions(readFileSync(EXCEPTIONS_FILE, 'utf8'));
  let title;
  let verdict;
  if (mode === 'exceptions') {
    title = 'scan exceptions';
    verdict = { ok: true };
  } else if (mode === 'image' && files.length > 0) {
    title = `image scan (${files.map((f) => path.basename(f)).join(', ')})`;
    verdict = evaluateImage(files.flatMap((f) => findingsOf(readJson(f))), exceptions);
  } else if (mode === 'deps' && files.length === 2) {
    title = 'production dependency scan';
    verdict = evaluateDeps(findingsOf(readJson(files[0])), findingsOf(readJson(files[1])), exceptions);
  } else {
    console.error(
      'usage: node ci/release/scan-gate.mjs exceptions | image <grype.json>... | deps <head.json> <base.json>',
    );
    return 2;
  }
  const summary = renderSummary(title, verdict, problems);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(summary);
  for (const problem of problems) console.log(`::error title=scan exceptions::${problem}`);
  for (const f of verdict.failing ?? []) {
    console.log(
      `::error title=${title}::${f.severity} ${f.id} in ${f.package} ${f.version}${f.fixedIn.length ? `, fixed in ${f.fixedIn.join(', ')}` : ''}`,
    );
  }
  return verdict.ok && problems.length === 0 ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.log(`::error title=scan::${error.message}`);
    process.exit(1);
  }
}
