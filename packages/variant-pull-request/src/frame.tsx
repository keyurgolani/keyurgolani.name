import { present, type SectionFrame } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { uiLangOf, Who, Words, type Review } from './parts';

// The frames (issue #270): in the conversation, the hero is the change's
// description, a post the author opened it with, and every other section a
// comment in the timeline, the owner's title its heading. In the commits,
// the checks and the files, a section is a titled group of its records, and
// in the merge box it's the box itself. A section the kit renders, such as
// an extension's, brings its own heading.

/** What each conversation post says its author did. */
const VERBS: Readonly<Record<string, string>> = {
  hero: 'opened this change',
  practice: 'added labels',
  focus: 'listed what changes for your team',
};

export function prFrame(
  input: VariantRenderInput,
  review: Review,
  lead: string | undefined,
): SectionFrame {
  const lang = uiLangOf(input);
  const panels = new Map(review.sections.map(({ section, panel }) => [section.id, panel]));
  return function PrFrame({ frame, section, level, children }) {
    const panel = panels.get(section.id) ?? 'conversation';
    const Heading = `h${level}` as 'h3';
    const own = frame['data-renderer'] !== 'shared';
    const title = own && present(section.title) ? section.title : undefined;
    const subtitle = own && present(section.subtitle) ? section.subtitle : undefined;
    const headId = `${frame.id ?? `${input.ids.prefix}${section.id}`}--h`;
    if (panel === 'conversation') {
      const isLead = section.id === lead;
      const post = (
        <article
          {...frame}
          className={isLead ? 'pr-post pr-post--desc' : 'pr-post'}
          aria-labelledby={title ? headId : `${headId}-by`}
        >
          <p className="pr-post__head" id={`${headId}-by`}>
            <Who review={review}>
              <Words lang={lang}>{VERBS[section.kind] ?? 'commented'}</Words>
            </Who>
            {isLead ? (
              <>
                {' '}
                <span className="pr-chip">
                  <Words lang={lang}>Author</Words>
                </span>
              </>
            ) : null}
          </p>
          <div className="pr-post__body">
            {title ? (
              <Heading className="pr-post__title" id={headId}>
                {title}
              </Heading>
            ) : null}
            {subtitle ? <p className="pr-sub">{subtitle}</p> : null}
            {children}
          </div>
        </article>
      );
      return isLead ? (
        post
      ) : (
        <li className="pr-ev" data-mark={section.kind === 'practice' ? 'label' : 'comment'}>
          <span className="pr-ev__mark" aria-hidden="true" />
          {post}
        </li>
      );
    }
    return (
      <section
        {...frame}
        className={panel === 'merge' ? 'pr-merge' : 'pr-sec'}
        data-panel={panel}
        aria-labelledby={title ? headId : undefined}
      >
        {title ? (
          <Heading className={panel === 'merge' ? 'pr-merge__h' : 'pr-sec__title'} id={headId}>
            {title}
          </Heading>
        ) : null}
        {subtitle ? <p className="pr-sub">{subtitle}</p> : null}
        {children}
      </section>
    );
  };
}
