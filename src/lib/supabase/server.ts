/**
 * Supabase-klienter för serversidan (@supabase/ssr).
 *
 * Sessionen bor i cookies. I Server Components är cookies skrivskyddade –
 * uppfriskning av utgångna sessioner sköts av src/proxy.ts, som kör före
 * varje request. Server actions och route handlers får skriva cookies.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/storage/config";

export async function createSupabaseServerClient() {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) {
    throw new Error("Supabase-miljön saknas (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  }
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component-rendering: cookies är skrivskyddade här.
          // Sessioner friskas upp i src/proxy.ts i stället.
        }
      },
    },
  });
}
