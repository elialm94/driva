process.env.DRIVA_TEST = "1";

/**
 * Påminnelser: ren, deterministisk tidstolkning (ingen LLM), den
 * deterministiska snabbvägens frastolkning samt uppmärksamhetspolicyn
 * genom den riktiga åtgärdsmotorn.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, testCustomer } from "./invoices/test-db";
import { DAYPART_TIMES, formatDueAt, resolveWhen, type WhenExpression } from "./reminders/when";
import {
  applyReminderFollowUp,
  formatReminderDateChip,
  parseReminderCommandInput,
  parseReminderText,
  parseWhenText,
  prettyReminderTitle,
  previewReminderDue,
  previewReminderDueFromArgs,
  reminderLocalFromArgs,
  reminderNeedsReview,
  reminderTextFromParts,
} from "./reminders/parse";
import {
  completeReminder,
  createReminder,
  describeReminderDue,
  dismissReminder,
  listReminders,
  reminderVisibleFrom,
  snoozeReminder,
  snoozeReminderBy,
  updateReminder,
} from "./services/reminders";
import { getBusinessActions } from "./services/actions";

const TZ = "Europe/Stockholm";

function resolved(expr: WhenExpression, nowIso: string, tz = TZ) {
  const r = resolveWhen(expr, new Date(nowIso), tz);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.ok ? r.value : (undefined as never);
}

/* -------------------------- Tidsupplösning (resolver) -------------------------- */

describe("resolveWhen: veckodagsregeln", () => {
  // 2026-08-24 = måndag, 2026-08-26 = onsdag, 2026-08-29 = lördag.

  it("'på onsdag' från en lördag → onsdag nästa vecka kl 10:00", () => {
    const v = resolved({ kind: "weekday", weekday: "onsdag" }, "2026-08-29T10:00:00Z");
    assert.equal(v.dueAt, "2026-09-02T08:00:00.000Z"); // 10:00 CEST
    assert.equal(v.hasExplicitTime, false);
    assert.equal(v.timezone, TZ);
  });

  it("'på onsdag' sagt en onsdag → NÄSTA onsdag (idag räknas som passerad)", () => {
    const v = resolved({ kind: "weekday", weekday: "onsdag" }, "2026-08-26T10:00:00Z");
    assert.equal(v.dueAt, "2026-09-02T08:00:00.000Z");
  });

  it("veckodag som är framför oss i veckan → denna vecka", () => {
    const v = resolved({ kind: "weekday", weekday: "onsdag" }, "2026-08-24T10:00:00Z");
    assert.equal(v.dueAt, "2026-08-26T08:00:00.000Z");
  });

  it("'nästa onsdag' från en måndag hoppar över veckans onsdag", () => {
    const v = resolved({ kind: "weekday", weekday: "onsdag", nextWeek: true }, "2026-08-24T10:00:00Z");
    assert.equal(v.dueAt, "2026-09-02T08:00:00.000Z");
  });
});

describe("resolveWhen: klockslag, dagsdelar och relativ tid", () => {
  it("'imorgon kl 14' är exakt och explicit", () => {
    const v = resolved({ kind: "date", date: "2026-08-30", time: "14:00" }, "2026-08-29T10:00:00Z");
    assert.equal(v.dueAt, "2026-08-30T12:00:00.000Z");
    assert.equal(v.hasExplicitTime, true);
  });

  it("'om två timmar' → exakt nu + 2 h", () => {
    const v = resolved({ kind: "relative", hours: 2 }, "2026-08-29T10:15:30Z");
    assert.equal(v.dueAt, "2026-08-29T12:15:30.000Z");
    assert.equal(v.hasExplicitTime, true);
  });

  it("'fredag eftermiddag' → 14:00 enligt dagsdelskonfigurationen", () => {
    assert.equal(DAYPART_TIMES.eftermiddag, "14:00");
    const v = resolved(
      { kind: "weekday", weekday: "fredag", daypart: "eftermiddag" },
      "2026-08-29T10:00:00Z"
    );
    assert.equal(v.dueAt, "2026-09-04T12:00:00.000Z");
    assert.equal(v.hasExplicitTime, true);
  });

  it("alla dagsdelar följer den centrala konfigurationen", () => {
    assert.deepEqual(DAYPART_TIMES, { morgon: "09:00", förmiddag: "10:00", eftermiddag: "14:00", kväll: "18:00" });
    const v = resolved({ kind: "date", date: "2026-08-31", daypart: "kväll" }, "2026-08-29T10:00:00Z");
    assert.equal(v.dueAt, "2026-08-31T16:00:00.000Z"); // 18:00 CEST
  });

  it("enbart dagsdel: ikväll före 18 → idag; passerad dagsdel → imorgon", () => {
    // 12:00 lokal tid → kväll är kvar idag.
    const today = resolved({ kind: "daypart", daypart: "kväll" }, "2026-08-29T10:00:00Z");
    assert.equal(today.dueAt, "2026-08-29T16:00:00.000Z");
    // 12:00 lokal tid → morgonen har passerat → imorgon 09:00.
    const tomorrow = resolved({ kind: "daypart", daypart: "morgon" }, "2026-08-29T10:00:00Z");
    assert.equal(tomorrow.dueAt, "2026-08-30T07:00:00.000Z");
  });

  it("ingen tid alls → standard 10:00 lokal, INTE explicit", () => {
    const v = resolved({ kind: "date", date: "2026-09-02" }, "2026-08-29T10:00:00Z");
    assert.equal(v.dueAt, "2026-09-02T08:00:00.000Z");
    assert.equal(v.hasExplicitTime, false);
  });

  it("isoDateTime med klockslag är explicit; utan klockslag → 10:00-standard", () => {
    const withTime = resolved({ kind: "isoDateTime", value: "2026-09-02T14:30" }, "2026-08-29T10:00:00Z");
    assert.equal(withTime.dueAt, "2026-09-02T12:30:00.000Z");
    assert.equal(withTime.hasExplicitTime, true);
    const dateOnly = resolved({ kind: "isoDateTime", value: "2026-09-02" }, "2026-08-29T10:00:00Z");
    assert.equal(dateOnly.dueAt, "2026-09-02T08:00:00.000Z");
    assert.equal(dateOnly.hasExplicitTime, false);
  });
});

describe("resolveWhen: tidszoner (aldrig hårdkodat Stockholm)", () => {
  it("samma uttryck i America/New_York ger annan UTC-instant", () => {
    const ny = resolved({ kind: "date", date: "2026-09-02" }, "2026-08-29T10:00:00Z", "America/New_York");
    assert.equal(ny.dueAt, "2026-09-02T14:00:00.000Z"); // 10:00 EDT
    assert.equal(ny.timezone, "America/New_York");
  });

  it("vintertid: Stockholm är UTC+1 i december", () => {
    const v = resolved({ kind: "date", date: "2026-12-01" }, "2026-08-29T10:00:00Z");
    assert.equal(v.dueAt, "2026-12-01T09:00:00.000Z");
  });

  it("formatDueAt presenterar lokal tid i påminnelsens tidszon", () => {
    assert.equal(formatDueAt("2026-09-02T08:00:00.000Z", TZ), "onsdag 2 september kl 10:00");
    assert.equal(formatDueAt("2026-09-02T14:00:00.000Z", "America/New_York"), "onsdag 2 september kl 10:00");
  });

  it("ogiltiga uttryck ger fel i stället för gissningar", () => {
    assert.equal(resolveWhen({ kind: "relative" }, new Date(), TZ).ok, false);
    assert.equal(resolveWhen({ kind: "date", date: "andra september" }, new Date(), TZ).ok, false);
    assert.equal(resolveWhen({ kind: "date", date: "2026-09-02", time: "25:99" }, new Date(), TZ).ok, false);
  });
});

/* ----------------------- Deterministisk snabbväg (parser) ---------------------- */

describe("parseReminderText: snabbvägen utan LLM", () => {
  const NOW = new Date("2026-08-29T10:00:00Z"); // lördag

  it("'Påminn mig att ringa Göran på onsdag' → veckodag + kundfråga", () => {
    const p = parseReminderText("Påminn mig att ringa Göran på onsdag", NOW, TZ);
    assert.ok(p);
    assert.equal(p.title, "ringa Göran");
    assert.equal(p.args.weekday, "onsdag");
    assert.equal(p.args.relatedType, "customer");
    assert.equal(p.args.relatedQuery, "Göran");
  });

  it("'påminn mig imorgon att skicka offerten' → morgondagens datum", () => {
    const p = parseReminderText("påminn mig imorgon att skicka offerten", NOW, TZ);
    assert.ok(p);
    assert.equal(p.args.whenDate, "2026-08-30");
    assert.equal(p.title, "skicka offerten");
  });

  it("'påminn mig om två timmar att kolla ugnen' → relativ tid", () => {
    const p = parseReminderText("påminn mig om två timmar att kolla ugnen", NOW, TZ);
    assert.ok(p);
    assert.equal(p.args.relativeHours, 2);
    assert.equal(p.title, "kolla ugnen");
  });

  it("'påminn mig på fredag eftermiddag att följa upp offert 113' → dagsdel + offertlänk", () => {
    const p = parseReminderText("påminn mig på fredag eftermiddag att följa upp offert 113", NOW, TZ);
    assert.ok(p);
    assert.equal(p.args.weekday, "fredag");
    assert.equal(p.args.daypart, "eftermiddag");
    assert.equal(p.args.relatedType, "quote");
    assert.equal(p.args.relatedQuery, "113");
  });

  it("'påminn mig imorgon kl 14 att ringa leverantören' → klockslag", () => {
    const p = parseReminderText("påminn mig imorgon kl 14 att ringa leverantören", NOW, TZ);
    assert.ok(p);
    assert.equal(p.args.whenDate, "2026-08-30");
    assert.equal(p.args.time, "14:00");
  });

  it("'nästa onsdag' sätter nextWeek", () => {
    const p = parseReminderText("påminn mig nästa onsdag att fakturera", NOW, TZ);
    assert.ok(p);
    assert.equal(p.args.weekday, "onsdag");
    assert.equal(p.args.nextWeek, true);
  });

  it("utan tidsuttryck eller utan påminn-prefix → null (LLM-vägen)", () => {
    assert.equal(parseReminderText("påminn mig att ringa Göran", NOW, TZ), null);
    assert.equal(parseReminderText("vad behöver jag göra idag?", NOW, TZ), null);
    assert.equal(parseReminderText("fakturera Johan imorgon", NOW, TZ), null);
    assert.equal(parseReminderText("skicka påminnelse till Johan om faktura", NOW, TZ), null);
  });

  it("guidat flöde: titel + onsdag använder samma parser och ger förhandsdatum", () => {
    const phrase = reminderTextFromParts("Ring Göran", "onsdag");
    assert.equal(phrase, "påminn mig onsdag att Ring Göran");
    const p = parseReminderText(phrase, NOW, TZ);
    assert.ok(p);
    assert.equal(p.title, "Ring Göran");
    assert.equal(p.args.weekday, "onsdag");
    assert.equal(p.args.relatedQuery, "Göran");
    const preview = previewReminderDue("onsdag", NOW, TZ);
    assert.equal(preview, "Onsdag 2 september kl 10:00");
  });
});

/* --------------- Kommandokontext: tolka VAD + NÄR ur EN mening --------------- */

describe("parseReminderCommandInput: ingen stel guide – bara det som saknas efterfrågas", () => {
  const NOW = new Date("2026-08-29T10:00:00Z"); // lördag 29 aug 2026, 12:00 lokal tid

  function complete(text: string) {
    const p = parseReminderCommandInput(text, NOW, TZ);
    assert.ok(p, `"${text}" gav null`);
    assert.ok(p.complete, `"${text}" hittade ingen tid – flödet skulle fråga "När?" i onödan`);
    if (!p.complete) throw new Error("unreachable");
    return p;
  }

  it("'Ring Göran imorgon kl 8' → VAD + NÄR ur en mening", () => {
    const p = complete("Ring Göran imorgon kl 8");
    assert.equal(p.title, "Ring Göran");
    assert.equal(p.args.whenDate, "2026-08-30");
    assert.equal(p.args.time, "8:00");
    assert.equal(p.args.relatedType, "customer");
    assert.equal(p.args.relatedQuery, "Göran");
  });

  it("'Ring Göran klockan 8 imorgon' → samma resultat med omvänd ordföljd (buggens repro)", () => {
    const p = complete("Ring Göran klockan 8 imorgon");
    assert.equal(p.title, "Ring Göran");
    assert.equal(p.args.whenDate, "2026-08-30");
    assert.equal(p.args.time, "8:00");
    // 08:00 svensk lokal tid (Europe/Stockholm) – aldrig rå UTC.
    assert.equal(previewReminderDueFromArgs(p.args, NOW, TZ), "Söndag 30 augusti kl 08:00");
  });

  it("'Påminn mig att ringa Göran imorgon' → prefixet konsumeras", () => {
    const p = complete("Påminn mig att ringa Göran imorgon");
    assert.equal(p.title, "ringa Göran");
    assert.equal(p.args.whenDate, "2026-08-30");
  });

  it("'Påminn mig imorgon kl 08 att ringa Göran' → tid före titel", () => {
    const p = complete("Påminn mig imorgon kl 08 att ringa Göran");
    assert.equal(p.title, "ringa Göran");
    assert.equal(p.args.whenDate, "2026-08-30");
    assert.equal(p.args.time, "08:00");
  });

  it("'Ring Göran på onsdag' → veckodag", () => {
    const p = complete("Ring Göran på onsdag");
    assert.equal(p.title, "Ring Göran");
    assert.equal(p.args.weekday, "onsdag");
  });

  it("'Ring Göran nästa onsdag kl 14' → nästa vecka + klockslag", () => {
    const p = complete("Ring Göran nästa onsdag kl 14");
    assert.equal(p.args.weekday, "onsdag");
    assert.equal(p.args.nextWeek, true);
    assert.equal(p.args.time, "14:00");
  });

  it("'om två timmar' och 'om 30 minuter' → relativ tid", () => {
    assert.equal(complete("Ring Göran om två timmar").args.relativeHours, 2);
    assert.equal(complete("Ring Göran om 30 minuter").args.relativeMinutes, 30);
  });

  it("'Ring Göran ikväll' → dagsdel", () => {
    assert.equal(complete("Ring Göran ikväll").args.daypart, "kväll");
  });

  it("'Ring Göran fredag eftermiddag' → veckodag + dagsdel", () => {
    const p = complete("Ring Göran fredag eftermiddag");
    assert.equal(p.args.weekday, "fredag");
    assert.equal(p.args.daypart, "eftermiddag");
  });

  it("'Ring Göran' utan tid → complete:false – ENDAST 'När?' efterfrågas", () => {
    const p = parseReminderCommandInput("Ring Göran", NOW, TZ);
    assert.ok(p);
    assert.equal(p.complete, false);
    assert.equal(p.title, "Ring Göran");
  });

  it("'påminn mig att ringa Göran' utan tid → titel utan prefix, complete:false", () => {
    const p = parseReminderCommandInput("påminn mig att ringa Göran", NOW, TZ);
    assert.ok(p);
    assert.equal(p.complete, false);
    assert.equal(p.title, "ringa Göran");
  });

  it("tom inmatning → null", () => {
    assert.equal(parseReminderCommandInput("   ", NOW, TZ), null);
  });
});

describe("parseWhenText: NÄR-steget tolkar rena tidfraser strikt", () => {
  const NOW = new Date("2026-08-29T10:00:00Z");

  it("'imorgon kl 8' → morgondagens datum + klockslag", () => {
    assert.deepEqual(parseWhenText("imorgon kl 8", NOW, TZ), { whenDate: "2026-08-30", time: "8:00" });
  });

  it("'kl 9 istället' → utfyllnadsord ignoreras; titeln (VAD) tolkas aldrig om", () => {
    assert.deepEqual(parseWhenText("kl 9 istället", NOW, TZ), { time: "9:00", whenDate: "2026-08-29" });
  });

  it("'på onsdag', 'om 2 timmar' och 'ikväll' fungerar som i NL-vägen", () => {
    assert.deepEqual(parseWhenText("på onsdag", NOW, TZ), { weekday: "onsdag" });
    assert.deepEqual(parseWhenText("om 2 timmar", NOW, TZ), { relativeHours: 2 });
    assert.deepEqual(parseWhenText("ikväll", NOW, TZ), { daypart: "kväll" });
  });

  it("ord över eller ingen tid → ärligt null, aldrig en hoptrasslad titel", () => {
    assert.equal(parseWhenText("imorgon kanske vid nio", NOW, TZ), null);
    assert.equal(parseWhenText("hejsan", NOW, TZ), null);
    assert.equal(parseWhenText("   ", NOW, TZ), null);
  });
});

describe("prettyReminderTitle: visningsversalisering utan verbbyte", () => {
  it("'skicka till göran' → 'Skicka till Göran' – skicka byts inte mot ring", () => {
    assert.equal(prettyReminderTitle("skicka till göran"), "Skicka till Göran");
    assert.equal(prettyReminderTitle("ringa Göran"), "Ringa Göran");
  });

  it("behåller redan versaliserad titel", () => {
    assert.equal(prettyReminderTitle("Ring Göran om altanen"), "Ring Göran om altanen");
  });
});

describe("applyReminderFollowUp: rättar fält utan att starta om", () => {
  const NOW = new Date("2026-08-29T10:00:00Z"); // lördag 12:00 CEST
  const current = { title: "Skicka till Göran", whenDate: "2026-08-30", time: "15:00" };

  it("'nej kl 10 istället' ändrar bara klockslaget – datumet står kvar", () => {
    const next = applyReminderFollowUp(current, "nej kl 10 istället", NOW, TZ);
    assert.ok(next);
    assert.equal(next.title, undefined);
    assert.equal(next.args.whenDate, "2026-08-30");
    assert.equal(next.args.time, "10:00");
  });

  it("'ändra till imorgon kl 9' byter både dag och tid", () => {
    const next = applyReminderFollowUp(current, "ändra till imorgon kl 9", NOW, TZ);
    assert.ok(next);
    assert.equal(next.args.whenDate, "2026-08-30");
    assert.equal(next.args.time, "9:00");
  });

  it("'imorgon kl 10' utan rättelseord uppdaterar förhandsvisningen direkt", () => {
    const next = applyReminderFollowUp(current, "imorgon kl 10", NOW, TZ);
    assert.ok(next);
    assert.equal(next.args.whenDate, "2026-08-30");
    assert.equal(next.args.time, "10:00");
  });

  it("'onsdag' behåller klockslaget som redan visas", () => {
    const next = applyReminderFollowUp(current, "onsdag", NOW, TZ);
    assert.ok(next);
    assert.equal(next.args.weekday, "onsdag");
    assert.equal(next.args.time, "15:00");
  });

  it("obegriplig fras → null, befintligt tillstånd orört", () => {
    assert.equal(applyReminderFollowUp(current, "kanske senare", NOW, TZ), null);
  });
});

describe("reminderLocalFromArgs + review-grind", () => {
  const NOW = new Date("2026-08-29T10:00:00Z");

  it("lokal väggtid speglar det som visas", () => {
    const local = reminderLocalFromArgs({ whenDate: "2026-08-30", time: "15:00" }, NOW, TZ);
    assert.deepEqual(local, { date: "2026-08-30", time: "15:00", whenIso: "2026-08-30T15:00" });
    assert.equal(formatReminderDateChip("2026-08-30"), "Sön 30 aug");
  });

  it("HIGH + SAFE + komplett utan guide → ingen obligatorisk review", () => {
    assert.equal(
      reminderNeedsReview({ complete: true, confidence: "high", inGuidedFlow: false }),
      false
    );
  });

  it("guidat flöde, låg konfidens eller tvetydighet → review", () => {
    assert.equal(reminderNeedsReview({ complete: true, confidence: "high", inGuidedFlow: true }), true);
    assert.equal(reminderNeedsReview({ complete: true, confidence: "low", inGuidedFlow: false }), true);
    assert.equal(
      reminderNeedsReview({ complete: true, confidence: "high", inGuidedFlow: false, ambiguous: true }),
      true
    );
    assert.equal(reminderNeedsReview({ complete: false, confidence: "high", inGuidedFlow: false }), true);
  });
});

/* --------------------- Uppmärksamhetspolicyn (åtgärdsmotorn) ------------------- */

describe("påminnelser i åtgärdsmotorn", () => {
  // Fast klocka: lördag 2026-08-29 08:00 lokal tid (06:00Z).
  const NOW = new Date("2026-08-29T06:00:00Z");

  beforeEach(() => {
    replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", name: "Göran Svensson" })] }));
  });

  function create(when: WhenExpression, over: { title?: string } = {}) {
    const r = createReminder({ title: over.title ?? "Ringa Göran Svensson", when }, NOW);
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r.ok ? r.reminder : (undefined as never);
  }

  function attentionIds(now: Date) {
    return getBusinessActions(now).attention.map((a) => a.id);
  }

  it("dagsnivå syns från dagens start – redan före kl 10", () => {
    const rem = create({ kind: "date", date: "2026-08-29" }); // due 10:00, ej explicit
    const actions = getBusinessActions(NOW); // 08:00 lokal
    const row = actions.attention.find((a) => a.id === `reminder-${rem.id}`);
    assert.ok(row, "dagsnivåpåminnelsen syns från dagsstart");
    assert.equal(row.priority, "action"); // inte försenad ännu
    assert.equal(row.icon, "bell");
    assert.match(row.subtitle, /Idag kl 10:00/);
  });

  it("explicit tid syns först från dueAt", () => {
    const rem = create({ kind: "date", date: "2026-08-29", time: "14:00" });
    assert.ok(!attentionIds(NOW).includes(`reminder-${rem.id}`), "syns inte kl 08");
    const later = new Date("2026-08-29T12:30:00Z"); // 14:30 lokal
    assert.ok(attentionIds(later).includes(`reminder-${rem.id}`), "syns efter 14:00");
  });

  it("framtida påminnelse hamnar under På gång – inte i uppmärksamhet", () => {
    const rem = create({ kind: "weekday", weekday: "onsdag" }); // 2026-09-02, 4 dagar bort
    const actions = getBusinessActions(NOW);
    assert.ok(!actions.attention.some((a) => a.id === `reminder-${rem.id}`));
    const upcoming = actions.watching.find((u) => u.id === `reminder-upcoming-${rem.id}`);
    assert.ok(upcoming, "finns i På gång");
    assert.equal(upcoming.date, "2026-09-02");
    assert.equal(upcoming.category, "reminder");
  });

  it("försenad markeras Försenad och blir brådskande", () => {
    const rem = create({ kind: "date", date: "2026-08-28", time: "10:00" }); // igår
    const row = getBusinessActions(NOW).attention.find((a) => a.id === `reminder-${rem.id}`);
    assert.ok(row);
    assert.equal(row.priority, "urgent");
    assert.match(row.subtitle, /Försenad – skulle gjorts igår kl 10:00/);
  });

  it("klar och borttagen försvinner (historiken finns kvar)", () => {
    const rem = create({ kind: "date", date: "2026-08-28" });
    completeReminder(rem.id, NOW);
    assert.ok(!attentionIds(NOW).includes(`reminder-${rem.id}`));
    assert.equal(db().reminders.find((r) => r.id === rem.id)?.status, "COMPLETED");
    assert.ok(db().reminders.find((r) => r.id === rem.id)?.completedAt);

    const rem2 = create({ kind: "date", date: "2026-08-28" }, { title: "Annan sak" });
    dismissReminder(rem2.id);
    assert.ok(!attentionIds(NOW).includes(`reminder-${rem2.id}`));
    assert.equal(db().reminders.find((r) => r.id === rem2.id)?.status, "DISMISSED");
  });

  it("uppskjuten försvinner tills snoozedUntil och återkommer sedan", () => {
    const rem = create({ kind: "date", date: "2026-08-29" });
    snoozeReminder(rem.id, "2026-08-29T10:00:00Z"); // 12:00 lokal
    assert.ok(!attentionIds(NOW).includes(`reminder-${rem.id}`), "borta direkt efter snooze");
    assert.ok(
      attentionIds(new Date("2026-08-29T10:05:00Z")).includes(`reminder-${rem.id}`),
      "tillbaka efter snoozedUntil"
    );
  });

  it("snoozeReminderBy: 1h är exakt, imorgon = 09:00 lokal, datum behåller klockslaget", () => {
    const rem = create({ kind: "date", date: "2026-08-29", time: "14:00" });
    snoozeReminderBy(rem.id, "1h", NOW);
    assert.equal(db().reminders.find((r) => r.id === rem.id)?.snoozedUntil, "2026-08-29T07:00:00.000Z");
    snoozeReminderBy(rem.id, "imorgon", NOW);
    assert.equal(db().reminders.find((r) => r.id === rem.id)?.snoozedUntil, "2026-08-30T07:00:00.000Z"); // 09:00 CEST
    snoozeReminderBy(rem.id, { date: "2026-09-01" }, NOW);
    assert.equal(db().reminders.find((r) => r.id === rem.id)?.snoozedUntil, "2026-09-01T12:00:00.000Z"); // 14:00 kvar
  });

  it("uppdatering flyttar tiden och nollställer snooze", () => {
    const rem = create({ kind: "date", date: "2026-08-29" });
    snoozeReminder(rem.id, "2026-09-10T10:00:00Z");
    const updated = updateReminder(rem.id, { when: { kind: "weekday", weekday: "torsdag" } }, NOW);
    assert.ok(updated.ok);
    if (updated.ok) {
      assert.equal(updated.reminder.dueAt, "2026-09-03T08:00:00.000Z"); // torsdag 10:00
      assert.equal(updated.reminder.snoozedUntil, undefined);
    }
  });

  it("reminderVisibleFrom + describeReminderDue: policyn är härledd, aldrig lagrad", () => {
    const dayLevel = create({ kind: "date", date: "2026-08-30" });
    assert.equal(reminderVisibleFrom(dayLevel).toISOString(), "2026-08-29T22:00:00.000Z"); // lokal dagsstart
    const explicit = create({ kind: "date", date: "2026-08-30", time: "14:00" }, { title: "Explicit" });
    assert.equal(reminderVisibleFrom(explicit).toISOString(), "2026-08-30T12:00:00.000Z");
    assert.deepEqual(describeReminderDue(dayLevel, NOW), { overdue: false, text: "Imorgon kl 10:00" });
  });

  it("listReminders sorterar på dueAt och utesluter avklarade", () => {
    const later = create({ kind: "date", date: "2026-09-05" }, { title: "Senare" });
    const sooner = create({ kind: "date", date: "2026-08-30" }, { title: "Snart" });
    const done = create({ kind: "date", date: "2026-08-29" }, { title: "Klar sak" });
    completeReminder(done.id, NOW);
    assert.deepEqual(
      listReminders().map((r) => r.id),
      [sooner.id, later.id]
    );
  });
});
