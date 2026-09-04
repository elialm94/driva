import { db, save } from "../store";
import { uid } from "../ids";
import type { BankIDOrder, Quote, QuoteAcceptance } from "../types";
import { currentVersion, getQuote, requireCustomer } from "./data";
import { isDemoBusiness, isDemoMode } from "../demo";
import { finalizeQuoteAcceptance, QuoteAcceptError } from "./quote-accept";

/**
 * BankID-provider (mock) – INTE på kundens godkännandeväg.
 *
 * Kunden godkänner offerter med namn + knapp på offertlänken
 * (services/quote-accept.ts). Ingen sida eller route anropar den här
 * providern längre; filen finns kvar som framtida krok för en riktig
 * leverantör (sign → collect med hintCodes) och för äldre demodata.
 *
 * Det finns ingen riktig BankID-integration i koden: environment är alltid
 * "mock", och mocken får bara köras i demo (aldrig för riktiga företag).
 */

export interface BankIDProvider {
  readonly environment: "mock" | "production";
  startSign(input: { quoteId: string; quoteVersionId: string; method: "same_device" | "qr" }): BankIDOrder;
  collect(orderRef: string): BankIDOrder | undefined;
  cancel(orderRef: string): void;
}

const ORDER_TTL_MS = 3 * 60 * 1000; // BankID-ordrar gäller i 3 minuter.

export class BankIDUnavailableError extends Error {
  constructor() {
    super("BankID-signering är inte aktiverad för det här företaget.");
    this.name = "BankIDUnavailableError";
  }
}

/** Mocken är en demofunktion: aldrig för riktiga företag i produktion. */
export function bankidSigningAvailable(): boolean {
  const provider: BankIDProvider = bankidProvider;
  if (provider.environment === "production") return true;
  return isDemoMode() || isDemoBusiness();
}

function assertMockSigningAllowed(): void {
  if (!isDemoMode() && !isDemoBusiness()) throw new BankIDUnavailableError();
}

class MockBankIDProvider implements BankIDProvider {
  readonly environment = "mock" as const;

  startSign(input: { quoteId: string; quoteVersionId: string; method: "same_device" | "qr" }): BankIDOrder {
    assertMockSigningAllowed();
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

  /** Endast mock: driv ordern framåt. */
  advance(orderRef: string, event: "open_app" | "complete" | "cancel" | "timeout"): BankIDOrder | undefined {
    assertMockSigningAllowed();
    const order = db().bankidOrders.find((o) => o.orderRef === orderRef);
    if (!order || order.status !== "pending") return order;
    order.updatedAt = new Date().toISOString();
    switch (event) {
      case "open_app":
        order.hintCode = "userSign";
        break;
      case "complete":
        // Godkännandet först – har offerten avböjts/ändrats kastar finalize
        // och ordern blir failed i stället för complete utan bevis.
        try {
          finalizeApproval(order);
          order.status = "complete";
          order.hintCode = "complete";
        } catch {
          order.status = "failed";
          order.hintCode = "startFailed";
        }
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

/** Texten kunden skulle se i en BankID-app (userVisibleData). */
export function signText(quote: Quote): string {
  const version = currentVersion(quote);
  const rotNote = version.taxReductionTerms
    ? ` ROT/RUT-villkor (${version.taxReductionTerms.version}) ingår.`
    : "";
  return `Jag godkänner offert #${quote.number} ”${version.title}” (version ${version.version}) från ${db().settings.name}.${rotNote}`;
}

/**
 * Slutför en mock-order: samma atomiska väg som kundens godkännande
 * (finalizeQuoteAcceptance) med method bankid_mock.
 */
export function finalizeApproval(order: BankIDOrder): QuoteAcceptance {
  const data = db();
  const quote = getQuote(order.quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  const version = data.quoteVersions.find((v) => v.id === order.quoteVersionId);
  if (!version) throw new Error("Offertversionen finns inte");
  if (quote.status !== "godkand" && quote.currentVersionId !== version.id) {
    throw new QuoteAcceptError("changed");
  }
  const customer = requireCustomer(quote.customerId);
  return finalizeQuoteAcceptance(quote, version, {
    method: "bankid_mock",
    acceptedByName: customer.kind === "foretag" ? (customer.contactPerson ?? customer.name) : customer.name,
    bankid: {
      orderRef: order.orderRef,
      personalNumberMasked: "••••••••-••••",
      environment: bankidProvider.environment,
      note: "Demosignatur – ingen riktig BankID-signering har genomförts.",
    },
  });
}
