import { renderSection, type SectionComposition } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, type Field as FieldModel, type HomeModel } from '../model';
import { FieldHead } from './field-head';

// One destination: a region named by its word, its field head, then each
// of its sections on paper, in content order, every one in the
// composition's own frame (frame.tsx), h3 under the field's h2.

export function Field({
  field,
  input,
  model,
  composition,
}: {
  field: FieldModel;
  input: VariantRenderInput;
  model: HomeModel;
  composition: SectionComposition;
}) {
  const ids = chromeIds(input.ids.prefix);
  return (
    <section
      className="tf-field"
      aria-labelledby={ids.fieldTitle(field.id)}
      data-tf-destination={field.id}
    >
      <FieldHead field={field} input={input} model={model} />
      <div className="tf-field__body">
        {field.sections.map((section) => renderSection(section, input, composition, { level: 3 }))}
      </div>
    </section>
  );
}
