import { NextResponse } from 'next/server';
import { parseDocument } from 'yaml';
import { detectFormat } from '@portfolio/schema';
import { loadPortfolioRaw, savePortfolioRaw } from '~/lib/portfolio';
import { findManifest } from '~/lib/registry';

export const dynamic = 'force-dynamic';

/**
 * Apply colorScheme and/or typography overrides to the *current* active variant.
 * Each field is optional. Pass `null` to clear.
 */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const colorScheme: string | null | undefined =
    'colorScheme' in body ? body.colorScheme : undefined;
  const typography: string | null | undefined =
    'typography' in body ? body.typography : undefined;

  if (colorScheme === undefined && typography === undefined) {
    return NextResponse.json(
      { error: 'Provide at least one of colorScheme or typography.' },
      { status: 400 },
    );
  }

  const { source, path } = await loadPortfolioRaw();
  const format = detectFormat(path);

  // Load active variant to validate ids against its declared options.
  const doc = format === 'yaml' ? parseDocument(source) : null;
  const activeSlug = doc?.get('variant') as string | undefined;
  const manifest = activeSlug ? findManifest(activeSlug) : null;

  if (manifest && colorScheme && colorScheme !== null) {
    if (!manifest.colorSchemes?.some((s) => s.id === colorScheme)) {
      return NextResponse.json(
        { error: `Unknown colorScheme '${colorScheme}' for variant '${manifest.slug}'.` },
        { status: 400 },
      );
    }
  }
  if (manifest && typography && typography !== null) {
    if (!manifest.typographyPresets?.some((p) => p.id === typography)) {
      return NextResponse.json(
        { error: `Unknown typography preset '${typography}' for variant '${manifest.slug}'.` },
        { status: 400 },
      );
    }
  }

  const updated = updateCustomizationFields(source, format, { colorScheme, typography });
  const result = await savePortfolioRaw(updated);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

function updateCustomizationFields(
  source: string,
  format: 'yaml' | 'toml' | 'json',
  scalars: { colorScheme?: string | null; typography?: string | null },
): string {
  if (format === 'yaml') {
    const doc = parseDocument(source);
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
  let lines = source.split('\n');
  for (const [key, value] of Object.entries(scalars) as Array<['colorScheme' | 'typography', string | null | undefined]>) {
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
