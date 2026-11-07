import { Fragment } from 'react';
import {
  composePages,
  footerOutline,
  pageOutline,
  VisitorControlSlot,
  type HomePageProps,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { CHAPTERS } from './chapters';
import { CaseStudyPage } from './board';
import { currentRole } from './title-card';
import { Timeline } from './timeline';
import { Stage, type ChapterMark, type SceneMark } from './controller';
import { Credits, type CreditLink } from './credits';
import { ownId, uiLang, Words } from './parts';
import { recordCredit } from './credit';
import { renderAt, SECTIONS } from './compose';
import { contactHrefs } from './words';
import { anchorOfScene, Intertitle, LeadScene, SceneFrame } from './scene';
import { homeScenes, isClosing, yearsOf, type PlacedScene } from './scenes';

/** How Cinema frames its sections and which take no anchor, which the outline check reads. */
export { SECTIONS as sections } from './compose';

// Horizontal Cinema (redesign): a letterboxed film strip. The portfolio is
// framed scenes in five chapters on one native horizontal scroller, steered
// by a minimap scrubber on the bottom edge. A scope-ratio title card opens
// it and an end-credits roll closes it. Every scene is server markup in the
// strip's order and every link a plain link, so a page with no script, a
// print, a plate, and the List view (/list) read every scene top to bottom;
// the controller only adds one bounded scene state on top.
//
// It owns composition alone: the matte is the scheme's scrim, so it reads
// as cinema black in light and in dark, and every other color, face, and
// material is the selected appearance's.

/** The List view: the same scenes, read top to bottom, at /list. */
function listView(input: VariantRenderInput) {
  return input.capabilities.views.find((view) => view.id === 'list');
}

/** The full record's own title, the composition's words. */
const RECORD_TITLE = 'The full record';

/**
 * The full record, after the film (the home outline): every section of it in
 * its own frame, behind a closed disclosure that opens in place, from a link
 * to it, with no script, and on paper.
 */
function FullRecord({
  id,
  sections,
  input,
}: {
  id: string;
  sections: readonly VariantRenderInput['portfolio']['sections'][number][];
  input: VariantRenderInput;
}) {
  if (sections.length === 0) return null;
  const lang = uiLang(input.portfolio.locale);
  return (
    <section id={id} className="hc-record" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="hc-record__title" data-type-role="title">
        <Words lang={lang}>{RECORD_TITLE}</Words>
      </h2>
      <ul className="hc-record__list" role="list">
        {sections.map((section) => {
          const credit = recordCredit(section, input);
          return (
            <li key={section.id}>
              <details className="hc-record__item" data-record="">
                <summary className="hc-record__summary">
                  <span className="hc-record__name" data-type-role="title">
                    {section.title?.trim() || section.id}
                  </span>
                  {credit ? (
                    <span className="hc-record__credit" data-type-role="label">
                      {credit}
                    </span>
                  ) : null}
                  <span className="hc-fold__state" aria-hidden="true" data-type-role="label">
                    <span className="hc-fold__show">
                      <Words lang={lang}>Show</Words>
                    </span>
                    <span className="hc-fold__hide">
                      <Words lang={lang}>Hide</Words>
                    </span>
                    <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
                      <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.75" />
                    </svg>
                  </span>
                </summary>
                <div className="hc-record__body">{renderAt(section, input, 3)}</div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HomePage({ input }: HomePageProps) {
  // The outline as Cinema anchors its sections: one whose id the strip keeps takes none.
  const outline = pageOutline(input, SECTIONS);
  const { ids, portfolio } = input;
  const prefix = ids.prefix;
  const lang = uiLang(portfolio.locale);
  const { scenes, record } = homeScenes(input);
  const recordId = ownId(prefix, 'record');
  const creditsId = ownId(prefix, 'credits');
  const footer = footerOutline(input, SECTIONS);
  const view = listView(input);
  const listing = input.route.route === 'view' && input.route.view.id === 'list';
  const home = routeHref(input, { route: 'home' });
  const list = view ? routeHref(input, { route: 'view', view, params: {} }) : undefined;
  const hrefOf = (scene: PlacedScene) => `#${prefix}${anchorOfScene(scene, scenes)}`;
  const marks: SceneMark[] = scenes.map((scene) => ({
    number: scene.number,
    chapter: scene.chapter,
    width: scene.width,
    id: `${prefix}${anchorOfScene(scene, scenes)}`,
    title: scene.title,
    base: scene.base,
    own: scene.own,
    continued: scene.continued,
    matte: scene.kind === 'title' || scene.kind === 'intertitle' || isClosing(scene, scenes),
  }));
  const chapters: ChapterMark[] = CHAPTERS.map(({ label }, position) => {
    const first = scenes.find((scene) => scene.chapter === position)!;
    // What the chapter holds, each scene's subject once: a reel's later parts and the cards aren't named.
    const named = scenes
      .filter((scene) => scene.chapter === position)
      .filter((scene) => scene.kind !== 'title' && scene.kind !== 'intertitle')
      .filter((scene) => scene.kind !== 'reel' || scene.part === 0);
    const contents = named
      .filter((scene, index) => named.findIndex((one) => one.title === scene.title) === index)
      .map((scene) => ({
        title: scene.title,
        base: scene.base,
        own: scene.own,
        continued: scene.continued,
        href: hrefOf(scene),
      }));
    return { label, years: yearsOf(scenes, position, input), href: hrefOf(first), contents };
  });
  // Each chapter's sections, for the credits: every one the outline lists, by the scene it's in.
  const anchored = new Map(outline.sections.map((section) => [section.id, section]));
  // The full record's sections, for the chapter sheet: each one's own link, which opens it in place.
  const recordMarks = record.flatMap((section) => {
    const found = anchored.get(section.id);
    return found?.href ? [{ title: found.title ?? section.id, href: found.href }] : [];
  });
  // The five chapters, for the credits: each one link, to its card.
  const film: CreditLink[] = chapters.map((chapter) => ({
    href: chapter.href,
    title: chapter.label,
    lang,
  }));
  const contact = footer.contactHref;
  return (
    <div className="hc" data-view={listing ? 'list' : 'strip'}>
      <a className="hc-skip" href={`#${creditsId}`} data-type-role="label">
        <Words lang={lang}>Skip the strip</Words>
      </a>
      <header className="hc-chrome">
        <a className="hc-chrome__name" href={home} aria-current="page">
          <span className="hc-chrome__title" data-type-role="body">
            {portfolio.identity.name}
          </span>
          <span className="hc-chrome__running" data-type-role="body">
            <Words lang={lang}>A portfolio in five chapters</Words>
          </span>
        </a>
        {list !== undefined || contact ? (
          // The top line's destinations, one landmark: the two views, then the one way in touch.
          <nav className="hc-chrome__nav" aria-label="Site">
            {list !== undefined ? (
              <span className="hc-chrome__views" role="group" aria-label="View">
                <a href={home} aria-current={listing ? undefined : 'page'} data-type-role="label">
                  <Words lang={lang}>Strip</Words>
                </a>
                <a href={list} aria-current={listing ? 'page' : undefined} data-type-role="label">
                  <Words lang={lang}>List</Words>
                </a>
              </span>
            ) : null}
            {contact ? (
              <a className="hc-chrome__contact" href={contact} data-type-role="label">
                <Words lang={lang}>Get in touch</Words>
              </a>
            ) : null}
          </nav>
        ) : null}
        <VisitorControlSlot />
      </header>
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={ids.main} className="hc-main" tabIndex={-1}>
        <Stage
          scenes={marks}
          chapters={chapters}
          creditsHref={`#${creditsId}`}
          jumpId={ownId(prefix, 'chapters')}
          listHref={listing ? undefined : list}
          contactHref={contact}
          record={recordMarks.length > 0 ? { href: `#${recordId}`, marks: recordMarks } : undefined}
          lang={lang}
          label={`The film strip: ${scenes.length} scenes in five chapters`}
        >
          {scenes.map((scene) =>
            // A reel's section renders once, at its first part, and frames every part as a scene.
            scene.kind === 'reel' ? (
              scene.part === 0 ? (
                <Fragment key={scene.number}>
                  {renderAt(scene.section, input, scene.chapter === 0 ? 2 : 3)}
                </Fragment>
              ) : null
            ) : (
              <SceneFrame
                key={scene.number}
                scene={scene}
                scenes={scenes}
                input={input}
                creditsId={creditsId}
                note={
                  scene.kind === 'title' ? (
                    <span className="hc-bar__note">
                      <Words lang={lang}>
                        {`${scenes.length} scenes in five chapters: step through them below, or read them as a list.`}
                      </Words>
                    </span>
                  ) : undefined
                }
              >
                {scene.kind === 'title' ? (
                  scene.hero ? (
                    renderAt(scene.hero, input, 1)
                  ) : (
                    <h1 className="hc-card__name">{portfolio.identity.name}</h1>
                  )
                ) : scene.kind === 'lead' ? (
                  <LeadScene scene={scene} input={input} />
                ) : scene.kind === 'timeline' ? (
                  <Timeline scene={scene} input={input} />
                ) : scene.kind === 'intertitle' ? (
                  <Intertitle
                    scene={scene}
                    scenes={scenes}
                    input={input}
                    years={yearsOf(scenes, scene.chapter, input)}
                    epigraph={scene.epigraph ? renderAt(scene.epigraph, input, 3) : undefined}
                  />
                ) : (
                  scene.sections.map((section) =>
                    renderAt(section, input, scene.chapter === 0 ? 2 : 3),
                  )
                )}
              </SceneFrame>
            ),
          )}
        </Stage>
        <FullRecord id={recordId} sections={record} input={input} />
      </main>
      <Credits
        id={creditsId}
        footer={footer}
        role={currentRole(input)}
        film={film}
        listHref={listing ? undefined : list}
        recordHref={record.length > 0 ? `#${recordId}` : undefined}
        contactInFilm={contact !== undefined ? contactHrefs(input) : []}
        contactHref={contact}
        locale={portfolio.locale}
      />
    </div>
  );
}

export default composePages({ HomePage, CaseStudyPage });

// HC evidence only, not for merge (row 43): this line makes quality:pr and the browser shards change-direct
// Horizontal Cinema, so CI Linux times the stacked walk's pieces and reads HC's cells on the evidence PR.
