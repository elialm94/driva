import { sqlClient } from "./adapter-supabase";

/** Aktiva skarpa företag – cron ska inte mejla demo eller avstängda. */
export async function listActiveBusinessIds(): Promise<string[]> {
  const client = await sqlClient();
  const rows = await client.query(
    `select id::text as id
       from public.businesses
      where coalesce(is_demo, false) = false
        and disabled_at is null
      order by created_at`
  );
  return rows.map((r) => String(r.id));
}
