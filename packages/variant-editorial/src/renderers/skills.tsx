import type { Skills } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function SkillsRenderer({ section }: { section: Skills }) {
  if (section.groups && section.groups.length > 0) {
    return (
      <SectionFrame section={section} fallbackTitle="Skills">
        <div className="editorial-grouped">
          {section.groups.map((group, i) => (
            <div key={`${group.name}-${i}`}>
              <h3 className="editorial-group__name">{group.name}</h3>
              {group.description ? (
                <p className="editorial-group__description">{group.description}</p>
              ) : null}
              <ul className="editorial-group__items editorial-group__items--inline">
                {group.items.map((item, j) => (
                  <li key={j} className="editorial-group__item">
                    {item}
                    {j < group.items.length - 1 ? <span style={{ color: 'var(--ink-subtle)' }}> · </span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame section={section} fallbackTitle="Skills">
      <ul className="editorial-group__items editorial-group__items--inline">
        {(section.items ?? []).map((item, i) => (
          <li key={i} className="editorial-group__item">
            {item}
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}
