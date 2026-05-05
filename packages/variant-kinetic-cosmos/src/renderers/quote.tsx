import type { Quote } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function QuoteRenderer({ section }: { section: Quote }) {
  return (
    <SectionFrame section={section} fallbackTitle="Quote" showHeading={false}>
      <figure className="kc-quote">
        <blockquote className="kc-quote__text">
          <span className="kc-quote__mark" aria-hidden="true">"</span>
          {section.text}
          <span className="kc-quote__mark" aria-hidden="true">"</span>
        </blockquote>
        {section.attribution ? (
          <figcaption className="kc-quote__attribution">
            — {section.sourceUrl ? (
              <a href={section.sourceUrl} target="_blank" rel="noopener noreferrer">
                {section.attribution}
              </a>
            ) : section.attribution}
            {section.source ? <span className="kc-quote__source">, {section.source}</span> : null}
          </figcaption>
        ) : null}
      </figure>
    </SectionFrame>
  );
}
