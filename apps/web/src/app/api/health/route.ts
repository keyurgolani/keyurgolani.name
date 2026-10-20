import { NextResponse } from 'next/server';
import { notServed } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const absent = notServed('/api/health');
  if (absent) return absent;
  return NextResponse.json({ ok: true, ts: Date.now() });
}
