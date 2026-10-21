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

/** What config.status reports: the health, or a failure, which names the selection when it's known. */
export type LiveVariantHealth =
  VariantHealth | { readonly status: 'fail'; readonly requested: string | null };

/** The health of a selection, once the module that renders it has loaded. It throws when that fails. */
export async function variantHealth(selected: string): Promise<VariantHealth> {
  const composition = compositionFor(selected);
  const rendered = composition.rendered.manifest.id;
  await loadComposition(rendered);
  return { status: composition.fallback ? 'degraded' : 'ok', requested: selected, rendered };
}

/**
 * The live site's variant health, for config.status, which never throws: a
 * revision that doesn't load, or a variant module that doesn't, is
 * `{ status: 'fail' }`, with the selection when the revision said it, so the
 * owner still gets the rest of the summary.
 */
export async function liveVariantHealth(
  selection: () => Promise<string>,
  health: (selected: string) => Promise<VariantHealth> = variantHealth,
): Promise<LiveVariantHealth> {
  let requested: string | null = null;
  try {
    requested = await selection();
    return await health(requested);
  } catch {
    return { status: 'fail', requested };
  }
}
