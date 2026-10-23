import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';
import { ASSET_MANIFEST, VARIANTS } from '~/lib/generated/registry.meta';
import { frameSandbox } from '~/lib/preview-frame';
import { getDeploymentState, requireDeploymentConfig } from '~/server/config-store';
import { signInLocation } from '~/server/return-to';
import type { OwnerPage } from '~/server/studio-page';
import { CatalogPlates, type CatalogPlate } from './catalog-plates';

// /studio/_catalog-fixture (#6, item 5): a plate per registered variant, its
// committed still first, and a live #7 preview of the published revision
// under that variant only on request or a near-viewport prefetch, within
// the scheduler's caps (lib/studio/preview-scheduler.ts). It's #8's and
// #9's catalog in miniature, for the trace to hold to AC2. Registry
// generation writes its route only in a build with BUDGET_FIXTURES
// (scripts/fixture-routes.ts), and catalog.fixtures is the owner's with a
// session there alone, which the generated page's requireOwnerPage checks
// before this reads anything. Every frame mints its own grant through
// #61's commands, as on /studio/preview, under the same cap.

export async function CatalogFixture({ owner }: { owner: OwnerPage }) {
  const { authorized, csrfToken } = owner;
  const config = requireDeploymentConfig();
  const previews = getDeploymentState()?.previews;
  const offered = previews ? await previews.previewable(authorized.session) : [];
  const live = offered.find((each) => each.kind !== 'draft') ?? null;
  const plates: CatalogPlate[] = VARIANTS.filter(
    ({ manifest }) => manifest.id !== FALLBACK_VARIANT_ID,
  ).map(({ manifest }) => {
    const unit = ASSET_MANIFEST.find((each) => each.kind === 'variant' && each.id === manifest.id);
    return {
      id: manifest.id,
      name: manifest.name,
      tier: manifest.performanceTier,
      stills: (unit?.stills ?? []).map(({ url, width, height }) => ({ url, width, height })),
    };
  });
  const previewOrigin = config.previewOrigin ?? null;
  return (
    <main className="studio-page catalog-fixture">
      <h1 className="studio-sign-in__title">Catalog fixture</h1>
      {live ? (
        <CatalogPlates
          plates={plates}
          csrfToken={csrfToken}
          subject={live.subject}
          appearance={live.appearance}
          sandbox={frameSandbox(config.profile, previewOrigin, true)}
          previewOrigin={previewOrigin}
          signIn={signInLocation('session_ended', '/studio/_catalog-fixture')}
        />
      ) : (
        <p className="studio-status" role="status">
          Nothing to preview yet: there&apos;s no published revision.
        </p>
      )}
    </main>
  );
}
