import type { ReactNode } from 'react';
import type { Practice } from '@portfolio/schema';
import {
  deeper,
  ItemTitle,
  MaybeLink,
  present,
  renderContext,
  SectionHeader,
  TagList,
  type RenderContext,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionOf, SectionRendererProps } from '../types';

// The practice (#10, slice 1): the owner's thesis, and their skills, tools,
// and services in ordered groups. A practice section shows the one part its
// `part` names. A group's name is its heading when it has one; an unnamed
// group's items sit straight under the section.

type Skills = NonNullable<Practice['skills']>;
type Tools = NonNullable<Practice['tools']>;
type Services = NonNullable<Practice['services']>;

/** A group's heading and description, and what goes below them, one level down when named. */
function Group({
  name,
  description,
  ctx,
  children,
}: {
  name?: string;
  description?: string;
  ctx: RenderContext;
  children: (inner: RenderContext) => ReactNode;
}) {
  const named = present(name);
  const inner: RenderContext = named ? { ...ctx, itemLevel: deeper(ctx.itemLevel) } : ctx;
  return (
    <li className="pf-group">
      <ItemTitle text={name} ctx={ctx} className="pf-group__title" />
      {present(description) ? <p>{description}</p> : null}
      {children(inner)}
    </li>
  );
}

function SkillGroups({ groups, ctx }: { groups: Skills; ctx: RenderContext }) {
  return (
    <ul className="pf-groups" role="list">
      {groups.map((group, index) => (
        <Group key={index} name={group.name} description={group.description} ctx={ctx}>
          {() => <TagList items={group.items} />}
        </Group>
      ))}
    </ul>
  );
}

function ToolGroups({ groups, ctx }: { groups: Tools; ctx: RenderContext }) {
  return (
    <ul className="pf-groups" role="list">
      {groups.map((group, index) => (
        <Group key={index} name={group.name} description={group.description} ctx={ctx}>
          {() => (
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
          )}
        </Group>
      ))}
    </ul>
  );
}

function ServiceGroups({ groups, ctx }: { groups: Services; ctx: RenderContext }) {
  const { input } = ctx;
  return (
    <ul className="pf-groups" role="list">
      {groups.map((group, index) => (
        <Group key={index} name={group.name} description={group.description} ctx={ctx}>
          {(inner) => (
            <ul className="pf-list" role="list">
              {group.items.map((item, itemIndex) => (
                <li key={itemIndex} className="pf-item">
                  <ItemTitle text={item.name} url={item.url} ctx={inner} />
                  {present(item.pricing) ? <p className="pf-pricing">{item.pricing}</p> : null}
                  {present(item.description) ? (
                    <RichText source={item.description} input={input} />
                  ) : null}
                  <TagList items={item.highlights} className="pf-highlights" />
                </li>
              ))}
            </ul>
          )}
        </Group>
      ))}
    </ul>
  );
}

/** The part of the practice the section names. */
export function PracticeSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'practice'>>) {
  const ctx = renderContext(input, section, level);
  const practice = input.portfolio.practice;
  const body = (() => {
    switch (section.part) {
      case 'thesis':
        return present(practice?.thesis) ? (
          <RichText source={practice.thesis} className="pf-thesis" input={input} />
        ) : null;
      case 'skills':
        return practice?.skills ? <SkillGroups groups={practice.skills} ctx={ctx} /> : null;
      case 'tools':
        return practice?.tools ? <ToolGroups groups={practice.tools} ctx={ctx} /> : null;
      case 'services':
        return practice?.services ? <ServiceGroups groups={practice.services} ctx={ctx} /> : null;
    }
  })();
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      {body}
    </>
  );
}
