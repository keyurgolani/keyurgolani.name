import type { Quote } from '@portfolio/schema';
import { ensureSectionId } from '@portfolio/kit';

export function QuoteRenderer({ section }: { section: Quote }) {
  const id = ensureSectionId(section.id, 'quote');
  return (
    <section id={id} className="editorial-section editorial-section--tight">
      <blockquote className="editorial-quote-standalone">
        <p className="editorial-quote-standalone__text">{section.text}</p>
        {(section.attribution || section.source) && (
          <cite className="editorial-quote-standalone__attribution">
            {section.attribution}
            {section.attribution && section.source ? ', ' : ''}
            {section.sourceUrl ? (
              <a href={section.sourceUrl} target="_blank" rel="noopener noreferrer">
                {section.source}
              </a>
            ) : (
              section.source
            )}
          </cite>
        )}
      </blockquote>
    </section>
  );
}
