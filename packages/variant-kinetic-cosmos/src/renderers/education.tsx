import type { Education } from '@portfolio/schema';
import { formatPeriod } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function EducationRenderer({ section }: { section: Education }) {
  return (
    <SectionFrame section={section} fallbackTitle="Education" gradientTitle>
      <div className="kc-list">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-edu">
            <header className="kc-edu__head">
              <h3 className="kc-edu__degree">
                {item.degree}
                {item.field ? <span className="kc-edu__field"> — {item.field}</span> : null}
              </h3>
              <span className="kc-edu__period">{formatPeriod(item.period)}</span>
            </header>
            <p className="kc-edu__institution">
              {item.institutionUrl ? (
                <a href={item.institutionUrl} target="_blank" rel="noopener noreferrer">
                  {item.institution}
                </a>
              ) : (
                item.institution
              )}
              {item.location ? <span className="kc-edu__location"> · {item.location}</span> : null}
            </p>
            {item.description ? <p className="kc-edu__description">{item.description}</p> : null}
            {item.achievements && item.achievements.length > 0 ? (
              <ul className="kc-edu__achievements">
                {item.achievements.map((a, j) => (
                  <li key={j}>{a}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
