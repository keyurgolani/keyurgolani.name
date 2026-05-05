import type { Writings } from '@portfolio/schema';
import { formatDate } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function WritingsRenderer({ section }: { section: Writings }) {
  return (
    <SectionFrame section={section} fallbackTitle="Writings">
      {section.items.map((item, i) => (
        <article key={`${item.title}-${i}`} className="editorial-entry">
          <aside className="editorial-entry__marginalia">
            <span className="editorial-entry__marginalia-period">{formatDate(item.publishedAt, { short: true })}</span>
            {item.publication ? <span>{item.publication}</span> : null}
            {item.readingTimeMinutes ? <span>{item.readingTimeMinutes} min</span> : null}
          </aside>
          <div className="editorial-entry__body">
            <h3 className="editorial-entry__title">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
              ) : (
                item.title
              )}
            </h3>
            {item.excerpt ? (
              <p className="editorial-entry__subtitle">&ldquo;{item.excerpt}&rdquo;</p>
            ) : null}
            {item.summary ? (
              <MarkdownBody source={item.summary} className="editorial-entry__description" />
            ) : null}
            {item.tags && item.tags.length > 0 ? (
              <div className="editorial-entry__tags">
                {item.tags.map((t, j) => (
                  <span key={j}>{t}</span>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </SectionFrame>
  );
}
