import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { bankidProvider } from "@/lib/services/bankid";

/**
 * Demo-endpoint som driver mock-BankID-ordrar framåt.
 * Finns bara i mock-läge – i produktion styrs orderns status av riktiga
 * BankID-collect-svar och den här endpointen svarar 404.
 */
export async function POST(req: NextRequest) {
  if (bankidProvider.environment !== "mock") {
    return NextResponse.json({ error: "Endast tillgängligt i mock-läge" }, { status: 404 });
  }
  const body = (await req.json()) as {
    orderRef?: string;
    event?: "open_app" | "complete" | "cancel" | "timeout";
  };
  if (!body.orderRef || !body.event) {
    return NextResponse.json({ error: "orderRef och event krävs" }, { status: 400 });
  }
  const order = bankidProvider.advance(body.orderRef, body.event);
  if (!order) return NextResponse.json({ error: "Ordern finns inte" }, { status: 404 });
  revalidatePath("/", "layout");
  return NextResponse.json({ status: order.status, hintCode: order.hintCode });
}
