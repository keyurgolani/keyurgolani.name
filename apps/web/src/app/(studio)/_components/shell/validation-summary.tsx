import { findingsOf, type StudioDraft } from '~/lib/studio/documents';

// The validation task (#8, Slice 1): every finding #4's validator made on
// the saved draft, in one list, each with its document, where it is, what's
// wrong, and what to do. Contextual findings beside each field arrive with
// structured editing in #8's next pull request.

const SEVERITY: Readonly<Record<string, string>> = {
  'blocks-preview': 'Blocks preview and publishing',
  'blocks-publish': 'Blocks publishing',
  warning: 'Warning',
};

export function ValidationSummary({ draft, dirty }: { draft: StudioDraft | null; dirty: boolean }) {
  if (!draft) {
    return <p className="studio-task__pending">Nothing is checked until a draft is saved.</p>;
  }
  // What blocks first, then the warnings, each in document order.
  const rank = (severity: string) => Object.keys(SEVERITY).indexOf(severity);
  const findings = [...findingsOf(draft)].sort((a, b) => rank(a.severity) - rank(b.severity));
  return (
    <div className="studio-validation">
      <p>
        {findings.length === 0
          ? `Version ${draft.version} of the draft has no findings.`
          : `Version ${draft.version} of the draft has ${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}.`}
        {dirty ? ' These are for the saved version: save to check your changes.' : ''}
      </p>
      {findings.length > 0 ? (
        <ol className="studio-validation__list">
          {findings.map((finding, index) => (
            <li key={`${finding.document}${finding.pointer}${finding.code}${index}`}>
              <p className="studio-validation__where">
                <strong>{SEVERITY[finding.severity] ?? finding.severity}:</strong>{' '}
                {finding.document}
                {finding.line ? `, line ${finding.line}` : ''}
                {finding.pointer ? `, at ${finding.pointer}` : ''} ({finding.code})
              </p>
              <p>{finding.message}</p>
              <p className="studio-validation__fix">{finding.remediation}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
