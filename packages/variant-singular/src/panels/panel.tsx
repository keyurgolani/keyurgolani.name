import type { ReactNode } from 'react';
import type { FrameAttributes } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { Panel as PanelModel } from '../model';
import { ownId, uiLang, Words } from '../parts';
import { ActionBand } from './action-band';

// One panel (brief §5.7, the panel grammar): a full-viewport section on the
// ground its position gives it, its one answer in the body, and its action
// band at the foot. A panel that frames a content section spreads the
// section's frame attributes, so the outline, the trace and the tests find
// it; the two panels the composition composes itself (best work, more work)
// carry ids of their own under sg-.

/** The id of a panel's heading, which the panel is labelled by and the pager focuses. */
export const headingId = (input: VariantRenderInput, panel: PanelModel) =>
  ownId(input.ids.prefix, `${panel.anchor}--h`);

/** A panel's name: the owner's title, or the composition's word, marked English when the page isn't. */
export function PanelLabel({ input, panel }: { input: VariantRenderInput; panel: PanelModel }) {
  return panel.label.own ? (
    <>{panel.label.text}</>
  ) : (
    <Words lang={uiLang(input.portfolio.locale)}>{panel.label.text}</Words>
  );
}

export function PanelShell({
  input,
  panel,
  frame,
  className,
  body: Body = 'div',
  children,
}: {
  input: VariantRenderInput;
  panel: PanelModel;
  /** The section's frame attributes, when the panel frames a content section. */
  frame?: FrameAttributes;
  className?: string;
  /** The body's element: an article when the panel's answer is one self-contained work. */
  body?: 'div' | 'article';
  children: ReactNode;
}) {
  const id = frame?.id ?? ownId(input.ids.prefix, panel.anchor);
  return (
    <section
      {...frame}
      id={id}
      className="sg-panel"
      data-ground={panel.ground}
      data-sg-panel={panel.key}
      data-sg-stop=""
      data-sg-anchor={panel.anchor}
      aria-labelledby={headingId(input, panel)}
    >
      {/* The surface hook (K-2) marks the body, not the section, so the band's own ground keeps its own pair. */}
      <Body
        className={`sg-grid sg-panel__body${className ? ` ${className}` : ''}`}
        data-ui-surface={panel.ground === 'canvas' ? undefined : panel.ground}
      >
        {children}
      </Body>
      <ActionBand input={input} panel={panel} />
    </section>
  );
}
