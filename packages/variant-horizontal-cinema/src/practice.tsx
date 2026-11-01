import type { ReactNode } from 'react';
import {
  deeper,
  Heading,
  MaybeLink,
  present,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { firstSentence } from './parts';
import { SectionHead } from './words';

// The practice (redesign): the part a section names, set as the film sets
// words. The thesis is the scene's one dominant line, its first sentence at
// display size with the rest beneath at a reading measure. Skills, tools,
// and services are named rows, each group's name at the start of its row
// and what it holds after it in plain words, never a cloud of chips.

type Section = SectionOf<'practice'>;

/** One named row: the group's name, its description, then what it holds. */
function Row({
  name,
  description,
  level,
  children,
}: {
  name?: string;
  description?: string;
  level: Parameters<typeof Heading>[0]['level'];
  children: ReactNode;
}) {
  return (
    <li className="hc-practice__row">
      {present(name) ? (
        <Heading level={level} className="hc-practice__name">
          <span data-type-role="label">{name}</span>
        </Heading>
      ) : null}
      <div className="hc-practice__held">
        {present(description) ? (
          <p className="hc-practice__description" data-type-role="body-compact">
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </li>
  );
}

export function PracticeSection({ section, input, level }: SectionRendererProps<Section>) {
  const ctx = renderContext(input, section, level);
  const practice = input.portfolio.practice;
  const inner = deeper(ctx.itemLevel);
  const head = (
    <SectionHead
      section={section}
      level={level}
      role={section.part === 'thesis' ? 'label' : 'headline'}
    />
  );
  switch (section.part) {
    case 'thesis': {
      if (!present(practice?.thesis)) return head;
      const { lead, rest } = firstSentence(practice.thesis);
      return (
        <>
          {head}
          <div className="hc-practice__thesis" data-type-role="display">
            <RichText source={lead} input={input} />
          </div>
          {rest ? <RichText source={rest} className="hc-practice__rest" input={input} /> : null}
        </>
      );
    }
    case 'skills':
      return (
        <>
          {head}
          <ul className="hc-practice" role="list">
            {(practice?.skills ?? []).map((group, index) => (
              <Row
                key={index}
                name={group.name}
                description={group.description}
                level={ctx.itemLevel}
              >
                <p data-type-role="body">{group.items.join(', ')}</p>
              </Row>
            ))}
          </ul>
        </>
      );
    case 'tools':
      return (
        <>
          {head}
          <ul className="hc-practice" role="list">
            {(practice?.tools ?? []).map((group, index) => (
              <Row
                key={index}
                name={group.name}
                description={group.description}
                level={ctx.itemLevel}
              >
                <p data-type-role="body">
                  {group.items.map((item, itemIndex) => (
                    <span key={itemIndex}>
                      {itemIndex > 0 ? ', ' : null}
                      <MaybeLink url={present(item.url) ? item.url : undefined} ctx={ctx}>
                        {item.name}
                      </MaybeLink>
                      {present(item.version) ? ` ${item.version}` : null}
                    </span>
                  ))}
                </p>
              </Row>
            ))}
          </ul>
        </>
      );
    case 'services':
      return (
        <>
          {head}
          <ul className="hc-practice" role="list">
            {(practice?.services ?? []).map((group, index) => (
              <Row
                key={index}
                name={group.name}
                description={group.description}
                level={ctx.itemLevel}
              >
                <ul className="hc-practice__services" role="list">
                  {group.items.map((item, itemIndex) => (
                    <li key={itemIndex}>
                      <Heading
                        level={present(group.name) ? inner : ctx.itemLevel}
                        className="hc-practice__service"
                      >
                        <span data-type-role="title">
                          <MaybeLink url={present(item.url) ? item.url : undefined} ctx={ctx}>
                            {item.name}
                          </MaybeLink>
                        </span>
                      </Heading>
                      {present(item.pricing) ? (
                        <p className="hc-practice__pricing" data-type-role="label">
                          {item.pricing}
                        </p>
                      ) : null}
                      {present(item.description) ? (
                        <RichText
                          source={item.description}
                          className="hc-practice__rest"
                          input={input}
                        />
                      ) : null}
                      {item.highlights?.length ? (
                        <p className="hc-practice__description" data-type-role="body-compact">
                          {item.highlights.join(', ')}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Row>
            ))}
          </ul>
        </>
      );
    default:
      return head;
  }
}
