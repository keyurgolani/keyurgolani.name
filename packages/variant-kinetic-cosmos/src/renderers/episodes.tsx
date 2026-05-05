import type { Episodes } from '@portfolio/schema';
import { formatDate, formatEpisodeDuration } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function EpisodesRenderer({ section }: { section: Episodes }) {
  return (
    <SectionFrame section={section} fallbackTitle={section.showName ?? 'Episodes'} gradientTitle>
      {section.showDescription ? (
        <p className="kc-episodes__intro">{section.showDescription}</p>
      ) : null}
      <div className="kc-list">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-episode">
            <header className="kc-episode__head">
              {item.number != null ? (
                <span className="kc-episode__number">#{item.number}</span>
              ) : null}
              <h3 className="kc-episode__title">{item.title}</h3>
            </header>
            <p className="kc-episode__meta">
              {item.publishedAt ? <span>{formatDate(item.publishedAt)}</span> : null}
              {item.durationMinutes ? (
                <span>{formatEpisodeDuration(item.durationMinutes)}</span>
              ) : null}
            </p>
            {item.description ? <p className="kc-episode__desc">{item.description}</p> : null}
            {item.audioUrl ? (
              <a className="kc-episode__listen" href={item.audioUrl} target="_blank" rel="noopener noreferrer">
                ▶ Listen
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
