import type { ReactNode } from 'react';
import type { Section } from '@portfolio/schema';
import { cn, ensureSectionId } from '@portfolio/kit';

interface SectionFrameProps {
  section: Section;
  fallbackTitle?: string;
  /** When false, omit the heading even if `section.title || fallbackTitle`. */
  showHeading?: boolean;
  /** Apply gradient text treatment to the heading. */
  gradientTitle?: boolean;
  className?: string;
  children: ReactNode;
}

export function SectionFrame({
  section,
  fallbackTitle,
  showHeading = true,
  gradientTitle = false,
  className,
  children,
}: SectionFrameProps) {
  const id = ensureSectionId(section.id, section.title ?? fallbackTitle ?? section.kind);
  const heading = section.title ?? fallbackTitle;

  return (
    <section id={id} className={cn('kc-section', className)}>
      <div className="kc-section__inner">
        {(showHeading && heading) || section.subtitle ? (
          <header className="kc-section__header">
            {showHeading && heading ? (
              <h2
                className={cn(
                  'kc-section__title',
                  gradientTitle && 'kc-section__title--gradient',
                )}
              >
                {heading}
              </h2>
            ) : null}
            {section.subtitle ? (
              <p className="kc-section__subtitle">{section.subtitle}</p>
            ) : null}
          </header>
        ) : null}
        {children}
      </div>
    </section>
  );
}
