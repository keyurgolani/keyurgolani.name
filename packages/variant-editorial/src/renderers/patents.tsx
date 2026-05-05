import type { Patents } from '@portfolio/schema';
import { formatDate, formatList } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function PatentsRenderer({ section }: { section: Patents }) {
  return (
    <SectionFrame section={section} fallbackTitle="Patents">
      {section.items.map((item, i) => (
        <article key={`${item.title}-${i}`} className="editorial-entry">
          <aside className="editorial-entry__marginalia">
            {item.number ? <span className="editorial-entry__marginalia-period">{item.number}</span> : null}
            {item.status ? <span>{item.status}</span> : null}
            {item.grantedAt ? <span>Granted {formatDate(item.grantedAt, { short: true })}</span> : null}
            {!item.grantedAt && item.filedAt ? <span>Filed {formatDate(item.filedAt, { short: true })}</span> : null}
          </aside>
          <div className="editorial-entry__body">
            <h3 className="editorial-entry__title">{item.title}</h3>
            {item.inventors && item.inventors.length > 0 ? (
              <p className="editorial-entry__subtitle">{formatList(item.inventors)}</p>
            ) : null}
            {item.assignee ? <p className="editorial-entry__subtitle">Assignee: {item.assignee}</p> : null}
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
