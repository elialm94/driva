import { NextRequest, NextResponse } from "next/server";
import { inboundSlugFromTo } from "@/lib/inbox/inbound-mail";
import {
  handleResendInboundWebhook,
  ingestInboundPayloadLocal,
  resendWebhookHeadersFromRequest,
} from "@/lib/inbox/resend-receiving";
import { isSupabaseMode } from "@/lib/storage/config";
import { withPublicBusiness } from "@/lib/auth/session";

/**
 * Resend Receiving-webhook. Rå body krävs för Svix-signaturen – inte req.json().
 * Andra events än email.received svarar 200 tomt så Resend inte retriar.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const result = await handleResendInboundWebhook(
    {
      rawBody: raw,
      headers: resendWebhookHeadersFromRequest((name) => req.headers.get(name)),
    },
    {
      ingest: async (payload) => {
        const slug = inboundSlugFromTo(payload.to);
        if (!slug) return { status: 400, error: "Kunde inte läsa tenant från To-adressen" };
        if (!isSupabaseMode()) return ingestInboundPayloadLocal(payload);
        const scoped = await withPublicBusiness("inbound", slug, () => ingestInboundPayloadLocal(payload));
        if (!scoped) return { status: 404, error: "Okänd inkommande adress" };
        return scoped;
      },
    }
  );
  return NextResponse.json(result.body, { status: result.status });
}
