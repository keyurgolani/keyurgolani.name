import type { Tenure } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function TenureRenderer({ section }: { section: Tenure }) {
  return (
    <SectionFrame section={section} fallbackTitle="Tenure" showHeading={false}>
      <div className="kc-card kc-tenure">
        <span className="kc-tenure__figure">
          {section.years != null ? `${section.years}+` : '—'}
        </span>
        <span className="kc-tenure__label">Years</span>
        {section.summary ? (
          <p className="kc-tenure__summary">{section.summary}</p>
        ) : null}
      </div>
    </SectionFrame>
  );
}
