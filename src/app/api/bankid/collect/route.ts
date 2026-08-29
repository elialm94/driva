import { NextRequest, NextResponse } from "next/server";
import { bankidProvider } from "@/lib/services/bankid";
import { withPublicBusiness } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  const orderRef = req.nextUrl.searchParams.get("orderRef");
  if (!orderRef) return NextResponse.json({ error: "orderRef saknas" }, { status: 400 });

  // Collect kan fullborda signeringen (godkänd offert + låst version) –
  // skrivkontext, företaget löses från orderRef. Mejl kan skickas → ingen retry.
  const order = await withPublicBusiness(
    "bankid_order",
    orderRef,
    () => bankidProvider.collect(orderRef),
    { retry: false }
  );
  if (!order) return NextResponse.json({ error: "Ordern finns inte" }, { status: 404 });
  return NextResponse.json({
    status: order.status,
    hintCode: order.hintCode,
    environment: bankidProvider.environment,
  });
}
