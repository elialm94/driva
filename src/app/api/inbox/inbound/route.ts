import { NextRequest, NextResponse } from "next/server";
import { parseInboundPayload, verifyInboundSignature } from "@/lib/inbox/inbound-mail";
import { ingestInboundMail, inboundSlugMatches } from "@/lib/services/inbox";
import { inboundSlugFromTo } from "@/lib/inbox/inbound-mail";
import { isSupabaseMode } from "@/lib/storage/config";
import { withPublicBusiness } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-inbox-signature") ?? req.headers.get("X-Inbox-Signature");
  if (!verifyInboundSignature(raw, signature)) {
    return NextResponse.json({ error: "Ogiltig eller saknad signatur" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    return NextResponse.json({ error: "Ogiltig JSON" }, { status: 400 });
  }

  const payload = parseInboundPayload(json);
  if ("error" in payload) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const slug = inboundSlugFromTo(payload.to);
  if (!slug) {
    return NextResponse.json({ error: "Kunde inte läsa tenant från To-adressen" }, { status: 400 });
  }

  const run = () => {
    if (!isSupabaseMode() && !inboundSlugMatches(payload.to)) {
      return { status: 404 as const, error: "Okänd inkommande adress" };
    }
    const result = ingestInboundMail(payload);
    if (!result.ok) return { status: result.status as 400 | 404, error: result.error };
    return {
      status: 200 as const,
      payload: { id: result.item.id, created: result.created, autoBooked: result.autoBooked },
    };
  };

  if (!isSupabaseMode()) {
    const result = run();
    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.payload);
  }

  const result = await withPublicBusiness("inbound", slug, run);
  if (!result) return NextResponse.json({ error: "Okänd inkommande adress" }, { status: 404 });
  if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.payload);
}
