// Shared helpers for CI reports: failure records and GitHub annotations.
// Pure Node, no dependencies, so the runner works before `pnpm install`.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCHEMA_VERSION = '1.0';
export const SCHEMA_PATH = path.join(REPO_ROOT, 'ci', 'failure-record.schema.json');

/** Root of everything a CI job uploads. */
export function reportsDir() {
  return path.resolve(process.env.CI_REPORTS_DIR ?? path.join(REPO_ROOT, 'reports'));
}

export function failuresDir() {
  return path.join(reportsDir(), 'failures');
}

/**
 * Builds a record, dropping empty fields so optional ones stay absent. It's
 * written against SCHEMA_VERSION unless `fields` names another, as #11's
 * quality records name 1.1 (tests/quality/lib/failure-records.ts).
 */
export function failureRecord(fields) {
  const record = { schemaVersion: SCHEMA_VERSION };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    record[key] = value;
  }
  return record;
}

/**
 * The gate and local command for records a check writes itself. Set by
 * ci/run.mjs; null when the check runs outside it, so nothing is written.
 */
export function currentGate(env = process.env) {
  return env.CI_GATE
    ? { gate: env.CI_GATE, reproCommand: env.CI_REPRO ?? `pnpm ci:${env.CI_GATE}` }
    : null;
}

/** Writes one record per file, so parallel writers never share a file. */
export function writeFailureRecord(fields, dir = failuresDir()) {
  const record = failureRecord(fields);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.gate ?? 'unknown'}-${Date.now()}-${randomUUID()}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export function listFailureFiles(dir = failuresDir()) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(dir, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Returns `{ file, record }` or `{ file, error }` for each record file. */
export function readFailureRecords(dir = failuresDir()) {
  return listFailureFiles(dir).map((file) => {
    try {
      return { file, record: JSON.parse(readFileSync(file, 'utf8')) };
    } catch (error) {
      return { file, error: `not valid JSON: ${error.message}` };
    }
  });
}

const inActions = () => process.env.GITHUB_ACTIONS === 'true';

function escapeData(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value) {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * Prints an error. In GitHub Actions it is also a workflow annotation, so it
 * shows on the run summary and, with `file`, inline on the diff.
 */
export function reportError(message, { title, file, line } = {}) {
  if (!inActions()) {
    const where = file ? `${file}${line ? `:${line}` : ''}: ` : '';
    console.error(`${where}${message}`);
    return;
  }
  const props = [];
  if (file) props.push(`file=${escapeProperty(file)}`);
  if (line) props.push(`line=${line}`);
  if (title) props.push(`title=${escapeProperty(title)}`);
  console.log(`::error${props.length ? ` ${props.join(',')}` : ''}::${escapeData(message)}`);
}
