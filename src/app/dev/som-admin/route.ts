import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCAL_USER_COOKIE } from "@/lib/auth/session";
import { ensureLocalPlatformAdmin, LOCAL_PLATFORM_ADMIN_ID } from "@/lib/platform/auth";
import { isSupabaseMode } from "@/lib/storage/config";

/**
 * Lokal genväg (ENDAST JSON-/utvecklingsläget): byt till den seedade
 * dev-superadminen så att /admin går att testa utan Supabase. I Supabase-läge
 * gör rutten ingenting – produktionsbehörighet kommer alltid från
 * platform_admins + riktig auth (se docs/admin.md).
 */
export async function GET() {
  if (isSupabaseMode()) redirect("/");
  await ensureLocalPlatformAdmin();
  const jar = await cookies();
  jar.set(LOCAL_USER_COOKIE, LOCAL_PLATFORM_ADMIN_ID, { path: "/", sameSite: "lax" });
  redirect("/admin");
}
