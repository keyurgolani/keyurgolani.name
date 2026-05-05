import type { Cta } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';
import { ActionLink } from '../primitives/action-link';

export function CtaRenderer({ section }: { section: Cta }) {
  return (
    <SectionFrame section={section} fallbackTitle={section.title ?? 'Work with me'} showHeading={false}>
      <div className="editorial-endnote editorial-endnote--accent">
        {section.title ? <p className="editorial-endnote__message">{section.title}</p> : null}
        {section.description ? <p>{section.description}</p> : null}
        {(section.primaryAction || section.secondaryAction) && (
          <div className="editorial-endnote__actions">
            {section.primaryAction ? <ActionLink link={section.primaryAction} /> : null}
            {section.secondaryAction ? <ActionLink link={section.secondaryAction} ghost /> : null}
          </div>
        )}
      </div>
    </SectionFrame>
  );
}
