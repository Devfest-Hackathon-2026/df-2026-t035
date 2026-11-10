import { NextRequest, NextResponse } from 'next/server';
import { handleAudienceAnswer } from '@/src/lib/presentationServer';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = await handleAudienceAnswer(body);
  return NextResponse.json(result.data, { status: result.status });
}
