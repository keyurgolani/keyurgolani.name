import type { Stack } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function StackRenderer({ section }: { section: Stack }) {
  return (
    <SectionFrame section={section} fallbackTitle="Stack">
      <div className="editorial-grouped">
        {section.groups.map((group, i) => (
          <div key={`${group.name}-${i}`}>
            <h3 className="editorial-group__name">{group.name}</h3>
            <ul className="editorial-group__items">
              {group.items.map((item, j) => (
                <li key={j} className="editorial-group__item">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.name}
                    </a>
                  ) : (
                    item.name
                  )}
                  {item.version ? <span className="editorial-group__item-version">{item.version}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}
