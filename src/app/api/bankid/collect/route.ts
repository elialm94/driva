import { NextRequest, NextResponse } from "next/server";
import { bankidProvider } from "@/lib/services/bankid";

export async function GET(req: NextRequest) {
  const orderRef = req.nextUrl.searchParams.get("orderRef");
  if (!orderRef) return NextResponse.json({ error: "orderRef saknas" }, { status: 400 });
  const order = bankidProvider.collect(orderRef);
  if (!order) return NextResponse.json({ error: "Ordern finns inte" }, { status: 404 });
  return NextResponse.json({
    status: order.status,
    hintCode: order.hintCode,
    environment: bankidProvider.environment,
  });
}
