import type { Services } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function ServicesRenderer({ section }: { section: Services }) {
  return (
    <SectionFrame section={section} fallbackTitle="Services">
      <div className="editorial-services">
        {section.items.map((item, i) => (
          <article key={`${item.name}-${i}`} className="editorial-service">
            <h3 className="editorial-service__name">{item.name}</h3>
            {item.description ? (
              <MarkdownBody source={item.description} className="editorial-service__description" />
            ) : null}
            {item.pricing ? <p className="editorial-service__pricing">{item.pricing}</p> : null}
            {item.highlights && item.highlights.length > 0 ? (
              <ul className="editorial-service__highlights">
                {item.highlights.map((h, j) => (
                  <li key={j}>{h}</li>
                ))}
              </ul>
            ) : null}
            {item.url ? (
              <div className="editorial-entry__links" style={{ marginTop: '0.75rem' }}>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  Inquire
                </a>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
