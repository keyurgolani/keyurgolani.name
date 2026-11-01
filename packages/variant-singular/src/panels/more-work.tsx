import type { Work } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  formatNumber,
  mediumWord,
  outbound,
  plainInline,
  planOf,
  present,
  workLink,
  type Panel,
} from '../model';
import { Hidden, hrefOf, Span, uiLang, When, Words } from '../parts';
import { headingId, PanelShell } from './panel';

// Panel 4, More work (brief §5.7; SG-S5): the other works as a compact
// index, each title at headline size; the row is the action, one link of
// 44 px or more whose box covers the row, with nothing else in it to tab
// to. A row with nowhere to go is plain text. Siblings dim while one row is
// pointed at or focused (C1).

/** A work's meta line: what it is, and when, in the composition's words and the owner's dates. */
export function WorkMeta({ work, input }: { work: Work; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const medium = mediumWord(work);
  const parts = [
    medium ? (
      <Words key="m" lang={lang}>
        {medium}
      </Words>
    ) : null,
    work.period?.start ? (
      work.period.end ? (
        <Span key="p" period={work.period} input={input} />
      ) : (
        <span key="p">
          <Words lang={lang}>since</Words> <When raw={work.period.start} input={input} />
        </span>
      )
    ) : present(work.publishedAt ?? work.releasedAt) ? (
      <When key="p" raw={work.publishedAt ?? work.releasedAt} input={input} />
    ) : null,
    work.readingTimeMinutes ? (
      <Words key="r" lang={lang}>
        {/* A non-breaking hyphen: "14-minute" never splits at the line's end. */}
        {`${formatNumber(work.readingTimeMinutes, input.portfolio.locale)}\u2011minute read`}
      </Words>
    ) : null,
  ].filter((part) => part !== null);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? ', ' : null}
          {part}
        </span>
      ))}
    </>
  );
}

export function MoreWorkPanel({ input, panel }: { input: VariantRenderInput; panel: Panel }) {
  const { more } = planOf(input);
  const lang = uiLang(input.portfolio.locale);
  return (
    <PanelShell input={input} panel={panel} className="sg-more">
      <h2
        className="sg-label"
        id={headingId(input, panel)}
        tabIndex={-1}
        data-sg-heading=""
        data-type-role="title"
        data-sg-rise="meta"
      >
        <Words lang={lang}>{panel.label.text}</Words>
      </h2>
      <ul className="sg-more__list" role="list" data-sg-rise="lead">
        {more.map((work) => {
          const link = workLink(work);
          const href = link ? hrefOf(link, input) : undefined;
          const summary = [work.summary, work.excerpt, work.description].find(present);
          return (
            <li key={work.id} className="sg-more__row" lang={work.lang}>
              <h3 className="sg-more__title" data-type-role="headline">
                {href ? (
                  <a href={href} data-out={outbound(href) ? '' : undefined}>
                    {work.title}
                    {outbound(href) ? <Hidden lang={lang}>(opens another site)</Hidden> : null}
                  </a>
                ) : (
                  work.title
                )}
              </h3>
              {summary ? (
                <p className="sg-more__sum" data-type-role="body">
                  {/* Plain text: the row's one link is its title (SG-S5). */}
                  {plainInline(summary)}
                </p>
              ) : null}
              <p className="sg-more__meta" data-type-role="body">
                <WorkMeta work={work} input={input} />
              </p>
            </li>
          );
        })}
      </ul>
    </PanelShell>
  );
}
