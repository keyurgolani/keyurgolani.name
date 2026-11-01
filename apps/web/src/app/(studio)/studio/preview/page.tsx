import { frameSandbox } from '~/lib/preview-frame';
import { compositionFor } from '~/lib/variants';
import { getDeploymentState, requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';
import { previewAppearanceOptions } from '~/server/preview-options';
import { signInLocation } from '~/server/return-to';
import { requireOwnerPage } from '~/server/studio-guard';
import { StudioPreview, type PreviewChoice } from '../../_components/preview/studio-preview';

// /studio/preview (#7, Slice 4, item 1): the owner's preview of the working
// draft or the live revision, on PreviewSurface, under owner only and with a
// session, which requireOwnerPage checks before anything reads. The page
// decides the frame's sandbox here, from the profile and the preview origin,
// and Studio's client mints, renews, and revokes the frame's grants with
// #61's commands. Demo's preview is #9's (Demo Studio).

export const metadata = { title: 'Preview · Portfolio Studio' };

/** What renders for a site's selection, as the frame's title names it: the fallback composition for one this build lacks. */
const rendered = (selected: string | null) =>
  selected === null ? null : compositionFor(selected).rendered.manifest.id;

async function StudioPreviewPage() {
  const { authorized, csrfToken } = await requireOwnerPage('preview.grant');
  const config = requireDeploymentConfig();
  const previews = getDeploymentState()?.previews;
  const offered = previews ? await previews.previewable(authorized.session) : [];
  const choices: PreviewChoice[] = offered.map((each) =>
    each.kind === 'draft'
      ? {
          id: 'draft',
          label: `Draft, version ${each.subject.version}`,
          kind: 'draft',
          subject: each.subject,
          variant: rendered(each.variant),
          appearance: each.appearance,
        }
      : {
          id: 'live',
          label: 'Live revision',
          kind: 'revision',
          subject: each.subject,
          variant: rendered(each.variant),
          appearance: each.appearance,
        },
  );
  const previewOrigin = config.previewOrigin ?? null;
  return (
    <main className="studio-page">
      <h1 className="studio-sign-in__title">Preview</h1>
      <StudioPreview
        csrfToken={csrfToken}
        choices={choices}
        sandbox={frameSandbox(config.profile, previewOrigin, true)}
        previewOrigin={previewOrigin}
        signIn={signInLocation('session_ended', '/studio/preview')}
        appearanceOptions={previewAppearanceOptions()}
      />
    </main>
  );
}

export default servedPage('/studio/preview', StudioPreviewPage);
