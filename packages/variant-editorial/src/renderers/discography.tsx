import type { Discography } from '@portfolio/schema';
import { formatYear, formatTrackDuration } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function DiscographyRenderer({ section }: { section: Discography }) {
  return (
    <SectionFrame section={section} fallbackTitle="Discography">
      <div className="editorial-plates">
        {section.items.map((item, i) => (
          <article key={`${item.title}-${i}`}>
            {item.cover ? (
              <div className="editorial-plate__media">
                <img
                  src={item.cover.src}
                  alt={item.cover.alt ?? item.title}
                  width={item.cover.width}
                  height={item.cover.height}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            ) : null}
            <div className="editorial-plate__caption" style={{ marginTop: '0.6rem' }}>
              <h3 className="editorial-plate__title">{item.title}</h3>
              <div className="editorial-plate__meta">
                {[item.role, item.label, formatYear(item.releasedAt)].filter(Boolean).join(' · ')}
              </div>
              {item.description ? (
                <MarkdownBody source={item.description} className="editorial-entry__description" />
              ) : null}
              {item.tracks && item.tracks.length > 0 ? (
                <ol className="editorial-plate__tracks">
                  {item.tracks.map((track, j) => (
                    <li key={j}>
                      <span>{track.title}</span>
                      {track.durationSeconds ? (
                        <span className="editorial-plate__track-duration">
                          {formatTrackDuration(track.durationSeconds)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              {item.links && item.links.length > 0 ? (
                <div className="editorial-entry__links">
                  {item.links.map((l, j) => (
                    <a key={j} href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.label ?? l.platform ?? 'Listen'}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
