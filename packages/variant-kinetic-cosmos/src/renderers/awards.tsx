import type { Awards } from '@portfolio/schema';
import { formatDate } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function AwardsRenderer({ section }: { section: Awards }) {
  return (
    <SectionFrame section={section} fallbackTitle="Awards" gradientTitle>
      <div className="kc-list">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-award">
            <header className="kc-award__head">
              <h3 className="kc-award__name">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a>
                ) : item.name}
              </h3>
              {item.receivedAt ? (
                <span className="kc-award__date">{formatDate(item.receivedAt)}</span>
              ) : null}
            </header>
            {item.organization ? <p className="kc-award__org">{item.organization}</p> : null}
            {item.description ? <p className="kc-award__desc">{item.description}</p> : null}
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
