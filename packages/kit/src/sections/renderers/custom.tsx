import { MediaFigure } from '../media';
import { placedMedia } from '../placement';
import { deeper, ItemTitle, LinkList, present, renderContext, SectionHeader } from '../primitives';
import { RichText } from '../rich-text';
import type { SectionOf, SectionRendererProps } from '../types';
import { evidenceByIds } from '../view';
import { EvidenceEntry } from './evidence';

// A custom section (#10, slice 1, item 7): the owner's own title, body, and
// items, each item with its summary, media, evidence, and links. It always
// renders here, in the shared fallback; extension data on it is for the
// extension that owns it, and shows nothing.

export function CustomSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'custom'>>) {
  const ctx = renderContext(input, section, level);
  const nested = { ...ctx, itemLevel: deeper(ctx.itemLevel) };
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      {present(section.body) ? (
        <RichText source={section.body} className="pf-prose" input={input} />
      ) : null}
      {section.items?.length ? (
        <ul className="pf-list" role="list">
          {section.items.map((item, index) => {
            const media = (item.media ?? []).flatMap((placement) => {
              const image = placedMedia(placement, ctx);
              return image ? [image] : [];
            });
            const evidence = evidenceByIds(item.evidence, input);
            return (
              <li key={index} className="pf-item">
                <ItemTitle text={item.title} ctx={ctx} />
                {present(item.summary) ? (
                  <RichText source={item.summary} className="pf-summary" input={input} />
                ) : null}
                {media.length ? (
                  <ul className="pf-gallery" role="list">
                    {media.map((image, mediaIndex) => (
                      <li key={`${image.asset}-${mediaIndex}`}>
                        <MediaFigure placed={image} ctx={ctx} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {evidence.length ? (
                  <ul className="pf-evidence" role="list">
                    {evidence.map((entry) => (
                      <EvidenceEntry key={entry.id} entry={entry} ctx={nested} />
                    ))}
                  </ul>
                ) : null}
                <LinkList links={item.links} ctx={ctx} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
