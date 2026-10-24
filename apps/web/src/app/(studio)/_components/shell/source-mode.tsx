'use client';

import type { DocumentName, SourceDocuments } from '~/lib/studio/documents';

// The content task's expert source mode (#8, Slice 1): the draft's complete
// portable documents as text, one field each, in their own formats. What
// it saves is the text as written, never a model parsed and written back,
// so comments, key order, and safe extension fields stay as they are. The
// store checks it on save with #4's validator, the same boundary every
// other way in has. Draft text goes in the save's JSON body, never a URL.

export function SourceMode({
  documents,
  names,
  fileName,
  readOnly,
  dirty,
  saving,
  onEdit,
  onSave,
}: {
  documents: SourceDocuments;
  names: readonly DocumentName[];
  fileName: (name: DocumentName, format: 'yaml' | 'json') => string;
  readOnly: boolean;
  dirty: boolean;
  saving: boolean;
  onEdit: (name: DocumentName, sourceText: string) => void;
  onSave: () => void;
}) {
  const blocked = readOnly || saving || !dirty;
  return (
    <form
      className="studio-source"
      aria-label="Source"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked) onSave();
      }}
    >
      <p className="studio-source__lede">
        Source mode edits the complete documents as text. Saving keeps your text exactly as written
        and checks it; it never changes the live site.
      </p>
      {names.map((name) => {
        const document = documents[name];
        if (!document) return null;
        const id = `studio-source-${name}`;
        const file = fileName(name, document.format);
        return (
          <div key={name} className="studio-source__document">
            <label className="studio-label" htmlFor={id}>
              {file}
            </label>
            <textarea
              id={id}
              className="studio-source__text"
              value={document.sourceText}
              readOnly={readOnly}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              rows={18}
              onChange={(event) => onEdit(name, event.target.value)}
            />
          </div>
        );
      })}
      <div className="studio-source__actions">
        <button type="submit" className="studio-button" aria-disabled={blocked ? true : undefined}>
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <p className="studio-source__note">
          {readOnly
            ? 'Resolve the notice above before saving.'
            : dirty
              ? 'Your unsaved changes are kept in this browser until you save.'
              : 'Nothing to save.'}
        </p>
      </div>
    </form>
  );
}
