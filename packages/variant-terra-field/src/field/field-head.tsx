import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, type Field, type HomeModel } from '../model';

// A destination's field head (TF-M5): the destination opens on its own
// ground on the page's axis, its word at headline size and its short
// index under it, and the ground's edge is the arc, quieter than the
// opening's. Each destination has its own ground, bend, and depth
// (FIELD_FORMS), so no two open alike. On the accent ground the region is
// marked data-ui-surface='accent' (K-2), so focus and selection inside it
// take on-accent; quiet, the ground is a surface and needs no mark.

export function FieldHead({
  field,
  input,
  model,
}: {
  field: Field;
  input: VariantRenderInput;
  model: HomeModel;
}) {
  const ids = chromeIds(input.ids.prefix);
  const accent = field.form.tone === 'accent' && !model.quiet;
  return (
    <header
      className="tf-fieldhead"
      id={ids.field(field.id)}
      data-tone={field.form.tone}
      data-arc={field.form.arc}
      data-depth={field.form.depth}
      data-edge={field.form.edge}
      data-ui-surface={accent ? 'accent' : undefined}
    >
      <div className="tf-page">
        <div className="tf-fieldhead__inner">
          <h2
            className="tf-headline tf-fieldhead__word"
            id={ids.fieldTitle(field.id)}
            lang={field.lang}
          >
            {field.label}
          </h2>
          {field.index.length > 1 ? (
            <nav className="tf-fieldhead__nav" aria-labelledby={ids.fieldTitle(field.id)}>
              <ul className="tf-fieldhead__index tf-compact" role="list">
                {field.index.map((entry) => (
                  <li key={entry.id}>
                    <a href={entry.href} lang={entry.lang} dir={entry.dir}>
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </div>
    </header>
  );
}
