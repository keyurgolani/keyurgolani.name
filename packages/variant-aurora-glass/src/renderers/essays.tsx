import type { Section, Work } from '@portfolio/schema';
import { recordAnchor } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { formatNumber, homeDescription, present } from '../model';
import { LinkLine, More, Out, Phrase, When, Words, uiLang } from '../parts';
import { workHref } from './work-href';

// Essays (brief §5.2): writing and research as rows inside the band's lite,
// each a title, its standfirst, and a ruled foot of where, when and how
// long. The first row leads with its excerpt set large, when it has one.

type Works = Extract<Section, { kind: 'works' }>;

export function Essays({
  works,
  section,
  input,
}: {
  works: readonly Work[];
  section: Works;
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  const locale = input.portfolio.locale;
  return (
    <ol className="ag-rows ag-essays">
      {works.map((work, index) => {
        const href = workHref(work, input);
        const summary = work.summary ?? work.description;
        const excerpt = index === 0 && present(work.excerpt) ? work.excerpt : undefined;
        return (
          <li
            key={work.id}
            className={excerpt ? 'ag-row ag-essay ag-essay--lead' : 'ag-row ag-essay'}
            id={recordAnchor(section, work, input)}
            lang={work.lang}
          >
            {excerpt ? (
              <blockquote className="ag-essay__pull" data-type-role="quote">
                <Phrase source={excerpt} input={input} />
              </blockquote>
            ) : null}
            <h4 className="ag-row__title" data-type-role="title">
              {href ? (
                <a href={href}>
                  {work.title}
                  <Out href={href} />
                </a>
              ) : (
                work.title
              )}
            </h4>
            {present(summary) ? (
              <p className="ag-row__sum" data-type-role="body-compact">
                <Phrase source={summary} input={input} />
              </p>
            ) : null}
            {homeDescription(work) ? (
              <More label="More about it" of={work} source={homeDescription(work)!} input={input} />
            ) : null}
            <p className="ag-row__foot" data-type-role="caption">
              {present(work.role) ? <span>{work.role}</span> : null}
              {work.tools?.some(present) ? (
                <span>{work.tools.filter(present).join(', ')}</span>
              ) : null}
              {present(work.publication) ? <span>{work.publication}</span> : null}
              {work.publishedAt ? (
                <span>
                  <When raw={work.publishedAt} lang={lang} />
                </span>
              ) : null}
              {work.readingTimeMinutes ? (
                <span className="ag-num">
                  <Words
                    lang={lang}
                  >{`${formatNumber(work.readingTimeMinutes, locale)} min read`}</Words>
                </span>
              ) : null}
            </p>
            <LinkLine links={work.links} input={input} />
          </li>
        );
      })}
    </ol>
  );
}
