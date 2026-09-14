/**
 * Auktorisering av schemalagda anrop (Vercel Cron).
 *
 * Enbart `Authorization: Bearer <CRON_SECRET>`, vilket är exakt det Vercel
 * Cron skickar. Query-parametern är borta: en hemlighet i frågesträngen hamnar
 * i Vercels åtkomstloggar, i Sentrys breadcrumbs och i varje mellanliggande
 * proxy - den kan inte roteras bort ur loggar som redan sparats.
 *
 * Jämförelsen sker i konstant tid på buffertar, med längdkontrollen först så
 * att timingSafeEqual aldrig kastar (samma mönster som
 * src/lib/inbox/resend-signature.ts och src/lib/inbox/inbound-mail.ts).
 *
 * Saknad eller tom CRON_SECRET auktoriserar ingenting: en öppen cron-endpoint
 * är värre än en trasig.
 */
import { timingSafeEqual } from "crypto";
import type { EnvSource } from "../legal/entity";

export function cronSecret(env: EnvSource = process.env): string | undefined {
  const secret = env.CRON_SECRET?.trim();
  return secret || undefined;
}

/**
 * Är anropet auktoriserat? `authorization` är rå headervärdet, null när den
 * saknas. Returnerar false i stället för att kasta - anroparen svarar 401.
 */
export function isAuthorizedCronRequest(
  authorization: string | null | undefined,
  secret: string | undefined = cronSecret()
): boolean {
  if (!secret) return false;
  const header = authorization?.trim() ?? "";
  const match = /^Bearer[ \t]+(.+)$/i.exec(header);
  if (!match) return false;
  const provided = Buffer.from(match[1].trim(), "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
