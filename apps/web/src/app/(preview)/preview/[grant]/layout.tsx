import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { requireDeploymentConfig } from '~/server/config-store';
import { openGrant } from '~/server/preview-page';
import { PREVIEW_ROBOTS, PreviewDocument, previewMetadata } from '../../document';

// A grant's frame document (#7, Slice 2): the root layout of
// /preview/<grant>/, the preview document around the page, in the previewed
// unit's language, direction, and head. It sits under the grant segment,
// since a layout sees no params below it. When the grant's content can't be
// read, it renders a neutral document and lets the page's boundary say so,
// and it never fails itself, so no site or Studio error page reaches a frame.

export const dynamic = 'force-dynamic';

interface Params {
  readonly params: Promise<{ readonly grant: string }>;
}

/** The grant's document, or null when it isn't active or doesn't render. */
async function opened(params: Params['params']) {
  const { grant } = await params;
  return openGrant(grant).catch(() => null);
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
  const grant = await opened(params);
  if (!grant) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }
  return (
    <PreviewDocument unit={grant.view} origin={requireDeploymentConfig().origin}>
      {children}
    </PreviewDocument>
  );
}
