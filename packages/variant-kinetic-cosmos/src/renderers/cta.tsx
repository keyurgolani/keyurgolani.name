import type { Cta } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';
import { ActionLink } from '../primitives/action-link';

export function CtaRenderer({ section }: { section: Cta }) {
  return (
    <SectionFrame section={section} fallbackTitle={section.title ?? 'Work with me'} showHeading={false}>
      <div className="kc-cta">
        {section.title ? <h2 className="kc-cta__title">{section.title}</h2> : null}
        {section.description ? <p className="kc-cta__description">{section.description}</p> : null}
        {(section.primaryAction || section.secondaryAction) && (
          <div className="kc-cta__actions">
            {section.primaryAction ? (
              <ActionLink link={section.primaryAction} variant="primary" size="lg" />
            ) : null}
            {section.secondaryAction ? (
              <ActionLink link={section.secondaryAction} variant="ghost" size="lg" />
            ) : null}
          </div>
        )}
      </div>
    </SectionFrame>
  );
}
