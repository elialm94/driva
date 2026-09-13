/**
 * Var koden körs. En källa, så att produktionsspärrar inte glider ifrån
 * varandra: `/api/health` och registreringsspärren i `src/lib/auth/signup-gate.ts`
 * ska bedöma "detta är skarp drift" exakt likadant.
 *
 * Vercel sätter VERCEL_ENV till production/preview/development. Bara
 * `production` är skarp drift - preview och lokal utveckling ska aldrig
 * påverkas av spärrar som är till för riktiga kunder.
 */
import type { EnvSource } from "./legal/entity";

export function isProductionRuntime(env: EnvSource = process.env): boolean {
  return env.VERCEL_ENV === "production";
}
