import type { ReactElement } from 'react';
import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Spotlight } from './spotlight';

// A budget fixture (#6, Slice 2): a light variant, every section through
// the kit's shared renderers in one column, and one small client island.
// pnpm test:trace publishes it and fixture-variant-medium in turn, in a
// build with BUDGET_FIXTURES=1, and checks that neither's code or styles
// reach the other's pages. Never installed in a release.

/** The host's words are English, marked so in a portfolio in another language. */
const uiLang = ({ portfolio }: VariantRenderInput) =>
  /^en(?:-|$)/i.test(portfolio.locale) ? undefined : 'en';

export default function FixtureVariantLight({
  input,
}: {
  readonly input: VariantRenderInput;
}): ReactElement {
  const { portfolio, ids } = input;
  return (
    <>
      <header className="fvl-header">
        <VisitorControlSlot />
        <Spotlight lang={uiLang(input)} />
      </header>
      {/* Focusable, so the host's skip link moves focus here. */}
      <main id={ids.main} className="fvl-main" tabIndex={-1}>
        <h1 className="fvl-name">{portfolio.identity.name}</h1>
        {portfolio.sections.map((section) => renderSection(section, input, {}, { level: 2 }))}
      </main>
    </>
  );
}
