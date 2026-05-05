import { NextResponse } from 'next/server';
import { loadPortfolioRaw, savePortfolioRaw } from '~/lib/portfolio';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { source, path, format } = await loadPortfolioRaw();
    return new NextResponse(source, {
      headers: {
        'content-type': formatContentType(format),
        'x-portfolio-path': path,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
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
