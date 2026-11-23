import type { Section } from '@portfolio/schema';
import { Enhancement } from '@portfolio/kit/enhancements';
import {
  renderSection,
  type BespokeRenderers,
  type HeadingLevel,
  type HomePageProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  ChecksEvent,
  CommitsEvent,
  Footer,
  Header,
  labelsOf,
  MergeBar,
  NotesEvent,
  panelsOf,
  RequestEvents,
  Side,
  Tabs,
  Tree,
} from './chrome';
import { Stat } from './diff';
import { prFrame } from './frame';
import type { PanelId } from './model';
import { PANEL_LABELS, reviewOf, Tick, uiLangOf, Words, type Review } from './parts';
import { Checks, Snapshot } from './renderers/checks';
import { Commits } from './renderers/commits';
import {
  Custom,
  Description,
  Facts,
  Focus,
  Now,
  Practice,
  Prose,
  Quote,
} from './renderers/conversation';
import { Files } from './renderers/files';
import { Contact, Cta, MergeBody } from './renderers/merge';

// Pull Request's home (issue #270): the portfolio as a pull request to the
// reader's team. The header names the change; the tabs and the file tree
// sit at the start; the four panels hold the conversation (About), the
// commits (the record's chronology), the checks (the rest of the record)
// and the files changed (the work and writing); the merge box (Contact) and
// the side column sit at the end. Without a script every panel shows in
// order and every diff is whole; the enhancement makes the tabs, folds and
// Viewed boxes work, offers a split view, and records the merge.

/** Every core kind, custom's own content included: the composition renders each itself. */
export const RENDERERS = {
  hero: Description,
  lede: Prose,
  now: Now,
  quote: Quote,
  focus: Focus,
  'fun-facts': Facts,
  practice: Practice,
  custom: Custom,
  chronology: Commits,
  evidence: Checks,
  github: Snapshot,
  works: Files,
  contact: Contact,
  cta: Cta,
} satisfies BespokeRenderers;

/** The checks panel's head: they all passed, and how many. */
function ChecksHead({ input, review }: { input: VariantRenderInput; review: Review }) {
  const lang = uiLangOf(input);
  if (review.checks === 0) return null;
  return (
    <div className="pr-checks-h">
      <Tick />
      <p>
        <b>
          <Words lang={lang}>All checks have passed</Words>
        </b>{' '}
        <span className="pr-quiet">
          <Words lang={lang}>
            {`${review.checks} successful ${review.checks === 1 ? 'check' : 'checks'}, each with its source`}
          </Words>
        </span>
      </p>
    </div>
  );
}

/** The files panel's bar: the count, the size, and Unified or Split, which only a script can switch. */
function FilesBar({ input, review }: { input: VariantRenderInput; review: Review }) {
  const lang = uiLangOf(input);
  return (
    <div className="pr-files-bar">
      <p>
        <b>
          {review.files.length}{' '}
          <Words lang={lang}>{review.files.length === 1 ? 'file' : 'files'}</Words>
        </b>{' '}
        <Stat adds={review.stat.adds} dels={review.stat.dels} lang={lang} />
      </p>
      <div
        className="pr-seg"
        role="group"
        aria-label="Diff view"
        lang={lang}
        data-pr-view=""
        hidden
      >
        <button type="button" data-pr-view-as="unified" aria-pressed="true">
          Unified
        </button>
        <button type="button" data-pr-view-as="split" aria-pressed="false">
          Split
        </button>
      </div>
    </div>
  );
}

export function HomePage({ input, outline }: HomePageProps) {
  const review = reviewOf(input);
  const lang = uiLangOf(input);
  const panels = panelsOf(review);
  const lead = review.sections.find(
    ({ section, panel }) => panel === 'conversation' && section.kind === 'hero',
  )?.section.id;
  const composition = { renderers: RENDERERS, Frame: prFrame(input, review, lead) };
  const render = (section: Section, level: HeadingLevel) =>
    renderSection(section, input, composition, { level });
  const of = (panel: PanelId) =>
    review.sections.filter((each) => each.panel === panel).map(({ section }) => section);
  const href = (panel: PanelId) => `#${review.ids.panel(panel)}`;
  const conversation = of('conversation');
  const merge = of('merge');
  const filesHref = panels.includes('files') ? href('files') : undefined;
  return (
    <div className="pr-page" data-pr-root="">
      <main id={input.ids.main} className="pr-main" tabIndex={-1}>
        <Header input={input} review={review} />
        <div className="pr-body">
          <div className="pr-rail">
            <Tabs input={input} review={review} />
            <Tree
              input={input}
              review={review}
              anchorOf={(file) => `${input.ids.prefix}${file.id}`}
            />
          </div>
          <div className="pr-panels">
            {panels.map((panel) => {
              const id = review.ids.panel(panel);
              return (
                <section
                  key={panel}
                  className="pr-panel"
                  id={id}
                  data-pr-panel={panel}
                  aria-labelledby={`${id}-h`}
                >
                  <h2 className="pr-panel__h" id={`${id}-h`}>
                    <Words lang={lang}>{PANEL_LABELS[panel].label}</Words>
                  </h2>
                  {panel === 'conversation' ? (
                    <>
                      {conversation
                        .filter((section) => section.id === lead)
                        .map((section) => render(section, 3))}
                      <ol className="pr-timeline" role="list">
                        <NotesEvent
                          input={input}
                          review={review}
                          panelHref={filesHref ?? href('conversation')}
                        />
                        <CommitsEvent input={input} review={review} panelHref={href('commits')} />
                        <ChecksEvent input={input} review={review} panelHref={href('checks')} />
                        {conversation
                          .filter((section) => section.id !== lead)
                          .map((section) => render(section, 3))}
                        <RequestEvents input={input} review={review} filesHref={filesHref} />
                      </ol>
                    </>
                  ) : (
                    <>
                      {panel === 'checks' ? <ChecksHead input={input} review={review} /> : null}
                      {panel === 'files' ? <FilesBar input={input} review={review} /> : null}
                      {of(panel).map((section) => render(section, 3))}
                    </>
                  )}
                </section>
              );
            })}
          </div>
          <div className="pr-desk">
            <div className="pr-desk__merge" id={review.ids.panel('merge')} data-pr-merge-box="">
              {merge.map((section) => render(section, 2))}
              {merge.some((section) => section.kind === 'contact') ? null : (
                <div className="pr-merge">
                  <MergeBody input={input} links={review.footer.links} />
                </div>
              )}
            </div>
            <Side input={input} labels={labelsOf(input, outline)} />
          </div>
        </div>
      </main>
      <MergeBar input={input} review={review} />
      <Footer input={input} />
      <Enhancement input={input} id="review" />
    </div>
  );
}
