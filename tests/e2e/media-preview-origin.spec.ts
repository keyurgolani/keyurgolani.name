import { readFileSync } from 'node:fs';
import { DEFAULT_PORTFOLIO, DEFAULT_SITE } from '../harness/app-server.mjs';
import { test } from '../harness/fixtures';
import { draftWithCover } from '../harness/media';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraftWith } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { expectFrameImage } from '../harness/studio-preview';

// #10's draft media in a frame on the preview origin (#7, Slice 4):
// PORTFOLIO_PREVIEW_ORIGIN on preview.localhost, as
// studio-preview-origin.spec.ts runs it. The frame loads its draft's
// rendition from its own origin's /preview-assets, under the preview CSP's
// img-src 'self'.

const ASSETS = { type: 'route', description: '/preview-assets/[grant]/[...path]' };
const OWNER = { type: 'profile', description: 'owner' };

const secret = ownerSecret();
test.use({ appOptions: { ...ownerApp(secret.hash), previewHost: 'preview.localhost' } });

test(
  "on the preview origin, Studio's frame renders the draft's image from that origin's /preview-assets, under the preview CSP",
  { annotation: [ASSETS, OWNER] },
  async ({ page, app }) => {
    const { documents, blobs, file } = draftWithCover(
      readFileSync(DEFAULT_PORTFOLIO, 'utf8'),
      readFileSync(DEFAULT_SITE, 'utf8'),
    );
    await seedDraftWith(app, documents, blobs);
    await expectFrameImage(page, app, secret.password, file, app.previewOrigin!);
  },
);
