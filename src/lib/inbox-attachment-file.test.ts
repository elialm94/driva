process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { ingestInboundMail, ingestUploadedDocument, inboundAddressForBusiness } from "./services/inbox";
import {
  MAX_INBOX_ATTACHMENT_BYTES,
  inboxBucketAvailable,
  persistInboundAttachments,
  safeAttachmentFilename,
  storeInboxAttachment,
} from "./inbox/attachment-file";
import { attachmentBytes, attachmentIsViewable } from "./inbox/attachment-content";

/**
 * Inboxbilagornas lagring.
 *
 * Utan fillagring gäller inline-taket, och det ska sägas rakt ut i stället för
 * att en fil tystnar. Med bucket bär posten bara en sökväg – och det är den
 * vägen läsningen och arkivexporten måste klara, inte bara base64.
 */

function reset() {
  replaceDb(emptyTestDb());
}

function base64OfSize(bytes: number): string {
  return Buffer.alloc(bytes, 7).toString("base64");
}

const PDF = "application/pdf";

describe("var bilagans bytes hamnar", () => {
  beforeEach(reset);

  it("utan fillagring lagras små dokument inline", async () => {
    assert.equal(inboxBucketAvailable(), false, "testläget har ingen bucket");
    const where = await storeInboxAttachment("doc-1", "faktura.pdf", PDF, base64OfSize(1_000));
    assert.ok(where.contentBase64);
    assert.equal(where.storagePath, undefined);
  });

  it("ett dokument över inline-taket lagras inte – posten bär bara uppgifterna", async () => {
    const where = await storeInboxAttachment("doc-1", "stor.pdf", PDF, base64OfSize(2_000_000));
    assert.deepEqual(where, {}, "hellre ärlig metadata än halv fil");
  });

  it("en typ som visaren inte klarar lagras inte inline", async () => {
    const where = await storeInboxAttachment("doc-1", "arkiv.zip", "application/zip", base64OfSize(500));
    assert.deepEqual(where, {});
  });

  it("bucketens tak är tio megabyte, inline-takets 1,5", () => {
    assert.equal(MAX_INBOX_ATTACHMENT_BYTES, 10 * 1024 * 1024);
  });

  it("filnamn saneras till en sökväg som går att lägga i en bucket", () => {
    assert.equal(safeAttachmentFilename("fakturor/mars?.pdf"), "fakturor-mars-.pdf");
    assert.equal(safeAttachmentFilename("   "), "dokument");
  });
});

describe("payloaden på väg in", () => {
  beforeEach(reset);

  it("innehållet följer med posten och går att läsa tillbaka", async () => {
    const payload = await persistInboundAttachments({
      externalId: "mail-1",
      to: inboundAddressForBusiness(),
      from: "faktura@beijer.se",
      subject: "Faktura BB-1",
      text: "Se bilaga",
      attachments: [{ filename: "BB-1.pdf", contentType: PDF, contentBase64: base64OfSize(800) }],
    });
    const result = ingestInboundMail(payload);
    assert.ok(result.ok);

    const attachment = result.item.attachments[0];
    assert.equal(attachment.filename, "BB-1.pdf");
    assert.equal(attachmentIsViewable(attachment), true);
    const bytes = await attachmentBytes(attachment);
    assert.equal(bytes?.bytes.length, 800);
  });

  it("en bilaga som inte kunde lagras blir metadata, men dokumentet kommer in", async () => {
    const payload = await persistInboundAttachments({
      externalId: "mail-2",
      to: inboundAddressForBusiness(),
      from: "faktura@beijer.se",
      subject: "Faktura BB-2",
      text: "Se bilaga",
      attachments: [{ filename: "stor.pdf", contentType: PDF, contentBase64: base64OfSize(3_000_000) }],
    });
    const result = ingestInboundMail(payload);
    assert.ok(result.ok);

    const attachment = result.item.attachments[0];
    assert.equal(attachment.contentBase64, undefined);
    assert.equal(attachment.storagePath, undefined);
    assert.equal(attachmentIsViewable(attachment), false, "visaren ska inte låtsas");
    assert.equal(await attachmentBytes(attachment), undefined);
  });

  it("en sökväg i payloaden blir en sökväg på posten, utan base64 vid sidan", () => {
    const result = ingestInboundMail({
      externalId: "mail-3",
      to: inboundAddressForBusiness(),
      from: "faktura@beijer.se",
      subject: "Faktura BB-3",
      text: "Se bilaga",
      attachments: [
        {
          filename: "BB-3.pdf",
          contentType: PDF,
          size: 4_200,
          storagePath: "biz-1/mail-3/BB-3.pdf",
          contentBase64: base64OfSize(100),
        },
      ],
    });
    assert.ok(result.ok);

    const attachment = result.item.attachments[0];
    assert.equal(attachment.storagePath, "biz-1/mail-3/BB-3.pdf");
    assert.equal(attachment.contentBase64, undefined, "aldrig två sanningar om samma fil");
    assert.equal(attachment.size, 4_200);
    assert.equal(attachmentIsViewable(attachment), true);
  });

  it("en uppladdning kan bära sökväg i stället för bytes", () => {
    const result = ingestUploadedDocument({
      filename: "kvitto.pdf",
      contentType: PDF,
      storagePath: "biz-1/upload-1/kvitto.pdf",
      sizeBytes: 2_048,
    });
    assert.ok(result.ok);
    const attachment = result.item.attachments[0];
    assert.equal(attachment.storagePath, "biz-1/upload-1/kvitto.pdf");
    assert.equal(attachment.contentBase64, undefined);
    assert.equal(db().inboxItems?.length, 1);
  });
});
