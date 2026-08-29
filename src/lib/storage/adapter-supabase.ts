/**
 * Supabase-adaptern: unit-of-work ovanpå Postgres.
 *
 *   runWithTenant(opts, fn)
 *     1. Laddar företagets tillstånd (EN transaktion, RLS-bunden).
 *     2. Kör fn i AsyncLocalStorage-kontext – db()/save() i domänlagret
 *        arbetar mot det laddade tillståndet, helt oförändrade.
 *     3. Om save() kallats: diffar mot baslinjen och skriver atomärt
 *        (commitTenantState). Vid CAS-/sekvenskonflikt körs fn om mot
 *        nyladdat tillstånd (max MAX_ATTEMPTS gånger).
 *
 * fn måste därför vara fri från externa sidoeffekter (mejl osv). Flöden som
 * mejlar delar upp sig i flera runWithTenant-block (se document-mail).
 */
import type { DB } from "../types";
import { supabaseEnv } from "./config";
import { cloneState, runInTenantContext, type TenantContext } from "./context";
import { commitTenantState, isRetryableStorageError } from "./commit";
import { getSqlClient, type SqlClient } from "./executor";
import { bindTransaction, loadTenantState } from "./load";

const MAX_ATTEMPTS = 3;

/** Testkrok: låter integrationstester köra adaptern mot PGlite. */
let clientOverride: SqlClient | null = null;
export function setSqlClientForTests(client: SqlClient | null): void {
  clientOverride = client;
}

export async function sqlClient(): Promise<SqlClient> {
  if (clientOverride) return clientOverride;
  return getSqlClient(supabaseEnv().dbUrl);
}

export interface RunWithTenantOptions {
  businessId: string;
  /** Verifierad användare (auth.users.id). null för publika tokenflöden. */
  userId: string | null;
  /** "read" = save() förbjudet (sidorenderingar), "write" = commit vid dirty. */
  access: "read" | "write";
  /**
   * Får fn köras om vid samtidighetskonflikt? Endast om fn saknar externa
   * sidoeffekter. Serveractions utan mejl: true. Mejlflöden: false.
   */
  retry?: boolean;
}

export async function runWithTenant<T>(opts: RunWithTenantOptions, fn: () => T | Promise<T>): Promise<T> {
  const client = await sqlClient();
  const attempts = opts.retry === false ? 1 : MAX_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const loaded = await client.transaction(async (tx) => {
      await bindTransaction(tx, opts.businessId);
      return loadTenantState(tx, opts.businessId);
    });

    const ctx: TenantContext = {
      businessId: opts.businessId,
      userId: opts.userId,
      writable: opts.access === "write",
      state: loaded.state,
      baseline: cloneState(loaded.state),
      stateVersion: loaded.stateVersion,
      dirty: false,
    };

    try {
      const result = await runInTenantContext(ctx, () => fn());
      if (ctx.dirty && opts.access === "write") {
        await client.transaction(async (tx) => {
          await bindTransaction(tx, opts.businessId);
          await commitTenantState(tx, {
            businessId: opts.businessId,
            userId: opts.userId,
            baseline: ctx.baseline,
            state: ctx.state,
            stateVersion: ctx.stateVersion,
          });
        });
      }
      return result;
    } catch (err) {
      // redirect()/notFound() kastar kontrollflödesfel – committa först,
      // så att åtgärden inte tappas när actionen avslutas med redirect.
      if (isNextControlFlowError(err)) {
        if (ctx.dirty && opts.access === "write") {
          await client.transaction(async (tx) => {
            await bindTransaction(tx, opts.businessId);
            await commitTenantState(tx, {
              businessId: opts.businessId,
              userId: opts.userId,
              baseline: ctx.baseline,
              state: ctx.state,
              stateVersion: ctx.stateVersion,
            });
          });
        }
        throw err;
      }
      if (isRetryableStorageError(err) && attempt < attempts) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("Kunde inte genomföra ändringen efter flera försök.");
}

/** Next.js kontrollflödesfel (redirect/notFound) känns igen på digest. */
function isNextControlFlowError(err: unknown): boolean {
  const digest = (err as { digest?: string } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_HTTP_ERROR_FALLBACK;404");
}

/**
 * Läs in ett företags hela state utan att öppna en skrivkontext – används av
 * sidorenderingar (request-scope-cellen). Ingen commit sker någonsin här.
 */
export async function loadStateSnapshot(businessId: string): Promise<DB> {
  const client = await sqlClient();
  const loaded = await client.transaction(async (tx) => {
    await bindTransaction(tx, businessId);
    return loadTenantState(tx, businessId);
  });
  return loaded.state;
}

/* ------------------------- uppslag utanför tenantkontext ------------------------- */

export type PublicTokenKind = "quote" | "invoice" | "bankid_order" | "website" | "website_slug" | "hostname" | "inbound";

/** Slå upp företag + entitet för en publik token (offert-/fakturalänk, sajt). */
export async function resolvePublicToken(
  kind: PublicTokenKind,
  token: string
): Promise<{ businessId: string; entityId: string } | null> {
  if (!token) return null;
  const client = await sqlClient();
  const rows = await client.transaction(async (tx) => {
    await tx.query(`set local role driva_app`);
    return tx.query(`select business_id, entity_id from app.resolve_public_token($1, $2)`, [kind, token]);
  });
  const row = rows[0];
  if (!row?.business_id) return null;
  return { businessId: String(row.business_id), entityId: String(row.entity_id) };
}

export interface MembershipInfo {
  businessId: string;
  role: "owner" | "admin" | "member";
}

/**
 * Medlemskap för en VERIFIERAD användare (id från Supabase Auth-sessionen).
 * Körs som anslutningsrollen (postgres/driva_app-login) – före tenantkontext.
 */
export async function membershipsForUser(userId: string): Promise<MembershipInfo[]> {
  const client = await sqlClient();
  const rows = await client.query(
    `select business_id, role from public.business_memberships where user_id = $1 order by created_at, business_id`,
    [userId]
  );
  return rows.map((r) => ({ businessId: String(r.business_id), role: r.role as MembershipInfo["role"] }));
}

/**
 * Onboarding: skapa företag + ägarmedlemskap + inställningar + nummerserier
 * atomärt. Returnerar företagets id.
 */
export async function createBusinessWithOwner(input: {
  userId: string;
  name: string;
  orgNumber: string;
  email: string;
  phone: string;
}): Promise<string> {
  const client = await sqlClient();
  return client.transaction(async (tx) => {
    const idRows = await tx.query(`select gen_random_uuid()::text as id`);
    const businessId = String(idRows[0].id);
    await bindTransaction(tx, businessId);
    await tx.query(
      `insert into public.businesses (id, name, org_number, meta)
       values ($1, $2, $3, jsonb_build_object('seededAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`,
      [businessId, input.name, input.orgNumber]
    );
    await tx.query(
      `insert into public.business_memberships (business_id, user_id, role) values ($1, $2, 'owner')`,
      [businessId, input.userId]
    );
    await tx.query(
      `insert into public.business_settings (business_id, name, org_number, email, phone, logo_initials, inbound_mail_slug)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [businessId, input.name, input.orgNumber, input.email, input.phone, initialsFor(input.name), inboundSlugFor(businessId)]
    );
    await tx.query(`insert into public.business_sequences (business_id) values ($1)`, [businessId]);
    return businessId;
  });
}

function initialsFor(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return initials.join("") || "AB";
}

function inboundSlugFor(businessId: string): string {
  const compact = businessId.replace(/-/g, "");
  return compact.slice(0, 12) || "inbox";
}
