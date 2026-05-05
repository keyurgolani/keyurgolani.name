import type { Stack } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

export function StackRenderer({ section }: { section: Stack }) {
  return (
    <SectionFrame section={section} fallbackTitle="Stack" gradientTitle>
      <div className="kc-stack">
        {section.groups.map((group, i) => (
          <div key={i} className="kc-card kc-stack__group">
            <h3 className="kc-stack__group-name">{group.name}</h3>
            <ul className="kc-stack__items">
              {group.items.map((tool, j) => (
                <li key={j} className="kc-stack__item">
                  {tool.url ? (
                    <a href={tool.url} target="_blank" rel="noopener noreferrer">
                      {tool.name}
                    </a>
                  ) : (
                    tool.name
                  )}
                  {tool.version ? <code className="kc-stack__version">{tool.version}</code> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}
