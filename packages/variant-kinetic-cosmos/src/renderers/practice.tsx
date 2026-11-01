import type { ReactNode } from 'react';
import type { Practice } from '@portfolio/schema';
import {
  deeper,
  formatNames,
  Heading,
  hrefFor,
  MaybeLink,
  present,
  renderContext,
  RichText,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { RuledList } from '../parts';
import { IndexClose, IndexTrigger, InkDialog } from '../system-index';

// The practice in Kinetic Cosmos (redesign, stream E). The first thesis is
// the opening's headline: its first sentence is the page's h1, set at
// display size with its last word stepped in to the fourth column, and the
// rest of it is the standfirst beside it. Skills and tools are ruled groups
// written as sentences, no chips; services are offers, each with its words,
// what it includes, its terms, and the way to ask.

type Skills = NonNullable<Practice['skills']>;
type Tools = NonNullable<Practice['tools']>;
type Services = NonNullable<Practice['services']>;

/** The thesis's first sentence, and the rest of it. A thesis of one sentence has no rest. */
export function splitThesis(thesis: string): { head: string; rest?: string } {
  const text = thesis.replace(/\s+/g, ' ').trim();
  const match = /^(.+?[.!?])["”’)]?\s+(\S.*)$/.exec(text);
  if (!match) return { head: text };
  return { head: match[1]!, rest: match[2]! };
}

/** The headline's words, its last word on a line of its own when the sentence is short enough to step. */
function Headline({ text, input }: { text: string; input: SectionRendererProps<never>['input'] }) {
  const words = text.split(' ');
  const steps = words.length >= 3 && text.length <= 48;
  const long = text.length > 72;
  return (
    <Heading level={1} className="kc-thesis">
      {steps ? (
        <>
          <span className="kc-thesis__line">
            <RichText source={words.slice(0, -1).join(' ')} inline input={input} />
          </span>{' '}
          <span className="kc-thesis__line kc-thesis__line--stepped">
            <RichText source={words.at(-1)!} inline input={input} />
          </span>
        </>
      ) : (
        <span className="kc-thesis__line" data-length={long ? 'long' : undefined}>
          <RichText source={text} inline input={input} />
        </span>
      )}
    </Heading>
  );
}

function Groups({
  groups,
  ctx,
  items,
}: {
  groups: Skills | Tools;
  ctx: RenderContext;
  items: (group: Skills[number] | Tools[number]) => ReactNode;
}) {
  return (
    <ul className="kc-groups" role="list">
      {groups.map((group, index) => (
        <li key={index} className="kc-group">
          <div className="kc-group__name">
            {present(group.name) ? (
              <Heading level={ctx.itemLevel} className="kc-group__title">
                {group.name}
              </Heading>
            ) : null}
            {present(group.description) ? (
              <p className="kc-group__description" data-type-role="label">
                {group.description}
              </p>
            ) : null}
          </div>
          <p className="kc-group__items">{items(group)}</p>
        </li>
      ))}
    </ul>
  );
}

function ToolNames({ group, ctx }: { group: Tools[number]; ctx: RenderContext }) {
  return (
    <>
      {group.items.map((item, index) => (
        <span key={index}>
          {index > 0 ? ', ' : null}
          <MaybeLink url={item.url} ctx={ctx}>
            {item.name}
          </MaybeLink>
          {present(item.version) ? <> {item.version}</> : null}
        </span>
      ))}
    </>
  );
}

/**
 * The offers as bodies with their terms and the way to take each up; what an
 * offer includes opens in a dialog of its own (the engagements as dialogs,
 * P2), from a button named for it. With no script the dialog's content
 * reads in the body.
 */
function Offers({ groups, ctx, idBase }: { groups: Services; ctx: RenderContext; idBase: string }) {
  const { input } = ctx;
  const email = present(input.portfolio.identity.email)
    ? input.portfolio.identity.email.trim()
    : undefined;
  return (
    <>
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="kc-offers-group">
          {present(group.name) ? (
            <Heading level={ctx.itemLevel} className="kc-group__title">
              {group.name}
            </Heading>
          ) : null}
          {present(group.description) ? <p className="kc-summary">{group.description}</p> : null}
          <ul className="kc-offers" role="list">
            {group.items.map((item, index) => {
              // The way to take it up: its own link, else the owner's email.
              const ask = present(item.url) ? item.url : email ? `mailto:${email}` : undefined;
              const more = (item.highlights ?? []).some(present);
              const dialogId = `${idBase}--offer-${groupIndex}-${index}`;
              const askLink =
                ask !== undefined ? (
                  <a className="kc-offer__action kc-link-action" href={hrefFor(ask, input)}>
                    {/* The name up to a dash, so a long title doesn't make the whole link (P3). */}
                    Ask about {item.name.split(/\s+[\u2013\u2014-]\s+/)[0]}
                  </a>
                ) : null;
              return (
                <li key={index} className="kc-offer">
                  <span className="kc-offer__body" aria-hidden="true" />
                  <Heading
                    level={present(group.name) ? deeper(ctx.itemLevel) : ctx.itemLevel}
                    className="kc-offer__title"
                  >
                    {item.name}
                  </Heading>
                  {present(item.pricing) ? (
                    <p className="kc-offer__terms" data-type-role="label">
                      {item.pricing}
                    </p>
                  ) : null}
                  {present(item.description) ? (
                    <RichText source={item.description} className="kc-summary" input={input} />
                  ) : null}
                  {more ? (
                    <IndexTrigger target={dialogId} className="kc-object__more kc-link-action">
                      <span lang={ctx.uiLang}>What it includes</span>
                      <span className="kc-sr"> {item.name}</span>
                    </IndexTrigger>
                  ) : null}
                  {askLink}
                  {more ? (
                    <InkDialog
                      id={dialogId}
                      className="kc-talk-dialog"
                      labelledBy={`${dialogId}--title`}
                    >
                      <div className="kc-talk-dialog__head">
                        <p className="kc-talk-dialog__title" id={`${dialogId}--title`}>
                          {item.name}
                        </p>
                        <IndexClose target={dialogId} className="kc-index__close">
                          <span lang={ctx.uiLang}>Close</span>
                        </IndexClose>
                      </div>
                      <RuledList items={item.highlights} />
                    </InkDialog>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

export function PracticeBody({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'practice'>>) {
  const ctx = renderContext(input, section, level);
  const practice = input.portfolio.practice;
  switch (section.part) {
    case 'thesis': {
      if (!present(practice?.thesis)) return null;
      if (level !== 1)
        return <RichText source={practice.thesis} className="kc-now" input={input} />;
      const { head, rest } = splitThesis(practice.thesis);
      return (
        <>
          <Headline text={head} input={input} />
          {rest !== undefined ? (
            <RichText source={rest} className="kc-standfirst" input={input} />
          ) : null}
        </>
      );
    }
    case 'skills':
      return practice?.skills ? (
        <Groups
          groups={practice.skills}
          ctx={ctx}
          items={(group) => formatNames((group as Skills[number]).items, ctx)}
        />
      ) : null;
    case 'tools':
      return practice?.tools ? (
        <Groups
          groups={practice.tools}
          ctx={ctx}
          items={(group) => <ToolNames group={group as Tools[number]} ctx={ctx} />}
        />
      ) : null;
    case 'services':
      return practice?.services ? (
        <Offers groups={practice.services} ctx={ctx} idBase={`${input.ids.prefix}${section.id}`} />
      ) : null;
  }
}
