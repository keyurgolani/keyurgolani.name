import { Fragment } from 'react';
import {
  LabeledDate,
  MaybeLink,
  present,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { EntranceThesis } from '../entrance';
import { firstParagraph } from '../layout';
import { atelierModel } from '../model';
import { CheckLabel, CheckLabels } from './labels';
import { SectionTitle } from './title';

// The practice gallery (redesign, stream C, OA-S2): the thesis as the wall
// statement beside the gallery's signage, then the studio's notes as the
// gallery's checklist of wall labels, numbered through it. Each group of
// skills and tools is a label, its name over its items joined in one line,
// never a row of chips; each service is a label with its terms; and each
// thing the owner is focused on, or about them, is a label of its own. The
// lede is the analytical column's prose, and now is a dated notice.

/** The part of the practice the section names. */
export function PracticeSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'practice'>>) {
  const ctx = renderContext(input, section, level);
  const practice = input.portfolio.practice;
  // The entrance's thesis is its room title, on the wall.
  if (atelierModel(input).thesis?.id === section.id) {
    return <EntranceThesis input={input} label={section.title} />;
  }
  if (section.part === 'thesis') {
    // Any other thesis hangs in Practice: its title, then the statement.
    return (
      <>
        <SectionTitle section={section} ctx={ctx} />
        {present(practice?.thesis) ? (
          <div className="oa-statement" data-type-role="headline">
            <RichText source={practice.thesis} input={input} />
          </div>
        ) : null}
      </>
    );
  }
  if (section.part === 'services') {
    // Each service is a label: its name, what it is, what it covers, and its terms.
    const items = (practice?.services ?? []).flatMap((group) =>
      group.items.map((item) => ({ group, item })),
    );
    return (
      <>
        <SectionTitle section={section} ctx={ctx} />
        <CheckLabels>
          {items.map(({ group, item }, index) => (
            <CheckLabel
              key={index}
              title={
                <MaybeLink url={item.url} ctx={ctx}>
                  {item.name}
                </MaybeLink>
              }
              lines={[
                present(group.name) ? group.name : undefined,
                present(item.description) ? (
                  <RichText key="what" source={item.description} input={input} />
                ) : undefined,
                item.highlights?.length ? item.highlights.join(', ') : undefined,
                present(item.pricing) ? item.pricing : undefined,
              ]}
            />
          ))}
        </CheckLabels>
      </>
    );
  }
  const groups = section.part === 'skills' ? (practice?.skills ?? []) : (practice?.tools ?? []);
  // Each group of materials is a label: its name, then its items in one line, never a row of chips.
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      <CheckLabels>
        {groups.map((group, index) => (
          <CheckLabel
            key={index}
            title={present(group.name) ? group.name : ''}
            lines={[
              group.items.map((item, itemIndex) => (
                <Fragment key={itemIndex}>
                  {itemIndex > 0 ? ', ' : null}
                  {typeof item === 'string' ? (
                    item
                  ) : (
                    <>
                      <MaybeLink url={item.url} ctx={ctx}>
                        {item.name}
                      </MaybeLink>
                      {present(item.version) ? ` ${item.version}` : null}
                    </>
                  )}
                </Fragment>
              )),
            ]}
          />
        ))}
      </CheckLabels>
    </>
  );
}

/** The lede: the analytical column's prose. */
export function LedeSection({ section, input, level }: SectionRendererProps<SectionOf<'lede'>>) {
  const ctx = renderContext(input, section, level);
  // Practice's summary is the words' first paragraph; the rest reads in the whole practice (home.tsx).
  const summary = atelierModel(input).halls.get('about')?.lead[0]?.id === section.id;
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      <RichText
        source={summary ? firstParagraph(section.body).first : section.body}
        className="oa-prose"
        input={input}
      />
    </>
  );
}

/** What the owner is doing now, as of the date they give: a dated notice. */
export function NowSection({ section, input, level }: SectionRendererProps<SectionOf<'now'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      {section.asOf !== undefined ? (
        <p className="oa-dateline" data-type-role="label">
          <LabeledDate label="As of" raw={section.asOf} ctx={ctx} />
        </p>
      ) : null}
      <RichText source={section.body} className="oa-prose" input={input} />
    </>
  );
}

/** A short list the owner writes out, what they're focused on or things about them: a label to each, numbered. */
export function ShortList({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'focus'> | SectionOf<'fun-facts'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      <CheckLabels>
        {section.items.filter(present).map((item, index) => (
          <CheckLabel key={index} title={item} lines={[]} />
        ))}
      </CheckLabels>
    </>
  );
}
