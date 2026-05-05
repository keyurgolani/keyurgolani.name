import type { Writings } from '@portfolio/schema';
import { formatDate } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function WritingsRenderer({ section }: { section: Writings }) {
  return (
    <SectionFrame section={section} fallbackTitle="Writing" gradientTitle>
      <div className="kc-list">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-writing">
            <h3 className="kc-writing__title">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
              ) : item.title}
            </h3>
            <p className="kc-writing__meta">
              {item.publication ? <span>{item.publication}</span> : null}
              {item.publication && item.publishedAt ? <span aria-hidden="true">·</span> : null}
              {item.publishedAt ? <span>{formatDate(item.publishedAt)}</span> : null}
              {item.readingTimeMinutes ? <span>{item.readingTimeMinutes} min read</span> : null}
            </p>
            {item.summary ? <p className="kc-writing__summary">{item.summary}</p> : null}
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
