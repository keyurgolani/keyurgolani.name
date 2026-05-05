import type { FunFacts } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function FunFactsRenderer({ section }: { section: FunFacts }) {
  return (
    <SectionFrame section={section} fallbackTitle="Fun Facts" gradientTitle>
      <ul className="kc-fun-facts">
        {section.items.map((item, i) => (
          <li key={i} className="kc-card kc-fun-fact">{item}</li>
        ))}
      </ul>
    </SectionFrame>
  );
}
