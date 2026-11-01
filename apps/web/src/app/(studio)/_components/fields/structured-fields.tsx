'use client';

import { useMemo, useState } from 'react';
import type { DocumentName, SourceDocuments, StudioDraft } from '~/lib/studio/documents';
import {
  editField,
  fieldGroups,
  JSON_REWRITE,
  readDocument,
  rewritesJson,
  type BoundField,
  type FieldGroup,
} from '~/lib/studio/fields';
import {
  describeDraft,
  placeFindings,
  plainWords,
  SEVERITY_LABEL,
  type FindingView,
  type PlacedFinding,
  type PlainFinding,
} from '~/lib/studio/findings';
import { CodeWords } from './findings-line';

// The content task's structured fields (#8, Slice 4): the portfolio's
// common content, as fields over the same text source mode edits. Each
// change goes through #4's applyEdits into the editor's text, as a source
// edit does, so the local journal, the state model, and the save with its
// expectedVersion are the shell's, unchanged. Each of the saved draft's
// findings shows beside its field, or its item when no field holds it, in
// plain words (OWN-3). What no field or item here holds, such as a
// chronology entry's link, is in the rail's one findings line, never a
// stack of notes over the document's first fields.

export function StructuredFields({
  documents,
  draft,
  fileName,
  readOnly,
  dirty,
  saving,
  onEdit,
  onSave,
  onSource,
  saveInBar = false,
}: {
  documents: SourceDocuments;
  draft: StudioDraft;
  fileName: (name: DocumentName, format: 'yaml' | 'json') => string;
  readOnly: boolean;
  dirty: boolean;
  saving: boolean;
  onEdit: (name: DocumentName, sourceText: string) => void;
  onSave: () => void;
  onSource: () => void;
  /** Whether Save draft is a bar's, outside this form, as the split has it. */
  saveInBar?: boolean;
}) {
  const portfolio = documents.portfolio;
  const file = fileName('portfolio', portfolio.format);
  const read = useMemo(() => readDocument(portfolio), [portfolio]);
  const groups = useMemo(() => (read.ok ? fieldGroups(read.data) : []), [read]);
  const findings = useMemo(() => describeDraft(draft, fileName), [draft, fileName]);
  // The saved text the findings were made on, placed by item over the working text.
  const saved = useMemo(() => readDocument(draft.documents.portfolio), [draft]);
  const placed = useMemo(
    () => (read.ok ? placeFindings(findings, saved.ok ? saved.data : undefined, read.data) : []),
    [findings, saved, read],
  );
  const plain = (view: FindingView) => plainWords(view, saved.ok ? saved.data : undefined);
  // A JSON document a field edit would write out differently stays with source mode.
  const rewrites = useMemo(() => rewritesJson(portfolio), [portfolio]);
  // A change applyEdits couldn't make, by field, until the next one it can.
  const [refused, setRefused] = useState<Readonly<Record<string, string>>>({});
  const blocked = readOnly || saving || !dirty;

  if (!read.ok) {
    return (
      <div className="studio-fields__unread">
        <p>
          {file} doesn&apos;t read as {portfolio.format === 'yaml' ? 'YAML' : 'JSON'}
          {read.problem.line ? ` at line ${read.problem.line}` : ''}: {read.problem.message}
        </p>
        <p>The fields come back once it reads. Fix it in source mode.</p>
        <button type="button" className="studio-button studio-button--quiet" onClick={onSource}>
          Edit in source mode
        </button>
      </div>
    );
  }

  function change(field: BoundField, value: string) {
    const result = editField(portfolio, field, value);
    if (!result.ok) {
      setRefused((current) => ({ ...current, [field.pointer]: result.message }));
      return;
    }
    if (refused[field.pointer] !== undefined) {
      setRefused((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([pointer]) => pointer !== field.pointer),
        ),
      );
    }
    if (result.sourceText !== portfolio.sourceText) onEdit('portfolio', result.sourceText);
  }

  return (
    <form
      className="studio-fields"
      aria-label="Fields"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked) onSave();
      }}
    >
      {/* How the fields work, for whoever asks, behind its disclosure (OWN-3). */}
      <details className="studio-fields__about">
        <summary>How the fields edit {file}</summary>
        <p className="studio-fields__lede">
          Fields edit the portfolio&apos;s common content in {file}. Each change is made in the
          document&apos;s text, as source mode would make it, so anything else there stays as
          written. Saving checks it; it never changes the live site.
        </p>
      </details>
      {rewrites ? <p className="studio-alert">{JSON_REWRITE}</p> : null}
      {groups.map((group) => (
        <Group
          key={group.key}
          group={group}
          placed={placed.filter(
            // The document's own notes on no field are the findings line's, above.
            (each) =>
              each.group === group.pointer && (group.key !== 'document' || each.field !== null),
          )}
          plain={plain}
          readOnly={readOnly || rewrites}
          refused={refused}
          onChange={change}
        />
      ))}
      <div className="studio-source__actions">
        {/* In the split, Save draft is the top bar's, so there's one. */}
        {saveInBar ? null : (
          <button
            type="submit"
            className="studio-button"
            aria-disabled={blocked ? true : undefined}
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        )}
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

/** A finding's text beside its field or item: what, why, and what next. */
function FindingNote({
  view,
  plain,
  changed,
  named = false,
}: {
  view: FindingView;
  /** Its words: the field's, never its pointer. */
  plain: PlainFinding;
  changed: boolean;
  /** Whether to name the item: a note whose item is gone shows on the document. */
  named?: boolean;
}) {
  return (
    <div className="studio-fields__finding" data-severity={view.finding.severity}>
      <p>
        <strong>{SEVERITY_LABEL[view.finding.severity] ?? view.finding.severity}:</strong>{' '}
        {named ? `${plain.where}. ` : ''}
        <CodeWords text={plain.what} />
      </p>
      <p className="studio-fields__next">{plain.next}</p>
      {changed ? (
        <p className="studio-fields__stale">
          You changed this after that check. Save to check it again.
        </p>
      ) : null}
    </div>
  );
}

function Group({
  group,
  placed,
  plain,
  readOnly,
  refused,
  onChange,
}: {
  group: FieldGroup;
  /** The findings placed in this group. */
  placed: readonly PlacedFinding[];
  plain: (view: FindingView) => PlainFinding;
  readOnly: boolean;
  refused: Readonly<Record<string, string>>;
  onChange: (field: BoundField, value: string) => void;
}) {
  const itemLevel = placed.filter((each) => each.field === null);
  const heading = `studio-fields-${idFor(group.pointer)}`;
  return (
    <fieldset
      className="studio-fields__group"
      aria-labelledby={heading}
      data-pointer={group.pointer}
    >
      <legend id={heading} className="studio-fields__item">
        {group.item}
      </legend>
      {group.facts.length > 0 ? (
        <dl className="studio-fields__facts">
          {group.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {itemLevel.map((each, index) => (
        <FindingNote
          key={`${each.view.finding.code}${each.view.finding.pointer}${index}`}
          view={each.view}
          plain={plain(each.view)}
          changed={each.stale}
          named={group.key !== each.view.at?.group}
        />
      ))}
      {group.fields.map((field) => (
        <Field
          key={field.pointer}
          field={field}
          readOnly={readOnly}
          refused={refused[field.pointer]}
          placed={placed.filter((each) => each.field === field.pointer)}
          plain={plain}
          onChange={onChange}
        />
      ))}
      {group.extensions.length > 0 ? (
        <p className="studio-fields__extensions">
          Extension fields, kept as written: {group.extensions.join(', ')}. Edit them in source
          mode.
        </p>
      ) : null}
    </fieldset>
  );
}

/** A pointer as an element id's tail. */
function idFor(pointer: string): string {
  return pointer === '' ? 'document' : pointer.slice(1).replace(/[^A-Za-z0-9_-]/g, '-');
}

function Field({
  field,
  readOnly,
  refused,
  placed,
  plain,
  onChange,
}: {
  field: BoundField;
  readOnly: boolean;
  refused: string | undefined;
  placed: readonly PlacedFinding[];
  plain: (view: FindingView) => PlainFinding;
  onChange: (field: BoundField, value: string) => void;
}) {
  const id = `studio-field-${idFor(field.pointer)}`;
  const { spec } = field;
  const label = `${spec.label}${spec.required ? ' (required)' : ''}`;
  const locked = readOnly || !field.editable;
  const common = {
    id,
    className: spec.kind === 'long' ? 'studio-fields__long' : 'studio-input',
    value: field.value,
    readOnly: locked,
    onChange: (event: { target: { value: string } }) => onChange(field, event.target.value),
  };
  return (
    <div className="studio-fields__field" data-pointer={field.pointer}>
      <label className="studio-label" htmlFor={id}>
        {label}
      </label>
      {spec.kind === 'long' ? (
        <textarea {...common} rows={4} />
      ) : spec.kind === 'choice' ? (
        <select
          id={common.id}
          className={common.className}
          value={common.value}
          disabled={locked}
          onChange={common.onChange}
        >
          {(spec.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {spec.options?.some((option) => option.value === field.value) ? null : (
            <option value={field.value}>{field.value || 'Left out'}</option>
          )}
        </select>
      ) : (
        <>
          <input
            {...common}
            type="text"
            autoComplete="off"
            list={spec.suggestions ? `${id}-suggestions` : undefined}
          />
          {spec.suggestions ? (
            <datalist id={`${id}-suggestions`}>
              {spec.suggestions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
      {field.editable ? null : (
        <p className="studio-fields__note">
          This holds a value a text field can&apos;t show. Edit it in source mode.
        </p>
      )}
      {refused ? <p className="studio-fields__note">{refused}</p> : null}
      {placed.map((each, index) => (
        <FindingNote
          key={`${each.view.finding.code}${each.view.finding.pointer}${index}`}
          view={each.view}
          plain={plain(each.view)}
          changed={each.stale}
        />
      ))}
    </div>
  );
}
