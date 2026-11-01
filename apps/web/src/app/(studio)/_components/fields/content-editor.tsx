'use client';

import { useState, type Ref } from 'react';
import type { DocumentName, SourceDocuments, StudioDraft } from '~/lib/studio/documents';
import { SourceMode } from '../shell/source-mode';
import { FindingsLine, type FindingsLineHandle } from './findings-line';
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
  saveInBar = false,
  findings,
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
  /** Whether Save draft is a bar's, as the split has it, rather than each mode's own. */
  saveInBar?: boolean;
  /** The findings line's handle, for the blocked preview's Show the problems. */
  findings?: Ref<FindingsLineHandle>;
}) {
  const [mode, setMode] = useState<ContentMode>(initialMode);
  const choose = (next: ContentMode) => {
    setMode(next);
    remember(next);
  };
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
      {/* One line for the saved draft's findings, which opens their list (OWN-3). */}
      <FindingsLine draft={draft} dirty={dirty} fileName={fileName} handle={findings} />
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
          saveInBar={saveInBar}
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
          saveInBar={saveInBar}
        />
      )}
    </div>
  );
}
