/**
 * AI-budget för det publika demoföretaget.
 *
 * Demon delar OPENROUTER_API_KEY med produktionen – utan tak vore den publika
 * demon ett gratis LLM-proxy. Två gränser, båda upprätthållna i chatWithTools
 * (transportens enda väg ut) så att ingen anropsväg kan glömmas:
 *
 *   1. Durabel dygnsgräns per demoföretag: llm_request-poster i
 *      assistentloggen räknas (persisteras i tenant-tillståndet och delas
 *      därmed över serverless-instanser). Nekade anrop loggas ALDRIG – taket
 *      kan inte blåsas upp av sina egna avslag och åldras ut efter 24 h.
 *   2. Glidande fönster per demosession (demo-cookiens unika värde), hållet i
 *      minnet per instans. På serverless är det bäst ansträngning – den
 *      durabla dygnsgränsen är garantin, fönstret tar de snabba skurarna.
 *
 * Riktiga företag berörs aldrig (isDemoBusiness-grinden), och demon får
 * alltid den snabba/billiga modellen (se chatWithTools).
 */
import { cookies } from "next/headers";
import { db } from "../store";
import { isDemoBusiness } from "../demo";
import { DEMO_SESSION_COOKIE } from "../auth/demo-session";
import { AiDemoLimitError } from "./provider";

const SESSION_WINDOW_MS = 10 * 60_000;
const MAX_PER_SESSION_WINDOW = 20;
const DAY_MS = 24 * 3_600_000;
const DEFAULT_DAILY_CAP = 300;

/** Dygnstak för hela demoföretaget (env-justerbart utan kodändring). */
export function demoAiDailyCap(): number {
  const n = Number(process.env.DEMO_AI_DAILY_CAP?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

const requestsBySession = new Map<string, number[]>();

function prune(list: number[], now: number): void {
  while (list.length > 0 && now - list[0] > SESSION_WINDOW_MS) list.shift();
}

async function sessionKey(): Promise<string> {
  try {
    const jar = await cookies();
    return jar.get(DEMO_SESSION_COOKIE)?.value || "demo";
  } catch {
    // Utanför requestkontext (test/skript): dela en gemensam nyckel.
    return "demo";
  }
}

/** Kasta AiDemoLimitError om demoföretagets AI-budget är förbrukad. */
export async function assertDemoAiBudget(now = Date.now()): Promise<void> {
  if (!isDemoBusiness()) return;

  const since = now - DAY_MS;
  let usedToday = 0;
  for (const entry of db().assistantAudit) {
    if (entry.tool === "llm_request" && Date.parse(entry.at) >= since) usedToday++;
  }
  if (usedToday >= demoAiDailyCap()) throw new AiDemoLimitError();

  const key = await sessionKey();
  const list = requestsBySession.get(key) ?? [];
  prune(list, now);
  if (list.length >= MAX_PER_SESSION_WINDOW) throw new AiDemoLimitError();
  list.push(now);
  requestsBySession.set(key, list);
  if (requestsBySession.size > 2_000) {
    for (const [k, v] of requestsBySession) {
      prune(v, now);
      if (v.length === 0) requestsBySession.delete(k);
    }
  }
}

export function __resetDemoAiBudgetForTests(): void {
  requestsBySession.clear();
}
