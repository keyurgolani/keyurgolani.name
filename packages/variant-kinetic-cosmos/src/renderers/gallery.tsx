import type { Gallery } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function GalleryRenderer({ section }: { section: Gallery }) {
  return (
    <SectionFrame section={section} fallbackTitle="Gallery" gradientTitle>
      <div className={`kc-gallery kc-gallery--${section.layout ?? 'grid'}`}>
        {section.items.map((item, i) => {
          const focal = item.image.focalPoint;
          const objectPosition = focal
            ? `${(focal.x * 100).toFixed(1)}% ${(focal.y * 100).toFixed(1)}%`
            : 'center';
          return (
            <figure key={i} className="kc-gallery__item">
              <div className="kc-gallery__frame">
                <img
                  src={item.image.src}
                  alt={item.image.alt ?? ''}
                  className="kc-gallery__img"
                  style={{ objectPosition }}
                  loading="lazy"
                />
              </div>
              {(item.caption || item.location) && (
                <figcaption className="kc-gallery__caption">
                  {item.caption ? <span>{item.caption}</span> : null}
                  {item.location ? <span className="kc-gallery__location">{item.location}</span> : null}
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
    </SectionFrame>
  );
}
