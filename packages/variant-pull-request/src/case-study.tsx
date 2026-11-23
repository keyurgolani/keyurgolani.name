import { Enhancement } from '@portfolio/kit/enhancements';
import {
  anchorSection,
  evidenceByIds,
  renderContext,
  type CaseStudyPageProps,
} from '@portfolio/kit/sections';
import { Footer, Header } from './chrome';
import { FileBlock } from './diff';
import { fileOf } from './model';
import { reviewOf, uiLangOf, Words } from './parts';
import { CheckItem } from './renderers/checks';

// A work's own page (issue #270, contract): its whole diff, the file the
// review page shows with nothing behind Expand, under the change's header
// with the work's title as the page's h1. A trail leads back to the files
// changed and to the files before and after it, and the checks the work
// cites follow it, each linking its place among the checks.

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const review = reviewOf(input);
  const lang = uiLangOf(input);
  const file =
    review.files.find((each) => each.id === work.id) ??
    fileOf(work, anchorSection(work, input)?.id);
  const ctx = renderContext(input, { id: work.id, title: work.title }, 2);
  const cited = evidenceByIds(work.evidence ?? [], input);
  const files = `${outline.home}#${review.ids.panel('files')}`;
  return (
    <div className="pr-page pr-page--work" data-pr-root="">
      <main id={input.ids.main} className="pr-main" tabIndex={-1}>
        <Header
          input={input}
          review={review}
          title={
            <h1 className="pr-title" data-type-role="display">
              {work.title}
            </h1>
          }
        />
        <div className="pr-body">
          <nav className="pr-crumbs" aria-label="This file" lang={lang}>
            <ul role="list">
              <li>
                <a href={files}>
                  <span aria-hidden="true">{'←'} </span>
                  <Words lang={lang}>All files changed</Words>
                </a>
              </li>
              {outline.previous ? (
                <li>
                  <a href={outline.previous.href} rel="prev">
                    <Words lang={lang}>Previous file:</Words>{' '}
                    <span lang={input.portfolio.locale}>{outline.previous.title}</span>
                  </a>
                </li>
              ) : null}
              {outline.next ? (
                <li>
                  <a href={outline.next.href} rel="next">
                    <Words lang={lang}>Next file:</Words>{' '}
                    <span lang={input.portfolio.locale}>{outline.next.title}</span>
                  </a>
                </li>
              ) : null}
            </ul>
          </nav>
          <div className="pr-work">
            <FileBlock
              file={file}
              work={work}
              section={{ id: work.id, title: work.title }}
              input={input}
              review={review}
              level={2}
              whole
            />
            {cited.length > 0 ? (
              <section className="pr-sec" aria-labelledby={`${input.ids.prefix}pr--cited`}>
                <h2 className="pr-sec__title" id={`${input.ids.prefix}pr--cited`}>
                  <Words lang={lang}>Checks</Words>
                </h2>
                <ol className="pr-checks" role="list">
                  {cited.map((entry) => (
                    <CheckItem
                      key={entry.id}
                      entry={entry}
                      section={{ id: `${work.id}--cited`, kind: 'evidence', items: [entry.id] }}
                      input={input}
                      review={review}
                      ctx={ctx}
                      lang={lang}
                    />
                  ))}
                </ol>
              </section>
            ) : null}
          </div>
        </div>
      </main>
      <Footer input={input} />
      <Enhancement input={input} id="review" />
    </div>
  );
}
