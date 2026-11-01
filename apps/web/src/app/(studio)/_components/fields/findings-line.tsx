'use client';

import { useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { namesIn, type DocumentName, type StudioDraft } from '~/lib/studio/documents';
import { openRail } from '../split/studio-split';
import { readDocument } from '~/lib/studio/fields';
import {
  describeDraft,
  findingsLine,
  plainWords,
  SEVERITY_LABEL,
  type FileName,
} from '~/lib/studio/findings';

// The content rail's findings (OWN-3): one line that says what the saved
// draft's findings are, counted, and opens their list in plain words, each
// item by its title and each field as words, never a JSON pointer. A field's
// own finding still shows beside it; this list holds every one, so the
// rail's first view is the fields, not a wall of notices.

/** A finding's words, each name it sets off in backticks drawn as code: "The key `x`…". */
export function CodeWords({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, at) =>
        at % 2 === 1 ? (
          <code key={at} className="studio-fields__key">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** What the preview asks of the findings when the saved draft can't render: show them. */
export interface FindingsLineHandle {
  /** Opens the list, brings it into view, and moves focus to its first finding. */
  show(): void;
}

export function FindingsLine({
  draft,
  dirty,
  fileName,
  handle,
}: {
  draft: StudioDraft;
  dirty: boolean;
  fileName: FileName;
  /** For the blocked preview's Show the problems (the next step it offers). */
  handle?: Ref<FindingsLineHandle>;
}) {
  const views = useMemo(() => describeDraft(draft, fileName), [draft, fileName]);
  const list = useRef<HTMLDetailsElement | null>(null);
  const first = useRef<HTMLLIElement | null>(null);
  useImperativeHandle(
    handle,
    () => ({
      show() {
        const details = list.current;
        if (!details) return;
        details.open = true;
        // A collapsed rail is hidden, and nothing in it scrolls or takes focus: show it first,
        // then land once it renders, a few frames at most.
        if (details.closest('[hidden]')) openRail();
        const land = (frames: number) => {
          if (details.closest('[hidden]') && frames > 0) {
            window.requestAnimationFrame(() => land(frames - 1));
            return;
          }
          details.scrollIntoView({ block: 'nearest' });
          // Focusable for this move alone: once focus leaves it, it's text again, so a click
          // on a finding never moves focus, nor the frame's outline with it.
          const item = first.current;
          if (!item) return;
          item.tabIndex = -1;
          item.focus({ preventScroll: true });
          // Focus didn't take (the rail stayed hidden or collapsed): it's text again at once.
          if (document.activeElement !== item) {
            item.removeAttribute('tabindex');
            return;
          }
          const left = () => {
            // A window switch blurs it but leaves it the document's focus, which comes back to
            // it on return: it stays focusable until focus moves on for real.
            if (document.activeElement === item) return;
            item.removeEventListener('blur', left);
            item.removeAttribute('tabindex');
          };
          item.addEventListener('blur', left);
        };
        land(10);
      },
    }),
    [],
  );
  const data = useMemo(() => {
    const read = new Map<string, unknown>();
    for (const name of namesIn(draft.documents)) {
      const document = draft.documents[name as DocumentName];
      if (!document) continue;
      const result = readDocument(document);
      read.set(name, result.ok ? result.data : undefined);
    }
    return read;
  }, [draft]);
  if (views.length === 0) {
    return <p className="studio-content__checks">Saved version {draft.version} has no findings.</p>;
  }
  return (
    <details ref={list} className="studio-findings">
      <summary className="studio-findings__line">
        <span className="studio-findings__count">{findingsLine(views)}</span>{' '}
        {/* The pronoun agrees with the count: "One finding blocks publishing. Show it". */}
        <span className="studio-findings__show">
          {views.length === 1 ? 'Show it' : 'Show them'}
        </span>
        <span className="studio-findings__hide">
          {views.length === 1 ? 'Hide it' : 'Hide them'}
        </span>
      </summary>
      <div className="studio-findings__body">
        <p className="studio-findings__from">
          From the check on saved version {draft.version}.
          {dirty ? ' Save to check your changes.' : ''}{' '}
          <a href="#validation">List every finding with its line.</a>
        </p>
        <ul className="studio-findings__list">
          {views.map((view, index) => {
            const plain = plainWords(view, data.get(view.finding.document));
            return (
              <li
                key={`${view.finding.document}${view.finding.pointer}${view.finding.code}${index}`}
                className="studio-fields__finding"
                data-severity={view.finding.severity}
                // The first takes focus from the preview's Show the problems, for that move only.
                {...(index === 0 ? { ref: first } : {})}
              >
                <p>
                  {/* Severity in words, every one, since the notice's look never says it alone. */}
                  <strong>{plain.where}</strong>
                  {` (${SEVERITY_LABEL[view.finding.severity] ?? view.finding.severity})`}
                </p>
                <p>
                  <CodeWords text={plain.what} />
                </p>
                <p className="studio-fields__next">{plain.next}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
