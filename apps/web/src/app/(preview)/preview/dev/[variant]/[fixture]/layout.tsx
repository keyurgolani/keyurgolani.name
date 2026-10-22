import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireDeploymentConfig } from '~/server/config-store';
import { devFixture } from '~/server/preview-dev';
import { serves } from '~/server/routes';
import { PreviewDocument, previewMetadata } from '../../../../document';

// The dev fixture route's root layout (#7, Slice 1, item 8): the preview
// document around the fixture's page, in the fixture's language, direction,
// and head. It sits under the route's dynamic segments, since a layout sees
// no params below it. It reads no fixture where the page's guard would refuse
// the page, as outside `next dev`.

interface Params {
  readonly params: Promise<{ readonly variant: string; readonly fixture: string }>;
}

const served = () => serves(requireDeploymentConfig().profile, '/preview/dev/[variant]/[fixture]');

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  if (!served()) return {};
  const { variant, fixture } = await params;
  return previewMetadata(devFixture(variant, fixture).view, requireDeploymentConfig().origin);
}

export default async function DevFixtureLayout({
  params,
  children,
}: Params & { readonly children: ReactNode }) {
  if (!served()) notFound();
  const { variant, fixture } = await params;
  return (
    <PreviewDocument
      unit={devFixture(variant, fixture).view}
      origin={requireDeploymentConfig().origin}
    >
      {children}
    </PreviewDocument>
  );
}
