import type { ReactElement } from 'react';
import { Navigation, type NavigationItem } from '@portfolio/appearance/primitives';
import { VisitorControlSlot, type HeadingLevel } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { anchoringInput, Chapter, levelOf, renderAt } from './chapter';
import { anchorOf, CHAPTERS, INDEX_ANCHOR, numberOf, RESERVED_ANCHORS } from './chapters';
import { Cinema } from './controller';
import { homeModel, named, present } from './model';
import { ownId, uiLang, Words } from './parts';

// Horizontal Cinema (#17): five finite chapters, Prologue, Origins,
// Journey, Craft, and Epilogue, each a frame of the portfolio's own media
// beside its evidence, with a direct URL each, `/#chapter-journey`, and an
// index after them that every chapter reaches in one link.
//
// It owns composition alone. Its dark framing is the selected appearance's
// and its grain the selected design language's texture (#19, Codex [29] to
// [31]): it never forces a mode, and a light scheme or high contrast gives
// the same chapters in those colors. Every chapter is server markup in the
// page's order, every link a plain link, so a page with no script, a print,
// reduced motion, and a plate all read all five; the controller only adds
// one bounded chapter state on top. A work's own page, /work/<slug>, is the
// host's shared one.

type Section = VariantRenderInput['portfolio']['sections'][number];

export default function HorizontalCinema({ input }: { readonly input: VariantRenderInput }) {
  const { ids, portfolio } = input;
  const prefix = ids.prefix;
  const lang = uiLang(portfolio.locale);
  const model = homeModel(input);
  const view = anchoringInput(input);
  // The page's one h1, in Prologue: the leading hero's, or the identity's name.
  const hero = model.hero ? renderAt(model.hero, view, 1) : null;
  const opening = hero ?? (
    <div className="hc-opening">
      <h1 className="hc-opening__name" data-type-role="display">
        {portfolio.identity.name}
      </h1>
      {present(portfolio.identity.tagline) ? (
        <p className="hc-opening__tagline" data-type-role="headline">
          {portfolio.identity.tagline}
        </p>
      ) : null}
    </div>
  );
  const render = (sections: readonly Section[], level: HeadingLevel): ReactElement[] =>
    sections.flatMap((section) => {
      const element = renderAt(section, view, level);
      return element ? [element] : [];
    });
  const chapters = model.chapters.map((content) =>
    render(content.sections, levelOf(content.position)),
  );
  const rest = render(model.rest, 3);
  const shown = new Set([...chapters.flat(), ...rest].map((element) => String(element.key)));
  // Every titled section the page shows, wherever it reads, by its own anchor.
  const sections = portfolio.sections.filter(
    (section) => named(section) && shown.has(section.id) && !RESERVED_ANCHORS.has(section.id),
  );
  const indexHeading = ownId(prefix, 'index-heading');
  const items: NavigationItem[] = [
    ...CHAPTERS.map(({ label }, position) => ({
      href: `#${prefix}${anchorOf(position)}`,
      label: (
        <span className="hc-index__chapter">
          <span data-type-role="numeric">{numberOf(position)}</span>{' '}
          <Words lang={lang}>{label}</Words>
        </span>
      ),
    })),
    ...sections.map((section) => ({
      href: `#${prefix}${section.id}`,
      label: <span className="hc-index__section">{section.title}</span>,
      lang: section.lang,
    })),
  ];
  return (
    <>
      <header className="hc-chrome">
        <a
          className="hc-chrome__name"
          href={routeHref(input, { route: 'home' })}
          data-type-role="label"
          aria-current="page"
        >
          {portfolio.identity.name}
        </a>
        {/* The exit, from anywhere: the index after the chapters, in the page's own flow. */}
        <a className="hc-chrome__index" href={`#${prefix}${INDEX_ANCHOR}`} data-type-role="label">
          <Words lang={lang}>Index</Words>
        </a>
        <VisitorControlSlot />
      </header>
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={ids.main} className="hc-main" tabIndex={-1}>
        <Cinema prefix={prefix} lang={lang}>
          {model.chapters.map((content) => (
            <Chapter
              key={content.position}
              content={content}
              sections={chapters[content.position]!}
              input={input}
              opening={content.position === 0 ? opening : undefined}
              folded={content.position === 2 ? model.folded : undefined}
            />
          ))}
        </Cinema>
        <section
          id={`${prefix}${INDEX_ANCHOR}`}
          className="hc-index"
          aria-labelledby={indexHeading}
        >
          <h2 id={indexHeading} className="hc-index__heading" data-type-role="title" tabIndex={-1}>
            <Words lang={lang}>Index</Words>
          </h2>
          <Navigation labelledBy={indexHeading} orientation="vertical" items={items} />
          {rest.length > 0 ? <div className="hc-index__rest">{rest}</div> : null}
        </section>
      </main>
    </>
  );
}
