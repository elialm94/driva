/**
 * Service role-klient för Supabase Auth-administration (ban/radera konto,
 * skicka om verifiering kräver dock bara anon-nyckeln).
 *
 * ENDAST serversidan. Nyckeln läses ur SUPABASE_SERVICE_ROLE_KEY och når
 * aldrig klientbundlar (inget NEXT_PUBLIC_-prefix, ingen export till UI).
 * Saknas nyckeln returneras null och anropande åtgärder visar ett ÄRLIGT
 * "inte tillgänglig i den här miljön" – aldrig fejkad framgång.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "../storage/config";

export function supabaseAuthAdminClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const AUTH_ADMIN_UNAVAILABLE =
  "Åtgärden kräver SUPABASE_SERVICE_ROLE_KEY på servern (Vercel-miljövariabel). Den är inte satt i den här miljön.";
