import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { environmentSelection } from '~/lib/environment';
import { requireDeploymentConfig } from '~/server/config-store';
import { grantChannel, openGrant } from '~/server/preview-page';
import type { GrantChannel, OpenedGrant } from '~/server/preview-port';
import { PreviewAgent } from '~/preview/agent';
import type { FrameChannelOptions } from '~/preview/frame-channel';
import { PREVIEW_ROBOTS, PreviewDocument, previewMetadata } from '../../document';

// A grant's frame document (#7, Slice 2): the root layout of
// /preview/<grant>/, the preview document around the page, in the previewed
// unit's language, direction, and head. It sits under the grant segment,
// since a layout sees no params below it. When the grant's content can't be
// read, it renders a neutral document and lets the page's boundary say so,
// and it never fails itself, so no site or Studio error page reaches a frame.
//
// Either way an active grant's document has the agent with its channel
// (Slice 3): Studio, on the deployment's origin, got the grant's nonce at
// mint and takes a hello from this frame with it alone, so a frame that
// fails to render still tells Studio, with the log's reference.

export const dynamic = 'force-dynamic';

interface Params {
  readonly params: Promise<{ readonly grant: string }>;
}

/** The grant's document, or null when it isn't active or doesn't render. */
async function opened(params: Params['params']) {
  const { grant } = await params;
  return openGrant(grant).catch(() => null);
}

/**
 * The agent's channel to Studio for the frame of `grant`, and what its site
 * publishes, which the agent sets Studio's `environment` against (Slice 4).
 */
function channelOf(
  grant: string,
  { nonce, renderedVersion }: GrantChannel,
  view?: OpenedGrant['view'],
): FrameChannelOptions {
  return {
    mode: 'server',
    studioOrigin: requireDeploymentConfig().origin,
    linkBase: `/preview/${grant}`,
    nonce,
    renderedVersion,
    ...(view ? { selection: environmentSelection(view.site) } : {}),
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const grant = await opened(params);
  if (!grant) return { title: 'Preview', robots: PREVIEW_ROBOTS };
  return previewMetadata(grant.view, requireDeploymentConfig().origin);
}

export default async function GrantLayout({
  children,
  params,
}: Params & { readonly children: ReactNode }) {
  const { grant: token } = await params;
  const grant = await opened(params);
  if (!grant) {
    const channel = await grantChannel(token);
    return (
      <html lang="en">
        <body>
          {children}
          {channel ? <PreviewAgent channel={channelOf(token, channel)} /> : null}
        </body>
      </html>
    );
  }
  return (
    <PreviewDocument
      unit={grant.view}
      origin={requireDeploymentConfig().origin}
      channel={channelOf(token, grant, grant.view)}
    >
      {children}
    </PreviewDocument>
  );
}
