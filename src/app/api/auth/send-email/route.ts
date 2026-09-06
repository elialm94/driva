import { NextRequest, NextResponse } from "next/server";
import { handleSendEmailHook } from "@/lib/auth/send-email-hook";

/**
 * Supabase Auth Send Email-hook. Rå body krävs för Standard Webhooks-signaturen.
 * När hooken är på i Auth → Hooks slutar GoTrue skicka "Supabase Auth"-mejlen.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const result = await handleSendEmailHook({
    rawBody: raw,
    getHeader: (name) => req.headers.get(name),
  });
  return NextResponse.json(result.body, { status: result.status });
}
