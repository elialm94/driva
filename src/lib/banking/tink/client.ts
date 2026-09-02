/**
 * Tink Open Banking (AIS) – tunn HTTP-klient. Endast kontoinformation:
 * inga betalningar (PIS), inga överföringar, ingen VRP.
 *
 * Flödet (permanent user per Driva-företag, external_user_id = företagets id):
 *   1. clientAccessToken(scope)              POST /api/v1/oauth/token (client_credentials)
 *   2. createUser                            POST /api/v1/user/create          (user:create)
 *   3. delegateAuthorizationCode             POST /api/v1/oauth/authorization-grant/delegate (authorization:grant)
 *   4. buildTinkLinkUrl → användaren till link.tink.com (helsidesredirect, aldrig iframe)
 *   5. callback ?credentials_id&state → userAccessToken:
 *        POST /api/v1/oauth/authorization-grant (authorization:grant) → code
 *        POST /api/v1/oauth/token (authorization_code)                 → user access token
 *   6. listAccounts GET /data/v2/accounts · listTransactions GET /data/v2/transactions
 *   7. refreshCredentials POST /api/v1/credentials/{id}/refresh · deleteCredentials DELETE /api/v1/credentials/{id}
 *
 * Alla anrop har timeout (AbortController) och transporten är utbytbar i
 * tester – inga riktiga HTTP-anrop i npm test. Felsvar loggas trunkerat på
 * servern men når aldrig UI:t (se errors.ts).
 */
import { TinkApiError } from "../errors";
import { TINK_LINK_ACTOR_CLIENT_ID, type TinkConfig } from "./config";

export const TINK_TIMEOUT_MS = 15_000;

/** Scopes för användartoken – enbart läsning av kontoinformation. */
export const TINK_USER_SCOPES =
  "accounts:read,balances:read,transactions:read,provider-consents:read,credentials:read,credentials:refresh,credentials:write,providers:read,user:read";

/** Scopes Tink Link får agera med för användaren (delegering). */
export const TINK_DELEGATE_SCOPES =
  "authorization:read,authorization:grant,credentials:refresh,credentials:read,credentials:write,providers:read,user:read";

type TinkTransport = (url: string, init: RequestInit) => Promise<Response>;

let transport: TinkTransport = (url, init) => fetch(url, init);

/** Endast för tester: byt HTTP-transporten (mock av Tink-svar). */
export function __setTinkTransportForTests(fn: TinkTransport | null): void {
  transport = fn ?? ((url, init) => fetch(url, init));
}

function formBody(fields: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) params.set(k, v);
  return params.toString();
}

async function call<T>(
  cfg: TinkConfig,
  path: string,
  init: RequestInit & { token?: string; expectJson?: boolean } = {}
): Promise<T> {
  const { token, expectJson = true, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TINK_TIMEOUT_MS);
  try {
    const headers = new Headers(rest.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    let res: Response;
    try {
      res = await transport(`${cfg.apiBase}${path}`, { ...rest, headers, signal: ctrl.signal });
    } catch (err) {
      throw new TinkApiError(`Tink: nätverksfel mot ${path} (${(err as Error)?.name ?? "fel"})`, 0);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let code: string | undefined;
      try {
        const parsed = JSON.parse(body) as { errorCode?: string; error?: string; errorMessage?: string };
        code = parsed.errorCode ?? parsed.error;
      } catch {
        // icke-JSON-fel: bara status
      }
      // Trunkerad kropp i serverloggen – aldrig till användaren.
      console.error(`[tink] ${rest.method ?? "GET"} ${path} → ${res.status} ${body.slice(0, 300)}`);
      throw new TinkApiError(`Tink ${path} svarade ${res.status}`, res.status, code);
    }
    if (!expectJson || res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TinkApiError(`Tink ${path}: ogiltigt JSON-svar`, res.status);
    }
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ OAuth / användare ------------------------------ */

export async function clientAccessToken(cfg: TinkConfig, scope: string): Promise<string> {
  const json = await call<{ access_token: string }>(cfg, "/api/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
      scope,
    }),
  });
  if (!json?.access_token) throw new TinkApiError("Tink: klienttoken saknas i svaret", 502);
  return json.access_token;
}

/**
 * Skapa den permanenta Tink-användaren för företaget. Finns den redan
 * (409) återanvänds den – external_user_id räcker i alla senare anrop.
 */
export async function createUser(
  cfg: TinkConfig,
  clientToken: string,
  input: { externalUserId: string }
): Promise<{ userId?: string; existed: boolean }> {
  try {
    const json = await call<{ user_id?: string }>(cfg, "/api/v1/user/create", {
      method: "POST",
      token: clientToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ external_user_id: input.externalUserId, market: cfg.market, locale: cfg.locale }),
    });
    return { userId: json?.user_id, existed: false };
  } catch (err) {
    if (err instanceof TinkApiError && err.status === 409) return { existed: true };
    throw err;
  }
}

/** Delegera åtkomst till Tink Link för användaren → authorization_code till Link-URL:en. */
export async function delegateAuthorizationCode(
  cfg: TinkConfig,
  clientToken: string,
  input: { externalUserId: string; idHint: string }
): Promise<string> {
  const json = await call<{ code: string }>(cfg, "/api/v1/oauth/authorization-grant/delegate", {
    method: "POST",
    token: clientToken,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      response_type: "code",
      actor_client_id: TINK_LINK_ACTOR_CLIENT_ID,
      external_user_id: input.externalUserId,
      id_hint: input.idHint.slice(0, 64) || "Driva",
      scope: TINK_DELEGATE_SCOPES,
    }),
  });
  if (!json?.code) throw new TinkApiError("Tink: delegeringskod saknas i svaret", 502);
  return json.code;
}

/**
 * Tink Link-URL (Transactions · connect-accounts). redirect_uri är exakt
 * TINK_REDIRECT_URI – URLSearchParams kodar den, Tink jämför avkodat värde
 * mot Console. Sandbox: test=true visar Demo Bank.
 */
export function buildTinkLinkUrl(cfg: TinkConfig, input: { authorizationCode: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    authorization_code: input.authorizationCode,
    market: cfg.market,
    locale: cfg.locale,
    state: input.state,
    financial_services_segments: "BUSINESS,PERSONAL",
  });
  if (cfg.env === "sandbox") params.set("test", "true");
  return `${cfg.linkBase}/1.0/transactions/connect-accounts?${params.toString()}`;
}

/** Användartoken för den permanenta användaren (authorization-grant → authorization_code). */
export async function userAccessToken(
  cfg: TinkConfig,
  clientToken: string,
  input: { externalUserId: string }
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const grant = await call<{ code: string }>(cfg, "/api/v1/oauth/authorization-grant", {
    method: "POST",
    token: clientToken,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ external_user_id: input.externalUserId, scope: TINK_USER_SCOPES }),
  });
  if (!grant?.code) throw new TinkApiError("Tink: auktoriseringskod saknas i svaret", 502);
  const token = await call<{ access_token: string; expires_in?: number }>(cfg, "/api/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code: grant.code,
    }),
  });
  if (!token?.access_token) throw new TinkApiError("Tink: användartoken saknas i svaret", 502);
  return { accessToken: token.access_token, expiresInSeconds: Number(token.expires_in) || 7200 };
}

/* --------------------------------- Data v2 --------------------------------- */

export interface TinkScaled {
  unscaledValue: string;
  scale: string;
}

export interface TinkAccount {
  id: string;
  name?: string;
  type?: string;
  financialInstitutionId?: string;
  balances?: { booked?: { amount?: { currencyCode?: string; value?: TinkScaled } } };
  identifiers?: {
    iban?: { iban?: string; bban?: string };
    pan?: { masked?: string };
    financialInstitution?: { accountNumber?: string };
  };
  dates?: { lastRefreshed?: string };
}

export interface TinkTransaction {
  id: string;
  accountId: string;
  amount: { currencyCode?: string; value: TinkScaled };
  status?: "BOOKED" | "PENDING" | "UNDEFINED";
  bookedDateTime?: string;
  dates?: { booked?: string; value?: string; transaction?: string };
  descriptions?: { display?: string; original?: string; detailed?: { unstructured?: string } };
  counterparties?: { payer?: { name?: string }; payee?: { name?: string } };
  reference?: string;
  identifiers?: { providerTransactionId?: string };
}

export async function listAccounts(cfg: TinkConfig, userToken: string): Promise<TinkAccount[]> {
  const out: TinkAccount[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ pageSize: "100" });
    if (pageToken) q.set("pageToken", pageToken);
    const json = await call<{ accounts?: TinkAccount[]; nextPageToken?: string }>(
      cfg,
      `/data/v2/accounts?${q.toString()}`,
      { token: userToken }
    );
    out.push(...(json?.accounts ?? []));
    pageToken = json?.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return out;
}

export async function listTransactions(
  cfg: TinkConfig,
  userToken: string,
  input: { accountIds: string[]; bookedDateGte?: string; maxPages?: number }
): Promise<TinkTransaction[]> {
  const out: TinkTransaction[] = [];
  let pageToken: string | undefined;
  const maxPages = input.maxPages ?? 10;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ pageSize: "100" });
    for (const id of input.accountIds) q.append("accountIdIn", id);
    q.append("statusIn", "BOOKED");
    if (input.bookedDateGte) q.set("bookedDateGte", input.bookedDateGte);
    if (pageToken) q.set("pageToken", pageToken);
    const json = await call<{ transactions?: TinkTransaction[]; nextPageToken?: string }>(
      cfg,
      `/data/v2/transactions?${q.toString()}`,
      { token: userToken }
    );
    out.push(...(json?.transactions ?? []));
    pageToken = json?.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return out;
}

/* -------------------------------- Credentials ------------------------------- */

export interface TinkCredentials {
  id: string;
  providerName?: string;
  status?: string;
  statusPayload?: string;
  updated?: number;
}

export async function getCredentials(cfg: TinkConfig, userToken: string, id: string): Promise<TinkCredentials> {
  const json = await call<TinkCredentials>(cfg, `/api/v1/credentials/${encodeURIComponent(id)}`, { token: userToken });
  if (!json?.id) throw new TinkApiError("Tink: credentials saknas i svaret", 502);
  return json;
}

/** Be banken om färsk data. Asynkront hos Tink – status pollas via getCredentials. */
export async function refreshCredentials(cfg: TinkConfig, userToken: string, id: string): Promise<void> {
  await call<void>(cfg, `/api/v1/credentials/${encodeURIComponent(id)}/refresh`, {
    method: "POST",
    token: userToken,
    expectJson: false,
  });
}

/** Koppla från: tar bort bankmedgivandet hos Tink. 404 = redan borttaget (idempotent). */
export async function deleteCredentials(cfg: TinkConfig, userToken: string, id: string): Promise<void> {
  try {
    await call<void>(cfg, `/api/v1/credentials/${encodeURIComponent(id)}`, {
      method: "DELETE",
      token: userToken,
      expectJson: false,
    });
  } catch (err) {
    if (err instanceof TinkApiError && err.status === 404) return;
    throw err;
  }
}

export interface TinkProvider {
  name: string;
  displayName?: string;
  financialInstitutionId?: string;
  financialInstitutionName?: string;
}

/** Bankernas visningsnamn (för "SEB" i UI:t i stället för "se-seb-bankid"). */
export async function listProviders(cfg: TinkConfig, userToken: string): Promise<TinkProvider[]> {
  const json = await call<{ providers?: TinkProvider[] }>(cfg, "/api/v1/providers", { token: userToken });
  return json?.providers ?? [];
}
