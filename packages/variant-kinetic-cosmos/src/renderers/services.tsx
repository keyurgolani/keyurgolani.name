import type { Services } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';
import { ActionLink } from '../primitives/action-link';

export function ServicesRenderer({ section }: { section: Services }) {
  return (
    <SectionFrame section={section} fallbackTitle="Services" gradientTitle>
      <div className="kc-services">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-service">
            <h3 className="kc-service__name">{item.name}</h3>
            {item.pricing ? <p className="kc-service__pricing">{item.pricing}</p> : null}
            {item.description ? <p className="kc-service__description">{item.description}</p> : null}
            {item.highlights && item.highlights.length > 0 ? (
              <ul className="kc-service__highlights">
                {item.highlights.map((h, j) => (
                  <li key={j}>{h}</li>
                ))}
              </ul>
            ) : null}
            {item.url ? (
              <div className="kc-service__cta">
                <ActionLink link={{ url: item.url, label: 'Learn more' }} variant="primary" />
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
