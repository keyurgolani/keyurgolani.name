import type { Skills } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function SkillsRenderer({ section }: { section: Skills }) {
  if (section.groups && section.groups.length > 0) {
    return (
      <SectionFrame section={section} fallbackTitle="Skills" gradientTitle>
        <div className="kc-skills">
          {section.groups.map((group, i) => (
            <div key={i} className="kc-card kc-skills__group">
              <h3 className="kc-skills__group-name">{group.name}</h3>
              {group.description ? (
                <p className="kc-skills__group-desc">{group.description}</p>
              ) : null}
              <ul className="kc-skills__chips">
                {group.items.map((item, j) => (
                  <li key={j} className="kc-skills__chip">{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SectionFrame>
    );
  }
  if (section.items && section.items.length > 0) {
    return (
      <SectionFrame section={section} fallbackTitle="Skills" gradientTitle>
        <ul className="kc-card kc-skills__chips">
          {section.items.map((item, i) => (
            <li key={i} className="kc-skills__chip">{item}</li>
          ))}
        </ul>
      </SectionFrame>
    );
  }
  return null;
}
