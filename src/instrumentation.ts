/**
 * Next.js-instrumentation: laddar Sentry per runtime och fångar serverfel
 * (server components, server actions, proxy). Utan SENTRY_DSN gör
 * konfigfilerna ingenting och captureRequestError blir en no-op.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
