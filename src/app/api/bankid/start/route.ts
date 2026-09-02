import { NextRequest, NextResponse } from "next/server";
import { currentVersion, getQuoteByToken } from "@/lib/services/data";
import { bankidProvider, bankidSigningAvailable, signText } from "@/lib/services/bankid";
import { dagarTill } from "@/lib/format";
import { withPublicBusiness } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { token?: string; method?: "same_device" | "qr" };
  if (!body.token) return NextResponse.json({ error: "token saknas" }, { status: 400 });

  // Publikt flöde: företaget löses från offert-token, aldrig från session.
  const result = await withPublicBusiness("quote", body.token, () => {
    const quote = getQuoteByToken(body.token!);
    if (!quote) return { status: 404, error: "Offerten finns inte" } as const;
    if (quote.status === "godkand") {
      return { status: 409, error: "already_approved" } as const;
    }
    if (quote.status !== "skickad") {
      return { status: 409, error: "Offerten kan inte signeras i nuvarande status" } as const;
    }
    if (dagarTill(currentVersion(quote).validUntil) < 0) {
      return { status: 409, error: "Offerten har gått ut och kan inte längre signeras." } as const;
    }
    // Servergrind: mocken får inte skapa "BankID-godkända" offerter för
    // riktiga företag i produktion. Sidan visar samma besked i stället för knappen.
    if (!bankidSigningAvailable()) {
      return { status: 503, error: "BankID-signering är inte aktiverad för det här företaget ännu." } as const;
    }

    const order = bankidProvider.startSign({
      quoteId: quote.id,
      quoteVersionId: quote.currentVersionId,
      method: body.method ?? "qr",
    });

    return {
      status: 200,
      payload: {
        orderRef: order.orderRef,
        environment: bankidProvider.environment,
        signText: signText(quote),
      },
    } as const;
  });

  if (!result) return NextResponse.json({ error: "Offerten finns inte" }, { status: 404 });
  if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.payload);
}
