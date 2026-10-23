import type { ReactElement } from 'react';
import { EnhancementIsland } from '@portfolio/kit/enhancements';
import { MotionControl } from '@portfolio/kit/runtime';
import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { ShaderStage } from './shader-stage';

// A budget fixture (#6, Slice 2): a medium variant. Above the sections, a
// stage the server renders with a still in its stylesheet, a WebGL2
// fragment shader that draws over it once the page runs, and a mark on an
// infinite CSS animation, both on the kit runtime (#6, items 6 and 7), and
// in the header the visitor's MotionControl. After them, an island that
// loads the one enhancement, glint, once it's in view, in place of its
// server markup. pnpm test:trace publishes it and fixture-variant-light in
// turn, in a build with BUDGET_FIXTURES=1. Never installed in a release.

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
        <MotionControl className="fvm-motion" />
      </header>
      {/* Focusable, so the host's skip link moves focus here. */}
      <main id={ids.main} className="fvm-main" tabIndex={-1}>
        <ShaderStage />
        <h1 className="fvm-name">{portfolio.identity.name}</h1>
        {portfolio.sections.map((section) => renderSection(section, input, {}, { level: 2 }))}
        <EnhancementIsland input={input} id="glint" className="fvm-glint-slot">
          <span className="fvm-glint" aria-hidden="true" />
        </EnhancementIsland>
      </main>
    </>
  );
}
