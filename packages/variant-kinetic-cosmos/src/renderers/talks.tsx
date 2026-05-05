import type { Talks } from '@portfolio/schema';
import { formatDate } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function TalksRenderer({ section }: { section: Talks }) {
  return (
    <SectionFrame section={section} fallbackTitle="Talks" gradientTitle>
      <div className="kc-list">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-talk">
            <header className="kc-talk__head">
              <h3 className="kc-talk__title">{item.title}</h3>
              {item.type ? <span className="kc-talk__type">{item.type}</span> : null}
            </header>
            <p className="kc-talk__meta">
              {item.venue ? <span>{item.venue}</span> : null}
              {item.location ? <span>{item.location}</span> : null}
              {item.presentedAt ? <span>{formatDate(item.presentedAt)}</span> : null}
            </p>
            {item.description ? <p className="kc-talk__description">{item.description}</p> : null}
            {(item.videoUrl || item.slidesUrl) && (
              <div className="kc-talk__links">
                {item.videoUrl ? (
                  <a href={item.videoUrl} target="_blank" rel="noopener noreferrer">Watch</a>
                ) : null}
                {item.slidesUrl ? (
                  <a href={item.slidesUrl} target="_blank" rel="noopener noreferrer">Slides</a>
                ) : null}
              </div>
            )}
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
