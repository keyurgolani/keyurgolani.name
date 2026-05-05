import { NextResponse } from 'next/server';
import { parseDocument } from 'yaml';
import { detectFormat } from '@portfolio/schema';
import { loadPortfolioRaw, savePortfolioRaw } from '~/lib/portfolio';
import { findManifest } from '~/lib/registry';

export const dynamic = 'force-dynamic';

/**
 * Activate a variant with a chosen color scheme and typography preset.
 * The body may include `colorScheme` and `typography`; either or both are
 * optional and fall back to the variant's declared defaults. Both fields
 * are validated against the manifest's offered options.
 */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const slug = body?.slug;
  if (typeof slug !== 'string' || !slug) {
    return NextResponse.json({ error: 'Missing or invalid slug' }, { status: 400 });
  }

  const manifest = findManifest(slug);
  if (!manifest) {
    return NextResponse.json({ error: `Unknown variant: ${slug}` }, { status: 404 });
  }

  const defaultScheme =
    manifest.colorSchemes?.find((s) => s.default)?.id ?? manifest.colorSchemes?.[0]?.id ?? null;
  const defaultTypography =
    manifest.typographyPresets?.find((p) => p.default)?.id ??
    manifest.typographyPresets?.[0]?.id ??
    null;

  const requestedScheme = typeof body?.colorScheme === 'string' ? body.colorScheme : undefined;
  const requestedTypography = typeof body?.typography === 'string' ? body.typography : undefined;

  if (requestedScheme && !manifest.colorSchemes?.some((s) => s.id === requestedScheme)) {
    return NextResponse.json(
      { error: `Unknown colorScheme '${requestedScheme}' for variant '${slug}'.` },
      { status: 400 },
    );
  }
  if (
    requestedTypography &&
    !manifest.typographyPresets?.some((p) => p.id === requestedTypography)
  ) {
    return NextResponse.json(
      { error: `Unknown typography preset '${requestedTypography}' for variant '${slug}'.` },
      { status: 400 },
    );
  }

  const colorScheme = requestedScheme ?? defaultScheme;
  const typography = requestedTypography ?? defaultTypography;

  const { source, path } = await loadPortfolioRaw();
  const format = detectFormat(path);
  const updated = updateScalars(source, format, {
    variant: slug,
    colorScheme,
    typography,
  });

  const result = await savePortfolioRaw(updated);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, slug, colorScheme, typography });
}

interface Scalars {
  variant?: string;
  colorScheme?: string | null;
  typography?: string | null;
}

function updateScalars(source: string, format: 'yaml' | 'toml' | 'json', scalars: Scalars): string {
  if (format === 'yaml') {
    const doc = parseDocument(source);
    if (scalars.variant !== undefined) doc.set('variant', scalars.variant);
    if (scalars.colorScheme !== undefined) {
      if (scalars.colorScheme == null) doc.delete('colorScheme');
      else doc.set('colorScheme', scalars.colorScheme);
    }
    if (scalars.typography !== undefined) {
      if (scalars.typography == null) doc.delete('typography');
      else doc.set('typography', scalars.typography);
    }
    return doc.toString();
  }
  if (format === 'json') {
    const obj = JSON.parse(source);
    if (scalars.variant !== undefined) obj.variant = scalars.variant;
    if (scalars.colorScheme !== undefined) {
      if (scalars.colorScheme == null) delete obj.colorScheme;
      else obj.colorScheme = scalars.colorScheme;
    }
    if (scalars.typography !== undefined) {
      if (scalars.typography == null) delete obj.typography;
      else obj.typography = scalars.typography;
    }
    return JSON.stringify(obj, null, 2);
  }
  // TOML — naive line-based update
  let lines = source.split('\n');
  for (const [key, value] of Object.entries(scalars)) {
    if (value === undefined) continue;
    const re = new RegExp(`^\\s*${key}\\s*=`);
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i] ?? '')) {
        if (value == null) lines.splice(i, 1);
        else lines[i] = `${key} = "${value}"`;
        replaced = true;
        break;
      }
    }
    if (!replaced && value != null) lines = [`${key} = "${value}"`, ...lines];
  }
  return lines.join('\n');
}
