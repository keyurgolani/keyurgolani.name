import type { Discography } from '@portfolio/schema';
import { formatDate, formatTrackDuration } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function DiscographyRenderer({ section }: { section: Discography }) {
  return (
    <SectionFrame section={section} fallbackTitle="Discography" gradientTitle>
      <div className="kc-discography">
        {section.items.map((item, i) => (
          <article key={i} className="kc-card kc-card--hoverable kc-record">
            {item.cover ? (
              <div className="kc-record__cover">
                <img
                  src={item.cover.src}
                  alt={item.cover.alt ?? `${item.title} cover`}
                  loading="lazy"
                />
              </div>
            ) : null}
            <div className="kc-record__body">
              <h3 className="kc-record__title">{item.title}</h3>
              <p className="kc-record__meta">
                {item.artist ? <span>{item.artist}</span> : null}
                {item.releasedAt ? <span>{formatDate(item.releasedAt)}</span> : null}
                {item.label ? <span>{item.label}</span> : null}
              </p>
              {item.tracks && item.tracks.length > 0 ? (
                <ol className="kc-record__tracks">
                  {item.tracks.map((track, j) => (
                    <li key={j} className="kc-record__track">
                      <span className="kc-record__track-num">{j + 1}.</span>
                      <span className="kc-record__track-title">{track.title}</span>
                      {track.durationSeconds ? (
                        <span className="kc-record__track-dur">
                          {formatTrackDuration(track.durationSeconds)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
