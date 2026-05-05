import { NextResponse } from 'next/server';
import { parseDocument } from 'yaml';
import { detectFormat } from '@portfolio/schema';
import { loadPortfolioRaw, savePortfolioRaw } from '~/lib/portfolio';
import { findManifest } from '~/lib/registry';

export const dynamic = 'force-dynamic';

/**
 * Activate a variant. Resets colorScheme and typography to the variant's
 * declared defaults — keeps state coherent when switching variants.
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

  const { source, path } = await loadPortfolioRaw();
  const format = detectFormat(path);
  const updated = updateScalars(source, format, {
    variant: slug,
    colorScheme: defaultScheme,
    typography: defaultTypography,
  });

  const result = await savePortfolioRaw(updated);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    slug,
    colorScheme: defaultScheme,
    typography: defaultTypography,
  });
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
