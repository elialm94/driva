process.env.DRIVA_TEST = "1";

/**
 * In-yttrande-rättelser: senaste tydliga rättelsen vinner.
 * Första regex-träff låses inte. Tvetydiga alternativ frågar.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collapseCorrectedUtterance,
  formatClarifyQuestion,
  formatResolvedCommandCta,
  prettyReminderTitle,
  reminderArgsFromStructuredExtraction,
  resolveAmount,
  resolveCustomerNameArg,
  resolvePhoneArg,
  resolveQuantityHours,
  resolveUtteranceCorrections,
  shouldFallbackToStructuredExtraction,
  timeCandidateHistory,
} from "./ai/corrections";
import { identifyUtteranceIntent } from "./ai/utterance";
import { parseAmountInclVat, parseQuantityHours } from "./ai/resolve";
import {
  parseReminderCommandInput,
  parseReminderText,
  previewReminderDueFromArgs,
} from "./reminders/parse";

const TZ = "Europe/Stockholm";
/** Söndag 30 augusti 2026, 09:00 svensk tid. */
const SUNDAY = new Date("2026-08-30T07:00:00Z");

function reminder(text: string) {
  return parseReminderText(text, SUNDAY, TZ) ?? parseReminderCommandInput(text, SUNDAY, TZ);
}

describe("korrektionslager: senaste tydliga rättelsen vinner", () => {
  it("Ring Göran kl 12, nej förresten kl 10 → tid 10:00; 12:00 supersedad", () => {
    const r = resolveUtteranceCorrections("Ring Göran kl 12, nej förresten kl 10");
    assert.equal(r.final.time, "10:00");
    assert.equal(r.confidence, "high");
    const hist = timeCandidateHistory(r);
    assert.equal(hist.find((c) => c.value === "12:00")?.status, "superseded");
    assert.equal(hist.find((c) => c.value === "10:00")?.status, "active");
  });

  it("Påminn mig kl 12, nej kl 10 → 10:00", () => {
    const p = parseReminderText("Påminn mig kl 12, nej kl 10 att ringa", SUNDAY, TZ);
    assert.ok(p);
    assert.equal(p.args.time, "10:00");
    assert.notEqual(p.args.time, "12:00");
  });

  it("Påminn mig onsdag, nej torsdag → torsdag", () => {
    const r = resolveUtteranceCorrections("Påminn mig onsdag, nej torsdag");
    assert.equal(r.final.weekday, "torsdag");
    assert.notEqual(r.final.weekday, "onsdag");
  });

  it("Ring Anna, nej Göran, imorgon kl 9 → Ring Göran", () => {
    const p = parseReminderCommandInput("Ring Anna, nej Göran, imorgon kl 9", SUNDAY, TZ);
    assert.ok(p && p.complete);
    assert.equal(p.title, "Ring Göran");
    assert.equal(p.args.time, "9:00");
    assert.equal(p.args.whenDate, "2026-08-31");
  });

  it("Skapa faktura på 10 000, jag menar 12 000 → 12 000", () => {
    assert.equal(parseAmountInclVat("Skapa faktura på 10 000, jag menar 12 000"), 12_000);
    assert.equal(resolveAmount("Skapa faktura till Carl på 12 000, nej 15 000"), 15_000);
  });

  it("Skapa faktura till Anna, nej Sara → Sara", () => {
    assert.equal(resolveCustomerNameArg("Skapa faktura till Anna, nej Sara"), "Sara");
    assert.equal(identifyUtteranceIntent("Skapa faktura till Anna, nej Sara"), "create_invoice");
  });

  it("Offert till Anna, nej Karin → Karin", () => {
    assert.equal(resolveCustomerNameArg("Offert till Anna, nej Karin"), "Karin");
    assert.equal(identifyUtteranceIntent("skapa offert till Anna, nej Karin"), "create_quote");
  });

  it("5 timmar arbete, ändra till 7 timmar → 7", () => {
    assert.equal(parseQuantityHours("5 timmar arbete, ändra till 7 timmar"), 7);
    assert.equal(resolveQuantityHours("5 timmar, ändra till 7"), 7);
    assert.equal(resolveQuantityHours("10 timmar à 750, nej 8 timmar"), 8);
  });

  it("inte fredag utan torsdag → torsdag; inte 12 utan 10 → 10; inte Anna, Sara → Sara", () => {
    const day = resolveUtteranceCorrections("inte fredag utan torsdag");
    assert.equal(day.final.weekday, "torsdag");
    assert.equal(day.candidates.find((c) => c.value === "fredag")?.status, "negated");

    const time = resolveUtteranceCorrections("inte 12 utan 10");
    assert.equal(time.final.time, "10:00");
    assert.equal(time.candidates.find((c) => c.value === "12:00")?.status, "negated");

    assert.equal(resolveCustomerNameArg("inte Anna, Sara"), "Sara");
  });

  it("12 eller 10 är INTE en tydlig rättelse → klargör, välj inte", () => {
    const r = resolveUtteranceCorrections("12 eller 10");
    assert.equal(r.confidence, "ambiguous");
    assert.equal(r.final.time, undefined);
    assert.equal(r.clarify, "Vilken tid vill du använda - 10:00 eller 12:00?");
    assert.equal(shouldFallbackToStructuredExtraction(r), false);
    assert.equal(formatClarifyQuestion("time", ["12:00", "10:00"]), "Vilken tid vill du använda - 10:00 eller 12:00?");
  });

  it("'Ring Göran kl 12, eller kanske 10' frågar – 'nej förresten kl 10' väljer 10", () => {
    const maybe = resolveUtteranceCorrections("Ring Göran kl 12, eller kanske 10");
    assert.equal(maybe.confidence, "ambiguous");
    assert.match(maybe.clarify ?? "", /10:00|12:00/);

    const clear = resolveUtteranceCorrections("Ring Göran kl 12, nej förresten kl 10");
    assert.equal(clear.confidence, "high");
    assert.equal(clear.final.time, "10:00");
  });

  it("Onsdag kl 12, nej torsdag kl 10 → torsdag 10:00", () => {
    const r = resolveUtteranceCorrections("Onsdag kl 12, nej torsdag kl 10");
    assert.equal(r.final.weekday, "torsdag");
    assert.equal(r.final.time, "10:00");
    const p = parseReminderCommandInput("Onsdag kl 12, nej torsdag kl 10 att ringa Göran", SUNDAY, TZ);
    assert.ok(p && p.complete);
    assert.equal(p.args.weekday, "torsdag");
    assert.equal(p.args.time, "10:00");
  });

  it("Telefon 070-123 45 67, nej använd 073-987 65 43 → senaste numret", () => {
    assert.equal(resolvePhoneArg("Telefon 070-123 45 67, nej använd 073-987 65 43"), "073-987 65 43");
    assert.equal(identifyUtteranceIntent("Telefon 070-123 45 67, nej använd 073-987 65 43"), "create_customer");
  });
});

describe("repro: skapa påminnelse med rättelse i samma mening", () => {
  const punctuated =
    "Skapa en påminnelse att ringa Göran klockan 12. Nej förresten, att ringa Göran klockan 10.";
  const screenshot =
    "skapa en påminnelse att ringa Göran klockan 12 Nej förresten att ringa Göran klockan 10";

  it("punktuerad mening → Ring Göran kl 10:00, inte 12:00", () => {
    const p = parseReminderText(punctuated, SUNDAY, TZ);
    assert.ok(p, "hela originalfrasen måste räcka");
    assert.equal(identifyUtteranceIntent(punctuated), "create_reminder");
    assert.equal(p.title, "Ring Göran");
    assert.equal(p.args.time, "10:00");
    assert.notEqual(p.args.time, "12:00");
    assert.equal(p.args.whenDate, "2026-08-30");
    const preview = previewReminderDueFromArgs(p.args, SUNDAY, TZ);
    assert.equal(preview, "Söndag 30 augusti kl 10:00");
    assert.equal(
      formatResolvedCommandCta({ command: "Skapa påminnelse", detail: p.title, when: preview ?? undefined }),
      "Skapa påminnelse / Ring Göran / Söndag 30 augusti kl 10:00"
    );
  });

  it("exakt skärmdumpssträng → intent create_reminder, text Ring Göran, tid 10:00", () => {
    const p = parseReminderText(screenshot, SUNDAY, TZ);
    assert.ok(p);
    assert.equal(identifyUtteranceIntent(screenshot), "create_reminder");
    assert.equal(p.title, "Ring Göran");
    assert.equal(p.args.title, "Ring Göran");
    assert.equal(p.args.time, "10:00");
    assert.notEqual(p.args.time, "12:00");
    const hist = timeCandidateHistory(resolveUtteranceCorrections(screenshot));
    assert.equal(hist.find((c) => c.value === "12:00")?.status, "superseded");
    assert.equal(hist.find((c) => c.value === "10:00")?.status, "active");
    const preview = previewReminderDueFromArgs(p.args, SUNDAY, TZ);
    assert.equal(preview, "Söndag 30 augusti kl 10:00");
  });

  it("idag kl 10 på söndag 30 aug 2026 → 2026-08-30 10:00 Europe/Stockholm", () => {
    const p = parseReminderText("påminn mig idag kl 10 att ringa Göran", SUNDAY, TZ);
    assert.ok(p);
    assert.equal(p.args.whenDate, "2026-08-30");
    assert.equal(p.args.time, "10:00");
    assert.equal(previewReminderDueFromArgs(p.args, SUNDAY, TZ), "Söndag 30 augusti kl 10:00");
  });

  it("hela originalfrasen bevaras i collapse – första träffen låses inte", () => {
    const collapsed = collapseCorrectedUtterance(screenshot);
    assert.match(collapsed, /10/);
    assert.doesNotMatch(collapsed, /12/);
    assert.doesNotMatch(collapsed, /förresten/i);
  });
});

describe("OpenRouter-reserv: stubbad strukturerad extraktion, aldrig påhitt", () => {
  it("avslutad extraktion med time=10 används – 12 skickas inte till verktyget", () => {
    const args = reminderArgsFromStructuredExtraction({
      title: "Ring Göran",
      time: "10:00",
      whenDate: "2026-08-30",
    });
    assert.equal(args.title, "Ring Göran");
    assert.equal(args.time, "10:00");
    assert.equal(args.whenDate, "2026-08-30");
    assert.notEqual(args.time, "12:00");
    assert.equal("scheduledAt" in args, false);
  });

  it("extraktionen hittar inte på fält som saknas i svaret", () => {
    const args = reminderArgsFromStructuredExtraction({ title: "Ring Göran", extraHallucination: "12:00" });
    assert.equal(args.title, "Ring Göran");
    assert.equal(args.time, undefined);
    assert.equal("extraHallucination" in args, false);
  });

  it("motstridiga kandidater utan tydlig markör → needsStructuredExtraction", () => {
    const r = resolveUtteranceCorrections("påminn mig att ringa klockan 12 klockan 10");
    assert.equal(r.confidence, "low");
    assert.equal(shouldFallbackToStructuredExtraction(r), true);
  });

  it("tydlig rättelse är deterministisk – ingen OpenRouter-reserv", () => {
    const r = resolveUtteranceCorrections("klockan 12 nej förresten klockan 10");
    assert.equal(r.confidence, "high");
    assert.equal(shouldFallbackToStructuredExtraction(r), false);
    assert.equal(r.final.time, "10:00");
  });
});

describe("visning och titel", () => {
  it("prettyReminderTitle: ringa Göran → Ring Göran", () => {
    assert.equal(prettyReminderTitle("ringa Göran"), "Ring Göran");
  });

  it("parseReminderCommandInput på rättad naken mening", () => {
    const p = reminder("Ring Göran kl 12, nej förresten kl 10");
    assert.ok(p && "complete" in p ? p.complete || "args" in p : p);
    const parsed = parseReminderCommandInput("Ring Göran kl 12, nej förresten kl 10", SUNDAY, TZ);
    assert.ok(parsed && parsed.complete);
    assert.equal(parsed.title, "Ring Göran");
    assert.equal(parsed.args.time, "10:00");
  });
});
