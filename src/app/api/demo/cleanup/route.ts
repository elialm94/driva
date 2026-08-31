/**
 * GET /api/demo/cleanup – schemalagd städning av utgångna demosessioner.
 *
 * Anropas av Vercel Cron (vercel.json) med Authorization: Bearer CRON_SECRET.
 * Rensar i tre steg, alla med hårda villkor som aldrig kan träffa riktiga data:
 *
 *   1. Utgångna demoföretag (is_demo AND demo_expires_at < now()):
 *      lagringsobjekt (kvitton/hemsidebilder under företagets prefix) och
 *      därefter app.delete_demo_business – funktionen verifierar själv
 *      is_demo + utgången demo_expires_at i SQL innan något raderas.
 *   2. De anonyma auth-användare som ägde företagen (inga medlemskap kvar).
 *   3. Föräldralösa anonyma användare (äldre än 24 h, inga medlemskap) –
 *      rester från avbrutna provisioneringar eller tidigare delkörningar.
 *
 * Körningen är idempotent och batchad: hinner den inte allt tar nästa
 * körning resten. Fel per företag samlas i svaret i stället för att stoppa.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseMode } from "@/lib/storage/config";
import { sqlClient } from "@/lib/storage/adapter-supabase";
import { supabaseAuthAdminClient } from "@/lib/platform/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Batchstorlek per körning – cron går varje timme, resten tas nästa varv. */
const MAX_BUSINESSES_PER_RUN = 20;
const MAX_ORPHAN_USERS_PER_RUN = 100;
const STORAGE_BUCKETS = ["receipts", "website-images"] as const;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function GET(request: NextRequest) {
  if (!isSupabaseMode()) {
    return NextResponse.json({ ok: false, error: "Städningen gäller endast Supabase-läget." }, { status: 503 });
  }
  if (!process.env.CRON_SECRET?.trim()) {
    // Ärligt fel i stället för en oskyddad radervärld: utan hemlighet körs inget.
    return NextResponse.json({ ok: false, error: "CRON_SECRET är inte satt." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Ogiltig authorization." }, { status: 401 });
  }

  const client = await sqlClient();
  const admin = supabaseAuthAdminClient();
  const errors: string[] = [];
  let deletedBusinesses = 0;
  let deletedFiles = 0;
  let deletedUsers = 0;

  // 1. Utgångna demoföretag. Villkoret speglar app.delete_demo_business –
  //    urvalsfrågan kan aldrig lista ett riktigt företag.
  const expired = (await client.query(
    `select id::text as id
       from public.businesses
      where is_demo
        and demo_expires_at is not null
        and demo_expires_at < now()
      order by demo_expires_at
      limit $1`,
    [MAX_BUSINESSES_PER_RUN]
  )) as { id: string }[];

  for (const { id } of expired) {
    try {
      // Ägarna behövs efter raderingen (cascade tar medlemskapsraderna).
      const members = (await client.query(
        `select distinct user_id::text as user_id
           from public.business_memberships
          where business_id = $1`,
        [id]
      )) as { user_id: string }[];

      deletedFiles += await deleteStorageObjects(client, admin, id, errors);

      // Funktionens egna SQL-villkor (is_demo + utgången demo_expires_at)
      // är den sista grinden – returnerar false rör vi inget mer.
      const res = (await client.query(`select app.delete_demo_business($1::uuid) as deleted`, [id])) as {
        deleted: boolean;
      }[];
      if (!res[0]?.deleted) continue;
      deletedBusinesses += 1;

      for (const { user_id } of members) {
        deletedUsers += await deleteAnonymousUserIfOrphan(client, admin, user_id, errors);
      }
    } catch (e) {
      errors.push(`företag ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. Föräldralösa anonyma användare: skapade för > 24 h sedan men utan
  //    medlemskap (avbruten provisionering eller tidigare delkörning).
  try {
    const orphans = (await client.query(
      `select u.id::text as id
         from auth.users u
        where u.is_anonymous
          and u.created_at < now() - interval '24 hours'
          and not exists (
            select 1 from public.business_memberships m where m.user_id = u.id
          )
        limit $1`,
      [MAX_ORPHAN_USERS_PER_RUN]
    )) as { id: string }[];
    for (const { id } of orphans) {
      deletedUsers += await deleteAnonymousUserIfOrphan(client, admin, id, errors);
    }
  } catch (e) {
    errors.push(`föräldralösa användare: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json({
    ok: errors.length === 0,
    expiredFound: expired.length,
    deletedBusinesses,
    deletedFiles,
    deletedUsers,
    errors,
  });
}

type Sql = Awaited<ReturnType<typeof sqlClient>>;
type Admin = ReturnType<typeof supabaseAuthAdminClient>;

/**
 * Ta bort företagets lagringsobjekt (sökvägskonventionen är
 * `<business_id>/…` i båda buckets). Namnen listas via SQL; själva
 * borttagningen går via Storage-API:t (service role) så att även de
 * underliggande filerna försvinner – SQL-delete är reservvägen (lokal miljö).
 */
async function deleteStorageObjects(client: Sql, admin: Admin, businessId: string, errors: string[]): Promise<number> {
  let deleted = 0;
  for (const bucket of STORAGE_BUCKETS) {
    try {
      const rows = (await client.query(
        `select name from storage.objects where bucket_id = $1 and name like $2 || '/%'`,
        [bucket, businessId]
      )) as { name: string }[];
      if (rows.length === 0) continue;
      const names = rows.map((r) => r.name);
      if (admin) {
        for (let i = 0; i < names.length; i += 100) {
          const chunk = names.slice(i, i + 100);
          const { error } = await admin.storage.from(bucket).remove(chunk);
          if (error) throw new Error(error.message);
          deleted += chunk.length;
        }
      } else {
        await client.query(`delete from storage.objects where bucket_id = $1 and name like $2 || '/%'`, [
          bucket,
          businessId,
        ]);
        deleted += names.length;
      }
    } catch (e) {
      errors.push(`lagring ${bucket}/${businessId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return deleted;
}

/**
 * Ta bort EN anonym användare – aldrig en riktig. Dubbla grindar:
 * SQL-frågan kräver is_anonymous och noll kvarvarande medlemskap, och
 * raderingen (admin-API eller SQL-reserv) villkorar på samma sak.
 */
async function deleteAnonymousUserIfOrphan(
  client: Sql,
  admin: Admin,
  userId: string,
  errors: string[]
): Promise<number> {
  try {
    const check = (await client.query(
      `select 1
         from auth.users u
        where u.id = $1::uuid
          and u.is_anonymous
          and not exists (
            select 1 from public.business_memberships m where m.user_id = u.id
          )`,
      [userId]
    )) as unknown[];
    if (check.length === 0) return 0;
    if (admin) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    } else {
      await client.query(`delete from auth.users where id = $1::uuid and is_anonymous`, [userId]);
    }
    return 1;
  } catch (e) {
    errors.push(`användare ${userId}: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
