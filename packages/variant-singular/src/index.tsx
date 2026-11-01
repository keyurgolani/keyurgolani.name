import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { composePages, renderSection, type HomePageProps } from '@portfolio/kit/sections';
import { Enhancement } from '@portfolio/kit/enhancements';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { CaseStudyPage } from './case-study';
import { Bar } from './chrome/bar';
import { Colophon } from './chrome/colophon';
import { Rail } from './chrome/rail';
import { Strip } from './chrome/strip';
import { compositionFor } from './frame';
import { planOf, type Panel } from './model';
import { BestWorkPanel } from './panels/best-work';
import { MoreWorkPanel } from './panels/more-work';
import { NumbersPanel } from './panels/numbers';
import { PanelShell } from './panels/panel';
import { Who } from './panels/who';
import { Record } from './record/record';

// Singular (variants-10 brief §5.7): one question per screen. Six
// full-viewport panels in a fixed order, Who, Best work, Numbers, More
// work, References and Contact, each answering one question and ending on
// one action band on the other of paper and ink; the grounds alternate by
// position and the contact panel is the accent. A labelled dot rail marks
// the place, Contents holds the short version and the record's index, and
// the record follows: every other section, monoscale and complete, so no
// content depends on the panel device. A panel whose content is missing
// leaves, and the counter renumbers.
//
// It owns composition alone: the paper, the ink and the ultramarine are the
// scheme's, the faces the typography pack's, the timing the motion tokens'.

type Render = (section: Section, level: 1 | 2 | 3) => ReactElement | null;

function PanelView({
  panel,
  input,
  render,
}: {
  panel: Panel;
  input: VariantRenderInput;
  render: Render;
}) {
  switch (panel.key) {
    case 'who':
      return panel.section ? (
        render(panel.section, 1)
      ) : (
        <PanelShell input={input} panel={panel} className="sg-panel--who">
          <Who input={input} panel={panel} />
        </PanelShell>
      );
    case 'best':
      return <BestWorkPanel input={input} panel={panel} />;
    case 'numbers':
      return panel.section ? (
        render(panel.section, 2)
      ) : (
        <NumbersPanel input={input} panel={panel} />
      );
    case 'more':
      return <MoreWorkPanel input={input} panel={panel} />;
    default:
      return panel.section ? render(panel.section, 2) : null;
  }
}

function HomePage({ input, outline }: HomePageProps) {
  const plan = planOf(input);
  const composition = compositionFor(input);
  const render: Render = (section, level) => renderSection(section, input, composition, { level });
  const snap =
    input.controls.snap === 'mandatory' || input.controls.snap === 'off'
      ? input.controls.snap
      : 'proximity';
  return (
    <div className="sg" data-sg-snap={snap}>
      <Bar input={input} outline={outline} />
      <Strip input={input} />
      <Rail input={input} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={input.ids.main} className="sg-main" tabIndex={-1}>
        {plan.panels.map((panel) => (
          <PanelView key={panel.key} panel={panel} input={input} render={render} />
        ))}
        <Record input={input} render={(section) => render(section, 3)} />
      </main>
      <Colophon input={input} />
      <Enhancement input={input} id="pager" />
    </div>
  );
}

export default composePages({ HomePage, CaseStudyPage });
