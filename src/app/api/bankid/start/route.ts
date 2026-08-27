import { NextRequest, NextResponse } from "next/server";
import { getQuoteByToken } from "@/lib/services/data";
import { bankidProvider, signText } from "@/lib/services/bankid";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { token?: string; method?: "same_device" | "qr" };
  if (!body.token) return NextResponse.json({ error: "token saknas" }, { status: 400 });

  const quote = getQuoteByToken(body.token);
  if (!quote) return NextResponse.json({ error: "Offerten finns inte" }, { status: 404 });
  if (quote.status === "godkand") {
    return NextResponse.json({ error: "already_approved" }, { status: 409 });
  }
  if (quote.status !== "skickad") {
    return NextResponse.json({ error: "Offerten kan inte signeras i nuvarande status" }, { status: 409 });
  }

  const order = bankidProvider.startSign({
    quoteId: quote.id,
    quoteVersionId: quote.currentVersionId,
    method: body.method ?? "qr",
  });

  return NextResponse.json({
    orderRef: order.orderRef,
    environment: bankidProvider.environment,
    signText: signText(quote),
  });
}
