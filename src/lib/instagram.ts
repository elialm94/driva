/**
 * Instagram-gräns mot Meta – ingen skrapning.
 *
 * Driva visar senaste inlägg bara via Instagram API with Instagram Login
 * (Graph). Utan app-id/secret är sektionen frånkopplad på riktigt.
 *
 * Kvarvarande steg för att gå live:
 *  1. Skapa en app på https://developers.facebook.com/apps
 *  2. Lägg till produkten Instagram och välj ”Instagram API with Instagram Login”
 *  3. Instagram-kontot måste vara Professionellt (Företag eller Creator)
 *  4. Valid OAuth Redirect URI: {DRIVA_APP_URL}/api/instagram/callback
 *  5. Behörighet: instagram_business_basic
 *  6. Sätt INSTAGRAM_APP_ID och INSTAGRAM_APP_SECRET (aldrig i git)
 *  7. Under utveckling: Instagram-testers. Produktion: App Review.
 *  8. Starta om Driva, fyll i @konto och klicka Anslut Instagram.
 */

import { absoluteAppUrl } from "./mail";
import type { WebsiteInstagram, WebsiteInstagramPost } from "./types";
import { DEFAULT_INSTAGRAM_LIMIT, normalizeInstagramHandle } from "./website-sections";

export const INSTAGRAM_SETUP_STEPS = [
  "Skapa en app på https://developers.facebook.com/apps",
  "Lägg till produkten Instagram och välj Instagram API with Instagram Login (inte Basic Display – den är avvecklad).",
  "Kontot måste vara ett professionellt Instagram-konto (Företag eller Creator).",
  "Sätt Valid OAuth Redirect URI till {app}/api/instagram/callback",
  "Begär behörigheten instagram_business_basic.",
  "Sätt INSTAGRAM_APP_ID och INSTAGRAM_APP_SECRET i Drivas miljö (Vercel/host). Committa dem inte.",
  "Under utveckling: lägg till Instagram-testers i Meta-appen. För produktion: App Review.",
  "Starta om Driva, fyll i @konto och klicka Anslut Instagram.",
] as const;

export type InstagramStatus = "disconnected" | "needs_credentials" | "ready_to_connect" | "connected";

export interface InstagramProviderState {
  status: InstagramStatus;
  hasAppCredentials: boolean;
  handle: string;
  connected: boolean;
  postCount: number;
  setupSteps: string[];
}

export function instagramAppId(): string | undefined {
  return process.env.INSTAGRAM_APP_ID?.trim() || undefined;
}

export function instagramAppSecret(): string | undefined {
  return process.env.INSTAGRAM_APP_SECRET?.trim() || undefined;
}

export function instagramHasCredentials(): boolean {
  return Boolean(instagramAppId() && instagramAppSecret());
}

export function instagramRedirectUri(): string {
  const override = process.env.INSTAGRAM_REDIRECT_URI?.trim();
  if (override) return override;
  return absoluteAppUrl("/api/instagram/callback");
}

export function instagramSetupSteps(appUrl = absoluteAppUrl("")): string[] {
  return INSTAGRAM_SETUP_STEPS.map((step) => step.replace("{app}", appUrl.replace(/\/$/, "")));
}

export function instagramState(section: { instagram?: WebsiteInstagram } | undefined): InstagramProviderState {
  const ig = section?.instagram;
  const handle = normalizeInstagramHandle(ig?.handle ?? "");
  const connected = Boolean(ig?.connected && ig.accessToken);
  const hasAppCredentials = instagramHasCredentials();
  let status: InstagramStatus = "disconnected";
  if (connected) status = "connected";
  else if (!hasAppCredentials) status = "needs_credentials";
  else if (handle) status = "ready_to_connect";
  return {
    status,
    hasAppCredentials,
    handle,
    connected,
    postCount: ig?.posts?.length ?? 0,
    setupSteps: instagramSetupSteps(),
  };
}

export function instagramAuthorizeUrl(input: { handle: string; state: string }): string {
  if (!instagramHasCredentials()) {
    throw new Error("Instagram är inte konfigurerat. Sätt INSTAGRAM_APP_ID och INSTAGRAM_APP_SECRET.");
  }
  const handle = normalizeInstagramHandle(input.handle);
  if (!handle) throw new Error("Ange Instagram-kontot, till exempel @dittforetag.");
  const params = new URLSearchParams({
    client_id: instagramAppId()!,
    redirect_uri: instagramRedirectUri(),
    response_type: "code",
    scope: "instagram_business_basic",
    state: input.state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeInstagramCode(code: string): Promise<{
  accessToken: string;
  userId: string;
  expiresAt?: string;
}> {
  if (!instagramHasCredentials()) throw new Error("Instagram är inte konfigurerat.");
  const body = new URLSearchParams({
    client_id: instagramAppId()!,
    client_secret: instagramAppSecret()!,
    grant_type: "authorization_code",
    redirect_uri: instagramRedirectUri(),
    code,
  });
  const short = await postForm<{ access_token?: string; user_id?: number | string }>(
    "https://api.instagram.com/oauth/access_token",
    body,
  );
  if (!short.access_token || short.user_id == null) {
    throw new Error("Instagram svarade inte med en åtkomstnyckel.");
  }
  const long = await getJson<{ access_token?: string; expires_in?: number }>(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: instagramAppSecret()!,
      access_token: short.access_token,
    }).toString()}`,
  );
  const accessToken = long.access_token || short.access_token;
  const expiresAt =
    typeof long.expires_in === "number" ? new Date(Date.now() + long.expires_in * 1000).toISOString() : undefined;
  return { accessToken, userId: String(short.user_id), expiresAt };
}

export async function fetchInstagramMedia(
  accessToken: string,
  limit = DEFAULT_INSTAGRAM_LIMIT,
): Promise<WebsiteInstagramPost[]> {
  const n = Math.min(12, Math.max(1, Math.round(limit) || DEFAULT_INSTAGRAM_LIMIT));
  const url = `https://graph.instagram.com/me/media?${new URLSearchParams({
    fields: "id,caption,media_type,media_url,permalink,thumbnail_url",
    limit: String(n),
    access_token: accessToken,
  }).toString()}`;
  const data = await getJson<{
    data?: Array<{
      id: string;
      caption?: string;
      media_type?: string;
      media_url?: string;
      permalink?: string;
      thumbnail_url?: string;
    }>;
    error?: { message?: string };
  }>(url);
  if (data.error?.message) throw new Error(data.error.message);
  const posts: WebsiteInstagramPost[] = [];
  for (const item of data.data ?? []) {
    const mediaUrl = item.media_url || item.thumbnail_url;
    if (!item.id || !item.permalink || !mediaUrl) continue;
    posts.push({
      id: item.id,
      permalink: item.permalink,
      mediaUrl: item.thumbnail_url && item.media_type === "VIDEO" ? item.thumbnail_url : mediaUrl,
      thumbnailUrl: item.thumbnail_url,
      caption: item.caption,
    });
    if (posts.length >= n) break;
  }
  return posts;
}

async function postForm<T>(url: string, body: URLSearchParams): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as T & { error_message?: string; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json.error?.message || json.error_message || "Kunde inte ansluta till Instagram.");
  }
  return json;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message || "Kunde inte hämta data från Instagram.");
  return json;
}

export function instagramProfileUrl(handle: string): string {
  const h = normalizeInstagramHandle(handle);
  return h ? `https://www.instagram.com/${encodeURIComponent(h)}/` : "https://www.instagram.com/";
}
