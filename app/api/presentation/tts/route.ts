import { NextRequest, NextResponse } from 'next/server';
import { handleTtsSynthesis } from '@/src/lib/presentationServer';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = await handleTtsSynthesis(body);
  return NextResponse.json(result.data, { status: result.status });
}
