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
import { bindTransaction, loadTenantState, type LoadedTenantState } from "./load";
import { ensurePendingSchema, resetPendingSchemaGuard } from "./apply-pending-schema";
import { isUndefinedColumn } from "./sql-errors";
import { cachedStateIfFresh, clearSnapshotCache, invalidateSnapshot, putSnapshot } from "./snapshot-cache";
import { markCacheHit, withPerfSpan } from "../perf/telemetry";

const MAX_ATTEMPTS = 3;

/** Testkrok: låter integrationstester köra adaptern mot PGlite. */
let clientOverride: SqlClient | null = null;
export function setSqlClientForTests(client: SqlClient | null): void {
  clientOverride = client;
  // Klientbyte kan peka på en HELT annan databas där samma businessId/version
  // råkar existera – gamla snapshots får aldrig återanvändas.
  clearSnapshotCache();
  resetPendingSchemaGuard();
}

/**
 * Ladda tenanttillstånd med snapshot-cachen framför den fulla laddningen.
 * Cacheträff = 1 versionsfråga. Miss = full laddning i EN transaktion.
 */
async function loadTenantStateCached(client: SqlClient, businessId: string): Promise<LoadedTenantState> {
  const cached = await cachedStateIfFresh(client, businessId);
  if (cached) {
    markCacheHit();
    return { state: cached.state, stateVersion: cached.stateVersion };
  }
  const loaded = await client.transaction(async (tx) => {
    await bindTransaction(tx, businessId);
    return loadTenantState(tx, businessId);
  });
  putSnapshot(businessId, loaded.state, loaded.stateVersion);
  return loaded;
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
    const loaded = await withPerfSpan(`load business=${opts.businessId}`, () =>
      loadTenantStateCached(client, opts.businessId)
    );

    const ctx: TenantContext = {
      businessId: opts.businessId,
      userId: opts.userId,
      writable: opts.access === "write",
      state: loaded.state,
      baseline: cloneState(loaded.state),
      stateVersion: loaded.stateVersion,
      dirty: false,
    };

    // Efter en commit KASTAS cacheposten i stället för att uppdateras med
    // minnestillståndet: databasen normaliserar (radordning, tal, tidsstämplar),
    // så cachen får bara innehålla tillstånd som kommer från en riktig
    // laddning. Nästa läsning läser färskt och fyller cachen igen.
    const commit = async () => {
      await ensurePendingSchema(client);
      try {
        await withPerfSpan(`commit business=${opts.businessId}`, () =>
          client.transaction(async (tx) => {
            await bindTransaction(tx, opts.businessId);
            return commitTenantState(tx, {
              businessId: opts.businessId,
              userId: opts.userId,
              baseline: ctx.baseline,
              state: ctx.state,
              stateVersion: ctx.stateVersion,
            });
          })
        );
      } catch (err) {
        // Saknad kolumn (t.ex. websites.footer / payer_*) efter ny deploy:
        // applicera schemat igen och skriv om en gång. Inte en tyst swallow.
        if (!isUndefinedColumn(err)) throw err;
        resetPendingSchemaGuard();
        await ensurePendingSchema(client);
        await withPerfSpan(`commit-retry-schema business=${opts.businessId}`, () =>
          client.transaction(async (tx) => {
            await bindTransaction(tx, opts.businessId);
            return commitTenantState(tx, {
              businessId: opts.businessId,
              userId: opts.userId,
              baseline: ctx.baseline,
              state: ctx.state,
              stateVersion: ctx.stateVersion,
            });
          })
        );
      }
      invalidateSnapshot(opts.businessId);
    };

    try {
      const result = await runInTenantContext(ctx, () => fn());
      if (ctx.dirty && opts.access === "write") {
        await commit();
      }
      return result;
    } catch (err) {
      // redirect()/notFound() kastar kontrollflödesfel – committa först,
      // så att åtgärden inte tappas när actionen avslutas med redirect.
      if (isNextControlFlowError(err)) {
        if (ctx.dirty && opts.access === "write") {
          await commit();
        }
        throw err;
      }
      if (isRetryableStorageError(err) && attempt < attempts) {
        // Konflikt = vår baslinje var inaktuell. Kasta cacheposten så nästa
        // varv garanterat läser färskt från databasen.
        invalidateSnapshot(opts.businessId);
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
 * Snapshot-cachen gör varma sidladdningar till EN versionsfråga i stället
 * för full tillståndsladdning.
 *
 * OBS: medvetet INTE React cache() här. AI-verktygsslingan läser tillstånd,
 * committar och läser om INOM samma request – en per-request-memo hade gett
 * inaktuella omläsningar. Snapshot-cachen gör ändå omläsningen till en enda
 * billig PK-fråga.
 */
export async function loadStateSnapshot(businessId: string): Promise<DB> {
  const client = await sqlClient();
  const loaded = await withPerfSpan(`load business=${businessId}`, () =>
    loadTenantStateCached(client, businessId)
  );
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
  role: import("../types").BusinessRole;
  lastActiveAt?: string;
  invitedByUserId?: string;
}

/**
 * Medlemskap för en VERIFIERAD användare (id från Supabase Auth-sessionen).
 * Återkallade rader filtreras bort – gamla sessioner får ingen åtkomst.
 * Företag som inaktiverats av Driva Admin (businesses.disabled_at) räknas
 * inte heller – medlemmarna stängs ute tills företaget återaktiveras.
 */
export async function membershipsForUser(userId: string): Promise<MembershipInfo[]> {
  const client = await sqlClient();
  // Inte b.disabled_at i SQL: kolumnen saknas tills admin-migrationen körts
  // och en saknad kolumn inne i andra tx kan fälla sidladdningen. Filtrera
  // inaktiverade företag i JS när kolumnen finns.
  const rows = await client.query(
    `select m.business_id, m.role, m.last_active_at, m.invited_by_user_id,
            ${await businessesDisabledAtSql(client)} as disabled_at
       from public.business_memberships m
       join public.businesses b on b.id = m.business_id
      where m.user_id = $1 and m.revoked_at is null
      order by m.created_at, m.business_id`,
    [userId]
  );
  return rows
    .filter((r) => !r.disabled_at)
    .map((r) => ({
      businessId: String(r.business_id),
      role: r.role as MembershipInfo["role"],
      lastActiveAt: r.last_active_at ? String(r.last_active_at) : undefined,
      invitedByUserId: r.invited_by_user_id ? String(r.invited_by_user_id) : undefined,
    }));
}

async function businessesDisabledAtSql(client: SqlClient): Promise<string> {
  const rows = await client.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'businesses' and column_name = 'disabled_at'
     ) as present`
  );
  return rows[0]?.present ? "b.disabled_at" : "null::timestamptz";
}

export async function insertMembership(input: {
  businessId: string;
  userId: string;
  role: MembershipInfo["role"];
  invitedByUserId?: string;
}): Promise<void> {
  const client = await sqlClient();
  await client.query(
    `insert into public.business_memberships (business_id, user_id, role, invited_by_user_id, accepted_at)
     values ($1, $2, $3, $4, now())
     on conflict (business_id, user_id) do update
       set role = excluded.role,
           revoked_at = null,
           invited_by_user_id = coalesce(excluded.invited_by_user_id, public.business_memberships.invited_by_user_id),
           accepted_at = coalesce(public.business_memberships.accepted_at, now())`,
    [input.businessId, input.userId, input.role, input.invitedByUserId ?? null]
  );
}

export async function revokeMembershipRow(businessId: string, userId: string): Promise<void> {
  const client = await sqlClient();
  // Samarbeta hanterar bara konsulter/revisorer. Ägarmedlemskap återkallas
  // aldrig den här vägen – skyddar både riktiga ägare mot förfalskade
  // revoke-anrop och det delade demoföretagets enda medlemskap.
  await client.query(
    `update public.business_memberships
        set revoked_at = now()
      where business_id = $1 and user_id = $2 and revoked_at is null
        and role in ('accounting_consultant', 'auditor')`,
    [businessId, userId]
  );
}

export async function touchMembershipActive(businessId: string, userId: string): Promise<void> {
  const client = await sqlClient();
  await client.query(
    `update public.business_memberships
        set last_active_at = now()
      where business_id = $1 and user_id = $2 and revoked_at is null`,
    [businessId, userId]
  );
}

export async function businessNameById(businessId: string): Promise<string> {
  const client = await sqlClient();
  const rows = await client.query(`select name from public.business_settings where business_id = $1`, [businessId]);
  return rows[0]?.name ? String(rows[0].name) : "";
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
  vatNumber?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  bankgiro?: string;
  plusgiro?: string;
  bankAccount?: string;
  /**
   * Endast seed-skriptets demoprovisionering. is_demo fryses av en trigger
   * vid insert – appens onboarding skapar aldrig demoföretag.
   */
  isDemo?: boolean;
}): Promise<string> {
  const client = await sqlClient();
  await ensurePendingSchema(client);
  return client.transaction(async (tx) => {
    const idRows = await tx.query(`select gen_random_uuid()::text as id`);
    const businessId = String(idRows[0].id);
    await bindTransaction(tx, businessId);
    await tx.query(
      `insert into public.businesses (id, name, org_number, is_demo, meta)
       values ($1, $2, $3, $4, jsonb_build_object('seededAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`,
      [businessId, input.name, input.orgNumber, input.isDemo === true]
    );
    await tx.query(
      `insert into public.business_memberships (business_id, user_id, role) values ($1, $2, 'owner')`,
      [businessId, input.userId]
    );
    await tx.query(
      `insert into public.business_settings (
         business_id, name, org_number, vat_number, email, phone,
         address, postal_code, city, country,
         bankgiro, plusgiro, bank_account,
         logo_initials, inbound_mail_slug
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        businessId,
        input.name,
        input.orgNumber,
        input.vatNumber ?? "",
        input.email,
        input.phone,
        input.address ?? "",
        input.postalCode ?? "",
        input.city ?? "",
        "Sverige",
        input.bankgiro ?? "",
        input.plusgiro ?? null,
        input.bankAccount ?? null,
        initialsFor(input.name),
        inboundSlugFor(businessId),
      ]
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

/* ------------------------- samarbete utanför tenantkontext ------------------------- */

export async function upsertInvitationRow(inv: import("../types").CollaborationInvitation): Promise<void> {
  const client = await sqlClient();
  await client.query(
    `insert into public.collaboration_invitations (
       id, business_id, email, role, invited_by_user_id, invited_by_name, token_hash,
       expires_at, accepted_at, accepted_by_user_id, revoked_at, revoked_by_user_id, status, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (id) do update set
       email = excluded.email,
       role = excluded.role,
       expires_at = excluded.expires_at,
       accepted_at = excluded.accepted_at,
       accepted_by_user_id = excluded.accepted_by_user_id,
       revoked_at = excluded.revoked_at,
       revoked_by_user_id = excluded.revoked_by_user_id,
       status = excluded.status`,
    [
      inv.id,
      inv.businessId,
      inv.email,
      inv.role,
      inv.invitedByUserId,
      inv.invitedByName,
      inv.tokenHash,
      inv.expiresAt,
      inv.acceptedAt ?? null,
      inv.acceptedByUserId ?? null,
      inv.revokedAt ?? null,
      inv.revokedByUserId ?? null,
      inv.status,
      inv.createdAt,
    ]
  );
}

export async function invitationRowByTokenHash(
  tokenHash: string
): Promise<import("../types").CollaborationInvitation | null> {
  const client = await sqlClient();
  const rows = await client.query(
    `select * from public.collaboration_invitations where token_hash = $1`,
    [tokenHash]
  );
  return mapInvitationRow(rows[0]);
}

/** Uppslag per id – används av Driva Admin ("skicka om inbjudan"). */
export async function invitationRowById(
  id: string
): Promise<import("../types").CollaborationInvitation | null> {
  const client = await sqlClient();
  const rows = await client.query(`select * from public.collaboration_invitations where id = $1`, [id]);
  return mapInvitationRow(rows[0]);
}

function mapInvitationRow(
  r: import("./executor").SqlRow | undefined
): import("../types").CollaborationInvitation | null {
  if (!r) return null;
  return {
    id: String(r.id),
    businessId: String(r.business_id),
    email: String(r.email),
    role: r.role as import("../types").CollaborationRole,
    invitedByUserId: String(r.invited_by_user_id),
    invitedByName: String(r.invited_by_name ?? ""),
    tokenHash: String(r.token_hash),
    expiresAt: new Date(r.expires_at as string).toISOString(),
    acceptedAt: r.accepted_at ? new Date(r.accepted_at as string).toISOString() : undefined,
    acceptedByUserId: r.accepted_by_user_id ? String(r.accepted_by_user_id) : undefined,
    revokedAt: r.revoked_at ? new Date(r.revoked_at as string).toISOString() : undefined,
    revokedByUserId: r.revoked_by_user_id ? String(r.revoked_by_user_id) : undefined,
    status: r.status as import("../types").CollaborationInviteStatus,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}
