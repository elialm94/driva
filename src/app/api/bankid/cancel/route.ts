import { NextRequest, NextResponse } from "next/server";
import { bankidProvider } from "@/lib/services/bankid";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { orderRef?: string };
  if (!body.orderRef) return NextResponse.json({ error: "orderRef saknas" }, { status: 400 });
  bankidProvider.cancel(body.orderRef);
  return NextResponse.json({ ok: true });
}
