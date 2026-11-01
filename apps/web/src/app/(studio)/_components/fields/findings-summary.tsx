import type { StudioDraft } from '~/lib/studio/documents';
import { describeDraft, SEVERITY_LABEL, type FileName } from '~/lib/studio/findings';

// The one complete summary (#8, Slice 4): every finding #4's validator made
// on the saved draft, the boundary source mode, the fields, and publish all
// share, each with its document, stable item, field, cause, and next
// action. It renders describeDraft()'s list, and nothing of its own.

export function FindingsSummary({
  draft,
  dirty,
  fileName,
}: {
  draft: StudioDraft | null;
  dirty: boolean;
  fileName: FileName;
}) {
  if (!draft) {
    return <p className="studio-task__pending">Nothing is checked until a draft is saved.</p>;
  }
  const views = describeDraft(draft, fileName);
  return (
    <div className="studio-validation">
      <p>
        {views.length === 0
          ? `Version ${draft.version} of the draft has no findings.`
          : `Version ${draft.version} of the draft has ${views.length} ${views.length === 1 ? 'finding' : 'findings'}.`}
        {dirty ? ' These are for the saved version: save to check your changes.' : ''}
      </p>
      {views.length > 0 ? (
        <ol className="studio-validation__list">
          {views.map((view, index) => (
            <li
              key={`${view.finding.document}${view.finding.pointer}${view.finding.code}${index}`}
              data-severity={view.finding.severity}
            >
              <p className="studio-validation__where">
                <strong>{SEVERITY_LABEL[view.finding.severity] ?? view.finding.severity}</strong> (
                {view.finding.code})
              </p>
              <dl className="studio-validation__facts">
                <div>
                  <dt>Document</dt>
                  <dd>
                    {view.file}
                    {view.finding.line ? `, line ${view.finding.line}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Item</dt>
                  <dd>{view.item}</dd>
                </div>
                <div>
                  <dt>Field</dt>
                  <dd>{view.field ?? 'The item itself'}</dd>
                </div>
                <div>
                  <dt>Cause</dt>
                  <dd>{view.cause}</dd>
                </div>
                <div>
                  <dt>Next</dt>
                  <dd className="studio-validation__fix">{view.next}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
