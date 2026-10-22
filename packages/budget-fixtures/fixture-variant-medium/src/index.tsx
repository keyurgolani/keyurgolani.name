import type { ReactElement } from 'react';
import { Enhancement } from '@portfolio/kit/enhancements';
import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { ShaderStage } from './shader-stage';
import { WhenVisible } from './when-visible';

// A budget fixture (#6, Slice 2): a medium variant. Above the sections, a
// stage the server renders with a still in its stylesheet, a WebGL2
// fragment shader that draws over it once the page runs, and a mark on an
// infinite CSS animation. After them, a slot that loads the one
// enhancement, glint, once it's in view. pnpm test:trace publishes it and
// fixture-variant-light in turn, in a build with BUDGET_FIXTURES=1. Never
// installed in a release.

export default function FixtureVariantMedium({
  input,
}: {
  readonly input: VariantRenderInput;
}): ReactElement {
  const { portfolio, ids } = input;
  return (
    <>
      <header className="fvm-header">
        <VisitorControlSlot />
      </header>
      {/* Focusable, so the host's skip link moves focus here. */}
      <main id={ids.main} className="fvm-main" tabIndex={-1}>
        <div className="fvm-stage" aria-hidden="true">
          <ShaderStage />
          <span className="fvm-pulse" />
        </div>
        <h1 className="fvm-name">{portfolio.identity.name}</h1>
        {portfolio.sections.map((section) => renderSection(section, input, {}, { level: 2 }))}
        <WhenVisible className="fvm-glint-slot">
          <Enhancement input={input} id="glint" />
        </WhenVisible>
      </main>
    </>
  );
}
