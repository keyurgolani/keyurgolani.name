import 'server-only';
import { findPack, type AppearanceRegistry } from '@portfolio/appearance';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { AXES, type AppearanceCatalog, type CatalogAxis } from '~/lib/studio/appearance';
import type { DraftDocument, StudioDraft } from '~/lib/studio/documents';
import { getLive } from './catalog';
import { servedReference, type ServedReference } from './config-store';
import { appearanceCatalog } from './studio-appearance';

// What Demo Studio's page hands its shell (#9): the build's appearance
// catalog without generated color schemes, which /sample can't render; the
// modes each scheme has; the bundled sample, the same public documents
// /sample renders, with its site's own selection as the demo's default; and,
// when startup verified a read-only reference, its name and its selection,
// from the server's own reference state, never from the request.
// Plain data. Nothing here is the owner's, and it imports no demo code.

export interface DemoStudioSetup {
  readonly catalog: AppearanceCatalog;
  readonly schemeModes: Readonly<Record<string, readonly string[]>>;
  readonly unit: { readonly revisionId: string; readonly documents: StudioDraft['documents'] };
  readonly defaults: Readonly<Record<CatalogAxis, string>>;
  /**
   * The read-only reference (#9), when startup verified one: the name its
   * public view gives, and its site's own selection. Null when there is none,
   * so Demo Studio offers nothing of a reference.
   */
  readonly reference: DemoReference | null;
}

/** What Demo Studio shows of the read-only reference: nothing a visitor couldn't read at /reference. */
export interface DemoReference {
  readonly name: string;
  readonly defaults: Readonly<Record<CatalogAxis, string>>;
}

/** A parsed document as Studio reads one: its model, and its text as JSON. */
function asDocument(model: unknown): DraftDocument {
  return {
    format: 'json',
    sourceText: `${JSON.stringify(model, null, 2)}\n`,
    diagnostics: [],
    model,
  };
}

export async function demoStudioSetup(
  registry: AppearanceRegistry = APPEARANCE_REGISTRY,
): Promise<DemoStudioSetup> {
  const full = appearanceCatalog(registry);
  const catalog: AppearanceCatalog = {
    axes: full.axes.map((entry) =>
      entry.axis === 'colorScheme'
        ? {
            ...entry,
            options: entry.options.filter(
              ({ id }) => !findPack(registry, 'colorScheme', id)?.manifest.generator,
            ),
          }
        : entry,
    ),
  };
  const schemeModes = Object.fromEntries(
    (catalog.axes.find(({ axis }) => axis === 'colorScheme')?.options ?? []).flatMap(({ id }) => {
      const entry = findPack(registry, 'colorScheme', id);
      return entry && 'modes' in entry ? [[id, [...(entry.modes as readonly string[])]]] : [];
    }),
  );
  const selectionOf = (site: unknown) => {
    const appearance = (site as { appearance?: Record<string, unknown> } | undefined)?.appearance;
    return Object.fromEntries(
      AXES.map((axis) => {
        const value = appearance?.[axis];
        const fallback = full.axes.find((entry) => entry.axis === axis)?.fallback ?? '';
        return [axis, typeof value === 'string' ? value : fallback];
      }),
    ) as Record<CatalogAxis, string>;
  };
  const live = await getLive();
  const defaults = selectionOf(live.unit?.site);
  return {
    catalog,
    schemeModes,
    unit: {
      revisionId: live.revisionId ?? 'sample',
      documents: {
        portfolio: asDocument(live.unit?.portfolio ?? null),
        site: asDocument(live.unit?.site ?? null),
      },
    },
    defaults,
    reference: referenceOf(servedReference(), selectionOf),
  };
}

/** The reference Demo Studio may offer: only one startup verified, by its public view's own name. */
function referenceOf(
  reference: ServedReference | undefined,
  selectionOf: (site: unknown) => Record<CatalogAxis, string>,
): DemoReference | null {
  if (!reference) return null;
  return {
    name: reference.view.portfolio.identity.name,
    defaults: selectionOf(reference.view.site),
  };
}
