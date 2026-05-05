import type { Talks } from '@portfolio/schema';
import { formatDate } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function TalksRenderer({ section }: { section: Talks }) {
  return (
    <SectionFrame section={section} fallbackTitle="Talks">
      {section.items.map((item, i) => (
        <article key={`${item.title}-${i}`} className="editorial-entry">
          <aside className="editorial-entry__marginalia">
            <span className="editorial-entry__marginalia-period">{formatDate(item.presentedAt, { short: true })}</span>
            {item.type ? <span>{item.type}</span> : null}
            {item.location ? <span>{item.location}</span> : null}
          </aside>
          <div className="editorial-entry__body">
            <h3 className="editorial-entry__title">{item.title}</h3>
            {item.venue ? <p className="editorial-entry__subtitle">{item.venue}</p> : null}
            {item.description ? (
              <MarkdownBody source={item.description} className="editorial-entry__description" />
            ) : null}
            {item.abstract ? (
              <MarkdownBody source={item.abstract} className="editorial-entry__description" />
            ) : null}
            {(item.slidesUrl || item.videoUrl || (item.links && item.links.length > 0)) && (
              <div className="editorial-entry__links">
                {item.slidesUrl && (
                  <a href={item.slidesUrl} target="_blank" rel="noopener noreferrer">
                    Slides
                  </a>
                )}
                {item.videoUrl && (
                  <a href={item.videoUrl} target="_blank" rel="noopener noreferrer">
                    Video
                  </a>
                )}
                {item.links?.map((l, j) => (
                  <a key={j} href={l.url} target="_blank" rel="noopener noreferrer">
                    {l.label ?? l.platform ?? 'Link'}
                  </a>
                ))}
              </div>
            )}
          </div>
        </article>
      ))}
    </SectionFrame>
  );
}
