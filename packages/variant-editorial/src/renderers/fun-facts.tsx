import type { FunFacts } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function FunFactsRenderer({ section }: { section: FunFacts }) {
  return (
    <SectionFrame section={section} fallbackTitle="Off the page">
      <ul className="editorial-fun-facts">
        {section.items.map((item, i) => (
          <li key={i} className="editorial-fun-facts__item">
            {item}
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}
