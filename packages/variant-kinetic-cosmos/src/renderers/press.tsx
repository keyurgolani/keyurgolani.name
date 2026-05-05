import type { Press } from '@portfolio/schema';
import { formatDate } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function PressRenderer({ section }: { section: Press }) {
  return (
    <SectionFrame section={section} fallbackTitle="Press" gradientTitle>
      <div className="kc-list">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-press">
            <p className="kc-press__publication">{item.publication}</p>
            <h3 className="kc-press__title">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
              ) : item.title}
            </h3>
            {item.excerpt ? <p className="kc-press__excerpt">"{item.excerpt}"</p> : null}
            <p className="kc-press__meta">
              {item.author ? <span>{item.author}</span> : null}
              {item.publishedAt ? <span>{formatDate(item.publishedAt)}</span> : null}
            </p>
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
