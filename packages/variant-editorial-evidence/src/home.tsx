import type { ReactElement } from 'react';
import { Disclosure } from '@portfolio/appearance/primitives';
import { EvidenceEntry, renderSection, RichText, WorkEntry } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Masthead, type Destination } from './masthead';
import { homeModel, present, type HomeModel } from './model';
import { regionContext, regionId, Region, Words } from './parts';
import { Plate } from './plates';

// Editorial Evidence's home page (#13): the opening, the work plates, the
// proof strip, the rest of the reading order, and the archive, in that order
// in the source, on screen, in print, and with no JavaScript. The page's one
// h1 is the opening's; every region and section below it starts at h2.

/** A section the navigation can name: one with a title. The hero and a call to action stand apart. */
const named = (section: HomeModel['sections'][number]) =>
  section.kind !== 'hero' && section.kind !== 'cta' && present(section.title);

/**
 * Where a folded section's links land: an empty mark with the section's own
 * id, at the start of the region that now shows it.
 */
function Anchors({ input, ids }: { input: VariantRenderInput; ids: readonly string[] }) {
  return ids.map((id) => <span key={id} id={`${input.ids.prefix}${id}`} className="ee-anchor" />);
}

function Opening({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const { identity } = input.portfolio;
  const facts = [
    ['Based in', identity.location],
    ['Pronouns', identity.pronouns],
  ].filter((fact): fact is [string, string] => present(fact[1]));
  // The hero heads the page when the reading order opens with one; else the name does.
  const hero = model.hero ? renderSection(model.hero, input, {}, { level: 1 }) : null;
  return (
    <div className="ee-opening">
      <div className="ee-opening__lead">
        {hero ?? (
          <h1 className="ee-opening__name" data-type-role="display">
            {identity.name}
          </h1>
        )}
        {model.thesis ? (
          <div className="ee-opening__thesis" data-type-role="headline">
            <Anchors input={input} ids={model.folded.thesis} />
            <RichText source={model.thesis} input={input} />
          </div>
        ) : !hero && model.tagline ? (
          <p className="ee-opening__thesis" data-type-role="headline">
            {model.tagline}
          </p>
        ) : null}
      </div>
      {facts.length > 0 ? (
        <dl className="ee-opening__notes">
          {facts.map(([term, value]) => (
            <div key={term}>
              <dt data-type-role="caption">
                <Words input={input}>{term}</Words>
              </dt>
              <dd data-type-role="body-compact">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export function Home({ input }: { input: VariantRenderInput }) {
  const { ids } = input;
  const model = homeModel(input);
  const work = regionId(input, 'work');
  const proof = regionId(input, 'proof');
  const archive = regionId(input, 'archive');
  const sections: ReactElement[] = model.sections.flatMap((section) => {
    const element = renderSection(section, input, {}, { level: 2 });
    return element ? [element] : [];
  });
  const shown = new Set(sections.map((element) => element.key));
  const destinations: Destination[] = [
    ...(model.signature || model.flagships.length > 0
      ? [{ label: 'Work', id: work, ui: true }]
      : []),
    ...(model.proof.length > 0 ? [{ label: 'Proof', id: proof, ui: true }] : []),
    ...model.sections
      .filter((section) => named(section) && shown.has(section.id))
      .map((section) => ({
        label: section.title!,
        id: `${ids.prefix}${section.id}`,
        lang: section.lang,
      })),
    ...(model.archive.length > 0 ? [{ label: 'Archive', id: archive, ui: true }] : []),
  ];
  const archiveCtx = regionContext(input, 'archive', 2);
  return (
    <>
      <Masthead input={input} destinations={destinations} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={ids.main} className="ee-main" tabIndex={-1}>
        <Opening input={input} model={model} />
        {model.signature || model.flagships.length > 0 ? (
          <Region
            id={work}
            headingId={`${work}-heading`}
            heading={<Words input={input}>Work</Words>}
            className="ee-region ee-work"
          >
            <Anchors input={input} ids={model.folded.work} />
            {model.signature ? (
              <Plate work={model.signature} input={input} kind="signature" />
            ) : null}
            {model.flagships.length > 0 ? (
              <div className="ee-flagships">
                {model.flagships.map((flagship) => (
                  <Plate key={flagship.id} work={flagship} input={input} kind="flagship" />
                ))}
              </div>
            ) : null}
          </Region>
        ) : null}
        {model.proof.length > 0 ? (
          <Region
            id={proof}
            headingId={`${proof}-heading`}
            heading={<Words input={input}>Proof</Words>}
            className="ee-region ee-proof"
          >
            <ul className="pf-evidence ee-proof__list" role="list">
              {model.proof.map((entry) => (
                <EvidenceEntry
                  key={entry.id}
                  entry={entry}
                  ctx={regionContext(input, 'proof', 2, entry.lang)}
                />
              ))}
            </ul>
          </Region>
        ) : null}
        {sections}
        {model.archive.length > 0 ? (
          <Region
            id={archive}
            headingId={`${archive}-heading`}
            heading={<Words input={input}>Archive</Words>}
            className="ee-region ee-archive"
          >
            {model.signature || model.flagships.length > 0 ? null : (
              <Anchors input={input} ids={model.folded.work} />
            )}
            <Disclosure
              className="ee-archive__disclosure"
              summary={
                <Words input={input}>
                  {model.archive.length === 1
                    ? 'Show 1 older work'
                    : `Show ${model.archive.length} older works`}
                </Words>
              }
            >
              <ul className="pf-list" role="list">
                {model.archive.map((entry) => (
                  <WorkEntry
                    key={entry.id}
                    work={entry}
                    ctx={archiveCtx}
                    anchor={`${ids.prefix}${entry.id}`}
                  />
                ))}
              </ul>
            </Disclosure>
          </Region>
        ) : null}
      </main>
    </>
  );
}
