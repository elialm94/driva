/**
 * Plattformsregister för JSON-läget (ENDAST utveckling/tester).
 *
 * Supabase-läget använder aldrig den här filen – där bor plattformsdatat i
 * riktiga tabeller (platform_admins, support_tickets, …) med RLS. Samma
 * mönster som collaboration/registry.ts: in-memory + .data/platform.json,
 * ingen persistens alls under DRIVA_TEST=1.
 */
import fs from "fs";
import path from "path";
import type {
  AdminAuditEntry,
  EmailEvent,
  PlatformAdmin,
  PlatformAdminInvitation,
  SupportSession,
  SupportTicket,
} from "./types";

export interface PlatformRegistry {
  admins: PlatformAdmin[];
  invitations: PlatformAdminInvitation[];
  tickets: SupportTicket[];
  sessions: SupportSession[];
  auditLog: AdminAuditEntry[];
  emailEvents: EmailEvent[];
  /** Företag som inaktiverats av admin (JSON-läget saknar businesses-tabell). */
  disabledBusinesses: { businessId: string; disabledAt: string; disabledBy: string }[];
}

const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_FILE = onServerless
  ? path.join("/tmp", "driva-platform.json")
  : path.join(process.cwd(), ".data", "platform.json");

type GlobalWithPlatform = typeof globalThis & { __drivaPlatform?: PlatformRegistry };
const g = globalThis as GlobalWithPlatform;

function empty(): PlatformRegistry {
  return {
    admins: [],
    invitations: [],
    tickets: [],
    sessions: [],
    auditLog: [],
    emailEvents: [],
    disabledBusinesses: [],
  };
}

function persist(data: PlatformRegistry) {
  if (process.env.DRIVA_TEST === "1") return;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  } catch {
    // Read-only FS: in-memory räcker i dev.
  }
}

function loadFromDisk(): PlatformRegistry {
  if (process.env.DRIVA_TEST === "1") return empty();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as Partial<PlatformRegistry>;
      return { ...empty(), ...loaded };
    }
  } catch {
    /* korrupt fil → tomt register */
  }
  return empty();
}

export function platformRegistry(): PlatformRegistry {
  if (!g.__drivaPlatform) g.__drivaPlatform = loadFromDisk();
  return g.__drivaPlatform;
}

export function resetPlatformRegistry(): void {
  g.__drivaPlatform = empty();
  persist(g.__drivaPlatform);
}

export function commitPlatformRegistry(): void {
  persist(platformRegistry());
}
