import type { CSSProperties, ReactNode } from 'react';
import { renderSection, RichText, type SectionFrameProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Seal } from './field/seal';
import { chromeIds, said, type HomeModel } from './model';
import { Hidden, Words } from './parts';

// The opening (TF-M3): the masthead's field continues down into the hero,
// one centred column on the page's axis whose ground's lower edge is the
// wide arc. In order: the kicker (the name and the current role, at label
// size, where a greeting would stand), the one display line, the page's h1
// (N5: the thesis's first sentence, the owner's name its hidden prefix),
// the lede, one action, and the subtagline. The seal sits on the arc's
// lowest point, the opening's one proof, outside the region marked as
// the accent ground (K-2), since it sits on paper. The greeting never shows.

function OpeningBody({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const ids = chromeIds(input.ids.prefix);
  const { line, kicker, lede, action, seal } = model;
  const name = said(model.hero?.name) ? model.hero.name : input.portfolio.identity.name;
  return (
    <>
      <div className="tf-page" data-ui-surface={model.quiet ? undefined : 'accent'}>
        <div className="tf-hero__inner">
          {model.hero && said(model.hero.title) ? (
            <p className="tf-label tf-hero__title">{model.hero.title}</p>
          ) : null}
          {kicker ? (
            <p className="tf-kicker tf-label tf-hero__kicker" lang={kicker.lang}>
              {kicker.name !== undefined ? <span className="tf-strong">{kicker.name}</span> : null}
              {kicker.name !== undefined && kicker.role !== undefined ? ', ' : null}
              {kicker.role !== undefined ? <span>{kicker.role}</span> : null}
              {kicker.organization !== undefined ? (
                <>
                  {' '}
                  {/* The role's own language may differ from the page's; the word is English. */}
                  <Words lang={kicker.lang !== undefined ? 'en' : model.uiLang}>at</Words>{' '}
                  <span>{kicker.organization}</span>
                </>
              ) : null}
            </p>
          ) : null}
          <h1 className="tf-display tf-hero__line" id={ids.heroTitle}>
            {line.source !== 'name' ? <Hidden>{`${name}: `}</Hidden> : null}
            {line.source === 'thesis' ? (
              <RichText source={line.text} inline input={input} />
            ) : (
              line.text
            )}
          </h1>
          {lede.lede !== undefined ? <p className="tf-quote tf-hero__lede">{lede.lede}</p> : null}
          {action ? (
            <p className="tf-hero__acts">
              <a className="tf-act tf-act--canvas" href={action.href}>
                {action.own ? <Words lang={model.uiLang}>{action.label}</Words> : action.label}
              </a>
            </p>
          ) : null}
          {lede.sub !== undefined ? <p className="tf-compact tf-hero__sub">{lede.sub}</p> : null}
        </div>
      </div>
      {seal ? <Seal seal={seal} /> : null}
    </>
  );
}

/** The seal's line and figure, in characters, which size the circle, the room above it, and the plates' drop beside it. */
export const sealStyle = (model: HomeModel) =>
  model.seal
    ? ({
        '--layout-seal-chars': model.seal.widest,
        '--layout-seal-figure': model.seal.figure,
      } as CSSProperties)
    : undefined;

/** The hero's frame: the field's arc and the region the h1 names. */
function heroFrame(input: VariantRenderInput, model: HomeModel) {
  return function HeroFrame(props: SectionFrameProps) {
    return (
      <section
        {...props.frame}
        aria-labelledby={chromeIds(input.ids.prefix).heroTitle}
        className="tf-hero"
        data-seal={model.seal ? '' : undefined}
      >
        {props.children}
      </section>
    );
  };
}

export function Opening({
  input,
  model,
}: {
  input: VariantRenderInput;
  model: HomeModel;
}): ReactNode {
  const body = <OpeningBody input={input} model={model} />;
  if (!model.hero) {
    // No hero section: the opening is the composition's own, with the same h1.
    return (
      <div className="tf-hero" data-seal={model.seal ? '' : undefined}>
        {body}
      </div>
    );
  }
  return renderSection(
    model.hero,
    input,
    { renderers: { hero: () => body }, Frame: heroFrame(input, model) },
    { level: 1 },
  );
}
