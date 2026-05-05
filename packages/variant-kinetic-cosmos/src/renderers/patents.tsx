import type { Patents } from '@portfolio/schema';
import { formatDate, formatList } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function PatentsRenderer({ section }: { section: Patents }) {
  return (
    <SectionFrame section={section} fallbackTitle="Patents" gradientTitle>
      <div className="kc-list">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-patent">
            <header className="kc-patent__head">
              <h3 className="kc-patent__title">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
                ) : item.title}
              </h3>
              {item.number ? <code className="kc-patent__number">{item.number}</code> : null}
            </header>
            <p className="kc-patent__meta">
              {item.status ? <span className="kc-patent__status">{item.status}</span> : null}
              {item.grantedAt ? <span>Granted {formatDate(item.grantedAt)}</span> : null}
              {item.assignee ? <span>{item.assignee}</span> : null}
            </p>
            {item.inventors && item.inventors.length > 0 ? (
              <p className="kc-patent__inventors">{formatList(item.inventors)}</p>
            ) : null}
            {item.description ? <p className="kc-patent__desc">{item.description}</p> : null}
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
