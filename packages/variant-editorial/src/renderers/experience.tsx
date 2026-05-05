import type { Experience } from '@portfolio/schema';
import { formatPeriod, formatDuration } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function ExperienceRenderer({ section }: { section: Experience }) {
  return (
    <SectionFrame section={section} fallbackTitle="Experience">
      {section.items.map((item, i) => (
        <article key={`${item.organization}-${item.role}-${i}`} className="editorial-entry">
          <aside className="editorial-entry__marginalia">
            <span className="editorial-entry__marginalia-period">{formatPeriod(item.period, { short: true })}</span>
            {formatDuration(item.period) && <span>{formatDuration(item.period)}</span>}
            {item.location && <span>{item.location}</span>}
          </aside>
          <div className="editorial-entry__body">
            <h3 className="editorial-entry__title">{item.role}</h3>
            <p className="editorial-entry__subtitle">
              {item.organizationUrl ? (
                <a href={item.organizationUrl} target="_blank" rel="noopener noreferrer">
                  {item.organization}
                </a>
              ) : (
                item.organization
              )}
            </p>
            {item.description ? (
              <MarkdownBody source={item.description} className="editorial-entry__description" />
            ) : null}
            {item.highlights && item.highlights.length > 0 ? (
              <ul className="editorial-entry__highlights">
                {item.highlights.map((h, j) => (
                  <li key={j}>{h}</li>
                ))}
              </ul>
            ) : null}
            {item.skills && item.skills.length > 0 ? (
              <div className="editorial-entry__tags">
                {item.skills.map((s, j) => (
                  <span key={j}>{s}</span>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </SectionFrame>
  );
}
