import type { ExternalPortfolios } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';
import { ActionLink } from '../primitives/action-link';

export function ExternalPortfoliosRenderer({ section }: { section: ExternalPortfolios }) {
  return (
    <SectionFrame section={section} fallbackTitle="Other Portfolios" gradientTitle>
      <div className="kc-externals">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-external">
            <header className="kc-external__head">
              <h3 className="kc-external__brand">{item.brandName}</h3>
              {item.locationLabel ? (
                <span className="kc-external__location">{item.locationLabel}</span>
              ) : null}
            </header>
            {item.description ? (
              <p className="kc-external__desc">{item.description}</p>
            ) : null}
            {item.categories && item.categories.length > 0 ? (
              <ul className="kc-external__categories">
                {item.categories.map((cat, j) => (
                  <li key={j}>{cat}</li>
                ))}
              </ul>
            ) : null}
            {item.highlights && item.highlights.length > 0 ? (
              <ul className="kc-external__highlights">
                {item.highlights.map((h, j) => (
                  <li key={j}>
                    <span className="kc-external__highlight-label">{h.label}</span>
                    <span className="kc-external__highlight-sub">{h.sub}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="kc-external__cta">
              <ActionLink
                link={{
                  url: item.url,
                  label: item.buttonText ?? `Visit ${item.urlLabel ?? item.brandName} →`,
                }}
                variant="primary"
              />
            </div>
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
