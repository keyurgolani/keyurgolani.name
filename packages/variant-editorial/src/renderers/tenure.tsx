import type { Tenure } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function TenureRenderer({ section }: { section: Tenure }) {
  if (section.years == null && !section.summary) return null;

  return (
    <SectionFrame section={section} fallbackTitle="Years in" tight>
      <div className="editorial-tenure">
        {section.years != null ? (
          <p className="editorial-tenure__figure">
            <span className="editorial-tenure__years">{section.years}</span>
            <span className="editorial-tenure__plus">+</span>
            <span className="editorial-tenure__label">years</span>
          </p>
        ) : null}
        {section.summary ? (
          <p className="editorial-tenure__summary">{section.summary}</p>
        ) : null}
      </div>
    </SectionFrame>
  );
}
