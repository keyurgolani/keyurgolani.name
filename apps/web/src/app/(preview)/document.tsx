import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import type { PublicView } from '@portfolio/schema';
import { experienceHead } from '~/lib/experience-head';
import '~/lib/experience-styles';
import { PreviewAgent } from '~/preview/agent';
import type { FrameChannelOptions } from '~/preview/frame-channel';

// A preview document (#7, Slice 1, item 3): the root layout of each preview
// route in this group renders it around its page, which renders
// ExperienceDocument with the preview's environment. So the document is the
// portfolio a visitor gets, in the previewed unit's language and direction,
// with its head from the previewed unit (experienceHead), noindex, and one
// preview agent. Nothing else goes in: no theme script, no Studio markup,
// script, or stylesheet. Each route's layout sits under its dynamic
// segments, since a layout sees no params below it and a route file exports
// only its page.

/** What the document tells crawlers, beside the X-Robots-Tag proxy.ts sends. */
export const PREVIEW_ROBOTS = { index: false, follow: false } as const;

/** The previewed unit's head metadata, noindex. */
export function previewMetadata(unit: PublicView, origin: string): Metadata {
  return { ...experienceHead(unit, origin).metadata, robots: PREVIEW_ROBOTS };
}

/** The document around a preview page, for `unit`, the unit the page renders. */
export function PreviewDocument({
  unit,
  origin,
  channel,
  children,
}: {
  readonly unit: PublicView;
  /** The deployment's canonical origin, which the JSON-LD's URLs start with. */
  readonly origin: string;
  /**
   * What the agent's channel to Studio starts from (#7, Slice 3): a grant's
   * nonce and link base. A document with none, such as the dev fixture
   * route's, opens no channel.
   */
  readonly channel?: FrameChannelOptions;
  readonly children: ReactNode;
}) {
  const { jsonLd } = experienceHead(unit, origin);
  return (
    <html lang={unit.portfolio.locale} dir={unit.portfolio.direction}>
      <head>
        {jsonLd.map((json, i) => (
          <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
        ))}
      </head>
      <body>
        {children}
        <PreviewAgent {...(channel ? { channel } : {})} />
      </body>
    </html>
  );
}
