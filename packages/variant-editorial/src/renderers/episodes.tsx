import type { Episodes } from '@portfolio/schema';
import { formatDate, formatEpisodeDuration, formatList } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function EpisodesRenderer({ section }: { section: Episodes }) {
  return (
    <SectionFrame section={section} fallbackTitle={section.showName ?? 'Episodes'}>
      {section.showDescription ? (
        <p className="editorial-section__subtitle">{section.showDescription}</p>
      ) : null}
      {section.items.map((item, i) => (
        <article key={`${item.title}-${i}`} className="editorial-entry">
          <aside className="editorial-entry__marginalia">
            {item.number != null ? <span className="editorial-entry__marginalia-period">No. {item.number}</span> : null}
            {item.publishedAt ? <span>{formatDate(item.publishedAt, { short: true })}</span> : null}
            {formatEpisodeDuration(item.durationMinutes) && (
              <span>{formatEpisodeDuration(item.durationMinutes)}</span>
            )}
          </aside>
          <div className="editorial-entry__body">
            <h3 className="editorial-entry__title">{item.title}</h3>
            {item.guests && item.guests.length > 0 ? (
              <p className="editorial-entry__subtitle">with {formatList(item.guests)}</p>
            ) : null}
            {item.description ? (
              <MarkdownBody source={item.description} className="editorial-entry__description" />
            ) : null}
            {item.showNotes ? <MarkdownBody source={item.showNotes} className="editorial-entry__description" /> : null}
            {(item.audioUrl || item.videoUrl || (item.links && item.links.length > 0)) && (
              <div className="editorial-entry__links">
                {item.audioUrl && (
                  <a href={item.audioUrl} target="_blank" rel="noopener noreferrer">
                    Listen
                  </a>
                )}
                {item.videoUrl && (
                  <a href={item.videoUrl} target="_blank" rel="noopener noreferrer">
                    Watch
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
