import type { Publications } from '@portfolio/schema';
import { formatList, formatYear } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function PublicationsRenderer({ section }: { section: Publications }) {
  return (
    <SectionFrame section={section} fallbackTitle="Publications">
      {section.items.map((item, i) => (
        <article key={`${item.title}-${i}`} className="editorial-entry">
          <aside className="editorial-entry__marginalia">
            <span className="editorial-entry__marginalia-period">{formatYear(item.publishedAt)}</span>
            {item.venue ? <span>{item.venue}</span> : null}
            {item.doi ? <span>doi:{item.doi}</span> : null}
          </aside>
          <div className="editorial-entry__body">
            <h3 className="editorial-entry__title">{item.title}</h3>
            {item.authors && item.authors.length > 0 ? (
              <p className="editorial-entry__subtitle">{formatList(item.authors)}</p>
            ) : null}
            {item.abstract ? <MarkdownBody source={item.abstract} className="editorial-entry__description" /> : null}
            {item.citation ? <p className="editorial-entry__description"><em>{item.citation}</em></p> : null}
            {(item.url || item.pdfUrl) && (
              <div className="editorial-entry__links">
                {item.url && (
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    Read
                  </a>
                )}
                {item.pdfUrl && (
                  <a href={item.pdfUrl} target="_blank" rel="noopener noreferrer">
                    PDF
                  </a>
                )}
              </div>
            )}
            {item.awards && item.awards.length > 0 ? (
              <div className="editorial-entry__tags">
                {item.awards.map((a, j) => (
                  <span key={j}>★ {a}</span>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </SectionFrame>
  );
}
