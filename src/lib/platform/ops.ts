/**
 * Driftposter (spec §6): verifierbara händelser för systemvyn – ingen
 * simulering. En restore drill räknas bara när en super_admin registrerat
 * den med resultat och ansvarig; ett mejltest bara när ett riktigt utskick
 * gjorts till adminens egen adress; en cronkörning bara när routen kört.
 */
import { uid } from "../ids";
import { appOrigin, sendMail, mailFromAddress, isLiveMailConfigured, MAIL_NOT_CONFIGURED } from "../mail";
import { writeAdminAudit } from "./audit";
import { insertOpsRecord, latestOpsRecord } from "./store";
import type { OpsRecord, PlatformAdmin } from "./types";

export class OpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsError";
  }
}

function environmentLabel(env: Record<string, string | undefined> = process.env): string {
  return env.VERCEL_ENV?.trim() || env.NODE_ENV || "development";
}

/* --------------------------------- Cron ------------------------------------ */

export async function recordCronRun(
  job: string,
  result: { businesses: number; errors: number; extra?: Record<string, number> },
  durationMs: number
): Promise<void> {
  try {
    await insertOpsRecord({
      id: uid(),
      kind: "cron_run",
      createdAt: new Date().toISOString(),
      status: result.errors === 0 ? "ok" : result.errors >= result.businesses ? "fel" : "partiell",
      environment: environmentLabel(),
      summary: { job, businesses: result.businesses, errors: result.errors, durationMs, ...(result.extra ?? {}) },
    });
  } catch {
    // Loggen får aldrig fälla själva körningen.
  }
}

/* ------------------------------ Inkommande mejl ----------------------------- */

export async function recordInboundMail(status: "ok" | "fel", summary: { httpStatus: number; created?: boolean }): Promise<void> {
  try {
    await insertOpsRecord({
      id: uid(),
      kind: "email_inbound",
      createdAt: new Date().toISOString(),
      status,
      environment: environmentLabel(),
      summary,
    });
  } catch {
    /* sekundär logg */
  }
}

/* ------------------------------ Mejltest (ut) ------------------------------- */

/**
 * Skicka ett testmejl till adminens EGEN adress (aldrig fri mottagare) och
 * logga resultatet utan innehåll. Mock-läge räknas inte som lyckat test.
 */
export async function sendAdminTestEmail(actor: PlatformAdmin): Promise<{ ok: boolean; message: string }> {
  if (!isLiveMailConfigured()) throw new OpsError(MAIL_NOT_CONFIGURED);
  if (!actor.email) throw new OpsError("Adminkontot saknar e-postadress.");
  const correlationId = uid().slice(0, 12);
  const origin = appOrigin();
  const result = await sendMail(
    {
      to: actor.email,
      from: mailFromAddress(),
      subject: `Ferva Admin – testmejl ${correlationId}`,
      text: `Det här är ett testmejl från Ferva Admin (${origin}). Referens: ${correlationId}. Om du fick det fungerar utgående e-post (SPF/DKIM kontrolleras i mottagarens rubriker).`,
      html: `<p>Det här är ett testmejl från Ferva Admin (${origin}).</p><p>Referens: <code>${correlationId}</code></p><p>Om du fick det fungerar utgående e-post. Kontrollera SPF/DKIM/DMARC i mottagarens rubriker ("Visa original").</p>`,
    },
    { kind: "admin_test" }
  );
  const ok = result.ok && result.mode === "live";
  await insertOpsRecord({
    id: uid(),
    kind: "email_test_outbound",
    createdAt: new Date().toISOString(),
    recordedByUserId: actor.userId,
    recordedByEmail: actor.email,
    status: ok ? "ok" : "fel",
    environment: environmentLabel(),
    summary: {
      correlationId,
      mode: result.mode,
      providerMessageId: result.ok ? result.messageId ?? null : null,
      error: result.ok ? null : result.error,
    },
  });
  await writeAdminAudit(actor, {
    action: "email_test_sent",
    targetType: "email",
    metadata: { correlationId, ok },
  });
  return {
    ok,
    message: ok
      ? `Testmejl skickat till ${actor.email} (referens ${correlationId}). Kontrollera inkorgen och rubrikerna.`
      : `Utskicket misslyckades: ${result.ok ? `läge ${result.mode} räknas inte som live` : result.error}`,
  };
}

/* ------------------------------ Restore drill ------------------------------- */

export interface RestoreDrillInput {
  /** Datum då drillen genomfördes (YYYY-MM-DD). */
  performedOn: string;
  /** Explicit staging-identitet (projektref/namn) som återläsningen gjordes mot. */
  targetEnvironment: string;
  responsible: string;
  result: "ok" | "fel";
  rpoMinutes: number;
  rtoMinutes: number;
  /** Datum PITR/backup bekräftades påslaget i Supabase-dashboarden (valfritt). */
  pitrConfirmedOn?: string;
  /** Verifieringsutfall från scripts/restore-drill.ts (valfritt, endast kända fält). */
  checks?: {
    schemaOk?: boolean;
    latestMigration?: string;
    tenantCount?: number;
    immutabilityOk?: boolean;
    balancesOk?: boolean;
    checksum?: string;
  };
  notes?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validera formulärdata → strukturerad drill. Kastar OpsError med begripligt fel. */
export function parseRestoreDrillInput(raw: Record<string, unknown>): RestoreDrillInput {
  const str = (k: string) => String(raw[k] ?? "").trim();
  const performedOn = str("performedOn");
  if (!DATE_RE.test(performedOn)) throw new OpsError("Ange datum för drillen (ÅÅÅÅ-MM-DD).");
  if (performedOn > new Date().toISOString().slice(0, 10)) throw new OpsError("Drillens datum kan inte ligga i framtiden.");
  const targetEnvironment = str("targetEnvironment");
  if (targetEnvironment.length < 3) throw new OpsError("Ange vilken staging-miljö återläsningen gjordes mot.");
  if (/prod/i.test(targetEnvironment)) throw new OpsError("En restore drill får aldrig göras mot produktion – ange staging-miljön.");
  const responsible = str("responsible");
  if (responsible.length < 2) throw new OpsError("Ange ansvarig person.");
  const result = str("result");
  if (result !== "ok" && result !== "fel") throw new OpsError("Ange resultat: ok eller fel.");
  const rpoMinutes = Number(str("rpoMinutes"));
  const rtoMinutes = Number(str("rtoMinutes"));
  if (!Number.isFinite(rpoMinutes) || rpoMinutes < 0 || rpoMinutes > 100000) throw new OpsError("RPO (minuter) måste vara ett tal ≥ 0.");
  if (!Number.isFinite(rtoMinutes) || rtoMinutes < 0 || rtoMinutes > 100000) throw new OpsError("RTO (minuter) måste vara ett tal ≥ 0.");
  const pitrConfirmedOn = str("pitrConfirmedOn");
  if (pitrConfirmedOn && !DATE_RE.test(pitrConfirmedOn)) throw new OpsError("PITR-bekräftelsen ska vara ett datum (ÅÅÅÅ-MM-DD).");
  const notes = str("notes").slice(0, 500);
  const checks = parseChecks(str("checksJson"));
  return {
    performedOn,
    targetEnvironment: targetEnvironment.slice(0, 80),
    responsible: responsible.slice(0, 80),
    result,
    rpoMinutes: Math.round(rpoMinutes),
    rtoMinutes: Math.round(rtoMinutes),
    pitrConfirmedOn: pitrConfirmedOn || undefined,
    checks,
    notes: notes || undefined,
  };
}

/** Endast kända, icke-känsliga fält ur scriptets JSON-utdata tas med. */
function parseChecks(json: string): RestoreDrillInput["checks"] | undefined {
  if (!json) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new OpsError("Scriptutdata måste vara giltig JSON (klistra in raden efter 'RESULT').");
  }
  if (!parsed || typeof parsed !== "object") throw new OpsError("Scriptutdata måste vara ett JSON-objekt.");
  const o = parsed as Record<string, unknown>;
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  return {
    schemaOk: bool(o.schemaOk),
    latestMigration: typeof o.latestMigration === "string" ? o.latestMigration.slice(0, 40) : undefined,
    tenantCount: typeof o.tenantCount === "number" ? o.tenantCount : undefined,
    immutabilityOk: bool(o.immutabilityOk),
    balancesOk: bool(o.balancesOk),
    checksum: typeof o.checksum === "string" ? o.checksum.slice(0, 64) : undefined,
  };
}

export async function recordRestoreDrill(actor: PlatformAdmin, input: RestoreDrillInput): Promise<OpsRecord> {
  const rec: OpsRecord = {
    id: uid(),
    kind: "restore_drill",
    createdAt: new Date().toISOString(),
    recordedByUserId: actor.userId,
    recordedByEmail: actor.email,
    status: input.result,
    environment: input.targetEnvironment,
    summary: {
      performedOn: input.performedOn,
      responsible: input.responsible,
      rpoMinutes: input.rpoMinutes,
      rtoMinutes: input.rtoMinutes,
      pitrConfirmedOn: input.pitrConfirmedOn ?? null,
      checks: input.checks ?? null,
      notes: input.notes ?? null,
    },
  };
  await insertOpsRecord(rec);
  await writeAdminAudit(actor, {
    action: "restore_drill_recorded",
    targetType: "ops_record",
    targetId: rec.id,
    metadata: { performedOn: input.performedOn, result: input.result, targetEnvironment: input.targetEnvironment },
  });
  return rec;
}

/* -------------------------------- Systemvy --------------------------------- */

export interface BackupStatus {
  /** Senaste registrerade drill eller null ⇒ "Ej verifierat". */
  lastDrill: OpsRecord | null;
  /** Dagar sedan drillen, om någon. */
  daysSinceDrill: number | null;
  /** Drill äldre än 180 dagar räknas som förfallen. */
  stale: boolean;
}

export async function backupStatus(now = Date.now()): Promise<BackupStatus> {
  const lastDrill = await latestOpsRecord("restore_drill").catch(() => null);
  if (!lastDrill) return { lastDrill: null, daysSinceDrill: null, stale: true };
  const performedOn = typeof lastDrill.summary.performedOn === "string" ? lastDrill.summary.performedOn : lastDrill.createdAt;
  const days = Math.floor((now - new Date(performedOn).getTime()) / (24 * 60 * 60 * 1000));
  return { lastDrill, daysSinceDrill: days, stale: days > 180 || lastDrill.status !== "ok" };
}
