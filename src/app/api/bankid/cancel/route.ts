import { NextRequest, NextResponse } from "next/server";
import { bankidProvider } from "@/lib/services/bankid";
import { withPublicBusiness } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { orderRef?: string };
  if (!body.orderRef) return NextResponse.json({ error: "orderRef saknas" }, { status: 400 });
  await withPublicBusiness("bankid_order", body.orderRef, () => {
    bankidProvider.cancel(body.orderRef!);
  });
  return NextResponse.json({ ok: true });
}
