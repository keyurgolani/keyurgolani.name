import type { Press } from '@portfolio/schema';
import { formatDate } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function PressRenderer({ section }: { section: Press }) {
  return (
    <SectionFrame section={section} fallbackTitle="Press">
      <div className="editorial-quoted">
        {section.items.map((item, i) => (
          <blockquote key={`${item.title}-${i}`} className="editorial-quoted__item">
            {item.excerpt ? (
              <p className="editorial-quoted__text">{item.excerpt}</p>
            ) : null}
            <cite className="editorial-quoted__attribution">
              <span className="editorial-quoted__attribution-name">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </span>
              <span className="editorial-quoted__attribution-source">
                {[item.publication, item.author, formatDate(item.publishedAt, { short: true })]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </cite>
          </blockquote>
        ))}
      </div>
    </SectionFrame>
  );
}
