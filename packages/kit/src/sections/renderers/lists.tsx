import type { Services, Skills, Stack } from '@portfolio/schema';
import { deeper, Heading, MaybeLink, renderContext, SectionHeader, TagList } from '../primitives';
import { RichText } from '../rich-text';
import type { SectionRendererProps } from '../types';

/** Grouped skills, a flat list, or both, groups first. */
export function SkillsSection({ section, input, level }: SectionRendererProps<Skills>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Skills" />
      {section.groups?.length ? (
        <ul className="pf-groups">
          {section.groups.map((group, index) => (
            <li key={index} className="pf-group">
              <Heading level={deeper(level)} className="pf-group__title">
                {group.name}
              </Heading>
              {group.description !== undefined ? <p>{group.description}</p> : null}
              <TagList items={group.items} />
            </li>
          ))}
        </ul>
      ) : null}
      <TagList items={section.items} />
    </>
  );
}

export function StackSection({ section, input, level }: SectionRendererProps<Stack>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Stack" />
      <ul className="pf-groups">
        {section.groups.map((group, index) => (
          <li key={index} className="pf-group">
            <Heading level={deeper(level)} className="pf-group__title">
              {group.name}
            </Heading>
            <ul className="pf-tags">
              {group.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <MaybeLink url={item.url} ctx={ctx}>
                    {item.name}
                  </MaybeLink>
                  {item.version !== undefined ? (
                    <>
                      {' '}
                      <span className="pf-version">{item.version}</span>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ServicesSection({ section, input, level }: SectionRendererProps<Services>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Services" />
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <Heading level={deeper(level)} className="pf-item__title">
              <MaybeLink url={item.url} ctx={ctx}>
                {item.name}
              </MaybeLink>
            </Heading>
            {item.pricing !== undefined ? <p className="pf-pricing">{item.pricing}</p> : null}
            {item.description !== undefined ? <RichText source={item.description} /> : null}
            <TagList items={item.highlights} className="pf-highlights" />
          </li>
        ))}
      </ul>
    </>
  );
}
