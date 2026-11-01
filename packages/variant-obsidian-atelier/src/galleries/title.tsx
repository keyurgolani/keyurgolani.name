import { Heading, present, type RenderContext } from '@portfolio/kit/sections';

// A section's title inside a gallery (redesign, stream C): the owner's
// words at body size and the label weight, the gallery's signage already
// being the one title size, and its subtitle under it in the quiet tone. A
// section the owner gave no title has no heading: no kind has a default one.

export function SectionTitle({
  section,
  ctx,
}: {
  section: { readonly title?: string; readonly subtitle?: string };
  ctx: RenderContext;
}) {
  const title = present(section.title) ? section.title : undefined;
  const subtitle = present(section.subtitle) ? section.subtitle : undefined;
  if (title === undefined && subtitle === undefined) return null;
  return (
    <>
      {title !== undefined ? (
        <Heading level={ctx.level} className="oa-h3">
          {title}
        </Heading>
      ) : null}
      {subtitle !== undefined ? <p className="oa-note">{subtitle}</p> : null}
    </>
  );
}
