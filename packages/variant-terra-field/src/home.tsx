import {
  renderSection,
  RichText,
  type HomePageProps,
  type SectionFrameProps,
} from '@portfolio/kit/sections';
import { Enhancement } from '@portfolio/kit/enhancements';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { AnchorBand } from './anchor-band';
import { FieldNotes } from './chrome/field-notes';
import { Footer } from './chrome/footer';
import { Masthead } from './chrome/masthead';
import { Marker } from './chrome/marker';
import { Field } from './field/field';
import { headId, named, sectionFrame } from './frame';
import { Opening, sealStyle } from './hero';
import { echoedHeads, folds, homeModel, said, sectionForm, type HomeModel } from './model';
import { NoScriptMark } from './parts';
import { renderersFor } from './renderers';
import { closeFrame } from './renderers/contact';

// Terra Field's home page, in the same order in the source, on screen, in
// print, and with no JavaScript: the masthead on the field, the opening
// (the hero on the same ground, its lower edge the arc, the seal on the
// arc's low point), the anchor band, the thesis's standfirst on the axis,
// the position marker, the destination fields in the fixed order, the
// closing field whose arc rises, and the footer on its ground. Field notes
// is a closed dialog after it. One small enhancement (field.tsx) adds the
// dialog fallback, the marker's words and below-fold reveals; without it
// the page, its links, and its index all work.

/** The standfirst's frame: the thesis on the page's axis, its section's title a label over it. */
function standfirstFrame(props: SectionFrameProps) {
  const title =
    'title' in props.section && said(props.section.title) ? props.section.title : undefined;
  return (
    <section {...props.frame} {...named(props)} className="tf-page tf-thesis">
      {title !== undefined ? (
        <p className="tf-label tf-kicker tf-thesis__label">
          <span id={headId(props.frame)}>{title}</span>
        </p>
      ) : null}
      {props.children}
    </section>
  );
}

function Standfirst({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  if (!model.thesis) return null;
  const text = model.standfirst;
  return renderSection(
    model.thesis,
    input,
    {
      renderers: {
        practice: () =>
          text !== undefined ? (
            <RichText source={text} className="tf-quote tf-thesis__text" input={input} />
          ) : null,
      },
      Frame: standfirstFrame,
    },
    { level: 2 },
  );
}

export function HomePage({ input }: HomePageProps) {
  const model = homeModel(input);
  const renderers = renderersFor({ model });
  const echoes = echoedHeads(model.fields);
  const composition = {
    renderers,
    Frame: sectionFrame(
      input,
      model.uiLang,
      (section) => sectionForm(section, input),
      (section) => folds(section, input),
      (section) => echoes.has(section.id),
    ),
  };
  const closing = model.contact ?? model.cta;
  return (
    <div
      className="tf-root"
      data-tf-field={model.quiet ? 'quiet' : 'accent'}
      style={sealStyle(model)}
    >
      <NoScriptMark />
      <Masthead input={input} model={model} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={input.ids.main} className="tf-main" tabIndex={-1}>
        <Opening input={input} model={model} />
        <AnchorBand input={input} model={model} />
        <Standfirst input={input} model={model} />
        <Marker input={input} model={model} />
        {model.fields.map((field) => (
          <Field
            key={field.id}
            field={field}
            input={input}
            model={model}
            composition={composition}
          />
        ))}
        {closing
          ? renderSection(
              closing,
              input,
              { renderers, Frame: closeFrame(input, model.quiet) },
              { level: 2 },
            )
          : null}
      </main>
      <Footer input={input} model={model} />
      <FieldNotes input={input} model={model} />
      <Enhancement input={input} id="field" />
    </div>
  );
}
