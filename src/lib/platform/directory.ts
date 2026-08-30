/**
 * Katalog över företag och användare för Driva Admin – tvär-tenant-läsningar
 * med paginering och serversök. Anropas ENDAST efter requirePlatformAdmin()
 * (auktoriseringen sker i src/lib/platform/auth.ts + adminytans actions).
 *
 * Supabase-läget frågar som anslutningsanvändaren (samma mönster som
 * membershipsForUser i adaptern) – aldrig från klienten, aldrig via Data API.
 * JSON-läget härleder ur det lokala demoföretaget + samarbetsregistret.
 */
import { isSupabaseMode } from "../storage/config";
import { sqlClient } from "../storage/adapter-supabase";
import type { SqlRow } from "../storage/executor";
import { db } from "../store";
import {
  activeMembershipsForBusiness,
  activeMembershipsForUser,
  collaborationRegistry,
  userById,
} from "../collaboration/registry";
import { LOCAL_JSON_BUSINESS_ID } from "../collaboration/actor";
import { platformAdminByUserId, businessDisabledAt } from "./store";
import type { BusinessRole } from "../types";

function iso(v: unknown): string | undefined {
  return v ? new Date(v as string).toISOString() : undefined;
}

function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

/* --------------------------------- Företag --------------------------------- */

export interface BusinessListRow {
  id: string;
  name: string;
  orgNumber: string;
  email: string;
  city: string;
  ownerEmail: string;
  memberCount: number;
  createdAt: string;
  lastActivityAt?: string;
  disabledAt?: string;
  isDemo: boolean;
}

export type BusinessStatusFilter = "alla" | "aktiva" | "inaktiverade" | "demo";

export interface BusinessSearchInput {
  q?: string;
  status?: BusinessStatusFilter;
  limit?: number;
  offset?: number;
}

export interface BusinessSearchResult {
  rows: BusinessListRow[];
  total: number;
}

export async function searchBusinesses(input: BusinessSearchInput = {}): Promise<BusinessSearchResult> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const q = input.q?.trim();

  if (!isSupabaseMode()) {
    const state = db();
    const meta = state.meta as { demo?: boolean };
    const disabledAt = (await businessDisabledAt(LOCAL_JSON_BUSINESS_ID)) ?? undefined;
    const members = activeMembershipsForBusiness(LOCAL_JSON_BUSINESS_ID);
    const owner = members.find((m) => m.role === "owner");
    const row: BusinessListRow = {
      id: LOCAL_JSON_BUSINESS_ID,
      name: state.settings.name,
      orgNumber: state.settings.orgNumber,
      email: state.settings.email,
      city: state.settings.city,
      ownerEmail: owner ? userById(owner.userId)?.email ?? "" : "demo@driva.local",
      memberCount: Math.max(members.length, 1),
      createdAt: state.meta.seededAt,
      lastActivityAt: state.activity[0]?.at,
      disabledAt,
      isDemo: meta.demo === true || true, // JSON-läget är per definition demo
    };
    const matchesQ =
      !q ||
      [row.name, row.orgNumber, row.email, row.ownerEmail].some((v) =>
        v.toLowerCase().includes(q.toLowerCase())
      );
    const matchesStatus =
      !input.status ||
      input.status === "alla" ||
      (input.status === "aktiva" && !row.disabledAt) ||
      (input.status === "inaktiverade" && Boolean(row.disabledAt)) ||
      (input.status === "demo" && row.isDemo);
    const rows = matchesQ && matchesStatus ? [row] : [];
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(
      `(b.name ilike ${p} or b.org_number ilike ${p} or coalesce(s.email, '') ilike ${p}
        or exists (
          select 1 from public.business_memberships m
          join auth.users u on u.id = m.user_id
          where m.business_id = b.id and coalesce(u.email, '') ilike ${p}
        ))`
    );
  }
  if (input.status === "aktiva") where.push(`b.disabled_at is null and b.is_demo = false`);
  if (input.status === "inaktiverade") where.push(`b.disabled_at is not null`);
  if (input.status === "demo") where.push(`b.is_demo = true`);
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  const client = await sqlClient();
  const totalRows = await client.query(
    `select count(*)::int as n
       from public.businesses b
       left join public.business_settings s on s.business_id = b.id
      ${whereSql}`,
    params
  );
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const rows = await client.query(
    `select b.id, b.name, b.org_number, b.created_at, b.disabled_at, b.is_demo,
            coalesce(s.email, '') as email, coalesce(s.city, '') as city,
            (select count(*)::int from public.business_memberships m
              where m.business_id = b.id and m.revoked_at is null) as member_count,
            (select u.email from public.business_memberships m
              join auth.users u on u.id = m.user_id
              where m.business_id = b.id and m.role = 'owner' and m.revoked_at is null
              order by m.created_at limit 1) as owner_email,
            (select max(a.created_at) from public.audit_log a where a.business_id = b.id) as last_activity_at
       from public.businesses b
       left join public.business_settings s on s.business_id = b.id
      ${whereSql}
      order by b.created_at desc
      limit $${limitIdx} offset $${params.length}`,
    params
  );
  return {
    total: num(totalRows[0]?.n),
    rows: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      orgNumber: String(r.org_number ?? ""),
      email: String(r.email ?? ""),
      city: String(r.city ?? ""),
      ownerEmail: String(r.owner_email ?? ""),
      memberCount: num(r.member_count),
      createdAt: iso(r.created_at) ?? "",
      lastActivityAt: iso(r.last_activity_at),
      disabledAt: iso(r.disabled_at),
      isDemo: Boolean(r.is_demo),
    })),
  };
}

export interface BusinessMemberRow {
  userId: string;
  email: string;
  role: BusinessRole;
  createdAt?: string;
  lastActiveAt?: string;
}

export interface BusinessDetail {
  id: string;
  name: string;
  orgNumber: string;
  email: string;
  phone: string;
  city: string;
  createdAt: string;
  disabledAt?: string;
  isDemo: boolean;
  members: BusinessMemberRow[];
  counts: {
    customers: number;
    quotes: number;
    issuedInvoices: number;
    verifications: number;
    jobs: number;
    inboxItems: number;
  };
  lastActivityAt?: string;
  recentEvents: { at: string; channel: string; eventType: string; message: string }[];
  financialRecords: boolean;
}

export async function businessDetail(businessId: string): Promise<BusinessDetail | null> {
  if (!isSupabaseMode()) {
    if (businessId !== LOCAL_JSON_BUSINESS_ID) return null;
    const state = db();
    const members = activeMembershipsForBusiness(LOCAL_JSON_BUSINESS_ID).map((m) => ({
      userId: m.userId,
      email: userById(m.userId)?.email ?? "",
      role: m.role,
      createdAt: m.createdAt,
      lastActiveAt: m.lastActiveAt,
    }));
    const issued = state.invoices.filter((i) => i.issuedAt).length;
    return {
      id: LOCAL_JSON_BUSINESS_ID,
      name: state.settings.name,
      orgNumber: state.settings.orgNumber,
      email: state.settings.email,
      phone: state.settings.phone,
      city: state.settings.city,
      createdAt: state.meta.seededAt,
      disabledAt: (await businessDisabledAt(LOCAL_JSON_BUSINESS_ID)) ?? undefined,
      isDemo: true,
      members,
      counts: {
        customers: state.customers.length,
        quotes: state.quotes.length,
        issuedInvoices: issued,
        verifications: state.verifications.length,
        jobs: state.jobs.length,
        inboxItems: state.inboxItems.length,
      },
      lastActivityAt: state.activity[0]?.at,
      recentEvents: state.activity.slice(0, 15).map((a) => ({
        at: a.at,
        channel: "activity",
        eventType: a.entity?.type ?? "handelse",
        message: a.text,
      })),
      financialRecords: state.verifications.length > 0 || issued > 0,
    };
  }

  const client = await sqlClient();
  const [businessRows, settingsRows] = await Promise.all([
    client.query(`select * from public.businesses where id = $1`, [businessId]),
    client.query(`select * from public.business_settings where business_id = $1`, [businessId]),
  ]);
  const b = businessRows[0];
  if (!b) return null;
  const s = settingsRows[0] ?? {};

  const [memberRows, countRows, eventRows] = await Promise.all([
    client.query(
      `select m.user_id, m.role, m.created_at, m.last_active_at, coalesce(u.email, '') as email
         from public.business_memberships m
         left join auth.users u on u.id = m.user_id
        where m.business_id = $1 and m.revoked_at is null
        order by m.created_at`,
      [businessId]
    ),
    client.query(
      `select
         (select count(*)::int from public.customers c where c.business_id = $1) as customers,
         (select count(*)::int from public.quotes q where q.business_id = $1) as quotes,
         (select count(*)::int from public.invoices i where i.business_id = $1 and i.issued_at is not null) as issued_invoices,
         (select count(*)::int from public.verifications v where v.business_id = $1) as verifications,
         (select count(*)::int from public.jobs j where j.business_id = $1) as jobs,
         (select count(*)::int from public.inbox_items x where x.business_id = $1) as inbox_items,
         (select max(a.created_at) from public.audit_log a where a.business_id = $1) as last_activity_at`,
      [businessId]
    ),
    client.query(
      `select created_at, channel, event_type, message
         from public.audit_log where business_id = $1
        order by created_at desc limit 15`,
      [businessId]
    ),
  ]);
  const counts = countRows[0] ?? {};
  const issuedInvoices = num(counts.issued_invoices);
  const verifications = num(counts.verifications);
  return {
    id: String(b.id),
    name: String(b.name ?? ""),
    orgNumber: String(b.org_number ?? ""),
    email: String(s.email ?? ""),
    phone: String(s.phone ?? ""),
    city: String(s.city ?? ""),
    createdAt: iso(b.created_at) ?? "",
    disabledAt: iso(b.disabled_at),
    isDemo: Boolean(b.is_demo),
    members: memberRows.map((m) => ({
      userId: String(m.user_id),
      email: String(m.email ?? ""),
      role: m.role as BusinessRole,
      createdAt: iso(m.created_at),
      lastActiveAt: iso(m.last_active_at),
    })),
    counts: {
      customers: num(counts.customers),
      quotes: num(counts.quotes),
      issuedInvoices,
      verifications,
      jobs: num(counts.jobs),
      inboxItems: num(counts.inbox_items),
    },
    lastActivityAt: iso(counts.last_activity_at),
    recentEvents: eventRows.map((r) => ({
      at: iso(r.created_at) ?? "",
      channel: String(r.channel ?? ""),
      eventType: String(r.event_type ?? ""),
      message: String(r.message ?? ""),
    })),
    financialRecords: verifications > 0 || issuedInvoices > 0,
  };
}

/* -------------------------------- Användare -------------------------------- */

export interface UserListRow {
  id: string;
  email: string;
  createdAt?: string;
  emailConfirmedAt?: string;
  lastSignInAt?: string;
  bannedUntil?: string;
  membershipCount: number;
}

export interface UserSearchResult {
  rows: UserListRow[];
  total: number;
}

export async function searchUsers(input: {
  q?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<UserSearchResult> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const q = input.q?.trim();

  if (!isSupabaseMode()) {
    const reg = collaborationRegistry();
    let users = reg.users.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: undefined as string | undefined,
      emailConfirmedAt: undefined as string | undefined,
      lastSignInAt: undefined as string | undefined,
      bannedUntil: undefined as string | undefined,
      membershipCount: activeMembershipsForUser(u.id).length,
    }));
    if (q) {
      const needle = q.toLowerCase();
      users = users.filter((u) => {
        if (u.email.toLowerCase().includes(needle)) return true;
        const name = userById(u.id)?.name ?? "";
        if (name.toLowerCase().includes(needle)) return true;
        return activeMembershipsForUser(u.id).some((m) =>
          m.businessName.toLowerCase().includes(needle)
        );
      });
    }
    return { rows: users.slice(offset, offset + limit), total: users.length };
  }

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(
      `(coalesce(u.email, '') ilike ${p} or exists (
         select 1 from public.business_memberships m
         join public.businesses b on b.id = m.business_id
         where m.user_id = u.id and b.name ilike ${p}
       ))`
    );
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const client = await sqlClient();
  const totalRows = await client.query(`select count(*)::int as n from auth.users u ${whereSql}`, params);
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const rows = await client.query(
    `select u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at, u.banned_until,
            (select count(*)::int from public.business_memberships m
              where m.user_id = u.id and m.revoked_at is null) as membership_count
       from auth.users u
      ${whereSql}
      order by u.created_at desc nulls last
      limit $${limitIdx} offset $${params.length}`,
    params
  );
  return {
    total: num(totalRows[0]?.n),
    rows: rows.map((r) => ({
      id: String(r.id),
      email: String(r.email ?? ""),
      createdAt: iso(r.created_at),
      emailConfirmedAt: iso(r.email_confirmed_at),
      lastSignInAt: iso(r.last_sign_in_at),
      bannedUntil: iso(r.banned_until),
      membershipCount: num(r.membership_count),
    })),
  };
}

export interface UserMembershipRow {
  businessId: string;
  businessName: string;
  role: BusinessRole;
  isDemo: boolean;
  createdAt?: string;
}

export interface UserDetail {
  id: string;
  email: string;
  createdAt?: string;
  emailConfirmedAt?: string;
  lastSignInAt?: string;
  bannedUntil?: string;
  memberships: UserMembershipRow[];
  isPlatformAdmin: boolean;
  platformRole?: string;
}

export async function userDetail(userId: string): Promise<UserDetail | null> {
  const platformAdmin = await platformAdminByUserId(userId);
  if (!isSupabaseMode()) {
    const user = userById(userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      memberships: activeMembershipsForUser(userId).map((m) => ({
        businessId: m.businessId,
        businessName: m.businessName,
        role: m.role,
        isDemo: m.businessId === LOCAL_JSON_BUSINESS_ID,
        createdAt: m.createdAt,
      })),
      isPlatformAdmin: Boolean(platformAdmin && !platformAdmin.disabledAt),
      platformRole: platformAdmin?.disabledAt ? undefined : platformAdmin?.role,
    };
  }
  const client = await sqlClient();
  const rows = await client.query(
    `select u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at, u.banned_until
       from auth.users u where u.id = $1`,
    [userId]
  );
  const r = rows[0];
  if (!r) return null;
  const membershipRows = await client.query(
    `select m.business_id, m.role, m.created_at, b.name, b.is_demo
       from public.business_memberships m
       join public.businesses b on b.id = m.business_id
      where m.user_id = $1 and m.revoked_at is null
      order by m.created_at`,
    [userId]
  );
  return {
    id: String(r.id),
    email: String(r.email ?? ""),
    createdAt: iso(r.created_at),
    emailConfirmedAt: iso(r.email_confirmed_at),
    lastSignInAt: iso(r.last_sign_in_at),
    bannedUntil: iso(r.banned_until),
    memberships: membershipRows.map((m) => ({
      businessId: String(m.business_id),
      businessName: String(m.name ?? ""),
      role: m.role as BusinessRole,
      isDemo: Boolean(m.is_demo),
      createdAt: iso(m.created_at),
    })),
    isPlatformAdmin: Boolean(platformAdmin && !platformAdmin.disabledAt),
    platformRole: platformAdmin?.disabledAt ? undefined : platformAdmin?.role,
  };
}

/* ----------------------- Raderingspolicy för användare ---------------------- */

/**
 * Radering av användare är en DOMÄNPOLICY – aldrig en blind auth-radering:
 *
 *   * Plattformsadmins raderas inte (ta bort admin-rollen först).
 *   * Företag med bokföring/utfärdade fakturor bevaras ALLTID
 *     (bokföringslagen) – då nekas radering; inaktivera kontot i stället.
 *   * Företag med andra aktiva medlemmar raderas inte (överför ägarskap).
 *   * Tomma företag där användaren är enda medlem raderas tillsammans med
 *     kontot. Konsult-/medlemskap i andras företag återkallas.
 */
export interface UserDeletionPolicy {
  canDelete: boolean;
  blockers: string[];
  businessesToDelete: { id: string; name: string }[];
  membershipsToRevoke: number;
  preserved: string[];
}

export async function userDeletionPolicy(userId: string): Promise<UserDeletionPolicy> {
  const policy: UserDeletionPolicy = {
    canDelete: true,
    blockers: [],
    businessesToDelete: [],
    membershipsToRevoke: 0,
    preserved: [],
  };

  const platformAdmin = await platformAdminByUserId(userId);
  if (platformAdmin && !platformAdmin.disabledAt) {
    policy.blockers.push("Personen är plattformsadmin – ta bort admin-rollen först (Admins-fliken).");
  }

  interface OwnedFacts {
    businessId: string;
    name: string;
    role: BusinessRole;
    otherMembers: number;
    financialRecords: boolean;
  }
  let facts: OwnedFacts[] = [];

  if (!isSupabaseMode()) {
    const state = db();
    const issued = state.invoices.filter((i) => i.issuedAt).length;
    facts = activeMembershipsForUser(userId).map((m) => ({
      businessId: m.businessId,
      name: m.businessName,
      role: m.role,
      otherMembers: activeMembershipsForBusiness(m.businessId).filter((x) => x.userId !== userId).length,
      financialRecords:
        m.businessId === LOCAL_JSON_BUSINESS_ID ? state.verifications.length > 0 || issued > 0 : false,
    }));
  } else {
    const client = await sqlClient();
    const rows = await client.query(
      `select m.business_id, m.role, b.name,
              (select count(*)::int from public.business_memberships m2
                where m2.business_id = m.business_id and m2.revoked_at is null and m2.user_id <> $1) as other_members,
              (select count(*)::int from public.verifications v where v.business_id = m.business_id) as verifications,
              (select count(*)::int from public.invoices i
                where i.business_id = m.business_id and i.issued_at is not null) as issued_invoices
         from public.business_memberships m
         join public.businesses b on b.id = m.business_id
        where m.user_id = $1 and m.revoked_at is null`,
      [userId]
    );
    facts = rows.map((r) => ({
      businessId: String(r.business_id),
      name: String(r.name ?? ""),
      role: r.role as BusinessRole,
      otherMembers: num(r.other_members),
      financialRecords: num(r.verifications) > 0 || num(r.issued_invoices) > 0,
    }));
  }

  for (const f of facts) {
    if (f.role === "owner") {
      if (f.financialRecords) {
        policy.blockers.push(
          `${f.name || f.businessId} har bokföring/utfärdade fakturor som måste bevaras (bokföringslagen). Inaktivera kontot i stället för att radera det.`
        );
        policy.preserved.push(`${f.name || f.businessId}: verifikationer och utfärdade fakturor behålls.`);
      } else if (f.otherMembers > 0) {
        policy.blockers.push(
          `${f.name || f.businessId} har andra aktiva medlemmar – överför ägarskapet innan kontot raderas.`
        );
      } else {
        policy.businessesToDelete.push({ id: f.businessId, name: f.name });
      }
    } else {
      policy.membershipsToRevoke += 1;
    }
  }

  policy.canDelete = policy.blockers.length === 0;
  return policy;
}

/* ---------------------- Raderingspolicy för företag ------------------------- */

export interface BusinessDeletionPolicy {
  canDelete: boolean;
  blockers: string[];
  preserved: string[];
  memberCount: number;
}

export async function businessDeletionPolicy(businessId: string): Promise<BusinessDeletionPolicy> {
  const detail = await businessDetail(businessId);
  if (!detail) {
    return { canDelete: false, blockers: ["Företaget finns inte."], preserved: [], memberCount: 0 };
  }
  const policy: BusinessDeletionPolicy = {
    canDelete: true,
    blockers: [],
    preserved: [],
    memberCount: detail.members.length,
  };
  if (detail.financialRecords) {
    policy.canDelete = false;
    policy.blockers.push(
      "Företaget har bokföring/utfärdade fakturor som måste bevaras (bokföringslagen). Inaktivera företaget i stället."
    );
    policy.preserved.push("Verifikationer, utfärdade fakturor och auditlogg behålls.");
  }
  return policy;
}
