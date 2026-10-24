'use client';

import { useEffect, useRef } from 'react';
import { namesIn, type DocumentName, type StudioDraft } from '~/lib/studio/documents';
import type { JournalEntry } from '~/lib/studio/journal';

// What the shell shows when two versions of the draft meet (#8, Slice 1):
// a save that found a newer version, or unsaved text this browser kept for
// a draft that isn't the working one any more. Nothing has been overwritten
// when either shows: the newer version is the store's, and this tab's text
// is in the editor and the local journal. The owner picks one, and until
// then both stay recoverable. Each panel takes focus as it appears, so a
// keyboard or screen reader user meets it first.

function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

export function ConflictPanel({
  theirs,
  fileName,
  saving,
  onKeepMine,
  onTakeTheirs,
}: {
  theirs: StudioDraft;
  fileName: (name: DocumentName, format: 'yaml' | 'json') => string;
  saving: boolean;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  const ref = useFocusOnMount<HTMLElement>();
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="studio-conflict"
      aria-labelledby="studio-conflict-heading"
    >
      <h3 id="studio-conflict-heading">Version {theirs.version} was saved first</h3>
      <p>
        Another tab, or the command line, saved version {theirs.version} of the draft after you
        started. Nothing was overwritten: version {theirs.version} is the saved draft, and your
        changes are still here and kept in this browser. Choose which to keep.
      </p>
      <details className="studio-conflict__theirs">
        <summary>Show version {theirs.version}</summary>
        {namesIn(theirs.documents).map((name) => {
          const document = theirs.documents[name];
          if (!document) return null;
          const id = `studio-conflict-${name}`;
          return (
            <div key={name} className="studio-source__document">
              <label className="studio-label" htmlFor={id}>
                {fileName(name, document.format)}, version {theirs.version}
              </label>
              <textarea
                id={id}
                className="studio-source__text"
                value={document.sourceText}
                readOnly
                spellCheck={false}
                rows={10}
              />
            </div>
          );
        })}
      </details>
      <div className="studio-conflict__actions">
        <button
          type="button"
          className="studio-button"
          aria-disabled={saving ? true : undefined}
          onClick={() => {
            if (!saving) onKeepMine();
          }}
        >
          Keep my changes
        </button>
        <button
          type="button"
          className="studio-button studio-button--quiet"
          aria-disabled={saving ? true : undefined}
          onClick={() => {
            if (!saving) onTakeTheirs();
          }}
        >
          Use version {theirs.version}
        </button>
      </div>
      <p className="studio-conflict__note">
        Keep my changes saves your text as the next version, on top of version {theirs.version}. Use
        version {theirs.version} puts it in the editor and lets your changes go.
      </p>
    </section>
  );
}

const SAVED_AT = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export function OrphanPanel({
  orphan,
  canAdopt,
  onAdopt,
  onDrop,
}: {
  orphan: JournalEntry;
  canAdopt: boolean;
  onAdopt: () => void;
  onDrop: () => void;
}) {
  const ref = useFocusOnMount<HTMLElement>();
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="studio-conflict"
      aria-labelledby="studio-orphan-heading"
    >
      <h3 id="studio-orphan-heading">Unsaved changes from an earlier draft</h3>
      <p>
        This browser kept unsaved changes from {SAVED_AT.format(orphan.savedAt)} for a draft that
        isn&apos;t the working draft any more. They&apos;re still here until you choose.
      </p>
      <div className="studio-conflict__actions">
        {canAdopt ? (
          <button type="button" className="studio-button" onClick={onAdopt}>
            Put them in the working draft
          </button>
        ) : null}
        <button type="button" className="studio-button studio-button--quiet" onClick={onDrop}>
          Discard them
        </button>
      </div>
    </section>
  );
}
