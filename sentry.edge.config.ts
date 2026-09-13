/**
 * Sentry – Edge-runtime (src/proxy.ts). Samma skrubbning som servern.
 * Utan SENTRY_DSN initieras SDK:t inte.
 */
import * as Sentry from "@sentry/nextjs";
import { appRelease, sentryEnvironment, sentryServerDsn } from "./src/lib/observability/config";
import { scrubBreadcrumb, scrubEvent } from "./src/lib/observability/scrub";

const dsn = sentryServerDsn();

if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment(),
    release: appRelease(),
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(crumb) {
      return scrubBreadcrumb(crumb);
    },
    ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND"],
  });
}
