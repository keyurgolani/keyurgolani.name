#!/usr/bin/env node
// Validates the failure records in reports/failures/ against
// ci/failure-record.schema.json and renders them as Markdown into the GitHub
// job summary (or stdout outside Actions). Exits 1 when a record is invalid,
// so a producer that drifts from the schema fails its job.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFailureRecords, reportError, reportsDir, SCHEMA_PATH } from './lib/reports.mjs';

const CONTEXT_FIELDS = [
  'package',
  'variant',
  'pack',
  'axis',
  'profile',
  'route',
  'viewport',
  'inputMode',
  'displayMode',
  'semanticRole',
  'asset',
  // 1.1 (#11): the quality gates' rule, preference row, tuple, and element.
  'rule',
  'preferenceMode',
  'tuple',
  'uiSlot',
  'accessibleName',
  'tokenRole',
  'exceptionId',
];

export async function loadValidator() {
  let Ajv2020;
  try {
    ({ default: Ajv2020 } = await import('ajv/dist/2020.js'));
  } catch (error) {
    throw new Error(`ajv is not installed (${error.message}). Run pnpm install first.`);
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  return ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
}

/** Splits entries into valid records and problems (unreadable or invalid). */
export function checkRecords(entries, validate) {
  const records = [];
  const problems = [];
  for (const { file, record, error } of entries) {
    if (error) {
      problems.push({ file, message: error });
    } else if (!validate(record)) {
      const details = validate.errors
        .map((e) => `${e.instancePath || '(record)'} ${e.message}`)
        .join('; ');
      problems.push({ file, message: `does not match the failure record schema: ${details}` });
    } else {
      records.push(record);
    }
  }
  return { records, problems };
}

function cell(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function code(value) {
  return value ? `<code>${cell(value).replace(/</g, '&lt;')}</code>` : '';
}

export function renderMarkdown(records) {
  if (records.length === 0) return '';
  const lines = [
    `### Failures (${records.length})`,
    '',
    '| Gate | Test | Context | Expected | Actual | Threshold | Artifacts | Reproduce |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of records) {
    const context = CONTEXT_FIELDS.filter((f) => r[f] !== undefined)
      .map((f) => `${f}=${r[f]}`)
      .join(', ');
    lines.push(
      `| ${[
        cell(r.gate),
        cell(r.test),
        cell(context),
        cell(r.expected),
        cell(r.actual),
        cell(r.threshold),
        cell((r.artifacts ?? []).join(', ')),
        code(r.reproCommand),
      ].join(' | ')} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const entries = readFailureRecords();
  if (entries.length === 0) {
    console.log(`[ci] no failure records in ${path.relative(process.cwd(), reportsDir())}`);
    return 0;
  }

  let validate;
  try {
    validate = await loadValidator();
  } catch (error) {
    reportError(`cannot validate failure records: ${error.message}`);
    return 1;
  }

  const { records, problems } = checkRecords(entries, validate);
  for (const { file, message } of problems) {
    reportError(`${path.relative(process.cwd(), file)} ${message}`, { title: 'failure record' });
  }

  const markdown = renderMarkdown(records);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  console.log(markdown);
  return problems.length === 0 ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
