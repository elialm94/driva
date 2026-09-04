process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "standardwebhooks";
import { resetDemoData } from "./store";
import { db } from "./store";
import { listInbox } from "./services/inbox";
import { storableAttachmentContent } from "./inbox/attachment-content";
import {
  signResendWebhook,
  verifyResendWebhookSignature,
  resendWebhookHeadersFromRequest,
} from "./inbox/resend-signature";
import {
  collectInboundAttachments,
  handleResendInboundWebhook,
  mapResendReceivedToPayload,
  parseResendWebhookJson,
  pickInboundRecipient,
  type ResendReceivingClient,
} from "./inbox/resend-receiving";

const TEST_WEBHOOK_SECRET = `whsec_${Buffer.from("driva-resend-webhook-test-key").toString("base64")}`;

const EMAIL_RECEIVED_FIXTURE = {
  type: "email.received",
  created_at: "2026-02-22T23:41:12.126Z",
  data: {
    email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
    created_at: "2026-02-22T23:41:11.894Z",
    from: "Byggmax <faktura@byggmax.se>",
    to: ["someone@gmail.com", "demo@in.ferva.se"],
    received_for: ["demo@in.ferva.se"],
    message_id: "<111-222-333@email.example.com>",
    subject: "Faktura 8812",
    attachments: [
      {
        id: "2a0c9ce0-3112-4728-976e-47ddcd16a318",
        filename: "faktura.pdf",
        content_type: "application/pdf",
      },
    ],
  },
};

function unsignedHeaders() {
  return { id: null, timestamp: null, signature: null };
}

function signedHeaders(payload: string, secret = TEST_WEBHOOK_SECRET) {
  const id = "msg_test_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    id,
    timestamp,
    signature: signResendWebhook(secret, id, timestamp, payload),
  };
}

function envBackup(keys: string[]): { restore: () => void } {
  const prev = new Map(keys.map((k) => [k, process.env[k]]));
  return {
    restore() {
      for (const [k, v] of prev) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

function mockClient(over: Partial<ResendReceivingClient> = {}): ResendReceivingClient {
  return {
    async getEmail() {
      return {
        from: EMAIL_RECEIVED_FIXTURE.data.from,
        to: ["demo@in.ferva.se"],
        received_for: ["demo@in.ferva.se"],
        subject: EMAIL_RECEIVED_FIXTURE.data.subject,
        text: "Se bifogad PDF.",
        html: "<p>Se bifogad PDF.</p>",
      };
    },
    async listAttachments() {
      return [];
    },
    async download() {
      return null;
    },
    ...over,
  };
}

describe("Resend email.received → InboundMailPayload", () => {
  it("mappar to/from/subject/externalId från fixture", () => {
    const event = parseResendWebhookJson(EMAIL_RECEIVED_FIXTURE);
    assert.equal("error" in event, false);
    if ("error" in event) return;
    assert.equal(event.type, "email.received");
    const to = pickInboundRecipient(event.data.to, event.data.received_for);
    assert.equal(to, "demo@in.ferva.se");
    const payload = mapResendReceivedToPayload({
      emailId: event.data.email_id!,
      from: event.data.from!,
      to: to!,
      subject: event.data.subject!,
      text: "Se bifogad PDF.",
    });
    assert.equal("error" in payload, false);
    if ("error" in payload) return;
    assert.equal(payload.externalId, "56761188-7520-42d8-8898-ff6fc54ce618");
    assert.equal(payload.to, "demo@in.ferva.se");
    assert.equal(payload.from, "Byggmax <faktura@byggmax.se>");
    assert.equal(payload.subject, "Faktura 8812");
  });

  it("väljer första adressen på inbound-domänen, även via received_for", () => {
    assert.equal(pickInboundRecipient(["anna@gmail.com"], ["demo@in.driva.se"]), "demo@in.driva.se");
    assert.equal(pickInboundRecipient(["only@gmail.com"], []), null);
    assert.equal(
      pickInboundRecipient(["Byggmax <faktura@byggmax.se>", "Calles <demo@in.ferva.se>"]),
      "demo@in.ferva.se"
    );
  });
});

describe("Resend Svix-signatur", () => {
  it("matchar standardwebhooks / Resend.webhooks.verify", () => {
    const payload = JSON.stringify({ type: "email.received" });
    const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signResendWebhook(TEST_WEBHOOK_SECRET, id, timestamp, payload);
    const verified = new Webhook(TEST_WEBHOOK_SECRET).verify(payload, {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": signature,
    });
    assert.deepEqual(verified, { type: "email.received" });
    assert.equal(
      verifyResendWebhookSignature(payload, { id, timestamp, signature }, TEST_WEBHOOK_SECRET),
      true
    );
  });

  it("avvisar ogiltig signatur i live", async () => {
    const env = envBackup(["INBOUND_MAIL_MODE", "RESEND_WEBHOOK_SECRET", "RESEND_API_KEY"]);
    process.env.INBOUND_MAIL_MODE = "live";
    process.env.RESEND_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    process.env.RESEND_API_KEY = "re_test_not_used";
    try {
      const raw = JSON.stringify(EMAIL_RECEIVED_FIXTURE);
      const bad = await handleResendInboundWebhook({
        rawBody: raw,
        headers: { id: "msg_x", timestamp: String(Math.floor(Date.now() / 1000)), signature: "v1,not-valid" },
      });
      assert.equal(bad.status, 401);

      const unsigned = await handleResendInboundWebhook({
        rawBody: raw,
        headers: unsignedHeaders(),
      });
      assert.equal(unsigned.status, 401);
    } finally {
      env.restore();
    }
  });

  it("läser svix-id / svix-timestamp / svix-signature", () => {
    const headers = resendWebhookHeadersFromRequest((name) => {
      if (name === "svix-id") return "msg_1";
      if (name === "svix-timestamp") return "1710000000";
      if (name === "svix-signature") return "v1,abc";
      return null;
    });
    assert.deepEqual(headers, { id: "msg_1", timestamp: "1710000000", signature: "v1,abc" });
  });
});

describe("Resend webhook-hanterare", () => {
  beforeEach(() => {
    resetDemoData();
  });

  it("andra event-typer → 200, ingen ingest", async () => {
    const before = (db().inboxItems ?? []).length;
    let fetched = false;
    const result = await handleResendInboundWebhook(
      {
        rawBody: JSON.stringify({ type: "email.delivered", data: { email_id: "should-not-fetch" } }),
        headers: unsignedHeaders(),
      },
      {
        client: mockClient({
          async getEmail() {
            fetched = true;
            return null;
          },
        }),
      }
    );
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {});
    assert.equal(fetched, false);
    assert.equal((db().inboxItems ?? []).length, before);
  });

  it("live utan webhook-hemlighet → 503, inget låtsas-mejl", async () => {
    const env = envBackup(["INBOUND_MAIL_MODE", "RESEND_WEBHOOK_SECRET", "RESEND_API_KEY"]);
    process.env.INBOUND_MAIL_MODE = "live";
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.RESEND_API_KEY;
    try {
      const before = (db().inboxItems ?? []).length;
      const result = await handleResendInboundWebhook({
        rawBody: JSON.stringify(EMAIL_RECEIVED_FIXTURE),
        headers: unsignedHeaders(),
      });
      assert.equal(result.status, 503);
      assert.equal((db().inboxItems ?? []).length, before);
    } finally {
      env.restore();
    }
  });

  it("mockad receiving.get + PDF-download → ingest och rad i listan", async () => {
    const pdf = Buffer.from("%PDF-1.4 testdokument");
    const emailId = "re-recv-pdf-1";
    const raw = JSON.stringify({
      ...EMAIL_RECEIVED_FIXTURE,
      data: { ...EMAIL_RECEIVED_FIXTURE.data, email_id: emailId },
    });
    let downloaded = 0;
    const result = await handleResendInboundWebhook(
      { rawBody: raw, headers: unsignedHeaders() },
      {
        client: mockClient({
          async getEmail() {
            return {
              from: "faktura@byggmax.se",
              to: ["demo@in.ferva.se"],
              subject: "Faktura med PDF",
              text: "Bifogat.",
            };
          },
          async listAttachments() {
            return [
              {
                filename: "faktura.pdf",
                content_type: "application/pdf",
                size: pdf.length,
                download_url: "https://inbound-cdn.resend.test/faktura.pdf",
              },
              {
                filename: "anteckning.xlsx",
                content_type: "application/vnd.ms-excel",
                size: 4096,
                download_url: "https://inbound-cdn.resend.test/notes.xlsx",
              },
            ];
          },
          async download(url) {
            downloaded += 1;
            assert.match(url, /faktura\.pdf/);
            return pdf;
          },
        }),
      }
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.created, true);
    assert.equal(downloaded, 1);

    const item = (db().inboxItems ?? []).find((row) => row.externalId === emailId);
    assert.ok(item, "inbox-rad skapades");
    assert.equal(item?.subject, "Faktura med PDF");
    assert.equal(item?.textBody, "Bifogat.");
    assert.equal(item?.attachments.length, 2);
    const pdfAtt = item?.attachments.find((a) => a.filename === "faktura.pdf");
    const xlsx = item?.attachments.find((a) => a.filename === "anteckning.xlsx");
    assert.ok(pdfAtt?.contentBase64);
    assert.equal(storableAttachmentContent("application/pdf", pdfAtt?.contentBase64), pdfAtt?.contentBase64);
    assert.equal(xlsx?.contentBase64, undefined);
    assert.equal(xlsx?.contentType, "application/vnd.ms-excel");

    const listed = listInbox({ filter: "alla" });
    assert.ok(listed.rows.some((row) => row.id === item?.id));
  });

  it("mejl utan bilaga syns som rad", async () => {
    const result = await handleResendInboundWebhook(
      {
        rawBody: JSON.stringify({
          type: "email.received",
          data: {
            email_id: "re-no-att",
            from: "a@x.se",
            to: ["demo@in.ferva.se"],
            subject: "Bara text",
          },
        }),
        headers: unsignedHeaders(),
      },
      {
        client: mockClient({
          async getEmail() {
            return { from: "a@x.se", to: ["demo@in.ferva.se"], subject: "Bara text", text: "Hej" };
          },
        }),
      }
    );
    assert.equal(result.status, 200);
    const item = (db().inboxItems ?? []).find((row) => row.externalId === "re-no-att");
    assert.ok(item);
    assert.equal(item?.textBody, "Hej");
    assert.equal(item?.attachments.length, 0);
  });

  it("okänd slug → 404, ingen tenant-läcka", async () => {
    const before = (db().inboxItems ?? []).length;
    const result = await handleResendInboundWebhook(
      {
        rawBody: JSON.stringify({
          type: "email.received",
          data: { email_id: "re-unknown", from: "a@x.se", to: ["okand@in.ferva.se"], subject: "Nej" },
        }),
        headers: unsignedHeaders(),
      },
      {
        client: mockClient({
          async getEmail() {
            return { from: "a@x.se", to: ["okand@in.ferva.se"], subject: "Nej", text: "fel företag" };
          },
        }),
      }
    );
    assert.equal(result.status, 404);
    assert.equal((db().inboxItems ?? []).length, before);
  });

  it("samma email_id två gånger → created: false, ingen dubblett", async () => {
    const client = mockClient({
      async getEmail() {
        return { from: "a@x.se", to: ["demo@in.ferva.se"], subject: "Ett", text: "hej" };
      },
    });
    const raw = JSON.stringify({
      type: "email.received",
      data: { email_id: "re-dup-1", from: "a@x.se", to: ["demo@in.ferva.se"], subject: "Ett" },
    });
    const first = await handleResendInboundWebhook({ rawBody: raw, headers: unsignedHeaders() }, { client });
    const count = (db().inboxItems ?? []).length;
    const second = await handleResendInboundWebhook({ rawBody: raw, headers: unsignedHeaders() }, { client });
    assert.equal(first.status, 200);
    assert.equal(first.body.created, true);
    assert.equal(second.status, 200);
    assert.equal(second.body.created, false);
    assert.equal((db().inboxItems ?? []).length, count);
  });

  it("för stor viewbar bilaga sparas som metadata, mailet droppas inte", async () => {
    const atts = await collectInboundAttachments(
      "re-big",
      {
        async getEmail() {
          return null;
        },
        async listAttachments() {
          return [
            {
              filename: "stor.pdf",
              content_type: "application/pdf",
              size: 5_000_000,
              download_url: "https://inbound-cdn.resend.test/stor.pdf",
            },
          ];
        },
        async download() {
          throw new Error("ska inte laddas ner");
        },
      },
      []
    );
    assert.equal(atts.length, 1);
    assert.equal(atts[0].filename, "stor.pdf");
    assert.equal(atts[0].contentBase64, undefined);
    assert.equal(atts[0].size, 5_000_000);
  });
});
