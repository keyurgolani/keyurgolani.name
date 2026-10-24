'use client';

import { useState } from 'react';
import type { DocumentName, SourceDocuments, StudioDraft } from '~/lib/studio/documents';
import { findingsOf } from '~/lib/studio/documents';
import { SourceMode } from '../shell/source-mode';
import { StructuredFields } from './structured-fields';
import './fields.css';

// The content task (#8, Slice 4): structured fields for the common content,
// and source mode for the complete documents, over the one text the shell
// holds. Switching never converts anything: both read and write the same
// documents, so a safe extension field, a comment, or a key no field
// shows stays as written either way. The choice lasts for this tab only.

export type ContentMode = 'fields' | 'source';

/** This tab's last choice, or the fields. */
function initialMode(): ContentMode {
  try {
    return window.sessionStorage.getItem('studio.content-mode') === 'source' ? 'source' : 'fields';
  } catch {
    return 'fields';
  }
}

function remember(mode: ContentMode): void {
  try {
    window.sessionStorage.setItem('studio.content-mode', mode);
  } catch {
    // Storage that can't be reached keeps the choice for this page only.
  }
}

export function ContentEditor({
  documents,
  draft,
  names,
  fileName,
  readOnly,
  dirty,
  saving,
  onEdit,
  onSave,
}: {
  documents: SourceDocuments;
  draft: StudioDraft;
  names: readonly DocumentName[];
  fileName: (name: DocumentName, format: 'yaml' | 'json') => string;
  readOnly: boolean;
  dirty: boolean;
  saving: boolean;
  onEdit: (name: DocumentName, sourceText: string) => void;
  onSave: () => void;
}) {
  const [mode, setMode] = useState<ContentMode>(initialMode);
  const choose = (next: ContentMode) => {
    setMode(next);
    remember(next);
  };
  const count = findingsOf(draft).length;
  return (
    <div className="studio-content">
      <div className="studio-content__modes" role="group" aria-label="Editing mode">
        {(
          [
            ['fields', 'Fields'],
            ['source', 'Source'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="studio-button studio-button--quiet studio-content__mode"
            aria-pressed={mode === value}
            onClick={() => choose(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="studio-content__checks">
        {count === 0
          ? `Saved version ${draft.version} has no findings.`
          : `Saved version ${draft.version} has ${count} ${count === 1 ? 'finding' : 'findings'}. `}
        {count === 0 ? null : <a href="#validation">List every finding.</a>}
      </p>
      {mode === 'fields' ? (
        <StructuredFields
          documents={documents}
          draft={draft}
          fileName={fileName}
          readOnly={readOnly}
          dirty={dirty}
          saving={saving}
          onEdit={onEdit}
          onSave={onSave}
          onSource={() => choose('source')}
        />
      ) : (
        <SourceMode
          documents={documents}
          names={names}
          fileName={fileName}
          readOnly={readOnly}
          dirty={dirty}
          saving={saving}
          onEdit={onEdit}
          onSave={onSave}
        />
      )}
    </div>
  );
}
