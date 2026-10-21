import type { Focus } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function FocusRenderer({ section }: { section: Focus }) {
  return (
    <SectionFrame section={section} fallbackTitle="Currently focused on">
      <ul className="editorial-focus">
        {section.items.map((item, i) => (
          <li key={`${item}-${i}`} className="editorial-focus__item">
            {item}
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}
