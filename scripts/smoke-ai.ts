/**
 * RIKTIGT röktest mot OpenRouter – körs manuellt, aldrig i CI.
 *
 *   npx tsx scripts/smoke-ai.ts
 *
 * Få och billiga anrop (FAST-modellen), hård budgetvakt. Nyckeln läses från
 * .env.local och skrivs aldrig ut. Databasen är seedad in-memory (DRIVA_TEST)
 * – inga riktiga data skickas och inget skrivs till disk.
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
import { isAiConfigured, aiConfig } from "../src/lib/ai/provider";
import { interpretFreeTextViaAi } from "../src/lib/services/command-bar";
import { parseFreeText } from "../src/lib/command-bar";

const MAX_REQUESTS = 12;

function usageReport(label: string) {
  const rows = db().assistantAudit.filter((e) => e.tool === "llm_request");
  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  for (const r of rows) {
    const p = r.params as Record<string, unknown>;
    inTok += Number(p.inputTokens) || 0;
    outTok += Number(p.outputTokens) || 0;
    cost += Number(p.estimatedCostUsd) || 0;
    console.log(
      `   [${r.success ? "ok" : "FEL"}] ${String(p.model)} · in=${String(p.inputTokens)} ut=${String(p.outputTokens)} · verktyg=[${(p.toolCalls as string[]).join(", ") || "-"}] · ${r.ms} ms`
    );
  }
  console.log(`   ${label}: ${rows.length} anrop · ${inTok} in / ${outTok} ut tokens · ~$${cost.toFixed(5)}`);
  if (rows.length > MAX_REQUESTS) {
    console.error(`BUDGETVAKT: ${rows.length} anrop > ${MAX_REQUESTS}`);
    process.exit(1);
  }
  return rows.length;
}

async function main() {
  if (!isAiConfigured() || aiConfig().provider !== "openrouter") {
    console.error("OPENROUTER_API_KEY/AI_PROVIDER=openrouter saknas i .env.local – röktestet kräver riktig nyckel.");
    process.exit(1);
  }
  console.log(`Modeller: FAST=${aiConfig().modelFast} SMART=${aiConfig().modelSmart} (stegtak ${aiConfig().maxToolSteps})`);
  replaceDb(buildSeed());

  let failed = 0;

  // 1. LÄS-scenario, formulerat så att deterministiska tolkningen missar.
  {
    const q = "vilka kunder är sega med betalningen?";
    console.log(`\n1. ${q}`);
    if (parseFreeText(q).confidence !== "none") throw new Error("borde vara deterministiskt none");
    const r = await interpretFreeTextViaAi(q);
    console.log(`   ok=${r.ok} kort=${r.card?.kind ?? "-"}\n   svar: ${r.text.slice(0, 220)}`);
    const mentionsReal = /Brf Eken|Johan|Anna|1042|1047|kr/i.test(r.text + JSON.stringify(r.card ?? {}));
    if (!(r.ok && mentionsReal)) {
      failed += 1;
      console.error("   FEL: förväntade riktiga fordringar i svaret");
    }
  }

  // 2. UTKAST-scenario end-to-end genom loopen (i UI:t tar deterministiska
  //    vägen exakt denna fras – här testar vi LLM-vägen explicit).
  {
    const q = "Fakturera Johan för resten av altanen";
    console.log(`\n2. ${q}`);
    const before = db().invoices.length;
    const r = await interpretFreeTextViaAi(q);
    const draft = db().invoices[db().invoices.length - 1];
    const created = db().invoices.length === before + 1 && draft.status === "utkast" && draft.customerId === "cust-johan";
    console.log(`   ok=${r.ok} kort=${r.card?.kind ?? "-"} utkast=${created ? draft.id : "SAKNAS"}\n   svar: ${r.text.slice(0, 220)}`);
    if (!(r.ok && created)) {
      failed += 1;
      console.error("   FEL: förväntade fakturautkast för cust-johan");
    }
    if (db().invoices.some((i) => i.status === "skickad" && !buildSeed().invoices.some((s) => s.id === i.id))) {
      failed += 1;
      console.error("   FEL: något skickades!");
    }
  }

  console.log("\nAnvändning:");
  usageReport("Totalt");
  if (failed > 0) {
    console.error(`\n${failed} röktest misslyckades.`);
    process.exit(1);
  }
  console.log("\nBåda röktesten godkända.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
