process.env.DRIVA_TEST = "1";

/**
 * Bankkoppling (Tink Open Banking AIS) – enhetstester utan nätverk.
 *
 *   * Val av leverantör: mock för demo eller saknad miljö, live ENDAST när alla
 *     TINK_* finns och requesten inte är demo.
 *   * CSRF-state: identiskt, inte utgånget, rätt företag.
 *   * Öre/skalade belopp → hela kronor (ADR-1) vid gränsen.
 *   * Felmappning: aldrig rå Tink-JSON – alltid en svensk mening.
 *   * Saknad miljö: "Bankkoppling är inte konfigurerad" utan att kasta oväntat.
 *   * Mock: kopplar utan HTTP, transaktionerna matchar fakturor; Koppla från
 *     behåller transaktioner och verifikationer.
 *   * Live (falsk transport): startConnect bygger Link-URL:en med exakt
 *     redirect_uri och test=true i sandbox; callback validerar state, hämtar
 *     konton/transaktioner och konverterar belopp.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { setTestActor } from "./collaboration/actor";
import { createInvoice, issueInvoice } from "./services/invoices";
import { getInvoice, invoiceTotals } from "./services/data";
import { readTinkConfig, isTinkConfigured, TINK_API_BASE, TINK_LINK_BASE } from "./banking/tink/config";
import { oreToKronor, tinkAmountToKronor } from "./banking/tink/amounts";
import { __setTinkTransportForTests, buildTinkLinkUrl } from "./banking/tink/client";
import {
  BANK_ERROR_TEXT,
  BankConnectionError,
  BankNotConfiguredError,
  TinkApiError,
  tinkCredentialsStatusMessage,
  tinkLinkErrorMessage,
  userFacingBankError,
} from "./banking/errors";
import { isValidConnectState, newConnectState, BANK_STATE_TTL_MS } from "./banking/provider";
import { resolveBankProviderKind } from "./banking/select";
import { MockBankProvider } from "./banking/providers/mock";
import { LiveTinkProvider, toProviderTransaction } from "./banking/providers/tink";
import { UnconfiguredBankProvider } from "./banking/providers/unconfigured";
import { activeBankConnection, bankConnectionView, hasConnectedBank, connectedBankAccount } from "./banking/connection-state";
import { simulateIncomingPayment } from "./services/banking";
import { ledgerIntegrity } from "./accounting/ledger";

const FULL_ENV = {
  TINK_CLIENT_ID: "client-abc",
  TINK_CLIENT_SECRET: "secret-xyz",
  TINK_REDIRECT_URI: "https://driva.se/api/bank/tink/callback",
  TINK_MARKET: "SE",
  TINK_ENV: "sandbox",
};

const BUSINESS_ID = "biz-test-1";

function reset() {
  replaceDb(emptyTestDb({ customers: [testCustomer()] }));
  setTestActor({ userId: "u1", email: "a@b.se", name: "Anna", role: "owner", businessId: BUSINESS_ID });
}

function issuedInvoice(unitPrice = 10_000) {
  const draft = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice })], rot: null });
  return issueInvoice(draft.id);
}

/** Transport som registrerar alla anrop och sprutar ut färdiga svar per sökväg. */
function fakeTransport(routes: Record<string, (init: RequestInit, url: URL) => unknown>) {
  const calls: { method: string; url: string }[] = [];
  __setTinkTransportForTests(async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({ method: init.method ?? "GET", url: rawUrl });
    const key = Object.keys(routes).find((k) => url.pathname === k || url.pathname.startsWith(`${k}/`));
    if (!key) return new Response(JSON.stringify({ errorCode: "not_found" }), { status: 404 });
    const body = routes[key](init, url);
    if (body instanceof Response) return body;
    if (body === undefined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

/* ------------------------------ leverantörsval ------------------------------ */

describe("Val av bankleverantör", () => {
  it("demo → mock, även när miljön är komplett", () => {
    assert.equal(resolveBankProviderKind({ demo: true, configured: true }), "mock");
    assert.equal(resolveBankProviderKind({ demo: true, configured: false }), "mock");
  });

  it("riktigt företag utan miljö → unconfigured (aldrig tyst mock)", () => {
    assert.equal(resolveBankProviderKind({ demo: false, configured: false }), "unconfigured");
  });

  it("live endast när alla TINK_* finns och requesten inte är demo", () => {
    assert.equal(resolveBankProviderKind({ demo: false, configured: true }), "tink");
  });

  it("readTinkConfig kräver alla obligatoriska variabler", () => {
    assert.ok(isTinkConfigured(FULL_ENV));
    for (const key of ["TINK_CLIENT_ID", "TINK_CLIENT_SECRET", "TINK_REDIRECT_URI"] as const) {
      const env = { ...FULL_ENV, [key]: "" };
      assert.equal(readTinkConfig(env), null, `${key} saknas → inte konfigurerad`);
    }
    assert.equal(readTinkConfig({}), null);
  });

  it("sandbox och produktion använder Tinks värdar; marknad/locale är svenska", () => {
    const cfg = readTinkConfig(FULL_ENV)!;
    assert.equal(cfg.env, "sandbox");
    assert.equal(cfg.apiBase, TINK_API_BASE);
    assert.equal(cfg.linkBase, TINK_LINK_BASE);
    assert.equal(cfg.market, "SE");
    assert.equal(cfg.locale, "sv_SE");
    assert.equal(readTinkConfig({ ...FULL_ENV, TINK_ENV: "production" })!.env, "production");
  });

  it("Link-URL: redirect_uri är byte-för-byte TINK_REDIRECT_URI, test=true bara i sandbox", () => {
    const cfg = readTinkConfig(FULL_ENV)!;
    const url = new URL(buildTinkLinkUrl(cfg, { authorizationCode: "code-1", state: "abc.def" }));
    assert.equal(url.origin + url.pathname, `${TINK_LINK_BASE}/1.0/transactions/connect-accounts`);
    assert.equal(url.searchParams.get("redirect_uri"), FULL_ENV.TINK_REDIRECT_URI);
    assert.equal(url.searchParams.get("client_id"), FULL_ENV.TINK_CLIENT_ID);
    assert.equal(url.searchParams.get("authorization_code"), "code-1");
    assert.equal(url.searchParams.get("market"), "SE");
    assert.equal(url.searchParams.get("locale"), "sv_SE");
    assert.equal(url.searchParams.get("state"), "abc.def");
    assert.equal(url.searchParams.get("test"), "true");

    const prod = readTinkConfig({ ...FULL_ENV, TINK_ENV: "production" })!;
    const prodUrl = new URL(buildTinkLinkUrl(prod, { authorizationCode: "c", state: "s" }));
    assert.equal(prodUrl.searchParams.get("test"), null);
  });
});

/* ---------------------------------- CSRF ----------------------------------- */

describe("CSRF-state för Tink Link", () => {
  const stored = newConnectState(BUSINESS_ID);
  const expires = new Date(Date.now() + BANK_STATE_TTL_MS).toISOString();

  it("godkänner identiskt, ej utgånget state för rätt företag", () => {
    assert.ok(isValidConnectState({ received: stored, stored, storedExpiresAt: expires, businessId: BUSINESS_ID }));
  });

  it("avvisar avvikande, saknat, utgånget eller främmande företags state", () => {
    const other = newConnectState(BUSINESS_ID);
    assert.equal(isValidConnectState({ received: other, stored, storedExpiresAt: expires, businessId: BUSINESS_ID }), false);
    assert.equal(isValidConnectState({ received: null, stored, storedExpiresAt: expires, businessId: BUSINESS_ID }), false);
    assert.equal(isValidConnectState({ received: stored, stored: null, storedExpiresAt: expires, businessId: BUSINESS_ID }), false);
    assert.equal(
      isValidConnectState({ received: stored, stored, storedExpiresAt: new Date(Date.now() - 1000).toISOString(), businessId: BUSINESS_ID }),
      false
    );
    assert.equal(isValidConnectState({ received: stored, stored, storedExpiresAt: expires, businessId: "biz-other" }), false);
  });

  it("state innehåller inte företagets id i klartext", () => {
    assert.equal(stored.includes(BUSINESS_ID), false);
    assert.notEqual(newConnectState(BUSINESS_ID), stored, "nonce är slumpad");
  });
});

/* --------------------------------- belopp ---------------------------------- */

describe("Belopp: Tink → hela kronor (ADR-1)", () => {
  it("skalade värden avrundas till hela kronor, halva kronor bort från noll", () => {
    assert.equal(tinkAmountToKronor({ unscaledValue: "1250000", scale: "2" }), 12_500);
    assert.equal(tinkAmountToKronor({ unscaledValue: "123456", scale: "2" }), 1235);
    assert.equal(tinkAmountToKronor({ unscaledValue: "-123456", scale: "2" }), -1235);
    assert.equal(tinkAmountToKronor({ unscaledValue: "150", scale: "2" }), 2);
    assert.equal(tinkAmountToKronor({ unscaledValue: "-150", scale: "2" }), -2);
    assert.equal(tinkAmountToKronor({ unscaledValue: "-49", scale: "2" }), 0);
    assert.equal(tinkAmountToKronor({ unscaledValue: "489", scale: "0" }), 489);
    assert.equal(tinkAmountToKronor({ unscaledValue: "4890", scale: "1" }), 489);
  });

  it("öre → kronor", () => {
    assert.equal(oreToKronor(48_900), 489);
    assert.equal(oreToKronor(48_950), 490);
    assert.equal(oreToKronor(-48_950), -490);
    assert.equal(oreToKronor(0), 0);
  });

  it("resultatet är alltid ett heltal som matchningsmotorn kan bokföra", () => {
    for (const v of ["1", "99", "-1", "1234567", "-99999"]) {
      const n = tinkAmountToKronor({ unscaledValue: v, scale: "2" });
      assert.ok(Number.isInteger(n), `${v} → ${n}`);
    }
  });
});

/* -------------------------------- felmappning ------------------------------- */

describe("Felmappning: aldrig rå Tink-JSON mot användaren", () => {
  it("Tink Link-fel → svensk mening; USER_CANCELLED är inget fel", () => {
    assert.equal(tinkLinkErrorMessage("USER_CANCELLED"), null);
    assert.equal(tinkLinkErrorMessage("AUTHENTICATION_ERROR"), BANK_ERROR_TEXT.declined);
    assert.equal(tinkLinkErrorMessage("BAD_REQUEST"), BANK_ERROR_TEXT.declined);
    assert.equal(tinkLinkErrorMessage("TEMPORARY_ERROR"), BANK_ERROR_TEXT.temporary);
    assert.equal(tinkLinkErrorMessage("INTERNAL_ERROR"), BANK_ERROR_TEXT.temporary);
    assert.equal(tinkLinkErrorMessage(null), null);
  });

  it("credentials-status → svensk mening", () => {
    assert.equal(tinkCredentialsStatusMessage("UPDATED"), null);
    assert.equal(tinkCredentialsStatusMessage("AUTHENTICATION_ERROR"), BANK_ERROR_TEXT.declined);
    assert.equal(tinkCredentialsStatusMessage("SESSION_EXPIRED"), BANK_ERROR_TEXT.declined);
    assert.equal(tinkCredentialsStatusMessage("TEMPORARY_ERROR"), BANK_ERROR_TEXT.temporary);
  });

  it("API-fel med JSON-kropp blir en av de godkända meningarna", () => {
    const raw = new TinkApiError('Tink /data/v2/accounts svarade 500 {"errorCode":"internal.error"}', 500, "internal.error");
    const text = userFacingBankError(raw);
    assert.equal(text, BANK_ERROR_TEXT.temporary);
    assert.equal(text.includes("{"), false);
    assert.equal(text.includes("errorCode"), false);
    assert.equal(userFacingBankError(new TinkApiError("401", 401)), BANK_ERROR_TEXT.declined);
    assert.equal(userFacingBankError(new TinkApiError("403", 403)), BANK_ERROR_TEXT.declined);
    assert.equal(userFacingBankError(new TinkApiError("nätverk", 0)), BANK_ERROR_TEXT.temporary);
    assert.equal(userFacingBankError(new Error("ECONNRESET")), BANK_ERROR_TEXT.temporary);
    assert.equal(userFacingBankError(new BankNotConfiguredError()), BANK_ERROR_TEXT.notConfigured);
    assert.equal(userFacingBankError(new BankConnectionError("Egen text")), "Egen text");
  });

  it("alla användartexter är svenska meningar utan tekniska termer", () => {
    for (const text of Object.values(BANK_ERROR_TEXT)) {
      assert.doesNotMatch(text, /tink|json|http|token|error/i, text);
    }
    assert.equal(BANK_ERROR_TEXT.notConfigured, "Bankkoppling är inte konfigurerad");
    assert.equal(BANK_ERROR_TEXT.declined, "Banken godkände inte kopplingen. Försök igen.");
    assert.equal(BANK_ERROR_TEXT.temporary, "Tillfälligt fel hos banken. Försök igen.");
  });
});

/* ------------------------------- saknad miljö -------------------------------- */

describe("Saknad miljö på riktigt företag", () => {
  beforeEach(reset);
  afterEach(() => setTestActor(null));

  it("Koppla ger 'Bankkoppling är inte konfigurerad' – inget kraschar, ingen rad blir pending", async () => {
    const provider = new UnconfiguredBankProvider();
    await assert.rejects(provider.startConnect(), (err: unknown) => {
      assert.ok(err instanceof BankNotConfiguredError);
      assert.equal((err as Error).message, "Bankkoppling är inte konfigurerad");
      return true;
    });
    await assert.rejects(provider.refresh(), BankNotConfiguredError);
    assert.equal(bankConnectionView().status, "disconnected");
    assert.equal(userFacingBankError(new BankNotConfiguredError()), "Bankkoppling är inte konfigurerad");
  });

  it("Koppla från fungerar utan miljö (rensar lokalt läge)", async () => {
    await new UnconfiguredBankProvider().disconnect();
    assert.equal(hasConnectedBank(), false);
  });
});

/* ----------------------------------- mock ----------------------------------- */

describe("MockBankProvider (demo)", () => {
  let calls: { method: string; url: string }[];
  beforeEach(() => {
    reset();
    calls = fakeTransport({});
  });
  afterEach(() => {
    __setTinkTransportForTests(null);
    setTestActor(null);
  });

  it("kopplar direkt utan HTTP och skapar transaktioner som matchar en faktura", async () => {
    const inv = issuedInvoice();
    const result = await new MockBankProvider().startConnect();
    assert.equal(result.kind, "connected");
    assert.equal(calls.length, 0, "mocken gör noll HTTP-anrop");

    const view = bankConnectionView();
    assert.equal(view.status, "connected");
    assert.equal(view.provider, "mock");
    assert.ok(view.bankName);
    assert.ok(view.maskedAccount);
    assert.ok(view.lastSyncAt);

    assert.ok(db().bankTransactions.length >= 2);
    const after = getInvoice(inv.id)!;
    assert.equal(after.status, "betald", "OCR-inbetalningen bokförs automatiskt");
    assert.equal(db().payments[0]?.amount, invoiceTotals(inv).toPay);
    assert.ok(ledgerIntegrity().balanced);
  });

  it("Uppdatera hämtar nya transaktioner och sätter lastSyncAt", async () => {
    const provider = new MockBankProvider();
    await provider.startConnect();
    const before = db().bankTransactions.length;
    const firstSync = bankConnectionView().lastSyncAt!;
    await new Promise((r) => setTimeout(r, 5));
    const result = await provider.refresh();
    assert.ok(result.imported >= 1);
    assert.equal(db().bankTransactions.length, before + result.imported);
    assert.ok(bankConnectionView().lastSyncAt! >= firstSync);
    assert.equal(calls.length, 0);
  });

  it("Koppla från: status revoked, transaktioner och verifikationer finns kvar, simulering stängs", async () => {
    issuedInvoice();
    const provider = new MockBankProvider();
    await provider.startConnect();
    const txCount = db().bankTransactions.length;
    const verCount = db().verifications.length;
    assert.ok(verCount > 0, "kopplingen bokförde minst en verifikation");

    await provider.disconnect();
    const view = bankConnectionView();
    assert.equal(view.status, "revoked");
    assert.equal(view.hasHistory, true);
    assert.equal(db().bankTransactions.length, txCount);
    assert.equal(db().verifications.length, verCount);
    assert.equal(hasConnectedBank(), false);
    assert.equal(connectedBankAccount(), undefined);
    await assert.rejects(provider.refresh(), (err: Error) => err.message === BANK_ERROR_TEXT.notConnected);

    const inv2 = issuedInvoice(2000);
    assert.throws(() => simulateIncomingPayment(inv2.id), /Ingen bank är kopplad/);

    // Koppla igen: tillbaka till connected utan dubbla konton.
    await provider.startConnect();
    assert.equal(bankConnectionView().status, "connected");
    assert.equal(db().bankAccounts.length, 1);
    assert.equal(calls.length, 0);
  });
});

/* ----------------------------------- live ----------------------------------- */

describe("LiveTinkProvider (falsk transport)", () => {
  const cfg = () => readTinkConfig(FULL_ENV)!;
  beforeEach(reset);
  afterEach(() => {
    __setTinkTransportForTests(null);
    setTestActor(null);
  });

  it("startConnect: skapar användare, delegerar och returnerar Link-URL; raden blir pending", async () => {
    const bodies: string[] = [];
    const calls = fakeTransport({
      "/api/v1/oauth/token": () => ({ access_token: "client-token", expires_in: 1800 }),
      "/api/v1/user/create": (init) => {
        bodies.push(String(init.body));
        return { user_id: "tink-user-1" };
      },
      "/api/v1/oauth/authorization-grant/delegate": () => ({ code: "delegate-code" }),
    });
    const result = await new LiveTinkProvider(cfg()).startConnect();
    assert.equal(result.kind, "redirect");
    const url = new URL((result as { url: string }).url);
    assert.equal(url.host, "link.tink.com");
    assert.equal(url.searchParams.get("redirect_uri"), FULL_ENV.TINK_REDIRECT_URI);
    assert.equal(url.searchParams.get("authorization_code"), "delegate-code");
    assert.equal(url.searchParams.get("test"), "true");
    assert.ok(url.searchParams.get("state"));

    const row = activeBankConnection()!;
    assert.equal(row.status, "pending");
    assert.equal(row.externalUserId, BUSINESS_ID, "permanent användare per företag");
    assert.equal(row.tinkUserId, "tink-user-1");
    assert.equal(row.pendingState, url.searchParams.get("state"));
    assert.ok(JSON.parse(bodies[0]).external_user_id === BUSINESS_ID);
    assert.ok(calls.every((c) => c.url.startsWith(TINK_API_BASE)));
  });

  it("callback med fel state → error-läge och svensk text, inget hämtas", async () => {
    const calls = fakeTransport({
      "/api/v1/oauth/token": () => ({ access_token: "t" }),
      "/api/v1/user/create": () => ({ user_id: "u" }),
      "/api/v1/oauth/authorization-grant/delegate": () => ({ code: "c" }),
    });
    const provider = new LiveTinkProvider(cfg());
    await provider.startConnect();
    const before = calls.length;
    await assert.rejects(
      provider.handleCallback({ credentialsId: "cred-1", state: "fel.state" }),
      (err: Error) => err.message === BANK_ERROR_TEXT.stateMismatch
    );
    assert.equal(calls.length, before, "ingen data hämtas utan giltigt state");
    const view = bankConnectionView();
    assert.equal(view.status, "error");
    assert.equal(view.error, BANK_ERROR_TEXT.stateMismatch);
  });

  it("callback USER_CANCELLED → tillbaka till disconnected utan fel", async () => {
    fakeTransport({
      "/api/v1/oauth/token": () => ({ access_token: "t" }),
      "/api/v1/user/create": () => ({ user_id: "u" }),
      "/api/v1/oauth/authorization-grant/delegate": () => ({ code: "c" }),
    });
    const provider = new LiveTinkProvider(cfg());
    await provider.startConnect();
    const state = activeBankConnection()!.pendingState!;
    const outcome = await provider.handleCallback({ state, error: "USER_CANCELLED", errorReason: "USER_CANCELLED" });
    assert.equal(outcome, "cancelled");
    assert.equal(bankConnectionView().status, "disconnected");
    assert.equal(activeBankConnection()!.pendingState, undefined, "state är engångs");
  });

  it("lyckad callback: konton + transaktioner hämtas, belopp i hela kronor, fakturan matchas", async () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay; // 12 500 kr
    const calls = fakeTransport({
      "/api/v1/oauth/token": () => ({ access_token: "tok", expires_in: 7200 }),
      "/api/v1/user/create": () => ({ user_id: "u" }),
      "/api/v1/oauth/authorization-grant/delegate": () => ({ code: "c" }),
      "/api/v1/oauth/authorization-grant": () => ({ code: "user-code" }),
      "/api/v1/credentials": () => ({ id: "cred-1", providerName: "se-demobank-password", status: "UPDATED" }),
      "/api/v1/providers": () => ({
        providers: [{ name: "se-demobank-password", displayName: "Demo Bank", financialInstitutionName: "Demo Bank" }],
      }),
      "/data/v2/accounts": () => ({
        accounts: [
          {
            id: "acc-tink-1",
            name: "Företagskonto",
            type: "CHECKING",
            balances: { booked: { amount: { currencyCode: "SEK", value: { unscaledValue: "4567890", scale: "2" } } } },
            identifiers: { iban: { iban: "SE4550000000058398257466", bban: "50000000058398257466" } },
          },
        ],
      }),
      "/data/v2/transactions": () => ({
        transactions: [
          {
            id: "tx-1",
            accountId: "acc-tink-1",
            amount: { currencyCode: "SEK", value: { unscaledValue: String(toPay * 100), scale: "2" } },
            status: "BOOKED",
            dates: { booked: "2026-08-30" },
            descriptions: { display: "Inbetalning bankgiro", original: "BG 123-4567 ANNA ANDERSSON" },
            counterparties: { payer: { name: "Anna Andersson" } },
            reference: `OCR ${inv.ocr}`,
          },
          {
            id: "tx-2",
            accountId: "acc-tink-1",
            amount: { currencyCode: "SEK", value: { unscaledValue: "-48950", scale: "2" } },
            status: "BOOKED",
            dates: { booked: "2026-08-31" },
            descriptions: { display: "Kortköp CLAS OHLSON" },
            counterparties: { payee: { name: "Clas Ohlson" } },
          },
        ],
      }),
    });
    const provider = new LiveTinkProvider(cfg());
    await provider.startConnect();
    const state = activeBankConnection()!.pendingState!;
    const outcome = await provider.handleCallback({ credentialsId: "cred-1", state });
    assert.equal(outcome, "connected");

    const view = bankConnectionView();
    assert.equal(view.status, "connected");
    assert.equal(view.bankName, "Demo Bank");
    assert.equal(view.maskedAccount, "···· 7466");
    assert.equal(view.balance, 45_679);
    assert.ok(view.lastSyncAt);

    const account = db().bankAccounts[0];
    assert.equal(account.provider, "tink");
    assert.equal(account.externalId, "acc-tink-1");
    assert.equal(db().bankTransactions.length, 2);
    const card = db().bankTransactions.find((t) => t.externalId === "tx-2")!;
    assert.equal(card.amount, -490, "-489,50 → -490 hela kronor");
    assert.equal(getInvoice(inv.id)!.status, "betald", "OCR-transaktionen bokfördes mot fakturan");
    assert.ok(ledgerIntegrity().balanced);

    const row = activeBankConnection()!;
    assert.equal(row.credentialsId, "cred-1");
    assert.ok(row.accessToken, "användartoken cachas server-side");
    assert.equal(row.pendingState, undefined);
    assert.ok(calls.every((c) => c.url.startsWith(TINK_API_BASE)));
    const txCall = calls.find((c) => c.url.includes("/data/v2/transactions"))!;
    assert.ok(new URL(txCall.url).searchParams.getAll("accountIdIn").includes("acc-tink-1"));

    // Andra synken importerar inte samma transaktioner igen (idempotent på externalId).
    const again = await provider.refresh();
    assert.equal(again.imported, 0);
    assert.equal(db().bankTransactions.length, 2);
  });

  it("Koppla från raderar medgivandet hos Tink och behåller historiken", async () => {
    const deleted: string[] = [];
    fakeTransport({
      "/api/v1/oauth/token": () => ({ access_token: "tok", expires_in: 7200 }),
      "/api/v1/oauth/authorization-grant": () => ({ code: "user-code" }),
      "/api/v1/credentials": (init, url) => {
        if (init.method === "DELETE") {
          deleted.push(url.pathname);
          return undefined;
        }
        return { id: "cred-1", providerName: "se-demobank-password", status: "UPDATED" };
      },
      "/api/v1/providers": () => ({ providers: [] }),
      "/data/v2/accounts": () => ({
        accounts: [{ id: "acc-tink-1", name: "Konto", type: "CHECKING", balances: { booked: { amount: { value: { unscaledValue: "100000", scale: "2" } } } } }],
      }),
      "/data/v2/transactions": () => ({
        transactions: [
          {
            id: "tx-9",
            accountId: "acc-tink-1",
            amount: { value: { unscaledValue: "-10000", scale: "2" } },
            dates: { booked: "2026-08-31" },
            descriptions: { display: "Kortköp" },
          },
        ],
      }),
    });
    const provider = new LiveTinkProvider(cfg());
    const state = newConnectState(BUSINESS_ID);
    // Simulera att startConnect redan gjorts (pending med giltigt state).
    const { upsertBankConnection } = await import("./banking/connection-state");
    upsertBankConnection({
      provider: "tink",
      status: "pending",
      externalUserId: BUSINESS_ID,
      pendingState: state,
      pendingStateExpiresAt: new Date(Date.now() + BANK_STATE_TTL_MS).toISOString(),
    });
    assert.equal(await provider.handleCallback({ credentialsId: "cred-1", state }), "connected");
    const txCount = db().bankTransactions.length;
    assert.equal(txCount, 1);

    await provider.disconnect();
    assert.deepEqual(deleted, ["/api/v1/credentials/cred-1"]);
    const row = activeBankConnection()!;
    assert.equal(row.status, "revoked");
    assert.equal(row.credentialsId, undefined);
    assert.equal(row.accessToken, undefined, "token rensas vid frånkoppling");
    assert.equal(db().bankTransactions.length, txCount, "historiken finns kvar");
    assert.equal(bankConnectionView().hasHistory, true);
    assert.equal(hasConnectedBank(), false);
  });

  it("nätverksfel/5xx under callback → error-läge med 'Tillfälligt fel', aldrig JSON", async () => {
    fakeTransport({
      "/api/v1/oauth/token": () => ({ access_token: "tok" }),
      "/api/v1/user/create": () => ({ user_id: "u" }),
      "/api/v1/oauth/authorization-grant/delegate": () => ({ code: "c" }),
      "/api/v1/oauth/authorization-grant": () => ({ code: "user-code" }),
      "/api/v1/credentials": () => ({ id: "cred-1", status: "UPDATED" }),
      "/api/v1/providers": () => ({ providers: [] }),
      "/data/v2/accounts": () =>
        new Response(JSON.stringify({ errorCode: "internal.error", errorMessage: "boom" }), { status: 500 }),
    });
    const provider = new LiveTinkProvider(cfg());
    await provider.startConnect();
    const state = activeBankConnection()!.pendingState!;
    const outcome = await provider.handleCallback({ credentialsId: "cred-1", state });
    assert.equal(outcome, "error");
    const view = bankConnectionView();
    assert.equal(view.status, "error");
    assert.equal(view.error, BANK_ERROR_TEXT.temporary);
    assert.equal(JSON.stringify(view).includes("boom"), false);
  });

  it("demoföretaget kan aldrig nå Tink även om live-providern skulle väljas", async () => {
    const calls = fakeTransport({ "/api/v1/oauth/token": () => ({ access_token: "tok" }) });
    db().meta.demo = true;
    await assert.rejects(new LiveTinkProvider(cfg()).startConnect(), BankConnectionError);
    assert.equal(calls.length, 0);
  });

  it("toProviderTransaction: motpart, beskrivning och referens från Tinks fält", () => {
    const tx = toProviderTransaction({
      id: "t",
      accountId: "a",
      amount: { value: { unscaledValue: "250000", scale: "2" } },
      dates: { booked: "2026-09-01" },
      descriptions: { display: "Inbetalning", original: "BG 999" },
      counterparties: { payer: { name: "Kalle Kund" } },
      reference: "OCR 12345678",
    });
    assert.equal(tx.amount, 2500);
    assert.equal(tx.counterpart, "Kalle Kund");
    assert.equal(tx.description, "Inbetalning");
    assert.equal(tx.reference, "OCR 12345678");
    assert.equal(tx.date, "2026-09-01T00:00:00.000Z");
  });
});
