import type { ReactNode } from 'react';
import type { Section } from '@portfolio/schema';
import { cn, ensureSectionId } from '@portfolio/kit';

interface SectionFrameProps {
  section: Section;
  fallbackTitle?: string;
  showHeading?: boolean;
  tight?: boolean;
  children: ReactNode;
}

export function SectionFrame({
  section,
  fallbackTitle,
  showHeading = true,
  tight,
  children,
}: SectionFrameProps) {
  const id = ensureSectionId(section.id, section.title ?? fallbackTitle ?? section.kind);
  const heading = section.title ?? fallbackTitle;

  return (
    <section id={id} className={cn('editorial-section', tight && 'editorial-section--tight')}>
      {showHeading && heading ? <h2 className="editorial-section__heading">{heading}</h2> : null}
      {section.subtitle ? <p className="editorial-section__subtitle">{section.subtitle}</p> : null}
      {children}
    </section>
  );
}
