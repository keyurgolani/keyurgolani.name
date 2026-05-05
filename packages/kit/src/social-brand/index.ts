/**
 * Social/external-platform brand styling registry.
 *
 * A static lookup of canonical visual treatments for known platforms — used
 * by variants that render brand-aware social profile cards (kinetic-cosmos's
 * floating profile cluster, terminal variants' "links" panel, etc.).
 *
 * Each entry carries:
 *   - `gradient`        — CSS `linear-gradient(...)` value used as the card
 *                         background. Multi-stop, brand-faithful.
 *   - `accent`          — single hex color used for hover-glow and
 *                         secondary highlights.
 *   - `glow`            — rgba color used for `box-shadow` halo.
 *   - `iconBg`          — semi-transparent background tint for the card's
 *                         icon container.
 *   - `pattern`         — optional CSS background overlay (radial/conic
 *                         gradients, repeating stripes) layered above
 *                         `gradient` for visual texture.
 *
 * Keys are platform identifiers (lowercased). Variants pass `link.platform`
 * in (e.g. `'github'`, `'linkedin'`) and get back the brand style or the
 * `default` fallback.
 *
 * To add a platform, append to BRAND_STYLES and update kit-catalog.md if
 * external consumers need to know about it.
 */

export interface SocialBrandStyle {
  /** Friendly display name. */
  name: string;
  /** Multi-stop linear gradient suitable for `background`. */
  gradient: string;
  /** Single hex accent color. */
  accent: string;
  /** rgba shadow color for hover halo. */
  glow: string;
  /** Background tint for the icon container. */
  iconBg: string;
  /** Optional pattern overlay (set on a pseudo-element by the consumer). */
  pattern?: string;
}

const BRAND_STYLES: Record<string, SocialBrandStyle> = {
  github: {
    name: 'GitHub',
    gradient: 'linear-gradient(135deg, #0d1117 0%, #161b22 50%, #21262d 100%)',
    accent: '#58a6ff',
    glow: 'rgba(88, 166, 255, 0.4)',
    iconBg: 'rgba(255, 255, 255, 0.1)',
    pattern:
      'radial-gradient(circle at 20% 80%, rgba(88,166,255,0.15) 0%, transparent 50%), ' +
      'radial-gradient(circle at 80% 20%, rgba(139,148,158,0.1) 0%, transparent 40%)',
  },
  linkedin: {
    name: 'LinkedIn',
    gradient: 'linear-gradient(135deg, #0077b5 0%, #0a66c2 50%, #004182 100%)',
    accent: '#70c4ff',
    glow: 'rgba(112, 196, 255, 0.5)',
    iconBg: 'rgba(255, 255, 255, 0.15)',
    pattern:
      'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%), ' +
      'radial-gradient(circle at 90% 90%, rgba(112,196,255,0.2) 0%, transparent 40%)',
  },
  dockerhub: {
    name: 'Docker Hub',
    gradient: 'linear-gradient(135deg, #0db7ed 0%, #1d63ed 50%, #003f8a 100%)',
    accent: '#79d4ff',
    glow: 'rgba(121, 212, 255, 0.5)',
    iconBg: 'rgba(255, 255, 255, 0.15)',
    pattern:
      'repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 2px, transparent 2px, transparent 20px), ' +
      'radial-gradient(circle at 30% 70%, rgba(121,212,255,0.15) 0%, transparent 50%)',
  },
  researchgate: {
    name: 'ResearchGate',
    gradient: 'linear-gradient(135deg, #00d0af 0%, #00b398 50%, #008f7a 100%)',
    accent: '#7fffea',
    glow: 'rgba(127, 255, 234, 0.5)',
    iconBg: 'rgba(255, 255, 255, 0.15)',
    pattern:
      'radial-gradient(ellipse at 10% 90%, rgba(127,255,234,0.2) 0%, transparent 50%), ' +
      'linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%)',
  },
  instagram: {
    name: 'Instagram',
    gradient: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
    accent: '#ffd180',
    glow: 'rgba(220, 39, 67, 0.5)',
    iconBg: 'rgba(255, 255, 255, 0.18)',
  },
  twitter: {
    name: 'Twitter',
    gradient: 'linear-gradient(135deg, #1da1f2 0%, #1991db 50%, #0c80c2 100%)',
    accent: '#a8e3ff',
    glow: 'rgba(29, 161, 242, 0.5)',
    iconBg: 'rgba(255, 255, 255, 0.15)',
  },
  x: {
    name: 'X',
    gradient: 'linear-gradient(135deg, #000000 0%, #14171a 50%, #2f3336 100%)',
    accent: '#ffffff',
    glow: 'rgba(255, 255, 255, 0.4)',
    iconBg: 'rgba(255, 255, 255, 0.1)',
  },
  mastodon: {
    name: 'Mastodon',
    gradient: 'linear-gradient(135deg, #6364ff 0%, #563acc 50%, #3a2899 100%)',
    accent: '#a8a9ff',
    glow: 'rgba(99, 100, 255, 0.5)',
    iconBg: 'rgba(255, 255, 255, 0.15)',
  },
  youtube: {
    name: 'YouTube',
    gradient: 'linear-gradient(135deg, #ff0000 0%, #cc0000 50%, #990000 100%)',
    accent: '#ff8585',
    glow: 'rgba(255, 0, 0, 0.5)',
    iconBg: 'rgba(255, 255, 255, 0.18)',
  },
  bluesky: {
    name: 'Bluesky',
    gradient: 'linear-gradient(135deg, #0085ff 0%, #006acc 50%, #004f99 100%)',
    accent: '#80caff',
    glow: 'rgba(0, 133, 255, 0.5)',
    iconBg: 'rgba(255, 255, 255, 0.15)',
  },
  email: {
    name: 'Email',
    gradient: 'linear-gradient(135deg, #6e6e80 0%, #4a4a55 50%, #2c2c33 100%)',
    accent: '#a0a0b0',
    glow: 'rgba(110, 110, 128, 0.4)',
    iconBg: 'rgba(255, 255, 255, 0.12)',
  },
  default: {
    name: 'Link',
    gradient: 'linear-gradient(135deg, #111827 0%, #1f2937 50%, #374151 100%)',
    accent: '#93c5fd',
    glow: 'rgba(147, 197, 253, 0.4)',
    iconBg: 'rgba(255, 255, 255, 0.15)',
    pattern: 'radial-gradient(circle at 30% 20%, rgba(147,197,253,0.2) 0%, transparent 45%)',
  },
};

/**
 * Look up a brand style by platform key. Falls back to `default` when the
 * platform isn't registered. Lookup is case-insensitive.
 *
 * Common aliases mapped to canonical keys:
 *   - `docker` → `dockerhub`
 *   - `gh` → `github`
 *   - `li` → `linkedin`
 *   - `ig` → `instagram`
 *   - `tw` / `twitter.com` → `twitter`
 */
export function getSocialBrandStyle(platform: string | undefined | null): SocialBrandStyle {
  if (!platform) return BRAND_STYLES.default!;
  const key = platform.trim().toLowerCase();
  const aliased =
    key === 'docker'
      ? 'dockerhub'
      : key === 'gh'
        ? 'github'
        : key === 'li'
          ? 'linkedin'
          : key === 'ig'
            ? 'instagram'
            : key === 'tw' || key === 'twitter.com'
              ? 'twitter'
              : key;
  return BRAND_STYLES[aliased] ?? BRAND_STYLES.default!;
}

/** All registered platform keys (excluding `default`). */
export function listSocialBrands(): string[] {
  return Object.keys(BRAND_STYLES).filter((k) => k !== 'default');
}

/**
 * Heuristically infer a platform key from a URL — for callers that don't
 * have an explicit `platform` field. Best-effort host matching.
 */
export function inferPlatformFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('github.com')) return 'github';
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('hub.docker.com') || host.endsWith('docker.com')) return 'dockerhub';
    if (host.includes('researchgate.net')) return 'researchgate';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('twitter.com')) return 'twitter';
    if (host === 'x.com' || host.endsWith('.x.com')) return 'x';
    if (host.includes('mastodon')) return 'mastodon';
    if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
    if (host.includes('bsky.app') || host.includes('bsky.social')) return 'bluesky';
    if (u.protocol === 'mailto:') return 'email';
  } catch {
    // not a valid URL
  }
  return null;
}
