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
  revokeMembershipRow,
  runWithTenant,
  setSqlClientForTests,
} from "../src/lib/storage/adapter-supabase";
import { db, save } from "../src/lib/store";
import { createCustomer, updateCustomer } from "../src/lib/services/customers";
import { addWorkLocation } from "../src/lib/services/work-locations";
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
import { inboundMailAddress } from "../src/lib/inbox/inbound-mail";
import { updateCompanySettings } from "../src/lib/services/settings";

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

  await check("inbound-slug från företagsnamn, unik utan användarval", async () => {
    const a = await pg.query<{ inbound_mail_slug: string }>(
      `select inbound_mail_slug from business_settings where business_id = $1`,
      [bizA],
    );
    const b = await pg.query<{ inbound_mail_slug: string }>(
      `select inbound_mail_slug from business_settings where business_id = $1`,
      [bizB],
    );
    assert.equal(a.rows[0].inbound_mail_slug, "testbygg");
    assert.equal(b.rows[0].inbound_mail_slug, "annatforetag");

    const USER_C = "44444444-4444-4444-8444-444444444444";
    const USER_D = "55555555-5555-4555-8555-555555555555";
    const USER_E = "66666666-6666-4666-8666-666666666666";
    await pg.query(`insert into auth.users (id, email) values ($1, 'c@test.se'), ($2, 'd@test.se'), ($3, 'e@test.se')`, [
      USER_C,
      USER_D,
      USER_E,
    ]);
    const c1 = await createBusinessWithOwner({
      userId: USER_C,
      name: "Calles Bygg AB",
      orgNumber: "556111-1111",
      email: "info@calles1.se",
      phone: "",
    });
    const c2 = await createBusinessWithOwner({
      userId: USER_D,
      name: "Calles Bygg AB",
      orgNumber: "556222-2222",
      email: "info@calles2.se",
      phone: "",
    });
    const c3 = await createBusinessWithOwner({
      userId: USER_E,
      name: "Calles Bygg AB",
      orgNumber: "556333-3333",
      email: "info@calles3.se",
      phone: "",
    });
    const slugs = await pg.query<{ inbound_mail_slug: string }>(
      `select inbound_mail_slug from business_settings where business_id in ($1, $2, $3) order by inbound_mail_slug`,
      [c1, c2, c3],
    );
    assert.deepEqual(
      slugs.rows.map((r) => r.inbound_mail_slug),
      ["callesbygg", "callesbygg2", "callesbygg3"],
    );
  });

  await check("namnbyte skriver inte om inbound-slug", async () => {
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      const s = db().settings;
      updateCompanySettings({
        name: "Helt Nytt Namn AB",
        orgNumber: s.orgNumber,
        vatNumber: s.vatNumber,
        email: s.email,
        phone: s.phone,
        address: s.address || "Gatan 1",
        postalCode: s.postalCode || "111 22",
        city: s.city || "Stockholm",
        bankgiro: s.bankgiro || "123-4567",
        logoInitials: s.logoInitials,
        paymentTermsDays: s.paymentTermsDays,
        lateInterestRate: s.lateInterestRate,
        quoteValidityDays: s.quoteValidityDays ?? 30,
        defaultVatRate: s.defaultVatRate ?? 25,
        defaultQuoteTerms: s.defaultQuoteTerms,
      });
    });
    const after = await pg.query<{ inbound_mail_slug: string; name: string }>(
      `select inbound_mail_slug, name from business_settings where business_id = $1`,
      [bizA],
    );
    assert.equal(after.rows[0].name, "Helt Nytt Namn AB");
    assert.equal(after.rows[0].inbound_mail_slug, "testbygg");
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
    // ROT-utskick kräver en bostad på dokumentet; en enda bostad auto-väljs.
    addWorkLocation(c.id, {
      label: "Villan",
      address: "Björkvägen 12",
      postalCode: "125 30",
      city: "Älvsjö",
      propertyType: "smahus",
      propertyDesignation: "Älvsjö Björken 12",
    });
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
        to: inboundMailAddress(slug),
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

  console.log("\nKontoregistret genom adaptern:");
  await check("eget konto rundresas, blir bokföringsbart och isoleras per tenant", async () => {
    const { addCustomAccount, chartAccount } = await import("../src/lib/accounting/chart");
    const { postVerification } = await import("../src/lib/accounting/engine");
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      addCustomAccount({ number: 4011, name: "Inköp virke" });
      save();
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const account = chartAccount(4011);
      assert.deepEqual(account, {
        number: 4011,
        name: "Inköp virke",
        type: "kostnad",
        section: "ravaror_och_fornodenheter",
        custom: true,
      });
      // Standardplanen ligger i koden och lagras inte per företag.
      assert.equal((db().chartAccounts ?? []).length, 1, "bara avvikelsen lagras");
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      postVerification({
        date: "2026-03-10",
        description: "Virke från adaptertestet",
        entries: [
          { account: 4011, debit: 400 },
          { account: 1930, credit: 400 },
        ],
        source: { type: "manuell" },
        createdBy: "anvandare",
      });
      save();
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const posted = db().verifications.find((v) => v.description === "Virke från adaptertestet");
      assert.ok(posted, "verifikationen på det egna kontot sparades");
      assert.equal(posted.entries[0].accountName, "Inköp virke");
    });
    await runWithTenant({ businessId: bizB, userId: USER_B, access: "read" }, () => {
      assert.equal((db().chartAccounts ?? []).length, 0, "B ser inte A:s egna konton");
      assert.equal(chartAccount(4011), undefined, "B kan inte bokföra på A:s konto");
    });
  });

  console.log("\nManuellt verifikat genom adaptern:");
  await check("serie M, handelsdatum och bilaga rundresar och delar inte räknare med serie A", async () => {
    const { postManualVerification } = await import("../src/lib/services/manual-verification");
    const { postVerification } = await import("../src/lib/accounting/engine");
    let manualId = "";
    let autoNumberBefore = 0;
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      autoNumberBefore = db().sequences.verification;
      const v = postManualVerification({
        date: "2026-04-02",
        transactionDate: "2026-03-28",
        description: "Manuellt verifikat genom adaptern",
        explanation: "Underlaget är hyresavin.",
        lines: [
          { account: 5010, debit: 12_000, note: "Mars" },
          { account: 1930, credit: 12_000 },
        ],
        attachment: {
          filename: "hyresavi.pdf",
          contentType: "application/pdf",
          sizeBytes: 8,
          contentBase64: Buffer.from("underlag").toString("base64"),
        },
      });
      manualId = v.id;
      save();
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const posted = db().verifications.find((v) => v.id === manualId);
      assert.ok(posted, "det manuella verifikatet sparades");
      assert.equal(posted.series, "M");
      assert.equal(posted.number, 1, "serie M börjar på sitt eget nummer");
      assert.equal(posted.transactionDate, "2026-03-28");
      assert.equal(posted.entries[0].note, "Mars");
      assert.equal(posted.attachment?.filename, "hyresavi.pdf");
      assert.equal(posted.attachment?.sizeBytes, 8);
      assert.equal(
        Buffer.from(posted.attachment?.contentBase64 ?? "", "base64").toString(),
        "underlag",
        "underlaget läses tillbaka byte för byte"
      );
      assert.equal(db().sequences.verificationSeries?.M, 2);
      assert.equal(db().sequences.verification, autoNumberBefore, "serie A rörde sig inte");
    });
    // Nästa automatiska bokning tar det A-nummer som stod på tur.
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      const auto = postVerification({
        date: "2026-04-03",
        description: "Automatik efter manuellt verifikat",
        entries: [
          { account: 5010, debit: 100 },
          { account: 1930, credit: 100 },
        ],
        source: { type: "manuell" },
        createdBy: "auto",
      });
      assert.equal(auto.series, "A");
      assert.equal(auto.number, autoNumberBefore);
      save();
    });
    await runWithTenant({ businessId: bizB, userId: USER_B, access: "read" }, () => {
      assert.equal(
        db().verifications.some((v) => v.series === "M"),
        false,
        "B ser inte A:s manuella verifikat"
      );
    });
  });

  console.log("\nKvittofil genom adaptern:");
  await check("kvitto med inline-fil rundresas (content_base64, content_type, size_bytes)", async () => {
    const { uploadReceiptForExpense } = await import("../src/lib/services/expenses");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    let receiptId = "";
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      db().expenses.push({
        id: "adapter-exp-1",
        date: "2026-08-01",
        supplier: "Bauhaus",
        amount: 875,
        vatAmount: 175,
        category: "",
        status: "saknar_kvitto",
        createdAt: new Date().toISOString(),
      });
      save();
      const { receipt } = uploadReceiptForExpense("adapter-exp-1", "kvitto.png", "uppladdning", {
        contentType: "image/png",
        sizeBytes: png.length,
        contentBase64: png.toString("base64"),
      });
      receiptId = receipt.id;
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const receipt = db().receipts.find((r) => r.id === receiptId);
      assert.ok(receipt, "kvittoraden laddas tillbaka");
      assert.equal(receipt.contentType, "image/png");
      assert.equal(receipt.sizeBytes, png.length);
      assert.equal(receipt.contentBase64, png.toString("base64"));
      assert.equal(receipt.storagePath, undefined);
    });
  });

  console.log("\nOmvänd byggmoms genom adaptern:");
  await check("markering på kunden och fryst markering på fakturan rundresar", async () => {
    const { createCustomer } = await import("../src/lib/services/customers");
    const { createInvoice, issueInvoice } = await import("../src/lib/services/invoices");
    let customerId = "";
    let invoiceId = "";
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      const customer = createCustomer({
        kind: "foretag",
        name: "Adapter Bygg AB",
        email: "faktura@adapterbygg.se",
        orgNumber: "556677-8899",
        address: "Byggvägen 3",
        postalCode: "121 45",
        city: "Johanneshov",
        reverseChargeConstruction: true,
      });
      customerId = customer.id;
      const invoice = createInvoice({
        customerId: customer.id,
        type: "faktura",
        lines: [
          {
            id: "adapter-bygg-rad",
            kind: "arbete",
            description: "Byggtjänst",
            qty: 1,
            unit: "st",
            unitPrice: 40_000,
            vatRate: 25,
          },
        ],
        rot: null,
      });
      invoiceId = issueInvoice(invoice.id).id;
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const customer = db().customers.find((c) => c.id === customerId);
      assert.equal(customer?.reverseChargeConstruction, true, "markeringen på kunden rundresar");
      const invoice = db().invoices.find((i) => i.id === invoiceId);
      assert.equal(invoice?.reverseCharge, true, "markeringen på fakturan rundresar");
      assert.deepEqual(invoice?.lines.map((l) => l.vatRate), [0], "raderna är momsfria");
      assert.equal(
        invoice?.issuedSnapshot?.buyer.vatNumber,
        "SE556677889901",
        "köparens momsnummer ligger fryst i snapshoten"
      );
      const ver = db().verifications.find((v) => v.source?.type === "kundfaktura" && v.source.id === invoiceId);
      assert.ok(ver, "verifikationen laddas tillbaka");
      assert.equal(ver.entries.find((e) => e.account === 3231)?.credit, 40_000);
    });
  });

  console.log("\nMomsperiodicitet genom adaptern:");
  await check("valet rundresar och styr perioderna", async () => {
    const { setVatPeriodicity, vatPeriods } = await import("../src/lib/accounting/vat");
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      assert.equal(vatPeriods().length, 4, "kvartal är default");
      setVatPeriodicity("manad", "anvandare");
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      assert.equal(db().settings.vatPeriodicity, "manad", "valet rundresar");
      assert.equal(vatPeriods().length, 12, "tolv perioder efter bytet");
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      setVatPeriodicity("kvartal", "anvandare");
    });
  });

  console.log("\nSkattekontot genom adaptern:");
  await check("kontering rundresar och saldot härleds ur huvudboken", async () => {
    const { bookFSkatt, taxAccountLedger, SKATTEKONTO, F_SKATT } = await import(
      "../src/lib/accounting/tax-account"
    );
    const { accountBalance } = await import("../src/lib/accounting/ledger");
    const { todayDate } = await import("../src/lib/accounting/fiscal");
    const month = `${new Date().getUTCFullYear()}-02`;
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      db().settings.fSkattPerMonth = 4_000;
      bookFSkatt(month, "anvandare");
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const today = todayDate();
      const ledger = taxAccountLedger(today);
      const row = ledger.rows.find((r) => r.description === `F-skatt ${month}`);
      assert.ok(row, "F-skattraden finns i skattekontots huvudbok efter rundresa");
      assert.equal(row.amount, -4_000, "F-skatten drar från kontot");
      assert.equal(row.kind, "f_skatt", "källan känns igen efter rundresa");
      assert.equal(ledger.balance, accountBalance(SKATTEKONTO, today), "saldot är huvudbokens");
      assert.equal(accountBalance(F_SKATT, today), 4_000, "2518 debiteras");
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      const again = bookFSkatt(month, "anvandare");
      assert.ok(again, "samma månad är idempotent även genom adaptern");
      assert.equal(
        db().verifications.filter((v) => v.description === `F-skatt ${month}`).length,
        1,
        "ingen dubblett"
      );
    });
    await runWithTenant({ businessId: bizB, userId: USER_B, access: "read" }, () => {
      assert.equal(taxAccountLedger(todayDate()).rows.length, 0, "B ser inget av A:s skattekonto");
    });
  });

  console.log("\nUppdragsposter genom adaptern:");
  await check("tidregistrering rundresas och isoleras per tenant", async () => {
    const { createJob } = await import("../src/lib/services/jobs");
    const { registerJobTime, actualEntries } = await import("../src/lib/services/job-work");
    let jobId = "";
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      const customer = db().customers[0];
      assert.ok(customer, "företag A har en kund efter tidigare steg");
      const job = createJob({ customerId: customer.id, title: "Adapter-tid" });
      jobId = job.id;
      registerJobTime(job.id, { hours: 2, unitPrice: 500, description: "Adapter" });
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      const entries = actualEntries(jobId);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].qty, 2);
    });
    await runWithTenant({ businessId: bizB, userId: USER_B, access: "read" }, () => {
      assert.equal((db().jobWorkEntries ?? []).length, 0, "B ser inga av A:s uppdragsposter");
    });
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

  console.log("\nSeed-/migreringsvägen (importStateIntoBusiness) – seedar demoföretaget:");
  // Exempeldatats id:n är fasta (cust-anna, …) – precis som i en riktig databas
  // kan seedet därför bara importeras till ETT företag. Företaget som skapas
  // här är den publika demons (is_demo) och används av demokontrollerna nedan.
  const USER_DEMO = "33333333-3333-4333-8333-333333333333";
  const { demoSeedFor, resetDemoBusinessToSeed } = await import("../src/lib/storage/demo-reset");
  const { importStateIntoBusiness, validateImport } = await import("../src/lib/storage/import-state");
  await pg.query(`insert into auth.users (id, email) values ($1, 'demo@driva.test')`, [USER_DEMO]);
  let bizDemo = "";
  await check("hela demoseedet importeras och validerar mot databasen", async () => {
    const { buildSeed } = await import("../src/lib/seed");
    const settings = buildSeed().settings;
    bizDemo = await createBusinessWithOwner({
      userId: USER_DEMO,
      name: settings.name,
      orgNumber: settings.orgNumber,
      email: settings.email,
      phone: settings.phone,
      isDemo: true,
    });
    // Samma seedobjekt för import och validering – buildSeed är datumrelativ,
    // så två anrop ger olika tidsstämplar i de hash-frysta ytorna.
    const slugRow = await pg.query<{ inbound_mail_slug: string }>(
      `select inbound_mail_slug from business_settings where business_id = $1`,
      [bizDemo],
    );
    const seed = demoSeedFor(bizDemo, slugRow.rows[0].inbound_mail_slug);
    await importStateIntoBusiness(bizDemo, USER_DEMO, seed);
    const report = await validateImport(bizDemo, seed);
    const bad = report.rows.filter((r) => !r.ok);
    assert.equal(
      bad.length,
      0,
      `avvikelser: ${bad.map((r) => `${r.label} ${r.actual}/${r.expected}`).join(", ")}`
    );
  });

  console.log("\nDemoföretaget – fryst flagga och säker återställning:");

  await check("is_demo är fryst – varken demo- eller riktiga företag kan flippas", async () => {
    await assert.rejects(pg.query(`update businesses set is_demo = false where id = $1`, [bizDemo]), /immutability/);
    await assert.rejects(pg.query(`update businesses set is_demo = true where id = $1`, [bizA]), /immutability/);
  });

  await check("meta.demo speglar kolumnen och kan inte förfalskas via jsonb", async () => {
    await runWithTenant({ businessId: bizDemo, userId: USER_DEMO, access: "read" }, () => {
      assert.equal(db().meta.demo, true, "demoföretaget laddas med meta.demo");
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "write" }, () => {
      assert.equal(db().meta.demo, undefined);
      db().meta.demo = true;
      save();
    });
    await runWithTenant({ businessId: bizA, userId: USER_A, access: "read" }, () => {
      assert.equal(db().meta.demo, undefined, "riktiga företag kan aldrig flagga om sig till demo");
    });
    const metaRow = await pg.query<{ meta: Record<string, unknown> }>(
      `select meta from businesses where id = $1`,
      [bizA]
    );
    assert.equal("demo" in (metaRow.rows[0].meta ?? {}), false, "demo-nyckeln skrivs aldrig till jsonb-kolumnen");
  });

  // Utfärda en faktura i demoföretaget – oföränderligheten ska gälla precis
  // som för riktiga företag så länge ingen återställning pågår.
  let demoInvoiceId = "";
  await runWithTenant({ businessId: bizDemo, userId: USER_DEMO, access: "write" }, () => {
    demoInvoiceId = createInvoice({ customerId: db().customers[0].id, type: "faktura", lines: lines(), rot: null }).id;
  });
  await runWithTenant({ businessId: bizDemo, userId: USER_DEMO, access: "write" }, () => {
    sendInvoice(demoInvoiceId);
  });

  await check("demoföretaget är lika oföränderligt som andra utanför återställningen", async () => {
    await assert.rejects(pg.query(`delete from invoices where id = $1`, [demoInvoiceId]), /immutability/);
    await assert.rejects(pg.query(`delete from verifications where business_id = $1`, [bizDemo]), /immutability/);
  });

  await check("återställningen vägrar riktiga företag i både SQL- och domänlagret", async () => {
    await assert.rejects(pg.query(`select app.reset_demo_business($1, $2)`, [bizA, USER_A]), /inte ett demoföretag/);
    await assert.rejects(resetDemoBusinessToSeed(bizA, USER_A), /Endast demoföretaget/);
  });

  // Simulera en accepterad demo-inbjudan: en främmande konsult i demoföretaget.
  await pg.query(
    `insert into business_memberships (business_id, user_id, role, accepted_at)
     values ($1, $2, 'accounting_consultant', now())`,
    [bizDemo, USER_B]
  );

  await check("SQL-återställningen tömmer varje företagsskopad tabell", async () => {
    await pg.query(`select app.reset_demo_business($1, $2)`, [bizDemo, USER_DEMO]);
    // Alla tabeller med business_id – fångar även tabeller som läggs till
    // senare men glöms bort i reset-funktionens raderingslista.
    const tables = await pg.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'public' and c.relkind = 'r'
          and a.attname = 'business_id' and not a.attisdropped
        order by c.relname`
    );
    // Företagsraden, profilen (stabil inkommande-slug), medlemskapen och
    // nummerserierna överlever – exempeldatat spelas upp igen efteråt.
    const kept = new Set(["business_memberships", "business_sequences", "business_settings"]);
    for (const { relname } of tables.rows) {
      if (kept.has(relname)) continue;
      const count = await pg.query<{ n: number }>(
        `select count(*)::int as n from ${relname} where business_id = $1`,
        [bizDemo]
      );
      assert.equal(Number(count.rows[0].n), 0, `${relname} ska vara tom efter återställning`);
    }
    const seqs = await pg.query<{ quote: number; invoice: number; verification: number }>(
      `select quote, invoice, verification from business_sequences where business_id = $1`,
      [bizDemo]
    );
    assert.deepEqual(
      { quote: Number(seqs.rows[0].quote), invoice: Number(seqs.rows[0].invoice), verification: Number(seqs.rows[0].verification) },
      { quote: 1, invoice: 1, verification: 1 }
    );
  });

  await check("återställningen behåller demo-ägaren och återkallar gästmedlemskap", async () => {
    const rows = await pg.query<{ user_id: string; revoked_at: string | null }>(
      `select user_id, revoked_at from business_memberships where business_id = $1`,
      [bizDemo]
    );
    const owner = rows.rows.find((r) => r.user_id === USER_DEMO);
    const guest = rows.rows.find((r) => r.user_id === USER_B);
    assert.ok(owner && owner.revoked_at === null, "demo-ägarens medlemskap är kvar");
    assert.ok(guest?.revoked_at, "den inbjudna konsultens medlemskap återkallades");
    const visible = await membershipsForUser(USER_B);
    assert.deepEqual(
      visible.map((m) => m.businessId),
      [bizB],
      "USER_B ser inte längre demoföretaget"
    );
  });

  await check("återställningen spelar upp exempeldatat och mejladressen är stabil", async () => {
    const slugBefore = await pg.query<{ inbound_mail_slug: string }>(
      `select inbound_mail_slug from business_settings where business_id = $1`,
      [bizDemo]
    );
    await resetDemoBusinessToSeed(bizDemo, USER_DEMO);
    // Återställningen bygger sitt eget (datumrelativa) seedobjekt – jämför
    // antal per samling här; värde-exaktheten bevisas i importkontrollen ovan.
    const report = await validateImport(bizDemo, demoSeedFor(bizDemo, slugBefore.rows[0].inbound_mail_slug));
    const exactness = new Set([
      "offertversioner värde-exakta",
      "offertversioner hashar identiskt (signaturer intakta)",
      "fakturasnapshots värde-exakta",
    ]);
    const bad = report.rows.filter((r) => !r.ok && !exactness.has(r.label));
    assert.equal(
      bad.length,
      0,
      `avvikelser: ${bad.map((r) => `${r.label} ${r.actual}/${r.expected}`).join(", ")}`
    );
    const slugAfter = await pg.query<{ inbound_mail_slug: string }>(
      `select inbound_mail_slug from business_settings where business_id = $1`,
      [bizDemo]
    );
    assert.equal(slugAfter.rows[0].inbound_mail_slug, slugBefore.rows[0].inbound_mail_slug);
  });

  await check("demon fungerar som vanligt efter återställning (nästa nummer ur seedens serie)", async () => {
    const seed = demoSeedFor(bizDemo);
    let freshInvoiceId = "";
    await runWithTenant({ businessId: bizDemo, userId: USER_DEMO, access: "write" }, () => {
      freshInvoiceId = createInvoice({ customerId: db().customers[0].id, type: "faktura", lines: lines(), rot: null }).id;
    });
    await runWithTenant({ businessId: bizDemo, userId: USER_DEMO, access: "write" }, () => {
      sendInvoice(freshInvoiceId);
    });
    await runWithTenant({ businessId: bizDemo, userId: USER_DEMO, access: "read" }, () => {
      assert.equal(db().invoices.find((i) => i.id === freshInvoiceId)?.number, seed.sequences.invoice);
    });
  });

  await check("samarbetsvägen kan aldrig återkalla ett ägarmedlemskap", async () => {
    await revokeMembershipRow(bizDemo, USER_DEMO);
    const row = await pg.query<{ revoked_at: string | null }>(
      `select revoked_at from business_memberships where business_id = $1 and user_id = $2`,
      [bizDemo, USER_DEMO]
    );
    assert.equal(row.rows[0].revoked_at, null, "ägarrollen omfattas inte av revoke-vägen");
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
