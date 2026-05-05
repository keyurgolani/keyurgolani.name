import type { Education } from '@portfolio/schema';
import { formatPeriod } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function EducationRenderer({ section }: { section: Education }) {
  return (
    <SectionFrame section={section} fallbackTitle="Education">
      {section.items.map((item, i) => (
        <article key={`${item.institution}-${item.degree}-${i}`} className="editorial-entry">
          <aside className="editorial-entry__marginalia">
            <span className="editorial-entry__marginalia-period">{formatPeriod(item.period, { short: true })}</span>
            {item.location && <span>{item.location}</span>}
          </aside>
          <div className="editorial-entry__body">
            <h3 className="editorial-entry__title">
              {item.degree}
              {item.field ? `, ${item.field}` : ''}
            </h3>
            <p className="editorial-entry__subtitle">
              {item.institutionUrl ? (
                <a href={item.institutionUrl} target="_blank" rel="noopener noreferrer">
                  {item.institution}
                </a>
              ) : (
                item.institution
              )}
            </p>
            {item.description ? (
              <MarkdownBody source={item.description} className="editorial-entry__description" />
            ) : null}
            {item.achievements && item.achievements.length > 0 ? (
              <ul className="editorial-entry__highlights">
                {item.achievements.map((a, j) => (
                  <li key={j}>{a}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </article>
      ))}
    </SectionFrame>
  );
}
