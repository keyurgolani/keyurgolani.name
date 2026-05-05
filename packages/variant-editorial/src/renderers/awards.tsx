import type { Awards } from '@portfolio/schema';
import { formatDate } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function AwardsRenderer({ section }: { section: Awards }) {
  return (
    <SectionFrame section={section} fallbackTitle="Awards">
      {section.items.map((item, i) => (
        <article key={`${item.name}-${i}`} className="editorial-entry">
          <aside className="editorial-entry__marginalia">
            <span className="editorial-entry__marginalia-period">{formatDate(item.receivedAt, { short: true })}</span>
            {item.organization ? <span>{item.organization}</span> : null}
          </aside>
          <div className="editorial-entry__body">
            <h3 className="editorial-entry__title">{item.name}</h3>
            {item.description ? (
              <MarkdownBody source={item.description} className="editorial-entry__description" />
            ) : null}
            {item.url ? (
              <div className="editorial-entry__links">
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  Read more
                </a>
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </SectionFrame>
  );
}
