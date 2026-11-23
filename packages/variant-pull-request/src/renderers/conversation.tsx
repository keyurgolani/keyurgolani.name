import {
  evidenceByIds,
  formatFigure,
  hrefFor,
  LabeledDate,
  MediaFigure,
  placedMedia,
  present,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRenderer,
} from '@portfolio/kit/sections';
import { plainText } from '../model';
import { Link, recordHref, reviewOf, uiLangOf, Words } from '../parts';

// The conversation (issue #270, behaviour 1): About, and the sections the
// navigation leaves to the index. The hero is the change's description: its
// greeting, its tagline as the thesis, its subtagline and its links. Every
// other section is a comment in the timeline under it, in the owner's
// order: a lede, a now, a quote, the focus as the checked list of what
// changes for the reader's team, the fun facts, the practice as the labels
// the change carries, and a custom section's own content.

/** The description's opening: the greeting, the tagline as its thesis, the subtagline, and the links. */
export const Description: SectionRenderer<SectionOf<'hero'>> = ({ section, input }) => {
  const ctas = (section.ctas ?? []).filter((cta) => present(cta.label));
  return (
    <>
      {present(section.greeting) ? <p className="pr-desc__greet">{section.greeting}</p> : null}
      {present(section.tagline) ? (
        <p className="pr-desc__thesis" data-type-role="title">
          {section.tagline}
        </p>
      ) : null}
      {present(section.subtagline) ? <p className="pr-desc__sub">{section.subtagline}</p> : null}
      {ctas.length > 0 ? (
        <ul className="pr-desc__links" role="list">
          {ctas.map((cta, i) => (
            <li key={i}>
              <Link
                url={cta.url}
                input={input}
                className={i === 0 ? 'pr-btn' : 'pr-btn pr-btn--quiet'}
              >
                {cta.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
};

export const Prose: SectionRenderer<SectionOf<'lede'>> = ({ section, input }) => (
  <RichText source={section.body} input={input} className="pr-prose" />
);

export const Now: SectionRenderer<SectionOf<'now'>> = ({ section, input, level }) => {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <RichText source={section.body} input={input} className="pr-prose" />
      {section.asOf ? (
        <p className="pr-quiet">
          <LabeledDate label="As of" raw={section.asOf} ctx={ctx} />
        </p>
      ) : null}
    </>
  );
};

export const Quote: SectionRenderer<SectionOf<'quote'>> = ({ section, input }) => {
  const by = [section.attribution, section.source].filter(present);
  return (
    <figure className="pr-quote">
      <blockquote>
        <p>{section.text}</p>
      </blockquote>
      {by.length > 0 ? (
        <figcaption>
          {present(section.attribution) ? <span>{section.attribution}</span> : null}
          {present(section.attribution) && present(section.source) ? ', ' : null}
          {present(section.source) ? (
            section.sourceUrl ? (
              <Link url={section.sourceUrl} input={input}>
                <cite>{section.source}</cite>
              </Link>
            ) : (
              <cite>{section.source}</cite>
            )
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
};

/** The focus as a checked list: what changes for the reader's team. The boxes are decoration. */
export const Focus: SectionRenderer<SectionOf<'focus'>> = ({ section }) => (
  <ul className="pr-checklist" role="list">
    {section.items.filter(present).map((item, i) => (
      <li key={i}>
        <span className="pr-cb" aria-hidden="true" />
        {item}
      </li>
    ))}
  </ul>
);

export const Facts: SectionRenderer<SectionOf<'fun-facts'>> = ({ section }) => (
  <ul className="pr-list">
    {section.items.filter(present).map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);

/** The practice: the thesis as prose, and each group of skills, tools or services as labels. */
export const Practice: SectionRenderer<SectionOf<'practice'>> = ({ section, input, level }) => {
  const ctx = renderContext(input, section, level);
  const practice = input.portfolio.practice;
  const Heading = `h${ctx.itemLevel}` as 'h4';
  if (!practice) return null;
  switch (section.part) {
    case 'thesis':
      return present(practice.thesis) ? (
        <RichText source={practice.thesis} input={input} className="pr-prose" />
      ) : null;
    case 'skills':
      return (
        <div className="pr-groups">
          {(practice.skills ?? []).map((group, i) => (
            <div className="pr-group" key={i}>
              {present(group.name) ? <Heading className="pr-group__h">{group.name}</Heading> : null}
              {present(group.description) ? <p className="pr-quiet">{group.description}</p> : null}
              <ul className="pr-labels" role="list">
                {group.items.filter(present).map((item, j) => (
                  <li key={j} className="pr-label">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    case 'tools':
      return (
        <div className="pr-groups">
          {(practice.tools ?? []).map((group, i) => (
            <div className="pr-group" key={i}>
              {present(group.name) ? <Heading className="pr-group__h">{group.name}</Heading> : null}
              {present(group.description) ? <p className="pr-quiet">{group.description}</p> : null}
              <ul className="pr-labels" role="list">
                {group.items.map((tool, j) => (
                  <li key={j} className="pr-label">
                    {tool.url ? (
                      <Link url={tool.url} input={input}>
                        {tool.name}
                      </Link>
                    ) : (
                      tool.name
                    )}
                    {present(tool.version) ? <code className="pr-ver"> {tool.version}</code> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    case 'services':
      return (
        <div className="pr-groups">
          {(practice.services ?? []).map((group, i) => (
            <div className="pr-group" key={i}>
              {present(group.name) ? <Heading className="pr-group__h">{group.name}</Heading> : null}
              {present(group.description) ? <p className="pr-quiet">{group.description}</p> : null}
              <ul className="pr-list">
                {group.items.map((service, j) => (
                  <li key={j}>
                    <b>
                      {service.url ? (
                        <Link url={service.url} input={input}>
                          {service.name}
                        </Link>
                      ) : (
                        service.name
                      )}
                    </b>
                    {present(service.pricing) ? (
                      <span className="pr-quiet"> {service.pricing}</span>
                    ) : null}
                    {present(service.description) ? (
                      <RichText source={service.description} input={input} className="pr-prose" />
                    ) : null}
                    {(service.highlights ?? []).filter(present).length > 0 ? (
                      <ul className="pr-list">
                        {(service.highlights ?? []).filter(present).map((item, k) => (
                          <li key={k}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
};

/** A custom section: its body, then each item with its pictures, summary, cited records and links. */
export const Custom: SectionRenderer<SectionOf<'custom'>> = ({ section, input, level }) => {
  const ctx = renderContext(input, section, level);
  const review = reviewOf(input);
  const lang = uiLangOf(input);
  const Heading = `h${ctx.itemLevel}` as 'h4';
  return (
    <>
      {present(section.body) ? (
        <RichText source={section.body} input={input} className="pr-prose" />
      ) : null}
      {(section.items ?? []).length > 0 ? (
        <ul className="pr-items" role="list">
          {(section.items ?? []).map((item, i) => {
            const pictures = (item.media ?? []).flatMap((placement) => {
              const placed = placedMedia(placement, ctx);
              return placed ? [placed] : [];
            });
            const cited = evidenceByIds(item.evidence ?? [], input);
            return (
              <li key={i} className="pr-item">
                <Heading className="pr-item__h">{item.title}</Heading>
                {pictures.map((placed, j) => (
                  <MediaFigure key={j} placed={placed} ctx={ctx} className="pr-fig" />
                ))}
                {present(item.summary) ? (
                  <RichText source={item.summary} input={input} className="pr-prose" />
                ) : null}
                {cited.length > 0 ? (
                  <p className="pr-quiet">
                    <Words lang={lang}>Checks:</Words>{' '}
                    {cited.map((record, j) => {
                      const href = recordHref(input, record, review);
                      const text =
                        record.title ??
                        (present(record.statement)
                          ? plainText(record.statement)
                          : record.metric?.value !== undefined
                            ? `${formatFigure(record.metric.value, ctx)} ${record.metric.unit ?? ''}`.trim()
                            : record.id);
                      return (
                        <span key={j}>
                          {j > 0 ? ', ' : null}
                          {href ? <a href={href}>{text}</a> : text}
                        </span>
                      );
                    })}
                  </p>
                ) : null}
                {(item.links ?? []).length > 0 ? (
                  <ul className="pr-links" role="list">
                    {(item.links ?? []).map((link, j) => (
                      <li key={j}>
                        <a href={hrefFor(link.url, input)}>
                          {link.label ?? link.platform ?? link.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
};
