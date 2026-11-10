import { NextRequest, NextResponse } from 'next/server';
import { handleSummaryReport } from '@/src/lib/presentationServer';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = await handleSummaryReport(body);
  return NextResponse.json(result.data, { status: result.status });
}
