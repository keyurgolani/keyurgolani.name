import type { Lede, Now } from '@portfolio/schema';
import { formatDate, readingTimeFor } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

interface LongFormProps {
  section: Lede | Now;
}

export function LongFormRenderer({ section }: LongFormProps) {
  const isNow = section.kind === 'now';
  const fallbackTitle = isNow ? 'Now' : 'About';
  const minutes = readingTimeFor(section.body);
  const asOf = isNow && 'asOf' in section ? section.asOf : undefined;

  return (
    <SectionFrame section={section} fallbackTitle={fallbackTitle} gradientTitle>
      <div className="kc-card kc-longform">
        {(asOf || minutes) && (
          <div className="kc-longform__meta">
            {asOf ? <span>As of {formatDate(asOf)}</span> : null}
            {asOf && minutes ? <span aria-hidden="true">·</span> : null}
            {minutes ? <span>{minutes} min read</span> : null}
          </div>
        )}
        <MarkdownBody source={section.body} />
      </div>
    </SectionFrame>
  );
}
