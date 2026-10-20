import { ImageResponse } from 'next/og';
import { findManifest } from '~/lib/registry';
import { getLive } from '~/server/catalog';
import { requireDeploymentConfig } from '~/server/config-store';
import { HOST_APPEARANCE } from '~/server/host-defaults';

export const runtime = 'nodejs';
// Per request, from the revision register() loaded, so a build never bakes
// in a portfolio or an origin.
export const dynamic = 'force-dynamic';
export const alt = 'Portfolio';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const host = new URL(requireDeploymentConfig().origin).hostname.replace(/^www\./, '');
  const { portfolio } = (await getLive()).unit;
  const name = portfolio.identity.name;
  const tagline = portfolio.identity.tagline ?? portfolio.meta?.description;
  const variant = findManifest(HOST_APPEARANCE.variant)?.name;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#fbfaf6',
        color: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '80px',
        fontFamily: 'serif',
      }}
    >
      <div
        style={{
          fontSize: 18,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: '#7a6a55',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <span style={{ width: 48, height: 1, background: '#b54a32' }} />
        Portfolio
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            fontSize: 110,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: '#1a1a1a',
          }}
        >
          {name}
        </div>
        {tagline ? (
          <div
            style={{
              fontSize: 36,
              lineHeight: 1.3,
              color: '#4a4a4a',
              maxWidth: 980,
              fontStyle: 'italic',
            }}
          >
            {tagline}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          fontSize: 22,
          color: '#7a6a55',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 12, height: 12, background: '#b54a32', borderRadius: 999 }} />
          {host}
        </div>
        <div
          style={{
            fontSize: 16,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
          }}
        >
          {variant}
        </div>
      </div>
    </div>,
    { ...size },
  );
}
