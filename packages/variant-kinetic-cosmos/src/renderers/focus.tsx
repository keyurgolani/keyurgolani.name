import type { Focus } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function FocusRenderer({ section }: { section: Focus }) {
  return (
    <SectionFrame section={section} fallbackTitle="Currently focused on" gradientTitle>
      <div className="kc-card kc-focus">
        <ul className="kc-focus__chips">
          {section.items.map((item, i) => (
            <li key={i} className="kc-focus__chip">{item}</li>
          ))}
        </ul>
      </div>
    </SectionFrame>
  );
}
