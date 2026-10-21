import type { Stats } from '@portfolio/schema';
import { formatStatValue } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export function StatsRenderer({ section }: { section: Stats }) {
  return (
    <SectionFrame section={section} fallbackTitle={section.title ?? 'By the numbers'}>
      <div className="editorial-stats">
        {section.items.map((item, i) => (
          <div key={i}>
            <div className="editorial-stat__value">{formatStatValue(item.value)}</div>
            <div className="editorial-stat__label">{item.label}</div>
            {item.description ? (
              <div className="editorial-stat__description">{item.description}</div>
            ) : null}
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}
