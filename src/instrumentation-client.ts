/**
 * Sentry i webbläsaren. Initieras bara när NEXT_PUBLIC_SENTRY_DSN är satt.
 * Ingen Session Replay (skulle spela in kunddata), ingen PII, aggressiv
 * skrubbning av meddelanden/brödsmulor (src/lib/observability/scrub.ts).
 */
import * as Sentry from "@sentry/nextjs";
import { appRelease, sentryClientDsn, sentryEnvironment } from "./lib/observability/config";
import { scrubBreadcrumb, scrubEvent } from "./lib/observability/scrub";

// Klientbundlar får bara NEXT_PUBLIC_-värden som skrivs ut explicit.
const dsn = sentryClientDsn({ NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN });

if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment({
      SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
      NODE_ENV: process.env.NODE_ENV,
    }),
    release: appRelease({ NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA }),
    tracesSampleRate: 0,
    sendDefaultPii: false,
    maxBreadcrumbs: 20,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(crumb) {
      return scrubBreadcrumb(crumb);
    },
    ignoreErrors: [
      "NEXT_REDIRECT",
      "NEXT_NOT_FOUND",
      "ResizeObserver loop",
      "Load failed",
      "Failed to fetch",
      /^AbortError/,
    ],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
