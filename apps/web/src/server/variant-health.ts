import 'server-only';
import { compositionFor, loadComposition } from '~/lib/variants';

// Whether the selected variant renders (#5, Slice 3, item 7), for #1's
// readiness `packs` check and the owner's config.status. Only status and
// ids: no content, no path.

export interface VariantHealth {
  /** `degraded` when the fallback composition stands in for the selection. */
  readonly status: 'ok' | 'degraded';
  /** The id the site selects. */
  readonly requested: string;
  /** The id that renders. */
  readonly rendered: string;
}

/** The health of a selection, once the module that renders it has loaded. It throws when that fails. */
export async function variantHealth(selected: string): Promise<VariantHealth> {
  const composition = compositionFor(selected);
  const rendered = composition.rendered.manifest.id;
  await loadComposition(rendered);
  return { status: composition.fallback ? 'degraded' : 'ok', requested: selected, rendered };
}
