import type { CSSProperties, ReactNode } from 'react';
import { hrefFor } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { anchorOf, CHAPTERS } from './chapters';
import { creditOf } from './credit';
import { LeadWork } from './lead-work';
import { numeralOf, ownId, SceneTitle, uiLang, Words } from './parts';
import { chapterScenes, foldsOnPhone, isClosing, sceneAnchor, type PlacedScene } from './scenes';

// A scene (redesign): one frame of the strip. A picture between two matte
// bars, the top one reading the chapter, the scene's title, and a real
// "Scene 6 of 21", the bottom one a credit from what the scene holds and
// the next scene as a link. Chapter openings are intertitles, full-matte
// cards with the chapter's title at display size, its epigraph where it
// has one, and its contents as links to its scenes. Every section a scene
// holds renders through renderSection() in a frame of its own, a landmark
// with its heading, so the outline check finds every one. A reel's parts
// are scenes inside its section's one frame.

/**
 * A scene's anchor, before the id prefix: a chapter's first scene takes the
 * chapter's anchor, `chapter-origins`, so a chapter link opens it, and every
 * other scene its number, `scene-6`.
 */
export function anchorOfScene(scene: PlacedScene, scenes: readonly PlacedScene[]): string {
  const first = chapterScenes(scenes, scene.chapter)[0];
  return first === scene ? anchorOf(scene.chapter) : sceneAnchor(scene.number);
}

/** The link the bottom bar ends in: the next scene, or the credits after the last. */
function NextLink({
  scene,
  scenes,
  input,
  creditsId,
}: {
  scene: PlacedScene;
  scenes: readonly PlacedScene[];
  input: VariantRenderInput;
  creditsId: string;
}) {
  const lang = uiLang(input.portfolio.locale);
  const next = scenes[scene.number];
  if (!next) {
    return (
      <a className="hc-bar__next" href={`#${creditsId}`}>
        <Words lang={lang}>Next: the credits</Words>
      </a>
    );
  }
  return (
    <a className="hc-bar__next" href={hrefFor(`#${anchorOfScene(next, scenes)}`, input)}>
      {next.kind === 'intertitle' ? (
        <Words
          lang={lang}
        >{`Next: Chapter ${numeralOf(next.chapter)}, ${CHAPTERS[next.chapter]!.label}`}</Words>
      ) : (
        <>
          <Words lang={lang}>Next:</Words> <SceneTitle mark={next} lang={lang} />
        </>
      )}
    </a>
  );
}

export function SceneFrame({
  scene,
  scenes,
  input,
  creditsId,
  children,
  note,
}: {
  scene: PlacedScene;
  scenes: readonly PlacedScene[];
  input: VariantRenderInput;
  /** The credits roll's id, which the last scene's next link names. */
  creditsId: string;
  children: ReactNode;
  /** What the title card's bottom bar says before its next link: how to move through the strip. */
  note?: ReactNode;
}) {
  const lang = uiLang(input.portfolio.locale);
  const prefix = input.ids.prefix;
  const total = scenes.length;
  const chapter = CHAPTERS[scene.chapter]!;
  const counter = `Scene ${scene.number} of ${total}`;
  const closing = isClosing(scene, scenes);
  const matte = scene.kind === 'title' || scene.kind === 'intertitle' || closing;
  const credit = creditOf(scene, input);
  const fold = foldsOnPhone(scene, input);
  const anchor = anchorOfScene(scene, scenes);
  // The scene's name, from an element of its own, so its English words keep their language.
  const labelId = ownId(prefix, `label-${anchor}`);
  return (
    <div
      id={`${prefix}${anchor}`}
      className="hc-scene"
      data-scene={scene.number}
      data-kind={scene.kind}
      data-w={scene.width}
      data-chapter={chapter.key}
      data-matte={matte ? '' : undefined}
      data-closing={closing ? '' : undefined}
      role="group"
      aria-labelledby={labelId}
      tabIndex={-1}
    >
      <span id={labelId} hidden>
        <Words lang={lang}>{counter}</Words>: <SceneTitle mark={scene} lang={lang} />
      </span>
      <div className="hc-bar hc-bar--top" aria-hidden="true" data-type-role="label">
        <span className="hc-bar__lead">
          <span className="hc-bar__numeral">{numeralOf(scene.chapter)}</span>{' '}
          <Words lang={lang}>
            {scene.kind === 'intertitle' ? `Chapter ${numeralOf(scene.chapter)}` : chapter.label}
          </Words>
          {scene.kind === 'sections' || scene.kind === 'lead' ? (
            <span className="hc-bar__title">
              {scene.kind === 'lead' ? 'The signature work' : scene.title}
            </span>
          ) : null}
        </span>
        <span className="hc-bar__counter">
          <Words lang={lang}>{counter}</Words>
        </span>
      </div>
      {fold ? (
        // A disclosure that is open as served; on a phone the controller folds it to its title and credit.
        <details className="hc-fold" data-fold="" open>
          <summary className="hc-fold__summary" data-type-role="title">
            <SceneTitle mark={scene} lang={lang} />
            {credit ? (
              <span className="hc-fold__credit" data-type-role="label">
                {credit}
              </span>
            ) : null}
            {/* The disclosure says open or closed itself; this is its sighted twin. */}
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
          <div className="hc-pic">{children}</div>
        </details>
      ) : (
        <div className="hc-pic">{children}</div>
      )}
      <div className="hc-bar hc-bar--bottom" data-type-role="label">
        {note ?? (credit ? <span className="hc-bar__credit">{credit}</span> : <span />)}
        <NextLink scene={scene} scenes={scenes} input={input} creditsId={creditsId} />
      </div>
    </div>
  );
}

/** A chapter's intertitle: its title, its years, its epigraph, and its contents. */
export function Intertitle({
  scene,
  scenes,
  input,
  years,
  epigraph,
}: {
  scene: Extract<PlacedScene, { kind: 'intertitle' }>;
  scenes: readonly PlacedScene[];
  input: VariantRenderInput;
  years: string | undefined;
  /** The chapter's epigraph, rendered by the caller, which holds the section renderers. */
  epigraph?: ReactNode;
}) {
  const lang = uiLang(input.portfolio.locale);
  const prefix = input.ids.prefix;
  const chapter = CHAPTERS[scene.chapter]!;
  const titleId = ownId(prefix, `chapter-${chapter.key}`);
  const contentsId = ownId(prefix, `contents-${chapter.key}`);
  // A reel's later parts aren't named again: the contents name each scene's subject once.
  const contents = chapterScenes(scenes, scene.chapter).filter(
    (one) => one !== scene && !(one.kind === 'reel' && one.part > 0),
  );
  return (
    <>
      <h2 id={titleId} className="hc-intertitle__title" data-type-role="display" tabIndex={-1}>
        <Words lang={lang}>{chapter.label}</Words>
      </h2>
      {years ? (
        <p className="hc-intertitle__years" data-type-role="display" dir="ltr">
          {years}
        </p>
      ) : null}
      {epigraph ? <div className="hc-intertitle__epigraph">{epigraph}</div> : null}
      {contents.length > 0 ? (
        <nav className="hc-intertitle__contents" aria-labelledby={contentsId}>
          <p id={contentsId} data-type-role="label">
            <Words lang={lang}>In this chapter</Words>
          </p>
          <ol
            role="list"
            // On the widest card the contents read in two columns, down the first and then the second.
            data-columns={scene.width === 8 ? 2 : undefined}
            style={
              scene.width === 8
                ? ({ '--layout-rows': Math.ceil(contents.length / 2) } as CSSProperties)
                : undefined
            }
          >
            {contents.map((one) => (
              <li key={one.number}>
                <a href={hrefFor(`#${anchorOfScene(one, scenes)}`, input)}>
                  <span className="hc-intertitle__entry">
                    <SceneTitle mark={one} lang={lang} />
                  </span>
                  <span className="hc-intertitle__number" data-type-role="numeric">
                    {one.number}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
    </>
  );
}

/** The signature work's scene: its lead frame, at Prologue's section level. */
export function LeadScene({
  scene,
  input,
}: {
  scene: Extract<PlacedScene, { kind: 'lead' }>;
  input: VariantRenderInput;
}) {
  return <LeadWork work={scene.work} input={input} level={2} />;
}
