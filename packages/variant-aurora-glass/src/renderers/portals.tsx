import type { Evidence, Section } from '@portfolio/schema';
import { hrefFor, recordAnchor } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { addressOf, present } from '../model';
import { Out, Phrase } from '../parts';
import { Sheet } from '../surfaces/sheet';

// Portals (brief §5.2, external work): each a sheet that leads off the
// site, its title the one link (stretched over the sheet), the owner's
// words, up to three of its highlights as a definition list, and the
// address it goes to.

type EvidenceSection = Extract<Section, { kind: 'evidence' }>;

export function Portals({
  entries,
  section,
  input,
}: {
  entries: readonly Evidence[];
  section: EvidenceSection;
  input: VariantRenderInput;
}) {
  return (
    <ul className="ag-portals" role="list" data-count={String(entries.length)}>
      {entries.map((entry) => {
        const url = entry.url ?? entry.links?.find((link) => present(link.url))?.url;
        const href = url ? hrefFor(url, input) : undefined;
        const words = entry.statement ?? entry.description;
        const highlights = (entry.highlights ?? []).slice(0, 3);
        return (
          <Sheet
            as="li"
            key={entry.id}
            className="ag-portal"
            id={recordAnchor(section, entry, input)}
            lang={entry.lang}
          >
            <p className="ag-portal__title" data-type-role="title">
              {href ? (
                <a className="ag-stretch" href={href}>
                  {entry.title ?? addressOf(url!)}
                  <Out href={href} />
                </a>
              ) : (
                entry.title
              )}
            </p>
            {present(words) ? (
              <p className="ag-row__sum" data-type-role="body-compact">
                <Phrase source={words} input={input} />
              </p>
            ) : null}
            {highlights.length > 0 ? (
              <dl className="ag-portal__facts">
                {highlights.map((item) => (
                  <div key={`${item.label}-${item.sub}`}>
                    <dt data-type-role="headline" className="ag-num">
                      {item.label}
                    </dt>
                    <dd data-type-role="caption">{item.sub}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {entry.categories?.some(present) || present(entry.locationLabel) ? (
              <p className="ag-row__where" data-type-role="caption">
                {entry.categories?.some(present) ? (
                  <span>{entry.categories.filter(present).join(', ')}</span>
                ) : null}
                {present(entry.locationLabel) ? <span>{entry.locationLabel}</span> : null}
              </p>
            ) : null}
            {url ? (
              <p className="ag-row__foot" data-type-role="caption">
                {/* The owner's own call on the sheet's link, then where it goes, in the owner's words. */}
                {present(entry.buttonText) ? <span>{entry.buttonText}</span> : null}
                <span>{present(entry.urlLabel) ? entry.urlLabel : addressOf(url)}</span>
              </p>
            ) : null}
          </Sheet>
        );
      })}
    </ul>
  );
}
