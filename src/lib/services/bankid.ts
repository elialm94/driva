import { db, save } from "../store";
import { uid } from "../ids";
import type { BankIDOrder, BankIDSignature, Quote } from "../types";
import { quoteVersionHash } from "../hash";
import { currentVersion, getQuote, requireCustomer } from "./data";
import { logActivity } from "./activity";
import { createJobFromQuote } from "./jobs";

/**
 * BankID-integration.
 *
 * Arkitekturen följer BankID:s riktiga RP-API (sign → collect med hintCodes),
 * så att MockBankIDProvider kan bytas mot en riktig leverantör (t.ex. BankID
 * direkt, Criipto eller Signicat) utan att flöden eller datamodell ändras.
 *
 * VIKTIGT: I mock-läge genomförs ingen riktig signering. Det markeras tydligt
 * i UI, i signaturens `environment`-fält och i signeringsunderlaget.
 */

export interface BankIDProvider {
  readonly environment: "mock" | "production";
  startSign(input: { quoteId: string; quoteVersionId: string; method: "same_device" | "qr" }): BankIDOrder;
  collect(orderRef: string): BankIDOrder | undefined;
  cancel(orderRef: string): void;
}

const ORDER_TTL_MS = 3 * 60 * 1000; // BankID-ordrar gäller i 3 minuter.

class MockBankIDProvider implements BankIDProvider {
  readonly environment = "mock" as const;

  startSign(input: { quoteId: string; quoteVersionId: string; method: "same_device" | "qr" }): BankIDOrder {
    const data = db();
    const now = new Date().toISOString();
    const order: BankIDOrder = {
      orderRef: `mock-${uid()}`,
      quoteId: input.quoteId,
      quoteVersionId: input.quoteVersionId,
      status: "pending",
      hintCode: "outstandingTransaction",
      method: input.method,
      createdAt: now,
      updatedAt: now,
    };
    data.bankidOrders.push(order);
    save();
    return order;
  }

  collect(orderRef: string): BankIDOrder | undefined {
    const order = db().bankidOrders.find((o) => o.orderRef === orderRef);
    if (!order) return undefined;
    if (order.status === "pending" && Date.now() - new Date(order.createdAt).getTime() > ORDER_TTL_MS) {
      order.status = "failed";
      order.hintCode = "expiredTransaction";
      order.updatedAt = new Date().toISOString();
      save();
    }
    return order;
  }

  cancel(orderRef: string): void {
    const order = db().bankidOrders.find((o) => o.orderRef === orderRef);
    if (order && order.status === "pending") {
      order.status = "failed";
      order.hintCode = "userCancel";
      order.updatedAt = new Date().toISOString();
      save();
    }
  }

  /** Endast i mock-läge: driv ordern framåt från demo-panelen. */
  advance(orderRef: string, event: "open_app" | "complete" | "cancel" | "timeout"): BankIDOrder | undefined {
    const order = db().bankidOrders.find((o) => o.orderRef === orderRef);
    if (!order || order.status !== "pending") return order;
    order.updatedAt = new Date().toISOString();
    switch (event) {
      case "open_app":
        order.hintCode = "userSign";
        break;
      case "complete":
        order.status = "complete";
        order.hintCode = "complete";
        finalizeApproval(order);
        break;
      case "cancel":
        order.status = "failed";
        order.hintCode = "userCancel";
        break;
      case "timeout":
        order.status = "failed";
        order.hintCode = "expiredTransaction";
        break;
    }
    save();
    return order;
  }
}

export const bankidProvider = new MockBankIDProvider();

/** Texten kunden ser i BankID-appen (userVisibleData i riktiga API:et). */
export function signText(quote: Quote): string {
  const version = currentVersion(quote);
  return `Jag godkänner offert #${quote.number} ”${version.title}” (version ${version.version}) från ${db().settings.name}.`;
}

/**
 * Slutför godkännandet efter genomförd BankID-signering:
 * låser offertversionen, sparar verifierbart signeringsunderlag,
 * skapar jobbet och informerar företagaren.
 */
export function finalizeApproval(order: BankIDOrder): BankIDSignature {
  const data = db();
  const quote = getQuote(order.quoteId);
  if (!quote) throw new Error("Offerten finns inte");

  // Idempotent: redan godkänd → returnera befintlig signatur.
  const existing = data.signatures.find((s) => s.quoteId === quote.id);
  if (quote.status === "godkand" && existing) return existing;

  const version = data.quoteVersions.find((v) => v.id === order.quoteVersionId);
  if (!version) throw new Error("Offertversionen finns inte");
  if (quote.currentVersionId !== version.id) {
    throw new Error("Offerten har ändrats sedan signeringen påbörjades");
  }

  const customer = requireCustomer(quote.customerId);
  const now = new Date().toISOString();

  // 1. Lås exakt den version kunden signerade.
  version.lockedAt = now;
  version.contentHash = quoteVersionHash(version);

  // 2. Spara signeringsunderlaget.
  const signature: BankIDSignature = {
    id: uid(),
    quoteId: quote.id,
    quoteVersionId: version.id,
    orderRef: order.orderRef,
    signerName: customer.kind === "foretag" ? (customer.contactPerson ?? customer.name) : customer.name,
    signerPersonalNumberMasked: "••••••••-••••",
    signedAt: now,
    environment: bankidProvider.environment,
    evidence: {
      contentHash: version.contentHash,
      note:
        bankidProvider.environment === "mock"
          ? "Demosignatur – ingen riktig BankID-signering har genomförts. I produktion lagras här BankID:s fullständiga signaturdata (XML-DSig) och OCSP-svar."
          : "BankID-signaturdata (XML-DSig) och OCSP-svar.",
    },
  };
  data.signatures.push(signature);

  // 3. Markera offerten som godkänd.
  quote.status = "godkand";
  quote.decidedAt = now;

  // 4. Skapa jobbet automatiskt.
  const job = createJobFromQuote(quote);
  quote.jobId = job.id;

  // 5. Informera företagaren.
  logActivity(
    `${signature.signerName} godkände offert #${quote.number} med BankID. Jobbet ${version.title} skapades.`,
    { customerId: customer.id, entity: { type: "offert", id: quote.id } }
  );

  save();
  return signature;
}
