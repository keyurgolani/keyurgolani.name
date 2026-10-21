import type { ExternalPortfolios, FunFacts, Focus, Github, Stats, Tenure } from '@portfolio/schema';
import { formatStatValue } from '../../format';
import {
  deeper,
  Heading,
  hrefFor,
  Meta,
  renderContext,
  SectionHeader,
  TagList,
  Ui,
} from '../primitives';
import type { SectionRendererProps } from '../types';

// Figures, short lists, and pointers elsewhere.

/** Each figure's value first, then what it counts. A `metric` key goes on a data attribute. */
export function StatsSection({ section, input, level }: SectionRendererProps<Stats>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <ul className="pf-stats">
        {section.items.map((item, index) => (
          <li key={index} className="pf-stat" data-metric={item.metric}>
            <p className="pf-stat__value">{formatStatValue(item.value, ctx.locale)}</p>
            <p className="pf-stat__label">{item.label}</p>
            {item.description !== undefined ? (
              <p className="pf-stat__description">{item.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

export function FocusSection({ section, input, level }: SectionRendererProps<Focus>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Focus" />
      <TagList items={section.items} className="pf-short-list" />
    </>
  );
}

export function FunFactsSection({ section, input, level }: SectionRendererProps<FunFacts>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Fun facts" />
      <TagList items={section.items} className="pf-short-list" />
    </>
  );
}

/** A career's length as one figure, such as 12+ years. */
export function TenureSection({ section, input, level }: SectionRendererProps<Tenure>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      {section.years !== undefined ? (
        <p className="pf-tenure">
          <span className="pf-tenure__years">{formatStatValue(section.years, ctx.locale)}+</span>{' '}
          <Ui ctx={ctx}>years</Ui>
        </p>
      ) : null}
      {section.summary !== undefined ? <p className="pf-message">{section.summary}</p> : null}
    </>
  );
}

/**
 * Cards that send the visitor to another site. The link reads as the card's
 * button text, else its URL label, else the brand. An icon name goes on a data
 * attribute for a variant that draws icons.
 */
export function ExternalPortfoliosSection({
  section,
  input,
  level,
}: SectionRendererProps<ExternalPortfolios>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Elsewhere" />
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item" data-icon={item.iconName}>
            <Heading level={deeper(level)} className="pf-item__title">
              {item.brandName}
            </Heading>
            <Meta parts={[item.locationLabel]} />
            {item.description !== undefined ? <p>{item.description}</p> : null}
            <TagList items={item.categories} />
            {item.highlights?.length ? (
              <dl className="pf-facts">
                {item.highlights.map((highlight, highlightIndex) => (
                  <div key={highlightIndex}>
                    <dt>{highlight.label}</dt>
                    <dd>{highlight.sub}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="pf-external-link">
              <a className="pf-action" href={hrefFor(item.url, input)}>
                {item.buttonText ?? item.urlLabel ?? item.brandName}
              </a>
              {item.buttonText !== undefined && item.urlLabel !== undefined ? (
                <>
                  {' '}
                  <span className="pf-url">{item.urlLabel}</span>
                </>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The profile link. The show and repository fields choose among GitHub data,
 * which no render input carries until #10 fills `derived`, so until then the
 * link is all there is to render.
 */
export function GithubSection({ section, input, level }: SectionRendererProps<Github>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="GitHub" />
      <p className="pf-github">
        <a href={`https://github.com/${encodeURIComponent(section.username)}`}>
          @{section.username}
        </a>
      </p>
    </>
  );
}
