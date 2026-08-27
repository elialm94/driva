import { db } from "../store";
import { uid } from "../ids";
import { kr, datumLang } from "../format";
import type { PendingAssistantAction } from "../types";
import { addPending, type DomainResult } from "./domain";
import { bankReconciliation } from "../accounting/reconciliation";
import { currentVatPosition, vatPeriods, vatChecklist, generateVatReport } from "../accounting/vat";
import { resultatrapport, balansrapport } from "../accounting/ledger";
import { bokslutChecklist } from "../accounting/close";
import { assetsNeedingDepreciation } from "../accounting/assets";
import { pendingAccruals } from "../accounting/accruals";
import { fiscalYears, lockedThrough } from "../accounting/fiscal";
import { getVerification, verificationLabel } from "../accounting/engine";
import { computeTaxCalculation } from "../accounting/tax";

/**
 * Assistentens bokföringsverktyg. AI:n är ett GRÄNSSNITT över motorn:
 * den läser färdiga rapporter och startar flöden via bekräftelsekort.
 * Den kan aldrig bokföra fritt, hitta på konton eller runda periodlås –
 * allt går genom samma domänfunktioner som UI:t.
 */

function fail(text: string): DomainResult {
  return { ok: false, text, forModel: { error: text } };
}

/** "Vad behöver jag göra med bokföringen?" */
export function bokforingStatusResult(): DomainResult {
  const data = db();
  const questions = data.expenses.filter((e) => e.status === "behover_svar");
  const missing = data.expenses.filter((e) => e.status === "saknar_kvitto");
  const recon = bankReconciliation();
  const moms = currentVatPosition();
  const lock = lockedThrough();

  const todo: string[] = [];
  if (questions.length) todo.push(`${questions.length} köp väntar på svar om vad de gällde`);
  if (missing.length) todo.push(`${missing.length} köp saknar kvitto`);
  if (recon.unhandled.length) todo.push(`${recon.unhandled.length} banktransaktioner behöver hanteras`);
  const nextVat = vatPeriods().find((p) => p.state === "att_deklarera");
  if (nextVat) todo.push(`momsen för ${nextVat.period.label} ska deklareras senast ${datumLang(nextVat.dueDate)}`);

  const text =
    todo.length === 0
      ? `Bokföringen är uppdaterad – inget väntar på dig. Banken är avstämd${recon.reconciledThrough ? ` till ${datumLang(recon.reconciledThrough)}` : ""}, och nästa moms (${moms.period.label}, ${kr(Math.abs(moms.attBetala))} ${moms.attBetala >= 0 ? "att betala" : "tillbaka"}) deklareras senast ${datumLang(moms.dueDate)}.${lock ? ` Bokföringen är låst till och med ${datumLang(lock)}.` : ""}`
      : `Det här behöver du göra: ${todo.join("; ")}. Resten sköter Driva automatiskt.`;

  return {
    ok: true,
    text,
    card: {
      kind: "list",
      title: "Bokföringsläget",
      rows: [
        { label: "Att hantera", value: todo.length === 0 ? "Inget ✓" : `${questions.length + missing.length + recon.unhandled.length} saker` },
        { label: "Bankavstämning", value: recon.ok ? "Avstämd ✓" : `Skillnad ${kr(recon.difference)}` },
        { label: `Moms ${moms.period.label}`, value: `${kr(Math.abs(moms.attBetala))} ${moms.attBetala >= 0 ? "att betala" : "tillbaka"}` },
        ...(lock ? [{ label: "Låst till och med", value: datumLang(lock) }] : []),
      ],
      links: [{ label: "Öppna Bokföring", href: "/bokforing" }],
    },
    forModel: {
      openQuestions: questions.length,
      missingReceipts: missing.length,
      unhandledBank: recon.unhandled.length,
      reconciled: recon.ok,
      vatToPay: moms.attBetala,
      vatDue: moms.dueDate,
      lockedThrough: lock ?? null,
    },
  };
}

/** Momsrapport med deklarationsrutor för en period (default: den som ska deklareras/pågår). */
export function momsRapportResult(periodKey?: string): DomainResult {
  const periods = vatPeriods();
  const period = periodKey
    ? periods.find((p) => p.period.key === periodKey)
    : (periods.find((p) => p.state === "att_deklarera") ?? periods.find((p) => p.state === "pagaende"));
  if (!period) return fail(`Jag hittar ingen momsperiod${periodKey ? ` med nyckeln ${periodKey}` : ""}.`);
  const checklist = period.state === "att_deklarera" ? vatChecklist(period.period) : [];
  const blockers = checklist.filter((c) => !c.ok);
  return {
    ok: true,
    text: `Moms för ${period.period.label}: ${kr(Math.abs(period.position.attBetala))} ${period.position.attBetala >= 0 ? "att betala" : "att få tillbaka"} (utgående ${kr(period.position.utgaende)}, ingående ${kr(period.position.ingaende)}). ${
      period.state === "deklarerad"
        ? "Perioden är markerad som deklarerad."
        : period.state === "att_deklarera"
          ? blockers.length
            ? `Innan deklaration: ${blockers.map((b) => b.detail ?? b.label).join(" ")}`
            : `Redo att deklareras – senast ${datumLang(period.dueDate)}. Siffrorna kommer direkt ur huvudboken.`
          : `Perioden pågår till ${period.period.end}.`
    }`,
    card: {
      kind: "list",
      title: `Momsrapport ${period.period.label}`,
      rows: period.position.boxes.map((b) => ({ label: `Ruta ${b.code} · ${b.label}`, value: kr(b.amount) })),
      links: [{ label: "Öppna momsöversikten", href: "/bokforing/moms" }],
    },
    forModel: {
      period: period.period.key,
      state: period.state,
      boxes: period.position.boxes,
      attBetala: period.position.attBetala,
      blockers: blockers.map((b) => b.label),
    },
  };
}

export function resultatRapportResult(): DomainResult {
  const rr = resultatrapport();
  return {
    ok: true,
    text: `Resultatrapport ${rr.range.from} till ${rr.range.to}: omsättning ${kr(rr.omsattning)}, kostnader ${kr(rr.kostnaderSumma)}, resultat före skatt ${kr(rr.resultatForeSkatt)}. Siffrorna kommer direkt ur bokföringen.`,
    card: {
      kind: "list",
      title: "Resultat i år",
      rows: [
        { label: "Omsättning", value: kr(rr.omsattning) },
        { label: "Kostnader", value: `−${kr(rr.kostnaderSumma)}` },
        { label: "Resultat före skatt", value: kr(rr.resultatForeSkatt) },
      ],
      links: [{ label: "Full resultatrapport", href: "/bokforing/resultat" }],
    },
    forModel: { omsattning: rr.omsattning, kostnader: rr.kostnaderSumma, resultat: rr.resultatForeSkatt },
  };
}

export function balansRapportResult(): DomainResult {
  const br = balansrapport();
  return {
    ok: true,
    text: `Balansen per ${datumLang(br.atDate)}: företaget äger ${kr(br.sumTillgangar)}, är skyldigt ${kr(br.sumSkulder)} och har ${kr(br.sumEgetKapital)} i eget kapital.${br.differens === 0 ? "" : " ⚠ Balansen stämmer inte – något behöver granskas."}`,
    card: {
      kind: "list",
      title: "Balansrapport",
      rows: [
        { label: "Tillgångar", value: kr(br.sumTillgangar) },
        { label: "Skulder", value: kr(br.sumSkulder) },
        { label: "Eget kapital", value: kr(br.sumEgetKapital) },
      ],
      links: [{ label: "Full balansrapport", href: "/bokforing/balans" }],
    },
    forModel: { tillgangar: br.sumTillgangar, skulder: br.sumSkulder, egetKapital: br.sumEgetKapital, balanced: br.differens === 0 },
  };
}

/** "Gör bokslutet" – läge + vad som återstår. */
export function bokslutStatusResult(): DomainResult {
  const open = fiscalYears().filter((f) => f.status === "oppet");
  const fy = open[0];
  if (!fy) return { ok: true, text: "Alla räkenskapsår är stängda.", forModel: { openYears: 0 } };
  const checklist = bokslutChecklist(fy.id);
  const blockers = checklist.filter((c) => c.blocking && !c.ok);
  const dep = assetsNeedingDepreciation(fy.id);
  const acc = pendingAccruals(fy.id);
  const tax = (db().settings.companyForm ?? "ab") === "ab" ? computeTaxCalculation(fy) : undefined;
  return {
    ok: true,
    text:
      blockers.length === 0
        ? `Bokslutet för ${fy.label} är redo att slutföras – alla kontroller är gröna.${tax ? ` Beräknad bolagsskatt: ${kr(tax.beraknadSkatt)} (preliminär).` : ""} Säg till så startar jag stängningen, eller gör det själv under Bokföring → Bokslut.`
        : `Bokslutet för ${fy.label} är inte klart ännu: ${blockers.map((b) => b.detail ?? b.label).join(" ")}${dep.length || acc.length ? ` Jag kan bokföra ${dep.length ? `${dep.length} avskrivning${dep.length > 1 ? "ar" : ""}` : ""}${dep.length && acc.length ? " och " : ""}${acc.length ? `${acc.length} periodisering${acc.length > 1 ? "ar" : ""}` : ""} åt dig.` : ""}`,
    card: {
      kind: "list",
      title: `Bokslut ${fy.label}`,
      rows: checklist.map((c) => ({ label: c.label, value: c.ok ? "✓" : c.blocking ? "Väntar" : "Info" })),
      links: [{ label: "Öppna bokslutet", href: "/bokforing/bokslut" }],
    },
    forModel: {
      fiscalYearId: fy.id,
      label: fy.label,
      ready: blockers.length === 0,
      blockers: blockers.map((b) => b.label),
      pendingDepreciations: dep.length,
      pendingAccruals: acc.length,
      estimatedTax: tax?.beraknadSkatt ?? null,
    },
  };
}

/** "Varför bokfördes detta?" – förklaring i klarspråk + kontorader. */
export function forklaraVerifikationResult(query: string): DomainResult {
  const data = db();
  const q = query.trim().toUpperCase();
  const byLabel = data.verifications.find((v) => verificationLabel(v).toUpperCase() === q || String(v.number) === q);
  const byText = byLabel
    ? undefined
    : [...data.verifications].reverse().find((v) => v.description.toLowerCase().includes(query.trim().toLowerCase()));
  const ver = byLabel ?? byText ?? (query ? getVerification(query) : undefined);
  if (!ver) return fail(`Jag hittar ingen verifikation som matchar ”${query}”. Ange nummer (t.ex. A12) eller en del av beskrivningen.`);
  const explanation =
    ver.explanation ??
    `${ver.description} bokfördes ${ver.createdBy === "auto" ? "automatiskt" : ver.createdBy === "assistent" ? "av assistenten" : "manuellt"} med underlagstyp ${ver.source.type}.`;
  return {
    ok: true,
    text: `${verificationLabel(ver)} (${ver.description}): ${explanation}`,
    card: {
      kind: "list",
      title: `Bokföringsdetaljer ${verificationLabel(ver)}`,
      rows: ver.entries.map((e) => ({
        label: `${e.account} ${e.accountName}`,
        value: e.debit ? `Debet ${kr(e.debit)}` : `Kredit ${kr(e.credit)}`,
      })),
      links: [{ label: "Öppna verifikationerna", href: "/bokforing/verifikationer" }],
    },
    forModel: {
      verification: verificationLabel(ver),
      description: ver.description,
      explanation,
      entries: ver.entries,
      corrected: Boolean(ver.correctedByVerificationId),
    },
  };
}

/** Bekräftelsekort: bokför avskrivningar + periodiseringar. */
export function requestRunBokslutAutomation(): DomainResult {
  const fy = fiscalYears().find((f) => f.status === "oppet");
  if (!fy) return fail("Det finns inget öppet räkenskapsår.");
  const dep = assetsNeedingDepreciation(fy.id);
  const acc = pendingAccruals(fy.id);
  if (dep.length === 0 && acc.length === 0) {
    return { ok: true, text: `Det finns inga avskrivningar eller periodiseringar att bokföra för ${fy.label}.`, forModel: { nothingToDo: true } };
  }
  const action: PendingAssistantAction = { id: uid(), type: "kor_bokslut_automatik", fiscalYearId: fy.id };
  addPending(action);
  return {
    ok: true,
    text: `Jag bokför årets avskrivningar och planerade periodiseringar för ${fy.label}. Inget bokförs förrän du bekräftar.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Bokslutsverifikationer skapas på årets sista dag, deterministiskt beräknade.",
      rows: [
        ...dep.map(({ asset, amount }) => ({ label: `Avskrivning: ${asset.name}`, value: kr(amount) })),
        ...acc.map((a) => ({ label: `Periodisering: ${a.description}`, value: kr(a.amount) })),
      ],
      confirmLabel: "Bokför",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, depreciations: dep.length, accruals: acc.length },
  };
}

/** Bekräftelsekort: slutför bokslutet (stäng året). */
export function requestCloseFiscalYear(): DomainResult {
  const fy = fiscalYears().find((f) => f.status === "oppet");
  if (!fy) return fail("Det finns inget öppet räkenskapsår att stänga.");
  const blockers = bokslutChecklist(fy.id).filter((c) => c.blocking && !c.ok);
  if (blockers.length) {
    return fail(`Bokslutet för ${fy.label} kan inte slutföras ännu: ${blockers.map((b) => b.detail ?? b.label).join(" ")}`);
  }
  const tax = (db().settings.companyForm ?? "ab") === "ab" ? computeTaxCalculation(fy) : undefined;
  const action: PendingAssistantAction = { id: uid(), type: "slutfor_bokslut", fiscalYearId: fy.id };
  addPending(action);
  return {
    ok: true,
    text: `Allt är klart för att stänga ${fy.label}. Året låses permanent – bekräfta så slutför jag bokslutet.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: `Skatt och årets resultat bokförs, ${Number(fy.label) + 1} får ingående balanser och året låses.`,
      rows: [
        ...(tax ? [{ label: "Beräknad bolagsskatt (preliminär)", value: kr(tax.beraknadSkatt) }] : []),
        { label: "Resultat före skatt", value: kr(tax?.redovisningsresultat ?? 0) },
      ],
      confirmLabel: "Slutför bokslut",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, fiscalYearId: fy.id },
  };
}

/** Bekräftelsekort: ångra en bokförd utgift (rättelseverifikation). */
export function requestUndoExpense(query: string): DomainResult {
  const data = db();
  const needle = query.trim().toLowerCase();
  const candidates = data.expenses.filter(
    (e) => e.status === "bokford" && e.verificationId && (e.supplier.toLowerCase().includes(needle) || e.id === query)
  );
  if (candidates.length === 0) return fail(`Jag hittar inget bokfört köp som matchar ”${query}”.`);
  if (candidates.length > 1) {
    return {
      ok: true,
      text: `Flera bokförda köp matchar ”${query}” – vilket menar du?`,
      card: {
        kind: "list",
        title: "Välj köp",
        rows: candidates.slice(0, 8).map((e) => ({ label: `${e.supplier} · ${datumLang(e.date)}`, value: kr(e.amount) })),
      },
      forModel: { ambiguous: true, candidates: candidates.map((e) => ({ id: e.id, supplier: e.supplier, amount: e.amount })) },
    };
  }
  const expense = candidates[0];
  const action: PendingAssistantAction = { id: uid(), type: "angra_utgift", expenseId: expense.id };
  addPending(action);
  return {
    ok: true,
    text: `Jag ångrar bokningen av köpet hos ${expense.supplier} (${kr(expense.amount)}). Originalet står kvar – en rättelseverifikation återför det, och du får frågan om rätt kategori igen.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "En rättelseverifikation bokförs. Historiken skrivs aldrig om.",
      rows: [{ label: expense.supplier, value: kr(expense.amount) }],
      confirmLabel: "Ångra bokningen",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, expenseId: expense.id },
  };
}

/** Bekräftelsekort: markera momsperiod som deklarerad. */
export function requestMarkVatDeclared(periodKey?: string): DomainResult {
  const periods = vatPeriods();
  const period = periodKey ? periods.find((p) => p.period.key === periodKey) : periods.find((p) => p.state === "att_deklarera");
  if (!period) return fail("Jag hittar ingen momsperiod som väntar på deklaration.");
  if (period.state === "deklarerad") return fail(`Momsen för ${period.period.label} är redan markerad som deklarerad.`);
  if (period.state !== "att_deklarera") return fail(`Momsperioden ${period.period.label} pågår fortfarande – den deklareras efter ${period.period.end}.`);
  const blockers = vatChecklist(period.period).filter((c) => !c.ok);
  if (blockers.length) {
    return fail(`Momsen för ${period.period.label} kan inte markeras som deklarerad ännu: ${blockers.map((b) => b.detail ?? b.label).join(" ")}`);
  }
  const report = generateVatReport(period.period.key, "assistent");
  const action: PendingAssistantAction = { id: uid(), type: "markera_moms_deklarerad", reportId: report.id };
  addPending(action);
  return {
    ok: true,
    text: `Momsen för ${period.period.label} är ${kr(Math.abs(report.attBetala))} ${report.attBetala >= 0 ? "att betala" : "att få tillbaka"}. Har du lämnat deklarationen hos Skatteverket? Bekräfta så markerar jag den som deklarerad och låser perioden. Driva skickar ingenting själv.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Momsen förs om till redovisningskontot och perioden låses. Ingen inlämning görs av Driva.",
      rows: report.boxes.map((b) => ({ label: `Ruta ${b.code} · ${b.label}`, value: kr(b.amount) })),
      confirmLabel: "Markera som deklarerad",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, reportId: report.id, attBetala: report.attBetala },
  };
}
