/**
 * Sentry – Node-runtime (server components, server actions, route handlers).
 * Laddas från src/instrumentation.ts. Utan SENTRY_DSN initieras SDK:t inte
 * alls (ingen nätverkstrafik, inga fejkade "övervakad"-lampor).
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
    // Felövervakning först. Tracing hålls lågt tills volymen är känd.
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    maxBreadcrumbs: 30,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(crumb) {
      return scrubBreadcrumb(crumb);
    },
    ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK"],
  });
}
