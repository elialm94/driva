/**
 * Integrationsvalidering av HELA persistenslagret mot riktig Postgres
 * (PGlite/WASM – ingen Docker krävs):
 *
 *   riktiga domäntjänster (createCustomer, sendQuote, sendInvoice, …)
 *     → tenantkontext (runWithTenant)
 *       → ladda → diffa → atomär commit med RPC:er (issue/payment/verifikation)
 *         → RLS + triggers + CAS i databasen
 *
 * Verifierar: exakta rundresor (inkl. hash-frysta offertversioner),
 * atomära utfärdanden, samtidighet (två parallella utfärdanden → olika
 * nummer via retry), tenantisolering, oföränderlighet genom hela stacken
 * och att databasen äger balanskravet även om domänlagret kringgås.
 *
 * Körs med: npm run test:adapter
 */
import assert from "node:assert/strict";
import { createMigratedPglite } from "./pglite-db";
import { pgliteClient } from "../src/lib/storage/executor";
import {
  createBusinessWithOwner,
  membershipsForUser,
  resolvePublicToken,
  runWithTenant,
  setSqlClientForTests,
} from "../src/lib/storage/adapter-supabase";
import { db, save } from "../src/lib/store";
import { createCustomer, updateCustomer } from "../src/lib/services/customers";
import { completeReminder, createReminder, snoozeReminderBy } from "../src/lib/services/reminders";
import { createQuote, sendQuote, STANDARD_TERMS } from "../src/lib/services/quotes";
import {
  createInvoice,
  sendInvoice,
  markInvoicePaid,
  creditInvoice,
  registerInvoicePayment,
} from "../src/lib/services/invoices";
import { quoteVersionHash } from "../src/lib/hash";
import type { DocLine, Verification } from "../src/lib/types";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name: string, detail: string) {
  failed += 1;
  failures.push(`${name}: ${detail}`);
  console.error(`  ✗ ${name}\n    ${detail}`);
}

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
}

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function lines(): DocLine[] {
  return [
    { id: "l1", kind: "arbete", description: "Snickeri", qty: 10, unit: "tim", unitPrice: 700, vatRate: 25 },
    { id: "l2", kind: "material", description: "Virke", qty: 1, unit: "st", unitPrice: 5000, vatRate: 25 },
  ];
}

async function main() {
  const { db: pg } = await createMigratedPglite();
  setSqlClientForTests(pgliteClient(pg));

  await pg.query(`insert into auth.users (id, email) values ($1, 'a@test.se'), ($2, 'b@test.se')`, [
    USER_A,
    USER_B,
  ]);

  console.log("\nOnboarding + tenantkontext:");
  const bizA = await createBusinessWithOwner({
    userId: USER_A,
    name: "Test Bygg AB",
    orgNumber: "556677-8899",
    email: "info@testbygg.se",
    phone: "070-111 22 33",
  });
  const bizB = await createBusinessWithOwner({
    userId: USER_B,
    name: "Annat Företag AB",
    orgNumber: "556600-1122",
    email: "info@annat.se",
    phone: "",
  });

  await check("medlemskap slås upp per användare", async () => {
    const a = await membershipsForUser(USER_A);
    assert.equal(a.length, 1);
    assert.equal(a[0].businessId, bizA);
    assert.equal(a[0].role, "owner");
  });

  await check("nytt företag laddas tomt med defaults", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      assert.equal(db().customers.length, 0);
      assert.equal(db().settings.name, "Test Bygg AB");
      assert.equal(db().sequences.invoice, 1);
    });
  });

  // Komplettera företagsprofilen så fakturor kan utfärdas.
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    Object.assign(db().settings, {
      vatNumber: "SE556677889901",
      address: "Verkstadsgatan 1",
      postalCode: "118 46",
      city: "Stockholm",
      bankgiro: "5555-6666",
    });
    save();
  });

  console.log("\nKundflöde – exakta rundresor:");
  let customerId = "";
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    const c = createCustomer({
      kind: "privat",
      name: "Anna Andersson",
      email: "anna@example.se",
      phone: "070-555 66 77",
      address: "Björkvägen 12",
      postalCode: "125 30",
      city: "Älvsjö",
    });
    customerId = c.id;
    updateCustomer(c.id, { personalIdentityNumber: "19850515-1234", notes: "Testkund" });
  });

  let customerJson = "";
  await check("kund rundresas fältexakt (inkl. personnummer)", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const c = db().customers.find((x) => x.id === customerId);
      assert.ok(c, "kunden finns efter omladdning");
      assert.equal(c.name, "Anna Andersson");
      assert.equal(c.personalIdentityNumber, "19850515-1234");
      assert.equal(c.notes, "Testkund");
      customerJson = JSON.stringify(c);
    });
  });

  console.log("\nOffertflöde – hash-fryst version:");
  let quoteId = "";
  let hashBefore = "";
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    const quote = createQuote({
      customerId,
      title: "Altanbygge",
      intro: "Hej! Här kommer offerten.",
      lines: lines(),
      rot: { type: "rot" },
      paymentPlan: [],
      paymentTermsDays: 30,
      validUntil: "2099-12-31",
      terms: STANDARD_TERMS,
    });
    quoteId = quote.id;
    sendQuote(quote.id);
    const version = db().quoteVersions.find((v) => v.quoteId === quote.id);
    assert.ok(version);
    hashBefore = quoteVersionHash(version);
  });

  let quoteToken = "";
  await check("offertversion hashar identiskt efter rundresa", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const quote = db().quotes.find((q) => q.id === quoteId);
      assert.ok(quote);
      assert.equal(quote.status, "skickad");
      quoteToken = quote.token;
      const version = db().quoteVersions.find((v) => v.quoteId === quoteId);
      assert.ok(version);
      assert.equal(quoteVersionHash(version), hashBefore);
    });
  });

  await check("publik token → rätt företag och entitet", async () => {
    const hit = await resolvePublicToken("quote", quoteToken);
    assert.ok(hit);
    assert.equal(hit.businessId, bizA);
    assert.equal(hit.entityId, quoteId);
    assert.equal(await resolvePublicToken("quote", "finns-inte"), null);
  });

  console.log("\nFakturaflöde – atomärt utfärdande via RPC:");
  let invoiceId = "";
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    const invoice = createInvoice({ customerId, type: "faktura", lines: lines(), rot: null });
    invoiceId = invoice.id;
  });
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    sendInvoice(invoiceId);
  });

  await check("fakturan fick nummer 1, snapshot och bokföring", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const inv = db().invoices.find((i) => i.id === invoiceId);
      assert.ok(inv);
      assert.equal(inv.number, 1);
      assert.equal(inv.status, "skickad");
      assert.ok(inv.issuedAt, "issuedAt satt");
      assert.ok(inv.issuedSnapshot, "juridisk snapshot finns");
      assert.equal(inv.issuedSnapshot.number, 1);
      assert.ok(inv.ocr.length > 0);
      const ver = db().verifications.find(
        (v) => v.source.type === "kundfaktura" && "id" in v.source && v.source.id === invoiceId
      );
      assert.ok(ver, "utfärdandet bokfördes");
      assert.equal(ver.number, 1);
      assert.equal(db().sequences.invoice, 2);
      assert.equal(db().sequences.verification, 2);
    });
  });

  await check("aktivitet + bokföringsaudit skrevs till audit_log", async () => {
    const rows = await pg.query<{ channel: string; n: number }>(
      `select channel, count(*)::int as n from audit_log where business_id = $1 group by channel`,
      [bizA]
    );
    const byChannel = new Map(rows.rows.map((r) => [r.channel, Number(r.n)]));
    assert.ok((byChannel.get("activity") ?? 0) >= 1, "minst en aktivitetsrad");
    assert.ok((byChannel.get("accounting") ?? 0) >= 1, "minst en bokföringsauditrad (räkenskapsår skapat)");
  });

  await check("snapshotraden i DB är byte-identisk med domänens", async () => {
    const rows = await pg.query<{ snapshot: unknown }>(
      `select snapshot from invoice_issued_snapshots where invoice_id = $1`,
      [invoiceId]
    );
    assert.equal(rows.rows.length, 1);
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const inv = db().invoices.find((i) => i.id === invoiceId);
      assert.ok(inv?.issuedSnapshot);
      assert.deepEqual(rows.rows[0].snapshot, JSON.parse(JSON.stringify(inv.issuedSnapshot)));
    });
  });

  console.log("\nBetalning – match_payment-RPC:");
  if (process.env.DEBUG_GUARD === "1") {
    // Fryst kolumn-för-kolumn-jämförelse: lagrat värde vs vad differn skriver.
    // Skriver ENDAST kolumnnamn + lika/skiljer (inga radvärden).
    const cmp = await pg.query<{ col: string; differs: boolean }>(
      `select 'issue_date' as col, (i.issue_date is distinct from ($2)::timestamptz) as differs from invoices i where i.id = $1
       union all select 'due_date', (i.due_date is distinct from ($3)::timestamptz) from invoices i where i.id = $1
       union all select 'created_at', (i.created_at is distinct from ($4)::timestamptz) from invoices i where i.id = $1
       union all select 'late_interest_rate', (i.late_interest_rate is distinct from ($5)::numeric) from invoices i where i.id = $1
       union all select 'amount_to_pay', (i.amount_to_pay is distinct from ($6)::bigint) from invoices i where i.id = $1
       union all select 'rot_is_sql_null', (i.rot is null) = false from invoices i where i.id = $1
       union all select 'terms_is_sql_null', (i.tax_reduction_terms is null) = false from invoices i where i.id = $1
       union all select 'service_date_null', (i.service_date is null) = false from invoices i where i.id = $1`,
      await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
        const inv = db().invoices.find((i) => i.id === invoiceId);
        if (!inv) throw new Error("saknas");
        return [
          invoiceId,
          inv.issueDate,
          inv.dueDate,
          inv.createdAt,
          inv.lateInterestRate ?? null,
          inv.issuedSnapshot?.totals.toPay ?? 0,
        ];
      })
    );
    console.log("FRYSTA KOLUMNER (differs=true = triggerkandidat):");
    for (const row of cmp.rows) console.log(`  ${row.col}: ${row.differs}`);
    const dates = await pg.query<{ issue_text: string; due_text: string }>(
      `select issue_date::text as issue_text, due_date::text as due_text from invoices where id = $1`,
      [invoiceId]
    );
    const domainDates = await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const inv = db().invoices.find((i) => i.id === invoiceId);
      return { issueDate: inv?.issueDate, dueDate: inv?.dueDate };
    });
    console.log("  lagrat:", JSON.stringify(dates.rows[0]));
    console.log("  domän: ", JSON.stringify(domainDates));
  }
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    markInvoicePaid(invoiceId, { matchedBy: "manuell" });
  });
  await check("betalning + statusövergång + bokföring", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const inv = db().invoices.find((i) => i.id === invoiceId);
      assert.equal(inv?.status, "betald");
      const payment = db().payments.find((p) => p.invoiceId === invoiceId);
      assert.ok(payment, "betalningsrad finns");
      const ver = db().verifications.find(
        (v) => v.source.type === "betalning" && "id" in v.source && v.source.id === payment.id
      );
      assert.ok(ver, "betalningen bokfördes");
    });
  });

  await check("dubbelbetalning stoppas av DB-vakten", async () => {
    await assert.rejects(
      runWithTenant({ businessId: bizA, userId: USER_A, access: "write", retry: false }, () => {
        // Kringgå domänens status-check genom att nollställa i minnet – DB:n
        // ska ändå vägra (statusövergången är vaktad i SQL).
        const inv = db().invoices.find((i) => i.id === invoiceId);
        if (!inv) throw new Error("fakturan saknas");
        inv.status = "skickad";
        inv.paidAt = undefined;
        db().payments.push({
          id: "pay-dubbel",
          invoiceId,
          amount: 1000,
          date: "2099-01-01",
          matchedBy: "manuell",
        });
        save();
      }),
      /payment_conflict|skickad|is not|immutability/
    );
  });

  console.log("\nKreditfaktura – insert-grenen i issue-RPC:n:");
  // Betalda fakturor kan inte krediteras i V1 – kreditera en obetald i stället.
  let creditBaseId = "";
  let creditId = "";
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    creditBaseId = createInvoice({ customerId, type: "faktura", lines: lines(), rot: null }).id;
  });
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    sendInvoice(creditBaseId);
  });
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    const credit = creditInvoice(creditBaseId);
    creditId = credit.id;
  });
  await check("kreditfakturan skapades färdigutfärdad med eget nummer", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const credit = db().invoices.find((i) => i.id === creditId);
      assert.ok(credit);
      assert.equal(credit.type, "kredit");
      assert.equal(credit.number, 3);
      assert.ok(credit.issuedSnapshot);
      const original = db().invoices.find((i) => i.id === creditBaseId);
      assert.equal(original?.status, "krediterad");
    });
  });

  console.log("\nSamtidighet – parallella utfärdanden:");
  let invX = "";
  let invY = "";
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    invX = createInvoice({ customerId, type: "faktura", lines: lines(), rot: null }).id;
    invY = createInvoice({ customerId, type: "faktura", lines: lines(), rot: null }).id;
  });
  await check("två parallella utfärdanden får olika nummer (retry vid konflikt)", async () => {
    await Promise.all([
      runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => sendInvoice(invX)),
      runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => sendInvoice(invY)),
    ]);
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const a = db().invoices.find((i) => i.id === invX);
      const b = db().invoices.find((i) => i.id === invY);
      assert.ok(a?.number && b?.number);
      assert.notEqual(a.number, b.number);
      assert.deepEqual([a.number, b.number].sort(), [4, 5]);
      const verNumbers = db().verifications.map((v) => v.number);
      assert.equal(new Set(verNumbers).size, verNumbers.length, "unika verifikationsnummer");
    });
  });

  console.log("\nDelbetalning – status och belopp genom RPC + adapter:");
  let partialId = "";
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    partialId = createInvoice({ customerId, type: "faktura", lines: lines(), rot: null }).id;
  });
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    sendInvoice(partialId);
  });
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    registerInvoicePayment(partialId, { amount: 400, matchedBy: "manuell" });
  });
  await check("delbetalning rundresar: status delbetald + faktiskt belopp", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const inv = db().invoices.find((i) => i.id === partialId);
      assert.equal(inv?.status, "delbetald");
      assert.equal(inv?.paidAt, undefined, "paidAt sätts först vid full betalning");
      const pays = db().payments.filter((p) => p.invoiceId === partialId);
      assert.equal(pays.length, 1);
      assert.equal(pays[0].amount, 400);
    });
  });
  await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
    const inv = db().invoices.find((i) => i.id === partialId);
    if (!inv) throw new Error("fakturan saknas");
    registerInvoicePayment(partialId, { matchedBy: "manuell" });
  });
  await check("slutbetalningen tar delbetald → betald i databasen", async () => {
    const row = await pg.query<{ status: string; paid_at: string | null }>(
      `select status, paid_at from invoices where id = $1`,
      [partialId]
    );
    assert.equal(row.rows[0].status, "betald");
    assert.ok(row.rows[0].paid_at, "paid_at satt i DB");
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const pays = db().payments.filter((p) => p.invoiceId === partialId);
      // lines(): (10×700 + 5 000) × 1,25 = 15 000 kr att betala.
      assert.equal(pays.reduce((s, p) => s + p.amount, 0), 15_000, "delbetalningarna summerar till fordran");
    });
  });

  console.log("\nOföränderlighet genom hela stacken:");
  await check("radändring på utfärdad faktura stoppas", async () => {
    await assert.rejects(
      runWithTenant({ businessId: bizA, userId: USER_A, access: "write", retry: false }, () => {
        const inv = db().invoices.find((i) => i.id === invX);
        if (!inv) throw new Error("saknas");
        inv.lines[0].description = "HACKAD RAD";
        save();
      }),
      /immutability/
    );
  });

  await check("obalanserad verifikation stoppas av SQL även när domänen kringgås", async () => {
    await assert.rejects(
      runWithTenant({ businessId: bizA, userId: USER_A, access: "write", retry: false }, () => {
        const number = db().sequences.verification;
        db().sequences.verification += 1;
        const ver: Verification = {
          id: "ver-obalans",
          series: "A",
          number,
          date: "2026-06-01",
          description: "Obalanserad",
          entries: [
            { account: 1930, accountName: "Företagskonto", debit: 100, credit: 0 },
            { account: 3001, accountName: "Försäljning", debit: 0, credit: 90 },
          ],
          source: { type: "manuell" },
          confidence: "hog",
          createdBy: "anvandare",
          status: "bokford",
          postedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        db().verifications.push(ver);
        save();
      }),
      /verifikation_obalanserad/
    );
  });

  await check("save() i läskontext kastar", async () => {
    await assert.rejects(
      runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
        db().customers[0].notes = "muterad i läskontext";
        save();
      }),
      /läskontext/
    );
  });

  console.log("\nPåminnelser genom adaptern:");
  let reminderId = "";
  await check("påminnelse skapas, rundresas och skopas per användare", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      const created = createReminder({
        title: "Ringa Anna om altanen",
        when: { kind: "weekday", weekday: "onsdag" },
        related: { type: "customer", id: customerId },
      });
      assert.ok(created.ok, created.ok ? "" : created.error);
      if (created.ok) reminderId = created.reminder.id;
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const r = db().reminders.find((x) => x.id === reminderId);
      assert.ok(r, "påminnelsen finns efter omladdning");
      assert.equal(r.title, "Ringa Anna om altanen");
      assert.equal(r.timezone, "Europe/Stockholm");
      assert.equal(r.hasExplicitTime, false);
      assert.equal(r.status, "PENDING");
      assert.equal(r.userId, USER_A);
      assert.equal(r.relatedEntityType, "customer");
      assert.equal(r.relatedEntityId, customerId);
    });
  });

  await check("snooze + klar rundresas och annan användare i annan tenant ser inget", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      snoozeReminderBy(reminderId, "1h");
      completeReminder(reminderId);
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const r = db().reminders.find((x) => x.id === reminderId);
      assert.ok(r?.snoozedUntil, "snoozedUntil sparad");
      assert.equal(r?.status, "COMPLETED");
      assert.ok(r?.completedAt, "completedAt sparad");
    });
    await runWithTenant({ businessId: bizB, userId: USER_B, access: "read" }, () => {
      assert.equal(db().reminders.length, 0, "B ser inga av A:s påminnelser");
    });
  });

  console.log("\nUppmärksamhetstillstånd genom adaptern:");
  await check("snooze rundresas (upsert, per användare) och döljer raden efter omladdning", async () => {
    const { snoozeAttention, snoozedUntilFor, suppressedActionIds } = await import(
      "../src/lib/services/attention-state"
    );
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      snoozeAttention("invoice-late-test-1", "imorgon");
      // Upsert i samma kontext: uppdaterar raden i stället för dubblett.
      snoozeAttention("invoice-late-test-1", "nasta_vecka");
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const states = db().attentionStates.filter((s) => s.actionId === "invoice-late-test-1");
      assert.equal(states.length, 1, "en rad per (åtgärd, användare)");
      assert.equal(states[0].userId, USER_A);
      assert.ok(states[0].snoozedUntil, "snoozedUntil rundresad");
      assert.ok(suppressedActionIds().has("invoice-late-test-1"), "raden är dold efter omladdning");
      assert.ok(snoozedUntilFor("invoice-late-test-1"), "aktiv snooze-tidpunkt läsbar");
    });
    await runWithTenant({ businessId: bizB, userId: USER_B, access: "read" }, () => {
      assert.equal(db().attentionStates.length, 0, "B ser inga av A:s tillstånd");
    });
  });

  console.log("\nInbox genom adaptern:");
  await check("inbound-slug + inboxpost rundresas och isoleras per tenant", async () => {
    const { ingestInboundMail } = await import("../src/lib/services/inbox");
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      const slug = db().settings.inboundMailSlug;
      assert.ok(slug, "nytt företag fick inbound-slug");
      const result = ingestInboundMail({
        externalId: "adapter-mail-1",
        to: `${slug}@in.driva.se`,
        from: "faktura@byggmax.se",
        subject: "Kvitto",
        text: "Bifogat kvitto",
      });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.created, true);
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const items = db().inboxItems ?? [];
      assert.equal(items.length, 1);
      assert.equal(items[0].externalId, "adapter-mail-1");
    });
    await runWithTenant({ businessId: bizB, userId: USER_B, access: "read" }, () => {
      assert.equal((db().inboxItems ?? []).length, 0, "B ser inga av A:s inboxposter");
    });
    const resolved = await resolvePublicToken("inbound", "");
    assert.equal(resolved, null);
  });

  console.log("\nTenantisolering genom adaptern:");
  await check("företag B ser ingenting av företag A", async () => {
    await runWithTenant({ businessId: bizB, userId: USER_B, access: "read" }, () => {
      assert.equal(db().customers.length, 0);
      assert.equal(db().invoices.length, 0);
      assert.equal(db().quotes.length, 0);
      assert.equal(db().verifications.length, 0);
      assert.equal(db().settings.name, "Annat Företag AB");
    });
  });

  await check("stabil rundresa: två laddningar är JSON-identiska", async () => {
    const first = await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () =>
      JSON.stringify(db())
    );
    const second = await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () =>
      JSON.stringify(db())
    );
    assert.equal(first, second);
    assert.ok(JSON.parse(first).customers[0] && JSON.stringify(JSON.parse(first).customers[0]) === customerJson);
  });

  console.log("\nSeed-/migreringsvägen (importStateIntoBusiness):");
  await check("hela demoseedet importeras och validerar mot databasen", async () => {
    const USER_C = "33333333-3333-4333-8333-333333333333";
    await pg.query(`insert into auth.users (id, email) values ($1, 'c@test.se')`, [USER_C]);
    const { buildSeed } = await import("../src/lib/seed");
    const { importStateIntoBusiness, validateImport } = await import("../src/lib/storage/import-state");
    const seed = buildSeed();
    const bizC = await createBusinessWithOwner({
      userId: USER_C,
      name: seed.settings.name,
      orgNumber: seed.settings.orgNumber,
      email: seed.settings.email,
      phone: seed.settings.phone,
    });
    await importStateIntoBusiness(bizC, USER_C, seed);
    const report = await validateImport(bizC, seed);
    const bad = report.rows.filter((r) => !r.ok);
    assert.equal(
      bad.length,
      0,
      `avvikelser: ${bad.map((r) => `${r.label} ${r.actual}/${r.expected}`).join(", ")}`
    );
  });

  await pg.close();

  console.log(`\n${passed} godkända, ${failed} underkända.`);
  if (failed > 0) {
    console.error("\nUnderkända kontroller:");
    for (const f of failures) console.error(`  – ${f.split("\n")[0]}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
