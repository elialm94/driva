/**
 * RIKTIGT röktest för påminnelser mot OpenRouter – körs manuellt, aldrig i CI.
 *
 *   npx tsx scripts/smoke-reminders.ts
 *
 * Max 2 scenarier (FAST-modellen). Fraserna är medvetet formulerade så att
 * de INTE fångas av den deterministiska snabbvägen – det är LLM-vägen som
 * ska bevisas här. Nyckeln läses från .env.local och skrivs aldrig ut.
 */

process.env.DRIVA_TEST = "1";

import fs from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), file);
  if (fs.existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* äldre Node */
    }
  }
}

import { db, replaceDb } from "../src/lib/store";
import { buildSeed } from "../src/lib/seed";
import { isAiConfigured } from "../src/lib/ai/provider";
import { createCustomer } from "../src/lib/services/customers";
import { interpretFreeTextViaAi } from "../src/lib/services/command-bar";
import { parseReminderText } from "../src/lib/reminders/parse";
import { formatDueAt } from "../src/lib/reminders/when";

async function main() {
  if (!isAiConfigured()) {
    console.error("OPENROUTER_API_KEY saknas – röktestet kräver en riktig nyckel.");
    process.exit(1);
  }
  replaceDb(buildSeed());
  createCustomer({ kind: "privat", name: "Göran Svensson", email: "goran@example.se", phone: "070-111 22 33" });

  // 1. Skapa påminnelse ur naturligt språk (fångas INTE av snabbvägen).
  const phrase = "Kan du påminna mig att ringa Göran på onsdag?";
  if (parseReminderText(phrase, new Date(), "Europe/Stockholm")) {
    throw new Error("Frasen fångas av snabbvägen – röktestet bevisar då inte LLM-vägen.");
  }
  console.log(`\n1) "${phrase}"`);
  const created = await interpretFreeTextViaAi(phrase);
  console.log(`   svar: ${created.text}`);
  const rem = db().reminders.find((r) => r.status === "PENDING");
  if (!rem) throw new Error("Ingen påminnelse persisterades!");
  console.log(
    `   persisterad: "${rem.title}" · ${rem.dueAt ? formatDueAt(rem.dueAt, rem.timezone, rem.hasExplicitTime) : "Ingen tid"} · explicitTid=${rem.hasExplicitTime} · koppling=${rem.relatedEntityType ?? "ingen"}`
  );
  if (!rem.dueAt) throw new Error("Röktestet förväntar en daterad påminnelse.");
  const wd = new Intl.DateTimeFormat("sv-SE", { timeZone: rem.timezone, weekday: "long" }).format(new Date(rem.dueAt));
  if (wd !== "onsdag") throw new Error(`Fel veckodag: ${wd}`);
  if (!rem.relatedEntityType) console.warn("   OBS: modellen länkade inte kunden (acceptabelt men noterat).");

  // 2. Lista påminnelser.
  const q = "Vilka påminnelser har jag?";
  console.log(`\n2) "${q}"`);
  const listed = await interpretFreeTextViaAi(q);
  console.log(`   svar: ${listed.text}`);
  if (listed.card?.kind === "list") {
    for (const row of listed.card.rows) console.log(`   · ${row.label} — ${row.value ?? ""}`);
  }

  // Användning/kostnad.
  const rows = db().assistantAudit.filter((e) => e.tool === "llm_request");
  let cost = 0;
  for (const r of rows) {
    const p = r.params as Record<string, unknown>;
    cost += Number(p.estimatedCostUsd) || 0;
    console.log(
      `   [${r.success ? "ok" : "FEL"}] ${String(p.model)} · in=${String(p.inputTokens)} ut=${String(p.outputTokens)} · verktyg=[${((p.toolCalls as string[]) ?? []).join(", ") || "-"}] · ${r.ms} ms`
    );
  }
  console.log(`\nTotalt: ${rows.length} LLM-anrop · ~$${cost.toFixed(5)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
