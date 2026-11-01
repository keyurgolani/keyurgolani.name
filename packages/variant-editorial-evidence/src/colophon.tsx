import type { ReactNode } from 'react';
import { footerOutline } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { HomeModel } from './model';
import { homeRegion, regionId, Words } from './parts';

// The colophon (C5, smell 25): after a full-page rule, the name, tagline,
// and place on the head line; a short note on how the issue is set, with
// the contents, the archive, and the résumé as its links, on the text
// line; and Back to the top in the margin. The owner's links are in the
// contact section, so the footer doesn't list them again (EE-S2). The
// note credits the appearance packs the page renders in, by the names the
// render input gives (contract 2.1), never names of its own; with none, as
// in a unit test's input, it names the composition alone.

/** How the issue is set: the composition, and the packs that dress it, as the render input names them. */
function Credits({ input }: { input: VariantRenderInput }) {
  const packs = input.appearance;
  const words = (text: string) => <Words input={input}>{text}</Words>;
  if (!packs) return words('Composed as Editorial Evidence, a long-form issue.');
  return (
    <>
      {words('Composed as Editorial Evidence, set in')} {packs.typography.name}
      {words(', colored')} {packs.scheme.name}
      {words(', in the')} {packs.language.name} {words('design language.')}
    </>
  );
}

export function Colophon({ input, model }: { input: VariantRenderInput; model?: HomeModel }) {
  const footer = footerOutline(input);
  const { identity } = input.portfolio;
  const resume = footer.links.find((link) => link.platform === 'resume');
  const hasArchive = (model?.archive.length ?? 0) > 0 && model?.selection !== undefined;
  // Where the rest of the issue is, each clause a sentence's start when it comes first.
  const clauses: [string, (first: boolean) => ReactNode][] = [];
  if ((model?.chapters.length ?? 0) > 0) {
    clauses.push([
      'contents',
      (first) => (
        <>
          <Words input={input}>
            {first ? 'Every section is in the' : 'every section is in the'}
          </Words>{' '}
          <a href={homeRegion(input, regionId(input, 'contents'))}>
            <Words input={input}>contents</Words>
          </a>
        </>
      ),
    ]);
  }
  if (hasArchive) {
    clauses.push([
      'archive',
      (first) => (
        <>
          <Words input={input}>{first ? 'Older work is in' : 'older work is in'}</Words>{' '}
          <a href={homeRegion(input, regionId(input, 'archive'))}>
            <Words input={input}>the archive</Words>
          </a>
        </>
      ),
    ]);
  }
  if (resume) {
    clauses.push([
      'resume',
      (first) => (
        <>
          <Words input={input}>{first ? 'The' : 'the'}</Words>{' '}
          <a href={resume.href}>
            <Words input={input}>full résumé</Words>
          </a>{' '}
          <Words input={input}>is its own document</Words>
        </>
      ),
    ]);
  }
  return (
    <footer className="ee-colophon" data-type-role="body-compact">
      <p className="ee-colophon__name">
        <b data-type-role="title">{footer.name}</b>
        {footer.tagline ? <span>{footer.tagline}</span> : null}
        {identity.location ? <span>{identity.location}</span> : null}
      </p>
      <p className="ee-colophon__text">
        <b>
          <Words input={input}>Colophon.</Words>
        </b>{' '}
        <Credits input={input} />
        {clauses.length > 0 ? (
          <>
            {' '}
            {clauses.map(([key, node], index) => (
              <span key={key}>
                {index > 0 ? '; ' : null}
                {node(index === 0)}
              </span>
            ))}
            .
          </>
        ) : null}
      </p>
      <ul className="ee-colophon__links" role="list">
        <li>
          <a href={`#${input.ids.main}`}>
            <Words input={input}>Back to the top</Words>
          </a>
        </li>
      </ul>
    </footer>
  );
}
