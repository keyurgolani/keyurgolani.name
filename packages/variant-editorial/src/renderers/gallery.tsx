import type { Gallery } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function GalleryRenderer({ section }: { section: Gallery }) {
  return (
    <SectionFrame section={section} fallbackTitle="Gallery">
      <div className="editorial-plates">
        {section.items.map((item, i) => (
          <figure key={`${item.image.src}-${i}`}>
            <div className="editorial-plate__media">
              <img
                src={item.image.src}
                alt={item.image.alt ?? item.caption ?? ''}
                width={item.image.width}
                height={item.image.height}
                loading="lazy"
                decoding="async"
              />
            </div>
            {(item.caption || item.location || item.takenAt) && (
              <figcaption className="editorial-plate__caption">
                {item.caption ? <span>{item.caption}</span> : null}
                {(item.location || item.takenAt) && (
                  <>
                    {item.caption ? <br /> : null}
                    <small>
                      {item.location}
                      {item.location && item.takenAt ? ' · ' : ''}
                      {item.takenAt}
                    </small>
                  </>
                )}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    </SectionFrame>
  );
}
