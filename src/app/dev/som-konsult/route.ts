import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  BUSINESS_COOKIE,
  LOCAL_USER_COOKIE,
  WORKSPACE_COOKIE,
} from "@/lib/auth/session";
import {
  LOCAL_JSON_ACCOUNTANT_ID,
  LOCAL_JSON_BUSINESS_ID,
} from "@/lib/collaboration/actor";
import { restoreLocalAccountantDemo } from "@/lib/collaboration/local-demo";
import { isAccountingRole } from "@/lib/collaboration/permissions";
import { activeMembershipFor } from "@/lib/collaboration/registry";
import { isSupabaseMode } from "@/lib/storage/config";

/** Lokal genväg: /redovisning som ägare → byt till seedad konsult. */
export async function GET() {
  if (isSupabaseMode()) redirect("/");
  restoreLocalAccountantDemo();
  const membership = activeMembershipFor(LOCAL_JSON_ACCOUNTANT_ID, LOCAL_JSON_BUSINESS_ID);
  if (!membership || !isAccountingRole(membership.role)) redirect("/");
  const jar = await cookies();
  jar.set(LOCAL_USER_COOKIE, LOCAL_JSON_ACCOUNTANT_ID, { path: "/", sameSite: "lax" });
  jar.set(WORKSPACE_COOKIE, "redovisning", { path: "/", sameSite: "lax" });
  jar.set(BUSINESS_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  jar.delete(BUSINESS_COOKIE);
  redirect("/redovisning");
}
