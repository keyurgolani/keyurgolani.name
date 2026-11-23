import type { ReactNode } from 'react';
import {
  footerOutline,
  present,
  VisitorControlSlot,
  type OutlineSection,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Cols, Rows, Squares, Stat } from './diff';
import { commitMessage, hashOf, PANELS, type DiffFile, type PanelId } from './model';
import {
  Avatar,
  Message,
  PANEL_LABELS,
  recordHref,
  Sr,
  Tick,
  uiLangOf,
  Who,
  Words,
  type Review,
} from './parts';

// The review page's chrome (issue #270): the change's header, the tabs and
// the file tree, the side column of reviewers, labels and author, the
// timeline's own events, and the footer. Every word here is the metaphor's
// furniture or the owner's, and every link is real without a script.

/** The change's header: the branches, the title, its state, and its size. */
export function Header({
  input,
  review,
  title,
}: {
  input: VariantRenderInput;
  review: Review;
  /** The page's h1, when it isn't the change's own title (a work's page). */
  title?: ReactNode;
}) {
  const lang = uiLangOf(input);
  const name = input.portfolio.identity.name;
  const hero = input.portfolio.sections.find((section) => section.kind === 'hero');
  const shown = hero?.kind === 'hero' && present(hero.name) ? hero.name : name;
  return (
    <header className="pr-head">
      <p className="pr-ref">
        <code className="pr-br">{review.base}</code>
        <span className="pr-from" aria-hidden="true" />
        <Sr lang={lang}> from </Sr>
        <code className="pr-br pr-br--head">{review.head}</code>
        <span className="pr-ref__no">
          <Words lang={lang}>Change 1 of 1</Words>
        </span>
      </p>
      {title ?? (
        <h1 className="pr-title" data-type-role="display">
          <Words lang={lang}>Add</Words> <span>{shown}</span>{' '}
          <Words lang={lang}>to your team</Words>
        </h1>
      )}
      <p className="pr-meta">
        <span className="pr-state" data-pr-state="">
          <span className="pr-state__dot" aria-hidden="true" />
          <span data-pr-state-text="" lang={lang}>
            Open
          </span>
        </span>{' '}
        <Who review={review}>
          <Words lang={lang}>
            {review.commits > 0
              ? `proposes ${review.commits} ${review.commits === 1 ? 'commit' : 'commits'} from`
              : 'proposes a change from'}
          </Words>{' '}
          <code>{review.head}</code> <Words lang={lang}>into</Words> <code>{review.base}</code>
        </Who>
      </p>
      {review.files.length > 0 ? (
        <p className="pr-size">
          <Stat adds={review.stat.adds} dels={review.stat.dels} lang={lang} />{' '}
          <Words lang={lang}>
            {`across ${review.files.length} ${review.files.length === 1 ? 'file' : 'files'}`}
          </Words>
          <Squares adds={review.stat.adds} dels={review.stat.dels} of={20} />
        </p>
      ) : null}
    </header>
  );
}

/** Which panels the page has: one with a section, the conversation always. */
export function panelsOf(review: Review): PanelId[] {
  return PANELS.filter(
    (panel) => panel === 'conversation' || review.sections.some((each) => each.panel === panel),
  );
}

/** The tabs: a real link to each panel, its count, and what it reads as; Merge last. */
export function Tabs({ input, review }: { input: VariantRenderInput; review: Review }) {
  const lang = uiLangOf(input);
  const counts: Partial<Record<PanelId, number>> = {
    commits: review.commits,
    checks: review.checks,
    files: review.files.length,
  };
  const panels = panelsOf(review);
  return (
    <nav className="pr-tabs" aria-label="This change" data-pr-tabs="" lang={lang}>
      <ul className="pr-tabs__l" role="list">
        {panels.map((panel) => (
          <li key={panel}>
            <a
              className="pr-tab"
              href={`#${review.ids.panel(panel)}`}
              id={`${review.ids.panel(panel)}-tab`}
              data-pr-tab={panel}
            >
              <span className="pr-tab__l">{PANEL_LABELS[panel].label}</span>
              {counts[panel] ? <span className="pr-tab__n">{counts[panel]}</span> : null}
              <span className="pr-tab__d">{PANEL_LABELS[panel].dest}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="pr-tabs__merge">
        <a className="pr-tab" href={`#${review.ids.panel('merge')}`} data-pr-to-merge="">
          <span className="pr-tab__l">{PANEL_LABELS.merge.label}</span>
          <span className="pr-tab__d">{PANEL_LABELS.merge.dest}</span>
        </a>
      </p>
    </nav>
  );
}

/** The file tree: each directory, each file with its size, and how many are viewed. */
export function Tree({
  input,
  review,
  anchorOf,
}: {
  input: VariantRenderInput;
  review: Review;
  anchorOf: (file: DiffFile) => string | undefined;
}) {
  const lang = uiLangOf(input);
  if (review.files.length === 0) return null;
  const dirs: { dir: string; files: DiffFile[] }[] = [];
  for (const file of review.files) {
    const group = dirs.find((each) => each.dir === file.dir);
    if (group) group.files.push(file);
    else dirs.push({ dir: file.dir, files: [file] });
  }
  return (
    <nav className="pr-tree" aria-labelledby={`${review.ids.tree}-h`} id={review.ids.tree}>
      <p className="pr-tree__h">
        <span id={`${review.ids.tree}-h`}>
          <Words lang={lang}>Files</Words>
        </span>{' '}
        <span className="pr-tree__n" data-pr-viewed-count="" aria-live="polite" lang={lang}>
          {`0 of ${review.files.length} viewed`}
        </span>
      </p>
      <span className="pr-prog" aria-hidden="true">
        <i data-pr-progress="" />
      </span>
      <ul className="pr-tree__l" role="list">
        {dirs.map(({ dir, files }) => (
          <li key={dir}>
            <code className="pr-tree__d">{dir}/</code>
            <ul role="list">
              {files.map((file) => {
                const anchor = anchorOf(file);
                const href = anchor ? `#${anchor}` : review.routed.get(file.id);
                return (
                  <li key={file.id} data-pr-tree-file={file.id}>
                    {href ? (
                      <a className="pr-tree__f" href={href}>
                        <code className="pr-tree__name">{file.name}</code>
                        <span className="pr-tree__s">
                          <Stat adds={file.adds} dels={file.dels} lang={lang} />
                        </span>
                      </a>
                    ) : (
                      <code className="pr-tree__name">{file.name}</code>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The side column: the reviewer (you), the labels (the skill groups), and the author. */
export function Side({
  input,
  labels,
}: {
  input: VariantRenderInput;
  labels: { readonly href: string; readonly names: readonly string[] } | undefined;
}) {
  const lang = uiLangOf(input);
  const { identity } = input.portfolio;
  return (
    <div className="pr-side" lang={lang}>
      <div className="pr-side__b">
        <p className="pr-side__h">Reviewers</p>
        <p className="pr-side__you">
          <Avatar initials="Y" you /> You{' '}
          <span className="pr-quiet" data-pr-reviewer="">
            requested
          </span>
        </p>
      </div>
      {labels && labels.names.length > 0 ? (
        <div className="pr-side__b">
          <p className="pr-side__h">Labels</p>
          <ul className="pr-labels" role="list" lang={input.portfolio.locale}>
            {labels.names.map((name) => (
              <li key={name} className="pr-label">
                <a href={labels.href}>{name}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="pr-side__b" lang={input.portfolio.locale}>
        <p className="pr-side__h" lang={lang ?? 'en'}>
          Author
        </p>
        <p className="pr-side__who">
          <b>{identity.name}</b>
          {present(identity.pronouns) ? (
            <span className="pr-quiet"> ({identity.pronouns})</span>
          ) : null}
        </p>
        {present(identity.tagline) ? <p className="pr-quiet">{identity.tagline}</p> : null}
        {present(identity.location) ? <p className="pr-quiet">{identity.location}</p> : null}
      </div>
    </div>
  );
}

/** One event in the timeline that isn't a section: its mark, then what happened. */
function Event({
  mark,
  children,
  id,
  hidden,
}: {
  mark: string;
  children: ReactNode;
  id?: string;
  hidden?: boolean;
}) {
  return (
    <li className="pr-ev pr-ev--sys" data-mark={mark} id={id} hidden={hidden}>
      <span className="pr-ev__mark" aria-hidden="true">
        {mark === 'check' ? <Tick /> : null}
      </span>
      <div className="pr-ev__b">{children}</div>
    </li>
  );
}

/** The notes on the diff: the first file with a note, its changed lines and their notes. */
export function NotesEvent({
  input,
  review,
  panelHref,
}: {
  input: VariantRenderInput;
  review: Review;
  panelHref: string;
}) {
  const lang = uiLangOf(input);
  const file =
    review.files.find(
      (each) => each.status === 'modified' && each.lines.some((l) => l.kind !== 'hunk' && l.note),
    ) ?? review.files.find((each) => each.lines.some((l) => l.kind !== 'hunk' && l.note));
  if (!file || review.notes === 0) return null;
  const excerpt = file.lines.filter((line) => line.kind !== 'ctx' || line.note);
  const href = recordHref(input, { id: file.id }, review) ?? panelHref;
  return (
    <Event mark="note">
      <p className="pr-ev__t">
        <Who review={review}>
          <Words
            lang={lang}
          >{`left ${review.notes} ${review.notes === 1 ? 'note' : 'notes'} on the diff`}</Words>
        </Who>
      </p>
      <div className="pr-excerpt">
        <p className="pr-excerpt__h">
          <a href={href}>
            <code>{file.path}</code>
          </a>
        </p>
        <table className="pr-diff">
          <caption className="pr-sr">
            <Words lang={lang}>An excerpt of</Words> {file.path}
          </caption>
          <Cols />
          <tbody>
            <Rows lines={excerpt} review={review} input={input} />
          </tbody>
        </table>
      </div>
    </Event>
  );
}

/** The commits event: how many, the three newest, and a link to the rest. */
export function CommitsEvent({
  input,
  review,
  panelHref,
}: {
  input: VariantRenderInput;
  review: Review;
  panelHref: string;
}) {
  const lang = uiLangOf(input);
  if (review.commits === 0) return null;
  const first = review.latest.slice(0, 3);
  return (
    <Event mark="commit">
      <p className="pr-ev__t">
        <Who review={review}>
          <Words
            lang={lang}
          >{`added ${review.commits} ${review.commits === 1 ? 'commit' : 'commits'}`}</Words>
        </Who>
      </p>
      <ol className="pr-mini" role="list">
        {first.map((entry) => {
          const href = recordHref(input, entry, review);
          return (
            <li key={entry.id}>
              <code className="pr-hash" aria-hidden="true">
                {hashOf(entry.id)}
              </code>{' '}
              {href ? (
                <a href={href}>
                  <Message segments={commitMessage(entry)} lang={lang} />
                </a>
              ) : (
                <Message segments={commitMessage(entry)} lang={lang} />
              )}
            </li>
          );
        })}
      </ol>
      {review.commits > first.length ? (
        <p className="pr-quiet">
          <a href={panelHref}>
            <Words lang={lang}>{`${review.commits - first.length} more in Commits`}</Words>
          </a>
        </p>
      ) : null}
    </Event>
  );
}

/** The checks event: they all passed, and where they are. */
export function ChecksEvent({
  input,
  review,
  panelHref,
}: {
  input: VariantRenderInput;
  review: Review;
  panelHref: string;
}) {
  const lang = uiLangOf(input);
  if (review.checks === 0) return null;
  return (
    <Event mark="check">
      <p className="pr-ev__t">
        <b>
          <Words lang={lang}>
            {review.checks === 1 ? 'The check passed.' : `All ${review.checks} checks passed.`}
          </Words>
        </b>{' '}
        <a href={panelHref}>
          <Words lang={lang}>See the checks</Words>
        </a>
      </p>
    </Event>
  );
}

/** The review request, last, and the merge the enhancement records once you approve. */
export function RequestEvents({
  input,
  review,
  filesHref,
}: {
  input: VariantRenderInput;
  review: Review;
  filesHref: string | undefined;
}) {
  const lang = uiLangOf(input);
  return (
    <>
      <Event mark="eye">
        <p className="pr-ev__t">
          <b>
            <Words lang={lang}>Review requested from you.</Words>
          </b>{' '}
          {filesHref ? (
            <>
              <Words lang={lang}>Read the</Words>{' '}
              <a href={filesHref}>
                <Words lang={lang}>files changed</Words>
              </a>
              <Words lang={lang}>, then</Words>{' '}
            </>
          ) : null}
          <a href={`#${review.ids.panel('merge')}`}>
            <Words lang={lang}>approve and merge</Words>
          </a>
          <Words lang={lang}>.</Words>
        </p>
      </Event>
      <Event mark="merge" id={review.ids.merged} hidden>
        <p className="pr-ev__t">
          <b>
            <Words lang={lang}>You approved and merged this change.</Words>
          </b>
        </p>
      </Event>
    </>
  );
}

/** The phone's bar at the window's foot: Approve and merge, always in reach, the same real link. */
export function MergeBar({ input, review }: { input: VariantRenderInput; review: Review }) {
  const lang = uiLangOf(input);
  const target = review.merge;
  if (!target) return null;
  const leaves = /^https?:/i.test(target.href);
  return (
    <p className="pr-bar">
      <a
        className="pr-btn pr-btn--merge"
        href={target.href}
        data-pr-merge=""
        {...(leaves ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        <Words lang={lang}>Approve and merge</Words>
        {leaves ? <Sr lang={lang}> (opens in a new tab)</Sr> : null}
      </a>
    </p>
  );
}

/** The colophon, the year and name, and the visitor's control. */
export function Footer({ input }: { input: VariantRenderInput }) {
  const footer = footerOutline(input);
  const { colophon } = footer;
  return (
    <footer className="pr-foot">
      <div className="pr-foot__c">
        {colophon.title ? <p className="pr-foot__t">{colophon.title}</p> : null}
        {colophon.description ? <p className="pr-quiet">{colophon.description}</p> : null}
        <p className="pr-quiet">
          © {footer.year} {footer.name}
        </p>
      </div>
      <div className="pr-foot__slot">
        <VisitorControlSlot />
      </div>
    </footer>
  );
}

/** The labels the side column shows: the first skills section's groups, linking to it. */
export function labelsOf(
  input: VariantRenderInput,
  outline: { readonly sections: readonly OutlineSection[] },
): { readonly href: string; readonly names: readonly string[] } | undefined {
  const section = outline.sections.find(
    (each) =>
      each.kind === 'practice' &&
      input.portfolio.sections.some(
        (s) => s.id === each.id && s.kind === 'practice' && s.part === 'skills',
      ),
  );
  const names = (input.portfolio.practice?.skills ?? []).flatMap((group) =>
    present(group.name) ? [group.name] : [],
  );
  return section?.href && names.length > 0 ? { href: section.href, names } : undefined;
}
