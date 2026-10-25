'use client';

import { useEffect, useRef, useState } from 'react';
import type { DemoBackend, LocalSources } from '~/lib/demo/browser-backend';
import type { ExportResult } from '~/lib/demo/export';
import {
  sizeRefusal,
  type ImportInput,
  type ImportRefusal,
  type ImportResult,
} from '~/lib/demo/import';

// Demo Studio's Content task (#9, design note section 3): a file picker for
// exactly two documents, a portfolio and a site, which #137's import reads in
// its module worker, and `Export setup`, which writes the current source, the
// imported pair or the sample, as two YAML files. Everything the import or
// the export says shows as text, never as markup: a finding's pointer and
// message, the remote media it lists by kind and host, what it couldn't
// check, and why it refused. A pick is checked by its count and sizes
// before a byte of it is read, and an import still in the worker when the
// task goes is stopped. A working copy this tab kept shows its findings
// again from the worker's check of it. Nothing here logs, and nothing
// leaves the browser: the files go to the worker, and the export to two
// Blob links in this document.

/** What a refusal says, by its code: never a value from the files. */
export const REFUSAL_TEXT: Readonly<Record<ImportRefusal, string>> = {
  too_many_files: 'Pick exactly two files: one portfolio document and one site document.',
  not_one_document: 'Pick one portfolio document and one site document.',
  too_large: "A file is over 1 MiB, so it wasn't read.",
  parse_limits:
    "A document goes past the import's limits on size, nesting, anchors, or aliases, so it wasn't read.",
  invalid: "The documents don't pass the checks, so nothing was imported.",
  timeout: 'The import took longer than 5 seconds, so it stopped and nothing was imported.',
  worker_unavailable: "The import couldn't start in this browser, so nothing was read.",
};

const OMITTED_TEXT: Readonly<Record<ExportResult['disclosure']['omitted'][number], string>> = {
  'appearance-selection':
    'the appearance you picked in the demo, which this browser keeps apart from the site document',
  'local-images': 'images picked in this browser',
  'yaml-comments': 'comments in your YAML, since the files are written from the data',
};

/** What the report says of a working copy this tab kept, checked again. */
export const KEPT_TEXT = {
  imported: 'The preview shows the documents this tab kept, and only this tab keeps them.',
  refused:
    "The documents this tab kept don't pass the checks now. Import another pair, or use Reset demo in Appearance for the sample.",
  unchecked:
    "The documents this tab kept couldn't be checked again here, so their findings don't show.",
} as const;

/** What the report's status line says. */
function statusOf(result: ImportResult, kept: boolean): string {
  if (result.kind === 'imported') {
    return kept
      ? KEPT_TEXT.imported
      : 'Imported. The preview shows your documents, and only this tab keeps them.';
  }
  if (!kept) return REFUSAL_TEXT[result.code];
  return result.code === 'timeout' || result.code === 'worker_unavailable'
    ? KEPT_TEXT.unchecked
    : KEPT_TEXT.refused;
}

/** The import's answer, as lines of text: for a pick, or for the working copy this tab `kept`. */
export function ImportReport({
  result,
  kept = false,
}: {
  readonly result: ImportResult;
  readonly kept?: boolean;
}) {
  const findings = result.diagnostics;
  return (
    <div className="studio-import__report" data-import={result.kind} data-kept={kept || undefined}>
      <p role="status">{statusOf(result, kept)}</p>
      {findings.length > 0 ? (
        <ul className="studio-import__findings" aria-label="Findings">
          {findings.map((finding, index) => (
            <li key={index} data-code={finding.code}>
              {`${finding.document} ${finding.pointer || '/'}${
                finding.line !== undefined ? `, line ${finding.line}` : ''
              }: ${finding.message} ${finding.remediation}`}
            </li>
          ))}
        </ul>
      ) : null}
      {result.kind === 'imported' && result.remoteImages.length > 0 ? (
        <>
          <p>
            {`The demo loads no remote media, so ${result.remoteImages.length} item${
              result.remoteImages.length === 1 ? '' : 's'
            } show${result.remoteImages.length === 1 ? 's' : ''} as a placeholder:`}
          </p>
          <ul className="studio-import__remote" aria-label="Remote media">
            {result.remoteImages.map((remote, index) => (
              <li key={index}>{`${remote.kind} from ${remote.host} (${remote.pointer})`}</li>
            ))}
          </ul>
        </>
      ) : null}
      {result.kind === 'imported' && result.unchecked && result.unchecked.length > 0 ? (
        <p>{`Not checked here: ${result.unchecked.join(', ')}.`}</p>
      ) : null}
    </div>
  );
}

/** The export's disclosure, as text. */
export function ExportDisclosure({
  disclosure,
}: {
  readonly disclosure: ExportResult['disclosure'];
}) {
  return (
    <div className="studio-export__disclosure">
      <p>{`Schema versions: portfolio ${disclosure.schemaVersions.portfolio}, site ${disclosure.schemaVersions.site}.`}</p>
      {disclosure.omitted.length > 0 ? (
        <p>{`Left out: ${disclosure.omitted.map((each) => OMITTED_TEXT[each]).join('; ')}.`}</p>
      ) : null}
      {disclosure.overImportCap.map((document) => (
        <p key={document} role="alert">
          {`${document}.yml is over the 1 MiB import cap, so it won't import again.`}
        </p>
      ))}
    </div>
  );
}

/** A picked file as the import reads it: its bytes. */
async function inputOf(file: File): Promise<ImportInput> {
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export interface ContentTaskProps {
  readonly backend: DemoBackend;
  /** The local source changed: the frame shows it. */
  readonly onSource: (sources: LocalSources | null) => void;
}

/** Why the files picked can't be read, by their count and sizes alone, before any is: the core's own rule. */
export function pickRefusal(files: ArrayLike<{ readonly size: number }>): ImportRefusal | null {
  return sizeRefusal(Array.from(files, ({ size }) => size));
}

export function ContentTask({ backend, onSource }: ContentTaskProps) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{
    readonly result: ImportResult;
    readonly kept: boolean;
  } | null>(null);
  // Aborted once the task goes, which stops an import still in the worker.
  const mounted = useRef<AbortController | null>(null);
  const [exported, setExported] = useState<{
    readonly links: readonly { readonly name: string; readonly href: string }[];
    readonly disclosure: ExportResult['disclosure'];
  } | null>(null);
  const [exportFailed, setExportFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = controller;
    // The working copy this tab kept: its findings and notices, from the worker's check again.
    if (backend.localSources()) {
      void backend.report().then((result) => {
        if (controller.signal.aborted || !result) return;
        setReport((shown) => shown ?? { result, kept: true });
      });
    }
    return () => controller.abort();
  }, [backend]);

  // Each export's Blob URLs go when the next comes, or the task does.
  useEffect(
    () => () => {
      for (const link of exported?.links ?? []) URL.revokeObjectURL(link.href);
    },
    [exported],
  );

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const signal = mounted.current?.signal;
    if (!signal || signal.aborted) return;
    setExported(null);
    // Too many, too few, or too big: refused before a byte is read.
    const early = pickRefusal(files);
    if (early) {
      setReport({ result: { kind: 'refused', code: early, diagnostics: [] }, kept: false });
      return;
    }
    setBusy(true);
    try {
      const inputs = await Promise.all([...files].map(inputOf));
      const answer = await backend.importFiles(inputs, { signal });
      // The task went, or Reset demo came, while the worker read them: nothing to show.
      if (signal.aborted || !answer) return;
      setReport({ result: answer, kept: false });
      if (answer.kind === 'imported') onSource(backend.localSources());
    } catch {
      if (!signal.aborted) {
        setReport({
          result: { kind: 'refused', code: 'worker_unavailable', diagnostics: [] },
          kept: false,
        });
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  async function exportSetup() {
    setExportFailed(false);
    try {
      const { exportUnit } = await import('~/lib/demo/export');
      const { files, disclosure } = exportUnit({ sources: backend.sources() }, 'yaml');
      setExported({
        links: files.map(({ name, text }) => ({
          name,
          href: URL.createObjectURL(new Blob([text], { type: 'application/yaml' })),
        })),
        disclosure,
      });
    } catch {
      setExported(null);
      setExportFailed(true);
    }
  }

  const local = backend.localSources() !== null;
  return (
    <div className="studio-content">
      <div className="studio-import">
        <label className="studio-label" htmlFor="studio-demo-import">
          Import your portfolio and site documents
        </label>
        <p className="studio-import__hint" id="studio-demo-import-hint">
          Two files, YAML or JSON, up to 1 MiB each. They&apos;re read in this browser and never
          leave it.
        </p>
        <input
          id="studio-demo-import"
          className="studio-input"
          type="file"
          multiple
          accept=".yml,.yaml,.json,application/json"
          aria-describedby="studio-demo-import-hint"
          disabled={busy}
          onChange={(event) => {
            const input = event.currentTarget;
            void pick(input.files).finally(() => {
              input.value = '';
            });
          }}
        />
        {busy ? (
          <p className="studio-import__busy" aria-busy="true">
            Importing…
          </p>
        ) : report ? (
          <ImportReport result={report.result} kept={report.kept} />
        ) : null}
      </div>
      <div className="studio-export">
        <button type="button" className="studio-button" onClick={() => void exportSetup()}>
          Export setup
        </button>
        <p className="studio-export__hint">
          {local
            ? 'Writes your imported documents as two YAML files.'
            : "Writes the sample's documents as two YAML files."}
        </p>
        {exportFailed ? (
          <p className="studio-alert" role="alert">
            The documents couldn&apos;t be exported.
          </p>
        ) : null}
        {exported ? (
          <>
            <ul className="studio-export__files" aria-label="Exported files">
              {exported.links.map((link) => (
                <li key={link.name}>
                  <a href={link.href} download={link.name}>
                    {`Download ${link.name}`}
                  </a>
                </li>
              ))}
            </ul>
            <ExportDisclosure disclosure={exported.disclosure} />
          </>
        ) : null}
      </div>
    </div>
  );
}
