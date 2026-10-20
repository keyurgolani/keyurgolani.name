import { NextResponse } from 'next/server';
import { authoringRoutesEnabled } from '~/lib/authoring';
import { loadPortfolioRaw, savePortfolioRaw } from '~/lib/portfolio';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!authoringRoutesEnabled()) return new Response(null, { status: 404 });
  try {
    const { source, format } = await loadPortfolioRaw();
    return new NextResponse(source, {
      headers: { 'content-type': formatContentType(format) },
    });
  } catch (e) {
    // The message can carry the absolute file path (ENOENT does), so it goes
    // to the server log only.
    console.error('[api/portfolio] Could not read the portfolio file:', e);
    return NextResponse.json(
      { error: 'Could not read the portfolio file. See the server log.' },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  if (!authoringRoutesEnabled()) return new Response(null, { status: 404 });
  const body = await request.text();
  const result = await savePortfolioRaw(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, issues: result.issues }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

function formatContentType(format: 'yaml' | 'toml' | 'json'): string {
  switch (format) {
    case 'yaml':
      return 'application/yaml';
    case 'toml':
      return 'application/toml';
    case 'json':
      return 'application/json';
  }
}
