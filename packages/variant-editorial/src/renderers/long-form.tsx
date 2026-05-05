import type { Lede, Now } from '@portfolio/schema';
import { readingTimeFor, formatDate } from '@portfolio/kit';
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
    <SectionFrame section={section} fallbackTitle={fallbackTitle}>
      <div className="editorial-longform">
        <aside className="editorial-longform__marginalia">
          {asOf ? <div>As of {formatDate(asOf)}</div> : null}
          {minutes ? <div className="editorial-longform__reading-time">{minutes} min read</div> : null}
        </aside>
        <div className="editorial-longform__body">
          <MarkdownBody source={section.body} />
        </div>
      </div>
    </SectionFrame>
  );
}
