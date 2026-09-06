/**
 * LiveFilingProvider – inlämning via bolagets inlämningstjänst.
 *
 * Väljs bara när FILING_API_* är komplett och företaget inte är demo. Providern
 * gör två saker: skickar filerna med en idempotensnyckel, och hämtar kvittensen.
 * Den tolkar inga siffror och den hittar inte på någon status – ett svar som
 * inte går att förstå blir ett tillfälligt fel, aldrig en kvittens.
 *
 * Kontraktet mot tjänsten:
 *   POST {base}/v1/submissions            → { submissionId, receipt? }
 *   GET  {base}/v1/submissions/{id}/kvittens → { status, receipt? , felmeddelande? }
 */
import type { FilingKind, FilingReceipt } from "../../types";
import type { FilingConfig } from "../config";
import { FILING_ERROR_TEXT, FilingApiError } from "../errors";
import type {
  FilingProvider,
  FilingReceiptOutcome,
  FilingSubmitInput,
  FilingSubmitOutcome,
} from "../provider";

/** Bolagsverket och Skatteverket tar båda emot det Driva bygger. */
const SUPPORTED: readonly FilingKind[] = ["moms", "agi", "ink2", "arsredovisning"];

type Json = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Myndighetens avslagsskäl får följa med användaren – ett avslag som inte säger
 * varför går inte att rätta. Men bara som kort, städad text efter vår egen
 * mening, aldrig som rått svar.
 */
function rejectionText(payload: Json): string {
  const detail = text(payload.felmeddelande) ?? text(payload.message) ?? text(payload.reason);
  if (!detail) return FILING_ERROR_TEXT.declined;
  const clean = detail.replace(/[\u0000-\u001f]+/g, " ").slice(0, 300);
  return `${FILING_ERROR_TEXT.declined} Myndigheten svarade: ${clean}`;
}

function receiptFrom(payload: unknown): FilingReceipt | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as Json;
  const receiptId = text(raw.kvittensnummer) ?? text(raw.receiptId);
  if (!receiptId) return undefined;
  return {
    receiptId,
    receivedAt: text(raw.mottagenTidpunkt) ?? text(raw.receivedAt) ?? new Date().toISOString(),
    ...(text(raw.meddelande) ?? text(raw.message) ? { message: (text(raw.meddelande) ?? text(raw.message))! } : {}),
  };
}

export class LiveFilingProvider implements FilingProvider {
  readonly name = "live" as const;

  constructor(private readonly config: FilingConfig) {}

  supports(kind: FilingKind): boolean {
    return SUPPORTED.includes(kind);
  }

  async submit(input: FilingSubmitInput): Promise<FilingSubmitOutcome> {
    const body = {
      typ: input.kind,
      myndighet: input.authority,
      period: input.label,
      organisationsnummer: input.orgNumber,
      miljo: this.config.env,
      signatur: {
        metod: input.signature.method,
        signeradAv: input.signature.signedByName,
        signeradTidpunkt: input.signature.signedAt,
        ...(input.signature.orderRef ? { orderRef: input.signature.orderRef } : {}),
      },
      filer: input.files.map((f) => ({
        filnamn: f.filename,
        innehallstyp: f.contentType,
        innehall: Buffer.from(f.bytes).toString("base64"),
      })),
    };

    const { status, payload } = await this.call("POST", "/v1/submissions", {
      body,
      idempotencyKey: input.idempotencyKey,
    });

    if (status === 400 || status === 409 || status === 422) return { kind: "rejected", reason: rejectionText(payload) };
    if (status < 200 || status >= 300) {
      throw new FilingApiError(`Inlämning misslyckades: HTTP ${status}`, status, text(payload.felkod));
    }
    const providerSubmissionId = text(payload.submissionId) ?? text(payload.inlamningsId);
    // Mottaget utan id går inte att kvittera senare, och är därför inte mottaget.
    if (!providerSubmissionId) throw new FilingApiError("Svaret saknar inlämningsid", status);
    const receipt = receiptFrom(payload.kvittens ?? payload.receipt);
    return { kind: "accepted", providerSubmissionId, ...(receipt ? { receipt } : {}) };
  }

  async fetchReceipt(providerSubmissionId: string): Promise<FilingReceiptOutcome> {
    const path = `/v1/submissions/${encodeURIComponent(providerSubmissionId)}/kvittens`;
    const { status, payload } = await this.call("GET", path, {});
    if (status === 404 || status === 202) return { kind: "pending" };
    if (status < 200 || status >= 300) {
      throw new FilingApiError(`Kvittens kunde inte hämtas: HTTP ${status}`, status, text(payload.felkod));
    }
    const state = (text(payload.status) ?? "").toLowerCase();
    if (state === "avvisad" || state === "rejected") return { kind: "rejected", reason: rejectionText(payload) };
    const receipt = receiptFrom(payload.kvittens ?? payload.receipt ?? payload);
    if (receipt) return { kind: "receipt", receipt };
    return { kind: "pending" };
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; idempotencyKey?: string }
  ): Promise<{ status: number; payload: Json }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.token}`,
          accept: "application/json",
          ...(opts.body ? { "content-type": "application/json" } : {}),
          ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
        },
        ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
        signal: controller.signal,
        cache: "no-store",
      });
      let payload: Json = {};
      try {
        const parsed: unknown = await response.json();
        if (parsed && typeof parsed === "object") payload = parsed as Json;
      } catch {
        // Tjänster svarar inte alltid med JSON (502-sidor, tomma 204). Statusen
        // räcker för att avgöra utfallet.
      }
      return { status: response.status, payload };
    } finally {
      clearTimeout(timer);
    }
  }
}
