import type { ReactElement } from 'react';
import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Ballast } from './ballast-island';

// A budget fixture (#6, Slice 2): a light variant that carries more than a
// light variant may, so #6's budget check has something to report. Its
// client island holds about 40 KB of gzipped JavaScript it can't compress
// away, and its stylesheet about 16 KB of gzipped CSS and an @import from
// another host. Registers only with BUDGET_FIXTURES=over. Never installed
// in a release.

export default function FixtureOverBudget({
  input,
}: {
  readonly input: VariantRenderInput;
}): ReactElement {
  const { portfolio, ids } = input;
  return (
    <>
      <header className="fob-header">
        <VisitorControlSlot />
        <Ballast />
      </header>
      {/* Focusable, so the host's skip link moves focus here. */}
      <main id={ids.main} className="fob-main" tabIndex={-1}>
        <h1 className="fob-name">{portfolio.identity.name}</h1>
        {portfolio.sections.map((section) => renderSection(section, input, {}, { level: 2 }))}
      </main>
    </>
  );
}
