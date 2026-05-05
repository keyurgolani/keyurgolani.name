import type { Publications } from '@portfolio/schema';
import { formatDate, formatList } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function PublicationsRenderer({ section }: { section: Publications }) {
  return (
    <SectionFrame section={section} fallbackTitle="Publications" gradientTitle>
      <div className="kc-list">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-publication">
            <h3 className="kc-publication__title">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
              ) : item.title}
            </h3>
            {item.authors && item.authors.length > 0 ? (
              <p className="kc-publication__authors">{formatList(item.authors)}</p>
            ) : null}
            <p className="kc-publication__meta">
              {item.venue ? <span>{item.venue}</span> : null}
              {item.venue && item.publishedAt ? <span aria-hidden="true">·</span> : null}
              {item.publishedAt ? <span>{formatDate(item.publishedAt)}</span> : null}
            </p>
            {item.abstract ? <p className="kc-publication__abstract">{item.abstract}</p> : null}
            {item.doi ? <p className="kc-publication__doi">DOI: <code>{item.doi}</code></p> : null}
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
