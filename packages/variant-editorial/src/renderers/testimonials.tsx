import type { Testimonials } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function TestimonialsRenderer({ section }: { section: Testimonials }) {
  return (
    <SectionFrame section={section} fallbackTitle="Testimonials">
      <div className="editorial-quoted">
        {section.items.map((item, i) => (
          <blockquote key={`${item.author}-${i}`} className="editorial-quoted__item">
            <p className="editorial-quoted__text">{item.quote}</p>
            <cite className="editorial-quoted__attribution">
              {item.authorAvatar ? (
                <img
                  src={item.authorAvatar.src}
                  alt={item.authorAvatar.alt ?? item.author}
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  style={{ borderRadius: '50%' }}
                />
              ) : null}
              <span className="editorial-quoted__attribution-name">
                {item.authorUrl ? (
                  <a href={item.authorUrl} target="_blank" rel="noopener noreferrer">
                    {item.author}
                  </a>
                ) : (
                  item.author
                )}
              </span>
              {(item.authorRole || item.authorOrganization) && (
                <span className="editorial-quoted__attribution-source">
                  {[item.authorRole, item.authorOrganization].filter(Boolean).join(', ')}
                </span>
              )}
            </cite>
          </blockquote>
        ))}
      </div>
    </SectionFrame>
  );
}
