import type { Testimonials } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function TestimonialsRenderer({ section }: { section: Testimonials }) {
  return (
    <SectionFrame section={section} fallbackTitle="Testimonials" gradientTitle>
      <div className="kc-testimonials">
        {section.items.map((item, i) => (
          <blockquote key={i} className="kc-card kc-testimonial">
            <p className="kc-testimonial__quote">{item.quote}</p>
            <footer className="kc-testimonial__attribution">
              {item.authorAvatar ? (
                <img
                  className="kc-testimonial__avatar"
                  src={item.authorAvatar.src}
                  alt={item.authorAvatar.alt ?? item.author}
                  loading="lazy"
                />
              ) : null}
              <div>
                <cite className="kc-testimonial__author">
                  {item.authorUrl ? (
                    <a href={item.authorUrl} target="_blank" rel="noopener noreferrer">
                      {item.author}
                    </a>
                  ) : item.author}
                </cite>
                {(item.authorRole || item.authorOrganization) && (
                  <p className="kc-testimonial__role">
                    {item.authorRole}
                    {item.authorRole && item.authorOrganization ? ', ' : ''}
                    {item.authorOrganization}
                  </p>
                )}
              </div>
            </footer>
          </blockquote>
        ))}
      </div>
    </SectionFrame>
  );
}
