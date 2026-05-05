import type { ExternalPortfolios, ExternalPortfolioItem } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function ExternalPortfoliosRenderer({ section }: { section: ExternalPortfolios }) {
  return (
    <SectionFrame section={section} fallbackTitle="Elsewhere">
      <div className="editorial-external">
        {section.items.map((item, i) => (
          <ExternalPortfolioCard key={`${item.url}-${i}`} item={item} />
        ))}
      </div>
    </SectionFrame>
  );
}

function ExternalPortfolioCard({ item }: { item: ExternalPortfolioItem }) {
  const urlLabel = item.urlLabel ?? readableHost(item.url);
  const buttonText = item.buttonText ?? `Visit ${item.brandName}`;

  return (
    <article className="editorial-external__card">
      <header className="editorial-external__head">
        <h3 className="editorial-external__brand">{item.brandName}</h3>
        {item.locationLabel ? (
          <p className="editorial-external__location">{item.locationLabel}</p>
        ) : null}
      </header>

      {item.description ? (
        <p className="editorial-external__description">{item.description}</p>
      ) : null}

      {item.categories && item.categories.length > 0 ? (
        <ul className="editorial-external__categories">
          {item.categories.map((c, i) => (
            <li key={i} className="editorial-external__category">
              {c}
            </li>
          ))}
        </ul>
      ) : null}

      {item.highlights && item.highlights.length > 0 ? (
        <dl className="editorial-external__highlights">
          {item.highlights.map((h, i) => (
            <div key={i} className="editorial-external__highlight">
              <dt>{h.label}</dt>
              <dd>{h.sub}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <footer className="editorial-external__foot">
        <a
          className="editorial-external__cta"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {buttonText}
        </a>
        <span className="editorial-external__url" aria-hidden="true">
          {urlLabel}
        </span>
      </footer>
    </article>
  );
}

function readableHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
