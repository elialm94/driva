import { NextRequest, NextResponse } from "next/server";
import { invalidateBillingCache } from "@/lib/billing/access";
import { readStripeConfig } from "@/lib/billing/config";
import { billingStore } from "@/lib/billing/store";
import { stripeGateway } from "@/lib/billing/stripe";
import { processStripeEvent } from "@/lib/billing/webhook";
import { reportSafeError } from "@/lib/observability/report";
import { isSupabaseMode } from "@/lib/storage/config";

/**
 * Stripe-webhook. Rå body krävs för Stripe-Signature – aldrig req.json().
 * Utan konfiguration svarar vi 503 så att Stripe visar felet i dashboarden i
 * stället för att vi tyst låtsas ta emot. Duplicerade och okända händelser
 * svarar 200 så att Stripe inte retriar i onödan; ett bearbetningsfel svarar
 * 500 så att Stripe försöker igen (händelseraden är då märkt "fel").
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!readStripeConfig()) {
    return NextResponse.json({ error: "Abonnemangsbetalning är inte konfigurerad." }, { status: 503 });
  }
  if (!isSupabaseMode()) {
    return NextResponse.json({ error: "Webhooken kräver databasläge." }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Stripe-Signature saknas." }, { status: 400 });

  const raw = await req.text();
  const gateway = stripeGateway();
  let event;
  try {
    event = await gateway.constructEvent(raw, signature);
  } catch {
    return NextResponse.json({ error: "Ogiltig signatur." }, { status: 400 });
  }

  const outcome = await processStripeEvent({ store: billingStore(), gateway }, event);
  if (outcome.kind === "processed") invalidateBillingCache(outcome.businessId);
  if (outcome.kind === "failed") {
    const correlationId = reportSafeError(new Error(outcome.error), {
      route: "/api/stripe/webhook",
      integration: "stripe",
      extra: { eventType: event.type, eventId: event.id },
    });
    return NextResponse.json({ received: true, error: outcome.error, correlationId }, { status: 500 });
  }
  return NextResponse.json({ received: true, outcome: outcome.kind });
}
