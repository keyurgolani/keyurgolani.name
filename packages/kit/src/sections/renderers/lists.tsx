import type { Services, Skills, Stack } from '@portfolio/schema';
import {
  ItemTitle,
  MaybeLink,
  present,
  renderContext,
  SectionHeader,
  TagList,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionRendererProps } from '../types';

/** Grouped skills, a flat list, or both, groups first. */
export function SkillsSection({ section, input, level }: SectionRendererProps<Skills>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Skills" />
      {section.groups?.length ? (
        <ul className="pf-groups" role="list">
          {section.groups.map((group, index) => (
            <li key={index} className="pf-group">
              <ItemTitle text={group.name} ctx={ctx} className="pf-group__title" />
              {present(group.description) ? <p>{group.description}</p> : null}
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
      <ul className="pf-groups" role="list">
        {section.groups.map((group, index) => (
          <li key={index} className="pf-group">
            <ItemTitle text={group.name} ctx={ctx} className="pf-group__title" />
            <ul className="pf-tags" role="list">
              {group.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <MaybeLink url={item.url} ctx={ctx}>
                    {item.name}
                  </MaybeLink>
                  {present(item.version) ? (
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
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <ItemTitle text={item.name} url={item.url} ctx={ctx} />
            {present(item.pricing) ? <p className="pf-pricing">{item.pricing}</p> : null}
            {present(item.description) ? (
              <RichText source={item.description} input={input} />
            ) : null}
            <TagList items={item.highlights} className="pf-highlights" />
          </li>
        ))}
      </ul>
    </>
  );
}
