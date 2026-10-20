import { NextResponse } from 'next/server';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

export const GET = served('/api/health', () => NextResponse.json({ ok: true, ts: Date.now() }));
