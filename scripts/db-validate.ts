/**
 * Validerar Supabase-migrationerna mot en riktig Postgres (PGlite/WASM) –
 * ingen Docker eller Supabase-stack krävs. Detta är en VALIDERINGSHARNESS,
 * inte en ersättning för `supabase start`:
 *
 *   * auth-/storage-schemana och rollerna anon/authenticated/service_role
 *     shimmas minimalt (de ägs av Supabase i en riktig stack).
 *   * Alla migrationer i supabase/migrations/ appliceras i ordning.
 *   * Därefter verifieras invarianterna som databasen ska äga:
 *     RLS-tenantisolering, CAS-nummerserier, balanskrav, oföränderlighet.
 *
 * Körs med: npm run db:validate
 */
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedPglite } from "./pglite-db";

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

async function expectOk(db: PGlite, name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function expectError(db: PGlite, name: string, needle: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    fail(name, `förväntade fel som innehåller "${needle}" men anropet lyckades`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes(needle)) ok(name);
    else fail(name, `fel utan "${needle}": ${msg}`);
  }
}

async function rows<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query<T>(sql, params);
  return res.rows;
}

async function main() {
  // Shims + samtliga migrationer (delas med adapter-validate).
  const { db, migrationFiles } = await createMigratedPglite();
  console.log(`Applicerade ${migrationFiles.length} migrationer:`);
  for (const file of migrationFiles) console.log(`  ✓ ${file}`);

  // Supabase ger anon/authenticated tabellrättigheter via default privileges –
  // spegla det här så att RLS (inte saknade grants) är det som testas.
  await db.exec(`
    grant usage on schema public, app to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant select on all tables in schema public to anon;
  `);

  // ------------------------------------------------------------------
  // Fixturer (som superuser – förbi RLS, precis som seed via service role).
  // ------------------------------------------------------------------
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const USER_A = "11111111-1111-4111-8111-111111111111";
  const USER_B = "22222222-2222-4222-8222-222222222222";

  await db.exec(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'a@example.com'),
      ('${USER_B}', 'b@example.com');
    insert into public.businesses (id, name, org_number) values
      ('${A}', 'Företag A', '556000-0001'),
      ('${B}', 'Företag B', '556000-0002');
    insert into public.business_memberships (business_id, user_id, role) values
      ('${A}', '${USER_A}', 'owner'),
      ('${B}', '${USER_B}', 'owner');
    insert into public.business_settings (business_id, name) values
      ('${A}', 'Företag A'), ('${B}', 'Företag B');
    insert into public.business_sequences (business_id, quote, invoice, verification) values
      ('${A}', 1, 10, 1), ('${B}', 1, 1, 1);
    insert into public.customers (id, business_id, kind, name, email, phone, notes, created_at) values
      ('cust-a1', '${A}', 'privat', 'Anna A', 'a1@x.se', '070', '', now()),
      ('cust-b1', '${B}', 'privat', 'Bertil B', 'b1@x.se', '070', '', now());
  `);

  const asApp = async (business: string | null) => {
    await db.exec(`reset role; set role driva_app;`);
    await db.query(`select set_config('app.business_id', $1, false)`, [business ?? ""]);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  };
  const asAuthenticated = async (userId: string | null) => {
    await db.exec(`reset role; set role authenticated;`);
    await db.query(`select set_config('app.business_id', '', false)`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  };
  const asSuperuser = async () => {
    await db.exec(`reset role;`);
    await db.query(`select set_config('app.business_id', '', false)`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  };

  // ------------------------------------------------------------------
  // 1. RLS: tenantisolering
  // ------------------------------------------------------------------
  console.log("\nRLS – tenantisolering:");

  await asApp(A);
  {
    const r = await rows(db, `select id from public.customers order by id`);
    if (r.length === 1 && (r[0] as { id: string }).id === "cust-a1") ok("driva_app med kontext A ser endast A:s kunder");
    else fail("driva_app med kontext A ser endast A:s kunder", JSON.stringify(r));
  }
  {
    const r = await rows(db, `select id from public.customers where id = 'cust-b1'`);
    if (r.length === 0) ok("driva_app med kontext A kan inte läsa B:s kund (IDOR)");
    else fail("driva_app med kontext A kan inte läsa B:s kund (IDOR)", JSON.stringify(r));
  }
  await expectError(db, "driva_app med kontext A kan inte skriva kund i B", "row-level security", () =>
    db.query(
      `insert into public.customers (id, business_id, kind, name, email, phone, notes, created_at)
       values ('cust-b2', $1, 'privat', 'Intrång', '', '', '', now())`,
      [B]
    )
  );
  {
    await asApp(null);
    const r = await rows(db, `select id from public.customers`);
    if (r.length === 0) ok("driva_app utan tenantkontext ser ingenting");
    else fail("driva_app utan tenantkontext ser ingenting", JSON.stringify(r));
  }
  {
    await asAuthenticated(USER_A);
    const r = await rows(db, `select id from public.customers`);
    if (r.length === 1 && (r[0] as { id: string }).id === "cust-a1")
      ok("authenticated (JWT medlem i A) ser endast A:s kunder");
    else fail("authenticated (JWT medlem i A) ser endast A:s kunder", JSON.stringify(r));
  }
  {
    await asAuthenticated(null);
    const r = await rows(db, `select id from public.customers`);
    if (r.length === 0) ok("authenticated utan medlemskap ser ingenting");
    else fail("authenticated utan medlemskap ser ingenting", JSON.stringify(r));
  }
  {
    await db.exec(`reset role; set role anon;`);
    const r = await rows(db, `select id from public.customers`);
    if (r.length === 0) ok("anon ser ingenting");
    else fail("anon ser ingenting", JSON.stringify(r));
    await asSuperuser();
  }

  // ------------------------------------------------------------------
  // 1b. Påminnelser: tenantisolering + mjuk borttagning (ingen DELETE-väg)
  // ------------------------------------------------------------------
  console.log("\nPåminnelser – RLS och mjuk borttagning:");

  await asSuperuser();
  await db.exec(`
    insert into public.reminders (id, business_id, user_id, title, due_at, timezone, has_explicit_time, status, source) values
      ('rem-a1', '${A}', '${USER_A}', 'Ringa Göran', now() + interval '1 day', 'Europe/Stockholm', false, 'PENDING', 'assistant'),
      ('rem-b1', '${B}', '${USER_B}', 'Följa upp offert', now() + interval '2 days', 'Europe/Stockholm', true, 'PENDING', 'assistant');
  `);

  await asApp(A);
  {
    const r = await rows(db, `select id from public.reminders order by id`);
    if (r.length === 1 && (r[0] as { id: string }).id === "rem-a1") ok("driva_app med kontext A ser endast A:s påminnelser");
    else fail("driva_app med kontext A ser endast A:s påminnelser", JSON.stringify(r));
  }
  await expectError(db, "driva_app med kontext A kan inte skapa påminnelse i B", "row-level security", () =>
    db.query(
      `insert into public.reminders (id, business_id, title, due_at) values ('rem-b2', $1, 'Intrång', now())`,
      [B]
    )
  );
  {
    const r = await db.query(`update public.reminders set status = 'COMPLETED', completed_at = now() where id = 'rem-b1'`);
    if ((r as { affectedRows?: number }).affectedRows === 0) ok("driva_app med kontext A kan inte uppdatera B:s påminnelse (IDOR)");
    else fail("driva_app med kontext A kan inte uppdatera B:s påminnelse (IDOR)", JSON.stringify(r));
  }
  await expectError(db, "DELETE på påminnelser nekas – borttagning är mjuk (DISMISSED)", "denied", () =>
    db.query(`delete from public.reminders where id = 'rem-a1'`)
  );
  await expectOk(db, "mjuk borttagning (status DISMISSED) tillåts i egen tenant", () =>
    db.query(`update public.reminders set status = 'DISMISSED' where id = 'rem-a1'`)
  );
  await expectError(db, "ogiltig status stoppas av check-villkoret", "check", () =>
    db.query(`update public.reminders set status = 'DUE' where id = 'rem-a1'`)
  );
  await expectError(db, "halv entitetskoppling stoppas (typ utan id)", "reminders_related_pair", () =>
    db.query(
      `insert into public.reminders (id, business_id, title, due_at, related_entity_type)
       values ('rem-a2', $1, 'Halv koppling', now(), 'customer')`,
      [A]
    )
  );
  {
    await asAuthenticated(USER_B);
    const r = await rows(db, `select id from public.reminders`);
    if (r.length === 1 && (r[0] as { id: string }).id === "rem-b1")
      ok("authenticated (JWT medlem i B) ser endast B:s påminnelser");
    else fail("authenticated (JWT medlem i B) ser endast B:s påminnelser", JSON.stringify(r));
  }
  {
    await db.exec(`reset role; set role anon;`);
    const r = await rows(db, `select id from public.reminders`);
    if (r.length === 0) ok("anon ser inga påminnelser");
    else fail("anon ser inga påminnelser", JSON.stringify(r));
    await asSuperuser();
  }
  // Städa så att övriga sektioner ser samma utgångsläge som tidigare.
  await db.exec(`delete from public.reminders where id in ('rem-a1', 'rem-b1');`);

  // ------------------------------------------------------------------
  // 1c. Uppmärksamhetstillstånd: RLS, null-säker upsertunikhet, ingen DELETE
  // ------------------------------------------------------------------
  console.log("\nUppmärksamhetstillstånd – RLS, unikhet, mjuk filosofi:");

  await asSuperuser();
  await db.exec(`
    insert into public.attention_states (id, business_id, user_id, action_id, snoozed_until) values
      ('att-a1', '${A}', '${USER_A}', 'invoice-late-inv-1', now() + interval '1 day'),
      ('att-a2', '${A}', null, 'quote-wait-q-1', now() + interval '2 days'),
      ('att-b1', '${B}', '${USER_B}', 'invoice-late-inv-9', now() + interval '1 day');
  `);

  await asApp(A);
  {
    const r = await rows(db, `select id from public.attention_states order by id`);
    if (r.length === 2 && (r[0] as { id: string }).id === "att-a1" && (r[1] as { id: string }).id === "att-a2")
      ok("driva_app med kontext A ser endast A:s uppmärksamhetstillstånd");
    else fail("driva_app med kontext A ser endast A:s uppmärksamhetstillstånd", JSON.stringify(r));
  }
  await expectError(db, "driva_app med kontext A kan inte snooza i B", "row-level security", () =>
    db.query(
      `insert into public.attention_states (id, business_id, action_id, snoozed_until)
       values ('att-b2', $1, 'intrång', now())`,
      [B]
    )
  );
  {
    const r = await db.query(`update public.attention_states set snoozed_until = now() where id = 'att-b1'`);
    if ((r as { affectedRows?: number }).affectedRows === 0) ok("driva_app med kontext A kan inte röra B:s tillstånd (IDOR)");
    else fail("driva_app med kontext A kan inte röra B:s tillstånd (IDOR)", JSON.stringify(r));
  }
  await expectError(db, "DELETE på attention_states nekas – tillstånd skrivs om, aldrig bort", "denied", () =>
    db.query(`delete from public.attention_states where id = 'att-a1'`)
  );
  await expectOk(db, "uppdatering (ny snooze-tid) tillåts i egen tenant", () =>
    db.query(`update public.attention_states set snoozed_until = now() + interval '3 days' where id = 'att-a1'`)
  );
  // Upsertunikheten: en rad per (företag, åtgärd, användare) – null-säkert.
  await expectError(db, "dubblettrad per (företag, åtgärd, användare) stoppas", "attention_states_scope_uq", () =>
    db.query(
      `insert into public.attention_states (id, business_id, user_id, action_id) values ('att-a1b', $1, $2, 'invoice-late-inv-1')`,
      [A, USER_A]
    )
  );
  await expectError(db, "dubblettrad med null-användare stoppas (coalesce-unikhet)", "attention_states_scope_uq", () =>
    db.query(
      `insert into public.attention_states (id, business_id, action_id) values ('att-a2b', $1, 'quote-wait-q-1')`,
      [A]
    )
  );
  {
    await asAuthenticated(USER_B);
    const r = await rows(db, `select id from public.attention_states`);
    if (r.length === 1 && (r[0] as { id: string }).id === "att-b1")
      ok("authenticated (JWT medlem i B) ser endast B:s tillstånd");
    else fail("authenticated (JWT medlem i B) ser endast B:s tillstånd", JSON.stringify(r));
  }
  {
    await db.exec(`reset role; set role anon;`);
    const r = await rows(db, `select id from public.attention_states`);
    if (r.length === 0) ok("anon ser inga uppmärksamhetstillstånd");
    else fail("anon ser inga uppmärksamhetstillstånd", JSON.stringify(r));
    await asSuperuser();
  }
  await db.exec(`delete from public.attention_states where id in ('att-a1', 'att-a2', 'att-b1');`);

  // ------------------------------------------------------------------
  // 1d. Inbox: tenantisolering, dedup external_id, ingen DELETE
  // ------------------------------------------------------------------
  console.log("\nInbox – RLS, dedup, mjuk status:");

  await asSuperuser();
  await db.exec(`
    insert into public.inbox_items (id, business_id, status, external_id, from_address, to_address, subject, text_body) values
      ('in-a1', '${A}', 'ny', 'ext-a-1', 'a@x.se', 'slug-a@in.ferva.se', 'Kvitto A', 'text'),
      ('in-b1', '${B}', 'ny', 'ext-b-1', 'b@x.se', 'slug-b@in.ferva.se', 'Kvitto B', 'text');
  `);

  await asApp(A);
  {
    const r = await rows(db, `select id from public.inbox_items order by id`);
    if (r.length === 1 && (r[0] as { id: string }).id === "in-a1") ok("driva_app med kontext A ser endast A:s inbox");
    else fail("driva_app med kontext A ser endast A:s inbox", JSON.stringify(r));
  }
  await expectError(db, "driva_app med kontext A kan inte skapa inboxpost i B", "row-level security", () =>
    db.query(
      `insert into public.inbox_items (id, business_id, from_address, to_address, subject) values ('in-b2', $1, 'x@x.se', 'y@y.se', 'Intrång')`,
      [B]
    )
  );
  {
    const r = await db.query(`update public.inbox_items set status = 'behandlad' where id = 'in-b1'`);
    if ((r as { affectedRows?: number }).affectedRows === 0) ok("driva_app med kontext A kan inte uppdatera B:s inbox (IDOR)");
    else fail("driva_app med kontext A kan inte uppdatera B:s inbox (IDOR)", JSON.stringify(r));
  }
  await expectError(db, "DELETE på inbox_items nekas – finansiell inkommande raderas inte", "denied", () =>
    db.query(`delete from public.inbox_items where id = 'in-a1'`)
  );
  await expectError(db, "samma external_id hos samma företag stoppas (dedup)", "inbox_items_external_uq", () =>
    db.query(
      `insert into public.inbox_items (id, business_id, external_id, from_address, to_address, subject)
       values ('in-a1-dup', $1, 'ext-a-1', 'a@x.se', 'slug-a@in.ferva.se', 'Dubblett')`,
      [A]
    )
  );
  await expectOk(db, "samma external_id hos annat företag tillåts", () =>
    db.query(
      `insert into public.inbox_items (id, business_id, external_id, from_address, to_address, subject)
       values ('in-a-same-ext', $1, 'ext-b-1', 'a@x.se', 'slug-a@in.ferva.se', 'Annan tenant')`,
      [A]
    )
  );
  {
    const r = await rows<{ inbound_mail_slug: string }>(db, `select inbound_mail_slug from public.business_settings where business_id = '${A}'`);
    if (r[0]?.inbound_mail_slug) ok("inbound_mail_slug finns på företaget");
    else fail("inbound_mail_slug finns på företaget", JSON.stringify(r));
  }
  {
    await asAuthenticated(USER_B);
    const r = await rows(db, `select id from public.inbox_items`);
    if (r.length === 1 && (r[0] as { id: string }).id === "in-b1")
      ok("authenticated (JWT medlem i B) ser endast B:s inbox");
    else fail("authenticated (JWT medlem i B) ser endast B:s inbox", JSON.stringify(r));
  }
  {
    await db.exec(`reset role; set role anon;`);
    const r = await rows(db, `select id from public.inbox_items`);
    if (r.length === 0) ok("anon ser ingen inbox");
    else fail("anon ser ingen inbox", JSON.stringify(r));
    await asSuperuser();
  }
  await db.exec(`delete from public.inbox_items where id in ('in-a1', 'in-b1', 'in-a-same-ext');`);

  // ------------------------------------------------------------------
  // 2. Verifikationer: balans, CAS-nummer, oföränderlighet
  // ------------------------------------------------------------------
  console.log("\nBokföring – balans, nummerserie, oföränderlighet:");

  const ver = (id: string, number: number, entries: unknown[]) =>
    JSON.stringify({
      id,
      number,
      series: "A",
      date: "2026-03-01T12:00:00.000Z",
      description: "Test",
      source_type: "manuell",
      confidence: "hog",
      created_by: "anvandare",
      posted_at: "2026-03-01T12:00:00.000Z",
      created_at: "2026-03-01T12:00:00.000Z",
      entries,
    });

  await asApp(A);
  await expectOk(db, "balanserad verifikation bokförs (A1)", () =>
    db.query(`select app.post_verification($1, $2::jsonb)`, [
      A,
      ver("ver-a1", 1, [
        { account: 1930, account_name: "Bank", debit: 1000, credit: 0 },
        { account: 3001, account_name: "Intäkter", debit: 0, credit: 1000 },
      ]),
    ])
  );
  await expectError(db, "obalanserad verifikation stoppas i SQL", "verifikation_obalanserad", () =>
    db.query(`select app.post_verification($1, $2::jsonb)`, [
      A,
      ver("ver-a2", 2, [
        { account: 1930, account_name: "Bank", debit: 1000, credit: 0 },
        { account: 3001, account_name: "Intäkter", debit: 0, credit: 900 },
      ]),
    ])
  );
  await expectError(db, "fel löpnummer stoppas (CAS)", "sequence_conflict", () =>
    db.query(`select app.post_verification($1, $2::jsonb)`, [
      A,
      ver("ver-a3", 7, [
        { account: 1930, account_name: "Bank", debit: 100, credit: 0 },
        { account: 3001, account_name: "Intäkter", debit: 0, credit: 100 },
      ]),
    ])
  );
  await expectError(db, "direkt INSERT i verifications nekas för driva_app", "denied", () =>
    db.query(
      `insert into public.verifications (id, business_id, series, number, date, description, source_type, confidence, created_by, status, posted_at)
       values ('ver-direct', $1, 'A', 99, now(), 'smyg', 'manuell', 'hog', 'anvandare', 'bokford', now())`,
      [A]
    )
  );
  await expectError(db, "UPDATE på bokförd verifikation stoppas", "denied", () =>
    db.query(`update public.verifications set description = 'ändrad' where id = 'ver-a1'`)
  );
  await expectError(db, "DELETE på bokförd verifikation stoppas", "denied", () =>
    db.query(`delete from public.verifications where id = 'ver-a1'`)
  );
  await expectOk(db, "rättelsestämpel (corrected_by) tillåts en gång", async () => {
    await db.query(`select app.post_verification($1, $2::jsonb)`, [
      A,
      ver("ver-a2r", 2, [
        { account: 3001, account_name: "Intäkter", debit: 1000, credit: 0 },
        { account: 1930, account_name: "Bank", debit: 0, credit: 1000 },
      ]),
    ]);
    await db.query(`update public.verifications set corrected_by_verification_id = 'ver-a2r' where id = 'ver-a1'`);
  });
  await expectError(db, "andra rättelsestämpeln stoppas", "immutability", () =>
    db.query(`update public.verifications set corrected_by_verification_id = 'ver-a1' where id = 'ver-a1'`)
  );
  await expectError(db, "UPDATE på accounting_entries stoppas", "denied", () =>
    db.query(`update public.accounting_entries set debit = 2000 where verification_id = 'ver-a1' and position = 0`)
  );

  // ------------------------------------------------------------------
  // 2b. Verifikationsserier, handelsdatum och bilaga
  // ------------------------------------------------------------------
  console.log("\nVerifikationsserier, handelsdatum och underlag:");

  const manual = (id: string, number: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      id,
      number,
      series: "M",
      date: "2026-03-05T12:00:00.000Z",
      description: "Manuellt verifikat",
      source_type: "manuell",
      confidence: "hog",
      created_by: "anvandare",
      posted_at: "2026-03-05T12:00:00.000Z",
      created_at: "2026-03-05T12:00:00.000Z",
      entries: [
        { account: 5010, account_name: "Lokalhyra", debit: 12000, credit: 0 },
        { account: 1930, account_name: "Företagskonto", debit: 0, credit: 12000 },
      ],
      ...extra,
    });

  await asApp(A);
  // Serie A står på 3 här. Serie M ska ändå börja på 1 – serierna delar aldrig räknare.
  await expectOk(db, "serie M börjar på 1 fastän serie A hunnit längre", () =>
    db.query(`select app.post_verification($1, $2::jsonb)`, [A, manual("ver-m1", 1)])
  );
  await expectError(db, "fel nummer i serie M stoppas (CAS per serie)", "sequence_conflict", () =>
    db.query(`select app.post_verification($1, $2::jsonb)`, [A, manual("ver-m9", 9)])
  );
  await expectOk(db, "handelsdatum och underlag skrivs med verifikationen", () =>
    db.query(`select app.post_verification($1, $2::jsonb)`, [
      A,
      manual("ver-m2", 2, {
        transaction_date: "2026-02-27",
        attachment_filename: "hyresavi.pdf",
        attachment_content_type: "application/pdf",
        attachment_size_bytes: 2048,
        attachment_storage_path: `${A}/verifikat/ver-m2/hyresavi.pdf`,
      }),
    ])
  );
  {
    const r = await rows<{
      transaction_date: string | null;
      attachment_filename: string | null;
      attachment_size_bytes: string | null;
      attachment_storage_path: string | null;
    }>(
      db,
      `select transaction_date, attachment_filename, attachment_size_bytes, attachment_storage_path
         from public.verifications where id = 'ver-m2'`
    );
    const row = r[0];
    const isoDate = row?.transaction_date ? new Date(row.transaction_date).toISOString().slice(0, 10) : null;
    if (
      isoDate === "2026-02-27" &&
      row?.attachment_filename === "hyresavi.pdf" &&
      Number(row?.attachment_size_bytes) === 2048 &&
      row?.attachment_storage_path === `${A}/verifikat/ver-m2/hyresavi.pdf`
    ) {
      ok("handelsdatum och bilagemetadata rundresar");
    } else {
      fail("handelsdatum och bilagemetadata rundresar", JSON.stringify(row));
    }
  }
  {
    // Serie M har tagit två nummer utan att serie A rört sig: A står kvar på 3,
    // både i serieräknarna och i den ursprungliga kolumnen som äldre kod läser.
    const r = await rows<{ verification: number; verification_series: Record<string, number> }>(
      db,
      `select verification, verification_series from public.business_sequences where business_id = $1`,
      [A]
    );
    const row = r[0];
    if (row?.verification === 3 && row.verification_series?.A === 3 && row.verification_series?.M === 3) {
      ok("räknarna hålls per serie, med serie A speglad i den ursprungliga kolumnen");
    } else {
      fail("räknarna hålls per serie", JSON.stringify(row));
    }
  }

  // ------------------------------------------------------------------
  // 3. Fakturautfärdande: CAS, snapshot, frysning
  // ------------------------------------------------------------------
  console.log("\nFakturor – atomärt utfärdande och frysning:");

  await asApp(A);
  await expectOk(db, "fakturautkast skapas", () =>
    db.query(
      `insert into public.invoices (id, business_id, customer_id, type, status, issue_date, due_date, payment_terms_days, token, created_at)
       values ('inv-a1', $1, 'cust-a1', 'faktura', 'utkast', now(), now(), 30, 'tok-inv-a1', now())`,
      [A]
    )
  );

  const issuePayload = (invoiceId: string, number: number, verId: string, verNumber: number) => ({
    invoice: JSON.stringify({
      id: invoiceId,
      number,
      status: "skickad",
      ocr: `${number}77X`,
      issued_at: "2026-03-02T10:00:00.000Z",
      issue_date: "2026-03-02T10:00:00.000Z",
      due_date: "2026-04-01T10:00:00.000Z",
      amount_to_pay: 1250,
    }),
    lines: JSON.stringify([
      { id: "line-1", kind: "arbete", description: "Arbete", qty: 1, unit: "st", unit_price: 1000, vat_rate: 25 },
    ]),
    snapshot: JSON.stringify({ number, totals: { toPay: 1250 } }),
    verification: ver(verId, verNumber, [
      { account: 1510, account_name: "Kundfordringar", debit: 1250, credit: 0 },
      { account: 3001, account_name: "Intäkter", debit: 0, credit: 1000 },
      { account: 2611, account_name: "Utgående moms", debit: 0, credit: 250 },
    ]),
  });

  {
    const p = issuePayload("inv-a1", 10, "ver-issue-1", 3);
    await expectOk(db, "issue_invoice: nummer + snapshot + bokföring atomärt", () =>
      db.query(`select app.issue_invoice($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, true)`, [
        A,
        p.invoice,
        p.lines,
        p.snapshot,
        p.verification,
      ])
    );
    const inv = await rows(db, `select number, status, ocr from public.invoices where id = 'inv-a1'`);
    const snap = await rows(db, `select snapshot from public.invoice_issued_snapshots where invoice_id = 'inv-a1'`);
    if ((inv[0] as { number: number }).number === 10 && (inv[0] as { status: string }).status === "skickad" && snap.length === 1)
      ok("fakturan bär nummer, status och juridisk snapshot");
    else fail("fakturan bär nummer, status och juridisk snapshot", JSON.stringify({ inv, snap }));
  }
  {
    const p = issuePayload("inv-a1", 11, "ver-issue-dup", 4);
    await expectError(db, "dubbelt utfärdande stoppas", "conflict", () =>
      db.query(`select app.issue_invoice($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, true)`, [
        A,
        p.invoice,
        p.lines,
        p.snapshot,
        p.verification,
      ])
    );
  }
  await expectError(db, "fakturanummer kan inte sättas med vanlig UPDATE", "immutability", () =>
    db.query(`update public.invoices set number = 99 where id = 'inv-a1'`)
  );
  await expectError(db, "rader på utfärdad faktura är frysta", "immutability", () =>
    db.query(`update public.invoice_line_items set unit_price = 5 where invoice_id = 'inv-a1'`)
  );
  await expectError(db, "rik text (Övrig information) på utfärdad faktura är fryst", "immutability", () =>
    db.query(
      `update public.invoices set rich_text = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hackat"}]}]}'::jsonb where id = 'inv-a1'`
    )
  );
  await expectError(db, "utfärdad faktura kan inte tas bort", "immutability", () =>
    db.query(`delete from public.invoices where id = 'inv-a1'`)
  );
  await expectError(db, "snapshot är oföränderlig", "denied", () =>
    db.query(`update public.invoice_issued_snapshots set snapshot = '{}'::jsonb where invoice_id = 'inv-a1'`)
  );
  await expectOk(db, "statusflödet (skickat/påminnelser) är fortsatt öppet", () =>
    db.query(`update public.invoices set sent_at = now(), reminders = '["2026-03-05T10:00:00.000Z"]'::jsonb where id = 'inv-a1'`)
  );

  // Samtidighet: nästa nummer är nu 11. Två "samtidiga" utfärdanden med samma
  // förväntade nummer – exakt en vinner (CAS + unikt index).
  await asSuperuser();
  await db.exec(`
    insert into public.invoices (id, business_id, customer_id, type, status, issue_date, due_date, payment_terms_days, token, created_at)
    values
      ('inv-c1', '${A}', 'cust-a1', 'faktura', 'utkast', now(), now(), 30, 'tok-c1', now()),
      ('inv-c2', '${A}', 'cust-a1', 'faktura', 'utkast', now(), now(), 30, 'tok-c2', now());
  `);
  await asApp(A);
  {
    // Verifikationssekvensen står på 4 (misslyckade anrop rullas tillbaka i
    // sin helhet – funktionen är atomär – så inga nummer har brunnit).
    const p1 = issuePayload("inv-c1", 11, "ver-c1", 4);
    const p2 = issuePayload("inv-c2", 11, "ver-c2", 4);
    let wins = 0;
    let conflicts = 0;
    for (const p of [p1, p2]) {
      try {
        await db.query(`select app.issue_invoice($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, true)`, [
          A,
          p.invoice,
          p.lines,
          p.snapshot,
          p.verification,
        ]);
        wins += 1;
      } catch (e) {
        if (String(e).includes("sequence_conflict")) conflicts += 1;
        else throw e;
      }
    }
    if (wins === 1 && conflicts === 1) ok("två utfärdanden med samma nummer: exakt ett vinner (CAS)");
    else fail("två utfärdanden med samma nummer: exakt ett vinner (CAS)", `wins=${wins} conflicts=${conflicts}`);
  }

  // ------------------------------------------------------------------
  // 4. Betalningsmatchning
  // ------------------------------------------------------------------
  console.log("\nBetalningar – atomär matchning och idempotens:");

  await asApp(A);
  const payPayload = (id: string, invoiceId: string, txId: string | null, verId: string, verNumber: number) => ({
    payment: JSON.stringify({
      id,
      invoice_id: invoiceId,
      bank_transaction_id: txId,
      amount: 1250,
      date: "2026-03-10T09:00:00.000Z",
      paid_at: "2026-03-10T09:00:00.000Z",
      matched_by: "manuell",
    }),
    verification: ver(verId, verNumber, [
      { account: 1930, account_name: "Bank", debit: 1250, credit: 0 },
      { account: 1510, account_name: "Kundfordringar", debit: 0, credit: 1250 },
    ]),
  });
  {
    const p = payPayload("pay-1", "inv-a1", null, "ver-pay-1", 5);
    await expectOk(db, "match_payment: betalning + status + bokföring atomärt", () =>
      db.query(`select app.match_payment($1, $2::jsonb, null, $3::jsonb)`, [A, p.payment, p.verification])
    );
    const inv = await rows(db, `select status, paid_at from public.invoices where id = 'inv-a1'`);
    if ((inv[0] as { status: string }).status === "betald") ok("fakturan är betald");
    else fail("fakturan är betald", JSON.stringify(inv));
  }
  {
    const p = payPayload("pay-2", "inv-a1", null, "ver-pay-2", 6);
    await expectError(db, "dubbel betalningsmatchning stoppas", "payment_conflict", () =>
      db.query(`select app.match_payment($1, $2::jsonb, null, $3::jsonb)`, [A, p.payment, p.verification])
    );
  }

  // ------------------------------------------------------------------
  // 5. Offertversioner och audit-logg
  // ------------------------------------------------------------------
  console.log("\nOffertversioner och audit-logg:");

  await asApp(A);
  await expectOk(db, "offert + version skapas och låses vid godkännande", async () => {
    await db.query(
      `insert into public.quotes (id, business_id, number, customer_id, status, current_version_id, token, created_at)
       values ('quote-a1', $1, 1, 'cust-a1', 'skickad', 'qv-a1', 'tok-quote-a1', now())`,
      [A]
    );
    await db.query(
      `insert into public.quote_versions (id, business_id, quote_id, version, title, payload, created_at)
       values ('qv-a1', $1, 'quote-a1', 1, 'Kök', '{"title":"Kök"}'::jsonb, now())`,
      [A]
    );
    await db.query(`update public.quote_versions set locked_at = now(), content_hash = 'abc' where id = 'qv-a1'`);
  });
  await expectError(db, "låst version är fryst", "immutability", () =>
    db.query(`update public.quote_versions set payload = '{"title":"Hackat"}'::jsonb where id = 'qv-a1'`)
  );
  await expectError(db, "låst version kan inte tas bort", "immutability", () =>
    db.query(`delete from public.quote_versions where id = 'qv-a1'`)
  );
  await expectOk(db, "godkännande (simple_accept) kan skapas utan BankID-kolumner", () =>
    db.query(
      `insert into public.signatures (id, business_id, quote_id, quote_version_id, method, signer_name, signed_at, evidence)
       values ('sig-1', $1, 'quote-a1', 'qv-a1', 'simple_accept', 'Anna A', now(),
               '{"contentHash":"abc","statement":"Genom att godkänna …","customerNameAtAccept":"Anna A","ip":"203.0.113.7"}'::jsonb)`,
      [A]
    )
  );
  await expectError(db, "dubbelt godkännande på samma offert stoppas (unikt index)", "duplicate key", () =>
    db.query(
      `insert into public.signatures (id, business_id, quote_id, quote_version_id, method, signer_name, signed_at, evidence)
       values ('sig-2', $1, 'quote-a1', 'qv-a1', 'simple_accept', 'Anna A', now(), '{}'::jsonb)`,
      [A]
    )
  );
  await expectError(db, "okänd godkännandemetod avvisas", "signatures_method_check", () =>
    db.query(
      `insert into public.signatures (id, business_id, quote_id, quote_version_id, method, signer_name, signed_at, evidence)
       values ('sig-3', $1, 'quote-a1', 'qv-a1', 'ritad_signatur', 'Anna A', now(), '{}'::jsonb)`,
      [A]
    )
  );
  {
    const r = await rows(db, `select method, order_ref, environment from public.signatures where id = 'sig-1'`);
    const row = r[0] as { method: string; order_ref: string | null; environment: string | null } | undefined;
    if (row && row.method === "simple_accept" && row.order_ref === null && row.environment === null) {
      ok("godkännandet sparas med method simple_accept och utan BankID-fält");
    } else {
      fail("godkännandet sparas med method simple_accept och utan BankID-fält", JSON.stringify(row));
    }
  }
  await expectOk(db, "audit_log tar emot händelser", () =>
    db.query(
      `insert into public.audit_log (id, business_id, channel, actor_label, event_type, message, created_at)
       values ('audit-1', $1, 'activity', 'anvandare', 'kund_skapad', 'Kunden Anna skapades.', now())`,
      [A]
    )
  );
  await expectError(db, "audit_log är oföränderlig (UPDATE)", "denied", () =>
    db.query(`update public.audit_log set message = 'ändrad' where id = 'audit-1'`)
  );
  await expectError(db, "audit_log är oföränderlig (DELETE)", "denied", () =>
    db.query(`delete from public.audit_log where id = 'audit-1'`)
  );

  // ------------------------------------------------------------------
  // 6. Publika token-uppslag
  // ------------------------------------------------------------------
  console.log("\nPublika token-uppslag:");

  await asApp(null);
  {
    const r = await rows(db, `select business_id, entity_id from app.resolve_public_token('quote', 'tok-quote-a1')`);
    if (r.length === 1 && (r[0] as { business_id: string }).business_id === A)
      ok("offerttoken → rätt företag (utan tenantkontext)");
    else fail("offerttoken → rätt företag (utan tenantkontext)", JSON.stringify(r));
  }
  {
    const r = await rows(db, `select * from app.resolve_public_token('quote', 'finns-inte')`);
    if (r.length === 0) ok("okänd token → tomt svar");
    else fail("okänd token → tomt svar", JSON.stringify(r));
  }

  // ------------------------------------------------------------------
  // 7. Storage-policyer
  // ------------------------------------------------------------------
  console.log("\nStorage – tenant-säkra policyer:");

  await asAuthenticated(USER_A);
  await expectOk(db, "medlem kan ladda upp kvitto under eget företags prefix", () =>
    db.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${A}/rcpt-1/kvitto.jpg`])
  );
  await expectError(db, "medlem kan inte ladda upp under annat företags prefix", "row-level security", () =>
    db.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${B}/rcpt-x/kvitto.jpg`])
  );
  {
    await asAuthenticated(USER_B);
    const r = await rows(db, `select name from storage.objects where bucket_id = 'receipts'`);
    if (r.length === 0) ok("annan tenant ser inte kvittofiler (select)");
    else fail("annan tenant ser inte kvittofiler (select)", JSON.stringify(r));
  }

  // ------------------------------------------------------------------
  // 8. Finansiell autopilot (migration 09): delbetalningar, dedup, kvitton
  // ------------------------------------------------------------------
  console.log("\nAutopilot – delbetalningar, dedup och kvittovakter:");

  await asSuperuser();
  const seqRow = (
    await rows<{ invoice: number; verification: number }>(
      db,
      `select invoice, verification from public.business_sequences where business_id = $1`,
      [A]
    )
  )[0];
  let nextInv = Number(seqRow.invoice);
  let nextVer = Number(seqRow.verification);
  await db.exec(`
    insert into public.bank_accounts (id, business_id, provider, name) values ('acc-a1', '${A}', 'mock', 'Företagskonto');
    insert into public.invoices (id, business_id, customer_id, type, status, issue_date, due_date, payment_terms_days, token, created_at)
    values ('inv-d1', '${A}', 'cust-a1', 'faktura', 'utkast', now(), now(), 30, 'tok-d1', now());
  `);

  await asApp(A);
  {
    const p = issuePayload("inv-d1", nextInv, "ver-d-issue", nextVer);
    await expectOk(db, "faktura för delbetalningstest utfärdas", () =>
      db.query(`select app.issue_invoice($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, true)`, [
        A,
        p.invoice,
        p.lines,
        p.snapshot,
        p.verification,
      ])
    );
    nextInv += 1;
    nextVer += 1;
  }

  const payPartial = (id: string, amount: number, status: string, verId: string, verNumber: number, txId: string | null = null) => ({
    payment: JSON.stringify({
      id,
      invoice_id: "inv-d1",
      bank_transaction_id: txId,
      amount,
      date: "2026-03-12T09:00:00.000Z",
      status,
      paid_at: "2026-03-12T09:00:00.000Z",
      matched_by: "auto",
    }),
    verification: ver(verId, verNumber, [
      { account: 1930, account_name: "Bank", debit: amount, credit: 0 },
      { account: 1510, account_name: "Kundfordringar", debit: 0, credit: amount },
    ]),
  });

  {
    const p = payPartial("pay-d1", 500, "delbetald", "ver-d-pay1", nextVer);
    await expectOk(db, "match_payment: delbetalning → status delbetald", () =>
      db.query(`select app.match_payment($1, $2::jsonb, null, $3::jsonb)`, [A, p.payment, p.verification])
    );
    nextVer += 1;
    const inv = await rows<{ status: string; paid_at: string | null }>(
      db,
      `select status, paid_at from public.invoices where id = 'inv-d1'`
    );
    if (inv[0].status === "delbetald" && inv[0].paid_at == null) ok("delbetald utan paid_at");
    else fail("delbetald utan paid_at", JSON.stringify(inv));
  }
  {
    const p = payPartial("pay-d2", 750, "betald", "ver-d-pay2", nextVer);
    await expectOk(db, "match_payment: slutbetalning delbetald → betald", () =>
      db.query(`select app.match_payment($1, $2::jsonb, null, $3::jsonb)`, [A, p.payment, p.verification])
    );
    nextVer += 1;
    const inv = await rows<{ status: string; paid_at: string | null }>(
      db,
      `select status, paid_at from public.invoices where id = 'inv-d1'`
    );
    if (inv[0].status === "betald" && inv[0].paid_at != null) ok("betald med paid_at");
    else fail("betald med paid_at", JSON.stringify(inv));
  }
  {
    const p = payPartial("pay-d3", 100, "betald", "ver-d-pay3", nextVer);
    await expectError(db, "betalning på redan betald faktura stoppas", "payment_conflict", () =>
      db.query(`select app.match_payment($1, $2::jsonb, null, $3::jsonb)`, [A, p.payment, p.verification])
    );
  }
  {
    const p = payPartial("pay-d4", 100, "krediterad", "ver-d-pay4", nextVer);
    await expectError(db, "ogiltig målstatus avvisas", "payment_conflict", () =>
      db.query(`select app.match_payment($1, $2::jsonb, null, $3::jsonb)`, [A, p.payment, p.verification])
    );
  }
  {
    const p = payPartial("pay-d5", 0, "betald", "ver-d-pay5", nextVer);
    await expectError(db, "nollbelopp avvisas (minst 1 kr)", "payment_conflict", () =>
      db.query(`select app.match_payment($1, $2::jsonb, null, $3::jsonb)`, [A, p.payment, p.verification])
    );
  }

  // Banktransaktioner: extern dedup + statusvärden + betalningsunikhet.
  await asApp(A);
  await expectOk(db, "banktransaktion med external_id registreras", () =>
    db.query(
      `insert into public.bank_transactions (id, business_id, account_id, external_id, date, amount, status)
       values ('tx-d1', $1, 'acc-a1', 'prov-abc-1', '2026-03-12', 500, 'ny')`,
      [A]
    )
  );
  await expectError(db, "samma external_id på samma konto stoppas (unikt index)", "duplicate key", () =>
    db.query(
      `insert into public.bank_transactions (id, business_id, account_id, external_id, date, amount, status)
       values ('tx-d2', $1, 'acc-a1', 'prov-abc-1', '2026-03-12', 500, 'ny')`,
      [A]
    )
  );
  await expectError(db, "utgången status 'matchad' avvisas av checken", "check", () =>
    db.query(
      `insert into public.bank_transactions (id, business_id, account_id, date, amount, status)
       values ('tx-d3', $1, 'acc-a1', '2026-03-12', 500, 'matchad')`,
      [A]
    )
  );
  await expectOk(db, "matched_type 'skattereduktion' är giltig (SKV-utbetalningar)", () =>
    db.query(
      `insert into public.bank_transactions (id, business_id, account_id, date, amount, status, matched_type)
       values ('tx-d4', $1, 'acc-a1', '2026-03-12', 3750, 'bokford', 'skattereduktion')`,
      [A]
    )
  );
  await expectError(db, "samma banktransaktion kan aldrig bära två betalningar", "duplicate key", async () => {
    await db.query(
      `insert into public.payments (id, business_id, invoice_id, bank_transaction_id, amount, date, matched_by)
       values ('pay-tx-1', $1, 'inv-d1', 'tx-d1', 250, '2026-03-12', 'manuell')`,
      [A]
    );
    await db.query(
      `insert into public.payments (id, business_id, invoice_id, bank_transaction_id, amount, date, matched_by)
       values ('pay-tx-2', $1, 'inv-d1', 'tx-d1', 250, '2026-03-12', 'manuell')`,
      [A]
    );
  });
  await expectError(db, "betalningsbelopp under 1 kr stoppas av tabellchecken", "check", () =>
    db.query(
      `insert into public.payments (id, business_id, invoice_id, amount, date, matched_by)
       values ('pay-zero', $1, 'inv-d1', 0, '2026-03-12', 'manuell')`,
      [A]
    )
  );

  // Kvitton: ETT kvitto per utgift.
  await expectOk(db, "kvitto kopplas till utgift", async () => {
    await db.query(
      `insert into public.expenses (id, business_id, supplier, date, amount, vat_amount, status)
       values ('exp-d1', $1, 'Bauhaus', '2026-03-12', 875, 175, 'saknar_kvitto')`,
      [A]
    );
    await db.query(
      `insert into public.receipts (id, business_id, expense_id, filename, source, extracted)
       values ('rcpt-d1', $1, 'exp-d1', 'kvitto.jpg', 'uppladdning', '{}'::jsonb)`,
      [A]
    );
  });
  await expectError(db, "andra kvittot på samma utgift stoppas (unikt index)", "duplicate key", () =>
    db.query(
      `insert into public.receipts (id, business_id, expense_id, filename, source, extracted)
       values ('rcpt-d2', $1, 'exp-d1', 'kvitto2.jpg', 'uppladdning', '{}'::jsonb)`,
      [A]
    )
  );

  // Fakturans nya kolumner rundresar.
  await expectOk(db, "refund/overpayment_credit kan skrivas på utfärdad faktura", () =>
    db.query(
      `update public.invoices
          set refund = '{"amount":500,"at":"2026-03-13T09:00:00.000Z","verificationId":"ver-d-pay2"}'::jsonb,
              overpayment_credit = 500
        where id = 'inv-d1'`
    )
  );

  await asSuperuser();

  // ------------------------------------------------------------------
  // 9. Driva Admin: plattformstabeller, vakter och RLS
  // ------------------------------------------------------------------
  console.log("\nDriva Admin – plattformsbehörighet:");

  const asPlatform = async (adminUserId: string | null) => {
    await db.exec(`reset role; set role driva_app;`);
    await db.query(`select set_config('app.business_id', '', false)`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`select set_config('app.platform_admin_user_id', $1, false)`, [adminUserId ?? ""]);
  };
  const clearPlatformCtx = async () => {
    await db.query(`select set_config('app.platform_admin_user_id', '', false)`);
  };

  await asSuperuser();
  await clearPlatformCtx();
  await expectOk(db, "super_admin-rad kan skapas", () =>
    db.query(
      `insert into public.platform_admins (id, user_id, role, email) values ('pa-1', $1, 'super_admin', 'super@driva.se')`,
      [USER_A]
    )
  );

  // Sista aktiva super_admin skyddas av databastriggern – oavsett appkod.
  await expectError(db, "sista super_admin kan inte raderas", "sista aktiva super_admin", () =>
    db.query(`delete from public.platform_admins where id = 'pa-1'`)
  );
  await expectError(db, "sista super_admin kan inte inaktiveras", "sista aktiva super_admin", () =>
    db.query(`update public.platform_admins set disabled_at = now() where id = 'pa-1'`)
  );
  await expectError(db, "sista super_admin kan inte nedgraderas", "sista aktiva super_admin", () =>
    db.query(`update public.platform_admins set role = 'admin' where id = 'pa-1'`)
  );
  await expectOk(db, "med en andra aktiv super_admin kan den första tas bort", async () => {
    await db.query(
      `insert into public.platform_admins (id, user_id, role, email) values ('pa-2', $1, 'super_admin', 'super2@driva.se')`,
      [USER_B]
    );
    await db.query(`delete from public.platform_admins where id = 'pa-1'`);
  });
  await expectError(db, "ogiltig plattformsroll avvisas av checken", "check", () =>
    db.query(
      `insert into public.platform_admins (id, user_id, role) values ('pa-x', $1, 'godmode')`,
      [USER_A]
    )
  );
  await expectError(db, "en användare kan bara ha en platform_admins-rad", "duplicate key", () =>
    db.query(
      `insert into public.platform_admins (id, user_id, role) values ('pa-dup', $1, 'admin')`,
      [USER_B]
    )
  );

  // Admin-audit är oföränderlig även för superuser-vägen (trigger).
  await asSuperuser();
  await db.query(
    `insert into public.admin_audit_log (id, admin_user_id, admin_role, action) values ('aud-1', $1, 'super_admin', 'admin_bootstrap')`,
    [USER_B]
  );
  await expectError(db, "admin_audit_log kan inte uppdateras", "immutability", () =>
    db.query(`update public.admin_audit_log set action = 'omskriven' where id = 'aud-1'`)
  );
  await expectError(db, "admin_audit_log kan inte raderas", "immutability", () =>
    db.query(`delete from public.admin_audit_log where id = 'aud-1'`)
  );

  // RLS: Data API-rollerna ser INGENTING av plattformsdatat.
  {
    await asAuthenticated(USER_B); // USER_B ÄR super_admin – men Data API:t är ändå stängt.
    const r = await rows(db, `select id from public.platform_admins`);
    if (r.length === 0) ok("authenticated ser inga platform_admins (även som admin-användare)");
    else fail("authenticated ser inga platform_admins (även som admin-användare)", JSON.stringify(r));
    const t = await rows(db, `select id from public.admin_audit_log`);
    if (t.length === 0) ok("authenticated ser ingen admin-audit");
    else fail("authenticated ser ingen admin-audit", JSON.stringify(t));
  }
  {
    await db.exec(`reset role; set role anon;`);
    const r = await rows(db, `select id from public.platform_admins`);
    if (r.length === 0) ok("anon ser inga platform_admins");
    else fail("anon ser inga platform_admins", JSON.stringify(r));
    await asSuperuser();
  }

  // driva_app utan plattformskontext: inga rader, inga skrivningar.
  {
    await asApp(null);
    await clearPlatformCtx();
    const r = await rows(db, `select id from public.platform_admins`);
    if (r.length === 0) ok("driva_app utan plattformskontext ser inga platform_admins");
    else fail("driva_app utan plattformskontext ser inga platform_admins", JSON.stringify(r));
  }
  await expectError(db, "driva_app utan plattformskontext kan inte skriva audit", "row-level security", () =>
    db.query(
      `insert into public.admin_audit_log (id, admin_user_id, admin_role, action) values ('aud-2', $1, 'admin', 'test')`,
      [USER_B]
    )
  );

  // driva_app MED plattformskontext: läsning + audit fungerar; rolluppslaget
  // (security definer) svarar utan direkta tabellrättigheter.
  {
    await asPlatform(USER_B);
    const r = await rows(db, `select id from public.platform_admins`);
    if (r.length === 1) ok("driva_app med plattformskontext ser platform_admins");
    else fail("driva_app med plattformskontext ser platform_admins", JSON.stringify(r));
    const role = await rows<{ role: string }>(db, `select app.platform_role_for($1) as role`, [USER_B]);
    if (role[0]?.role === "super_admin") ok("app.platform_role_for svarar för driva_app");
    else fail("app.platform_role_for svarar för driva_app", JSON.stringify(role));
  }
  await expectOk(db, "driva_app med plattformskontext kan skriva audit", () =>
    db.query(
      `insert into public.admin_audit_log (id, admin_user_id, admin_role, action) values ('aud-3', $1, 'super_admin', 'test')`,
      [USER_B]
    )
  );

  // Supportärenden: tenantkontext får skapa ärende för SITT företag, inte andras.
  {
    await asApp(A);
    await clearPlatformCtx();
    await expectOk(db, "tenantkontext kan skapa supportärende för sitt företag", () =>
      db.query(
        `insert into public.support_tickets (id, business_id, user_email, subject, message)
         values ('tick-a', $1, 'kund@a.se', 'Hjälp', 'Behöver hjälp')`,
        [A]
      )
    );
    await expectError(db, "tenantkontext kan inte skapa ärende för annat företag", "row-level security", () =>
      db.query(
        `insert into public.support_tickets (id, business_id, user_email, subject, message)
         values ('tick-b', $1, 'kund@a.se', 'Intrång', 'x')`,
        [B]
      )
    );
    await expectError(db, "tenantkontext kan inte ändra ärendestatus", "row-level security", async () => {
      const updated = await db.query(`update public.support_tickets set status = 'resolved' where id = 'tick-a'`);
      if ((updated.affectedRows ?? 0) === 0) throw new Error("row-level security: 0 rader uppdaterade");
    });
    const visible = await rows(db, `select id from public.support_tickets`);
    if (visible.length === 1) ok("tenantkontext ser sitt eget ärende");
    else fail("tenantkontext ser sitt eget ärende", JSON.stringify(visible));
  }
  {
    await asPlatform(USER_B);
    const r = await rows(db, `select id from public.support_tickets`);
    if (r.length === 1) ok("plattformskontext ser alla supportärenden");
    else fail("plattformskontext ser alla supportärenden", JSON.stringify(r));
  }

  // email_events: tenantkontext loggar bara för sitt eget företag.
  {
    await asApp(A);
    await clearPlatformCtx();
    await expectOk(db, "tenantkontext kan logga mejlhändelse för sitt företag", () =>
      db.query(
        `insert into public.email_events (id, business_id, kind, to_email, status, mode)
         values ('em-a', $1, 'quote', 'k@a.se', 'sent', 'test')`,
        [A]
      )
    );
    await expectError(db, "tenantkontext kan inte logga mejl på annat företag", "row-level security", () =>
      db.query(
        `insert into public.email_events (id, business_id, kind, to_email, status, mode)
         values ('em-b', $1, 'quote', 'k@a.se', 'sent', 'test')`,
        [B]
      )
    );
  }

  // Inaktiverat företag: kolumnen finns och medlemsuppslaget filtrerar i appen.
  // (is_demo är fryst sedan skapandet – rundresan gäller endast disabled_at.)
  await asSuperuser();
  await expectOk(db, "businesses.disabled_at rundresar", async () => {
    await db.query(`update public.businesses set disabled_at = now() where id = $1`, [B]);
    const r = await rows<{ disabled_at: string | null }>(
      db,
      `select disabled_at from public.businesses where id = $1`,
      [B]
    );
    if (!r[0]?.disabled_at) throw new Error("kolumnen sparades inte");
    await db.query(`update public.businesses set disabled_at = null where id = $1`, [B]);
  });
  await expectError(db, "businesses.is_demo är fryst efter skapandet", "is_demo", () =>
    db.query(`update public.businesses set is_demo = true where id = $1`, [B])
  );

  await asSuperuser();
  await clearPlatformCtx();

  // ------------------------------------------------------------------
  // Provperiod: trial-stämplar frysta, status ändras bara via grinden
  // ------------------------------------------------------------------
  console.log("\nProvperiod – fryst tillstånd:");

  await asSuperuser();
  await expectOk(db, "trial-kolumner kan sättas vid insert", () =>
    db.query(
      `update public.businesses set disabled_at = disabled_at where id = '${A}'` // no-op sanity
    )
  );
  await db.query(
    `insert into public.businesses (id, name, org_number, trial_started_at, trial_ends_at, subscription_status)
     values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'Trial AB', '556000-0100', now(), now() + interval '14 days', 'trialing')`
  );
  await expectError(db, "trial_ends_at är fryst efter insert", "provperiodens stämplar", () =>
    db.query(
      `update public.businesses set trial_ends_at = now() + interval '1 year'
        where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'`
    )
  );
  await expectError(db, "subscription_status ändras inte utan grind", "faktureringsflödet", () =>
    db.query(
      `update public.businesses set subscription_status = 'active'
        where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'`
    )
  );
  await expectOk(db, "subscription_status ändras med faktureringsgrinden", async () => {
    await db.exec(`begin`);
    try {
      await db.query(`select set_config('app.allow_subscription_update', '1', true)`);
      await db.query(
        `update public.businesses set subscription_status = 'active'
          where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'`
      );
      await db.exec(`commit`);
    } catch (e) {
      await db.exec(`rollback`);
      throw e;
    }
  });
  await expectError(db, "subscription_status accepterar bara kända värden (CHECK)", "businesses_subscription_status_check", () =>
    db.query(
      `insert into public.businesses (id, name, org_number, subscription_status)
       values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'Trial fel', '556000-0101', 'gratis')`
    )
  );

  // ------------------------------------------------------------------
  // Kontoregister (migration 30)
  // ------------------------------------------------------------------
  console.log("\nKontoregister:");

  await asApp(A);
  await expectOk(db, "eget konto kan läggas till i egen tenant", () =>
    db.query(
      `insert into public.chart_accounts (id, business_id, number, name, type, section, custom)
       values ('konto-4011', $1, 4011, 'Inköp virke', 'kostnad', 'ravaror_och_fornodenheter', true)`,
      [A]
    )
  );
  await expectError(db, "kontoregistret är tenantisolerat (RLS)", "row-level security", () =>
    db.query(
      `insert into public.chart_accounts (id, business_id, number, name, type, section, custom)
       values ('konto-b-4011', $1, 4011, 'Intrång', 'kostnad', 'ravaror_och_fornodenheter', true)`,
      [B]
    )
  );
  await expectError(db, "samma kontonummer kan inte finnas två gånger per företag", "duplicate key", () =>
    db.query(
      `insert into public.chart_accounts (id, business_id, number, name, type, section, custom)
       values ('konto-4011-dubblett', $1, 4011, 'Dubblett', 'kostnad', 'ravaror_och_fornodenheter', true)`,
      [A]
    )
  );
  await expectError(db, "kontonummer utanför BAS:s nummerrymd avvisas", "chart_accounts_number_check", () =>
    db.query(
      `insert into public.chart_accounts (id, business_id, number, name, type, section, custom)
       values ('konto-999', $1, 999, 'För lågt', 'kostnad', 'ravaror_och_fornodenheter', true)`,
      [A]
    )
  );
  await expectError(db, "okänd kontotyp avvisas", "chart_accounts_type_check", () =>
    db.query(
      `insert into public.chart_accounts (id, business_id, number, name, type, section, custom)
       values ('konto-4012', $1, 4012, 'Fel typ', 'hittepa', 'ravaror_och_fornodenheter', true)`,
      [A]
    )
  );
  await expectError(db, "namnlöst konto avvisas", "chart_accounts_name_check", () =>
    db.query(
      `insert into public.chart_accounts (id, business_id, number, name, type, section, custom)
       values ('konto-4013', $1, 4013, '   ', 'kostnad', 'ravaror_och_fornodenheter', true)`,
      [A]
    )
  );
  {
    await asApp(B);
    const r = await rows(db, `select number from public.chart_accounts`);
    if (r.length === 0) ok("företag B ser inte A:s egna konton");
    else fail("företag B ser inte A:s egna konton", JSON.stringify(r));
    await asSuperuser();
  }

  // ------------------------------------------------------------------
  // Omvänd byggmoms (migration 32)
  // ------------------------------------------------------------------
  console.log("\nOmvänd byggmoms:");

  await asApp(A);
  await expectOk(db, "markeringen kan sättas på en företagskund", () =>
    db.query(
      `insert into public.customers
         (id, business_id, kind, name, email, phone, notes, org_number, reverse_charge_construction, created_at)
       values ('cust-a-bygg', $1, 'foretag', 'Bygg & Co AB', 'b@x.se', '', '', '556677-8899', true, now())`,
      [A]
    )
  );
  await expectError(
    db,
    "markeringen kan inte sättas på en privatperson",
    "customers_reverse_charge_kind_check",
    () =>
      db.query(
        `insert into public.customers
           (id, business_id, kind, name, email, phone, notes, reverse_charge_construction, created_at)
         values ('cust-a-privat-bygg', $1, 'privat', 'Anna', 'a@x.se', '', '', true, now())`,
        [A]
      )
  );
  await expectError(
    db,
    "en markerad kund kan inte göras om till privatperson",
    "customers_reverse_charge_kind_check",
    () => db.query(`update public.customers set kind = 'privat' where id = 'cust-a-bygg'`)
  );
  {
    const r = await rows(
      db,
      `select reverse_charge_construction as flag from public.customers where id = 'cust-a-bygg'`
    );
    if (r[0]?.flag === true) ok("markeringen rundresar");
    else fail("markeringen rundresar", JSON.stringify(r));
  }
  await asSuperuser();

  // ------------------------------------------------------------------
  // Momsperiodicitet (migration 33)
  // ------------------------------------------------------------------
  console.log("\nMomsperiodicitet:");

  await asApp(A);
  {
    const r = await rows(db, `select vat_periodicity as p from public.business_settings where business_id = $1`, [A]);
    if (r[0]?.p === "kvartal") ok("default är kvartal – huvudregeln");
    else fail("default är kvartal – huvudregeln", JSON.stringify(r));
  }
  await expectOk(db, "helår kan väljas", () =>
    db.query(`update public.business_settings set vat_periodicity = 'helar' where business_id = $1`, [A])
  );
  await expectOk(db, "månad kan väljas", () =>
    db.query(`update public.business_settings set vat_periodicity = 'manad' where business_id = $1`, [A])
  );
  await expectError(
    db,
    "okänd periodicitet avvisas",
    "business_settings_vat_periodicity_check",
    () => db.query(`update public.business_settings set vat_periodicity = 'veckovis' where business_id = $1`, [A])
  );
  await db.query(`update public.business_settings set vat_periodicity = 'kvartal' where business_id = $1`, [A]);
  await asSuperuser();

  // ------------------------------------------------------------------
  // Skattekontot
  // ------------------------------------------------------------------
  console.log("\nSkattekonto:");

  const taxAccountVer = (id: string, number: number, sourceId: string) =>
    JSON.stringify({
      id,
      number,
      series: "A",
      date: "2026-03-12T12:00:00.000Z",
      description: "F-skatt 2026-02",
      source_type: "skattekonto",
      source_id: sourceId,
      confidence: "hog",
      created_by: "anvandare",
      posted_at: "2026-03-12T12:00:00.000Z",
      created_at: "2026-03-12T12:00:00.000Z",
      entries: [
        { account: 2518, account_name: "Betald F-skatt", debit: 4000, credit: 0 },
        { account: 1630, account_name: "Skattekonto", debit: 0, credit: 4000 },
      ],
    });

  await asApp(A);
  const nextSeriesA = Number(
    (
      await rows<{ verification_series: Record<string, number> }>(
        db,
        `select verification_series from public.business_sequences where business_id = $1`,
        [A]
      )
    )[0]?.verification_series?.A ?? 1
  );
  await expectOk(db, "kontering mot skattekontot bokförs med källan skattekonto", () =>
    db.query(`select app.post_verification($1, $2::jsonb)`, [
      A,
      taxAccountVer("ver-sk1", nextSeriesA, "fskatt-2026-02"),
    ])
  );
  {
    const r = await rows(
      db,
      `select v.source_type as t, v.source_id as sid, sum(e.credit) as kredit
         from public.verifications v
         join public.accounting_entries e on e.verification_id = v.id
        where v.id = 'ver-sk1' and e.account = 1630
        group by v.source_type, v.source_id`
    );
    if (r[0]?.t === "skattekonto" && r[0]?.sid === "fskatt-2026-02" && Number(r[0]?.kredit) === 4000) {
      ok("källa och konto 1630 rundresar");
    } else {
      fail("källa och konto 1630 rundresar", JSON.stringify(r));
    }
  }
  await asSuperuser();

  // ------------------------------------------------------------------
  // Lön och arbetsgivardeklaration (migration 34)
  // ------------------------------------------------------------------
  console.log("\nLön och AGI:");

  await asApp(A);
  await expectOk(db, "den anställde kan läggas upp i egen tenant", () =>
    db.query(
      `insert into public.employees
         (id, business_id, name, personnummer, role, monthly_salary, tax_basis, start_date, status)
       values ('emp-a', $1, 'Anna Ägare', '19850312-4567', 'foretagsledare', 42000,
               '{"kind":"tabell","table":34,"monthlyDeduction":9400,"salaryAtLookup":42000}'::jsonb,
               '2026-01-01', 'anstalld')`,
      [A]
    )
  );
  await expectError(db, "anställda är tenantisolerade (RLS)", "row-level security", () =>
    db.query(
      `insert into public.employees
         (id, business_id, name, personnummer, role, monthly_salary, tax_basis, start_date, status)
       values ('emp-b', $1, 'Intrång', '19850312-4567', 'tjansteman', 1000, '{"kind":"procent","percent":30}'::jsonb,
               '2026-01-01', 'anstalld')`,
      [B]
    )
  );
  await expectError(db, "okänd roll avvisas", "employees_role_check", () =>
    db.query(
      `insert into public.employees
         (id, business_id, name, personnummer, role, monthly_salary, tax_basis, start_date, status)
       values ('emp-fel-roll', $1, 'Fel roll', '19850312-4567', 'vd', 1000, '{"kind":"procent","percent":30}'::jsonb,
               '2026-01-01', 'anstalld')`,
      [A]
    )
  );

  const payrollRun = (id: string, month: string, payDate = "2026-01-25") =>
    db.query(
      `insert into public.payroll_runs
         (id, business_id, employee_id, month, pay_date, gross, tax, net, employer_contribution,
          contribution_percent, tax_basis, salary_account, verification_id, created_by)
       values ($1, $2, 'emp-a', $3, $4, 42000, 9400, 32600, 13196, 31.42,
               '{"kind":"tabell","table":34,"monthlyDeduction":9400,"salaryAtLookup":42000}'::jsonb,
               7220, 'ver-lon-1', 'anvandare')`,
      [id, A, month, payDate]
    );
  await expectOk(db, "lönekörningen kan bokföras", () => payrollRun("run-a-01", "2026-01"));
  await expectError(db, "samma månad kan inte lönekörras två gånger", "duplicate key", () =>
    payrollRun("run-a-01-dubblett", "2026-01")
  );
  await expectError(db, "lönemånad måste vara YYYY-MM", "payroll_runs_month_check", () =>
    payrollRun("run-a-fel-manad", "2026-13", "2026-12-25")
  );

  const declaration = (id: string, month: string, status: string) =>
    db.query(
      `insert into public.employer_declarations
         (id, business_id, month, label, status, individual_rows, gross, tax, employer_contribution,
          att_betala, due_date)
       values ($1, $2, $3, 'januari 2026', $4,
               '[{"employeeId":"emp-a","name":"Anna Ägare","personnummer":"19850312-4567","gross":42000,"tax":9400,"employerContribution":13196}]'::jsonb,
               42000, 9400, 13196, 22596, '2026-02-12')`,
      [id, A, month, status]
    );
  await expectOk(db, "arbetsgivardeklarationen kan lämnas", () => declaration("agi-a-01", "2026-01", "deklarerad"));
  await expectError(db, "en månad har bara en arbetsgivardeklaration", "duplicate key", () =>
    declaration("agi-a-01-dubblett", "2026-01", "utkast")
  );
  await expectError(db, "okänd deklarationsstatus avvisas", "employer_declarations_status_check", () =>
    declaration("agi-a-fel-status", "2026-02", "inskickad")
  );
  {
    const r = await rows<{ namn: string; brutto: string; pnr: string }>(
      db,
      `select e.name as namn, r.gross as brutto,
              d.individual_rows -> 0 ->> 'personnummer' as pnr
         from public.payroll_runs r
         join public.employees e on e.id = r.employee_id
         join public.employer_declarations d on d.month = r.month and d.business_id = r.business_id
        where r.id = 'run-a-01'`
    );
    if (r[0]?.namn === "Anna Ägare" && Number(r[0]?.brutto) === 42000 && r[0]?.pnr === "19850312-4567") {
      ok("lön, anställd och individuppgift hänger ihop och rundresar");
    } else {
      fail("lön, anställd och individuppgift hänger ihop och rundresar", JSON.stringify(r));
    }
  }
  {
    await asApp(B);
    const r = await rows(db, `select id from public.employees`);
    if (r.length === 0) ok("företag B ser inte A:s anställda");
    else fail("företag B ser inte A:s anställda", JSON.stringify(r));
  }
  await asSuperuser();

  // ------------------------------------------------------------------
  console.log(`\n${passed} godkända, ${failed} underkända.`);
  if (failed > 0) {
    console.error("\nUnderkända kontroller:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
