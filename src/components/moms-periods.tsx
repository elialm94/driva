import type { ReactNode } from "react";
import { ArrowRight, Check, CircleAlert, Download, ExternalLink, Landmark } from "lucide-react";
import { kr, datumLang } from "@/lib/format";
import { Badge, ButtonLink, Card, cx } from "./ui";
import { BookVatOnTaxAccountButton } from "./skattekonto-widgets";
import { CopyValue, DeclareVatButton, TaxAccountOcrField } from "./moms-flow-widgets";
import type { VatChecklistItem } from "@/lib/accounting/vat";
import type { VatFlowStep, VatPeriodFlow } from "@/lib/accounting/vat-flow";
import { taxAccountOcrFromOrgnr } from "@/lib/accounting/tax-account-model";
import { db } from "@/lib/store";
import { VAT_PERIOD_STATE } from "@/lib/status-labels";
import { InlamningPanel } from "./inlamning";
import { filingPanelData } from "@/lib/filing/view";
import { filingSubmissionAvailable } from "@/lib/filing/select";

function suggestedTaxAccountOcr(): string | undefined {
  try {
    return taxAccountOcrFromOrgnr(db().settings.orgNumber ?? "");
  } catch {
    return undefined;
  }
}

/**
 * Momsen i tre steg per period: Kontrollera → Deklarera → Betala.
 *
 * Perioden som väntar på användaren visas öppen med det aktuella steget
 * utvecklat; klara och kommande perioder är en rad var med stegraden som
 * kvitto på vad som är gjort. Var perioden står räknas i
 * lib/accounting/vat-flow.ts – komponenten visar bara det.
 */

const SKV_DECLARE_URL = "https://skatteverket.se/foretag/moms/deklareramoms.4.7459477810df5bccdd480006935.html";

/** Var användaren fixar det checklistan klagar på. */
const CHECKLIST_LINKS: Record<string, { href: string; label: string }> = {
  bank: { href: "/bokforing/bank?status=atgard", label: "Öppna banken" },
  underlag: { href: "/ekonomi?flik=utgifter&status=atgard", label: "Öppna utgifterna" },
};

export function MomsPeriods({
  flows,
  focusKey,
  readOnly,
  basePath = "/bokforing/moms",
}: {
  flows: VatPeriodFlow[];
  /** Perioden som visas öppen. Saknas = den första som väntar på något. */
  focusKey?: string | null;
  readOnly?: boolean;
  /** Sidan som visar perioderna – för länkar till en period i ett annat räkenskapsår. */
  basePath?: string;
}) {
  return (
    <div className="space-y-4">
      {flows.map((flow) => (
        <PeriodCard
          key={flow.summary.period.key}
          flow={flow}
          open={flow.summary.period.key === focusKey}
          readOnly={readOnly}
          basePath={basePath}
        />
      ))}
      <p className="text-[12px] leading-relaxed text-muted">
        {filingSubmissionAvailable()
          ? "Deklarationsfilen (eSKD) går att lämna in härifrån, och då står kvittensen kvar på perioden. Du kan lika gärna hämta filen och ladda upp den i e-tjänsten själv, eller fylla i rutorna för hand – siffrorna är desamma."
          : "Driva skickar inget till Skatteverket för det här företaget. Du deklarerar som vanligt i e-tjänsten Lämna momsdeklaration – antingen genom att fylla i rutorna eller genom att ladda upp deklarationsfilen (eSKD)."}
      </p>
    </div>
  );
}

/* --------------------------------- Kortet --------------------------------- */

function PeriodCard({
  flow,
  open,
  readOnly,
  basePath,
}: {
  flow: VatPeriodFlow;
  open: boolean;
  readOnly?: boolean;
  basePath: string;
}) {
  const p = flow.summary;
  const pay = flow.payment;
  const overdue = pay.daysLeft < 0 && !flow.done && p.state !== "kommande";
  const dueTone = flow.done ? "text-muted" : overdue ? "text-danger" : pay.daysLeft <= 7 ? "text-warn" : "text-ink";

  return (
    <Card
      id={`period-${p.period.key}`}
      data-vat-period={p.period.key}
      data-vat-state={p.state}
      data-vat-step={flow.current ?? (flow.done ? "klar" : "pagaende")}
      className={cx("px-6 py-5", open && !flow.done && "border-accent/40")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <Landmark className="size-4.5 text-muted" />
            <h3 className="text-[15px] font-semibold">{p.period.label}</h3>
            <Badge tone={flow.done ? "ok" : overdue ? "danger" : VAT_PERIOD_STATE[p.state].tone}>
              {flow.done ? "✓ Klar" : overdue ? "Förfallen" : p.state === "deklarerad" ? "Deklarerad · att betala" : VAT_PERIOD_STATE[p.state].label}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-soft">
            {p.state === "kommande" ? (
              <>Börjar {datumLang(p.period.start)}</>
            ) : (
              <>
                {p.state === "pagaende" ? `Pågår till ${datumLang(p.period.end)} · ` : ""}
                {flow.done ? "Deklarerades senast " : "Deklareras och betalas senast "}
                <span className={cx("font-medium", dueTone)}>{datumLang(pay.dueDate)}</span>
                {!flow.done ? <DaysLeft days={pay.daysLeft} /> : null}
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-muted">{pay.direction === "tillbaka" ? "Att få tillbaka" : "Att betala"}</p>
          <p className="text-[22px] font-semibold tracking-tight tabular">{kr(pay.amount)}</p>
        </div>
      </div>

      <StepRail steps={flow.steps} />

      {open ? (
        <div className="mt-4 border-t border-line/60 pt-4">
          {flow.current === "kontrollera" || (p.state === "pagaende" && !flow.done) ? (
            <KontrolleraStep flow={flow} basePath={basePath} />
          ) : flow.current === "deklarera" ? (
            <DeklareraStep flow={flow} readOnly={readOnly} />
          ) : flow.current === "betala" ? (
            <BetalaStep flow={flow} readOnly={readOnly} />
          ) : null}
        </div>
      ) : null}

      <details className="group mt-3">
        <summary className="cursor-pointer list-none text-[13px] font-medium text-accent hover:underline">
          {open ? "Alla rutor, filer och inlämning" : "Visa underlag"}
        </summary>
        <div className="mt-3 space-y-4">
          <BoxesTable flow={flow} />
          {readOnly || p.state === "pagaende" ? null : <InlamningPanel {...filingPanelData("moms", p.period.key)} />}
          {p.state === "deklarerad" && p.report ? (
            <p className="text-[12px] text-muted">
              Deklarerad {p.report.declaredAt ? datumLang(p.report.declaredAt) : ""}. Momsen fördes till redovisningskontot (2650) och
              perioden låstes; siffrorna är frysta som de såg ut då.
              {pay.bookedOnTaxAccount ? ` Bokförd på skattekontot ${datumLang(pay.bookedOnTaxAccount.date)}.` : ""}
            </p>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

function DaysLeft({ days }: { days: number }) {
  if (days < 0) return <span className="text-danger"> · {Math.abs(days) === 1 ? "1 dag" : `${Math.abs(days)} dagar`} sen</span>;
  if (days === 0) return <span className="text-warn"> · i dag</span>;
  return <span className={days <= 7 ? "text-warn" : "text-muted"}> · {days === 1 ? "1 dag" : `${days} dagar`} kvar</span>;
}

/* -------------------------------- Stegraden -------------------------------- */

function StepRail({ steps }: { steps: VatFlowStep[] }) {
  return (
    <ol className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Momsens tre steg">
      {steps.map((s, i) => (
        <li key={s.key} data-vat-rail-step={s.key} data-vat-rail-status={s.status} className="flex items-start gap-2.5">
          <StepMarker index={i + 1} status={s.status} />
          <div className="min-w-0">
            <p className={cx("text-[13px] font-semibold", s.status === "nu" ? "text-ink" : s.status === "klar" ? "text-soft" : "text-muted")}>
              {s.title}
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">{s.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepMarker({ index, status }: { index: number; status: VatFlowStep["status"] }) {
  const base = "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold";
  if (status === "klar") {
    return (
      <span className={cx(base, "bg-ok text-white")} aria-label="Klar">
        <Check className="size-3.5" />
      </span>
    );
  }
  if (status === "nu") return <span className={cx(base, "bg-accent text-white ring-4 ring-accent/15")}>{index}</span>;
  if (status === "pagaende") return <span className={cx(base, "border border-info/60 text-info")}>{index}</span>;
  return <span className={cx(base, "border border-line text-muted")}>{index}</span>;
}

function StepHeading({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 className="text-[14px] font-semibold">{title}</h4>
        {text ? <p className="mt-0.5 max-w-prose text-[13px] text-soft">{text}</p> : null}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------ 1. Kontrollera ------------------------------ */

function KontrolleraStep({ flow, basePath }: { flow: VatPeriodFlow; basePath: string }) {
  const p = flow.summary;
  if (p.state === "pagaende") {
    return (
      <div data-vat-step-body="kontrollera">
        <StepHeading
          title="Perioden pågår"
          text={`Momsen räknas löpande ur bokföringen. När ${datumLang(p.period.end)} har passerat kontrolleras underlaget här, och sedan deklarerar du senast ${datumLang(flow.payment.dueDate)}.`}
        />
        <dl className="grid gap-3 sm:grid-cols-3">
          <Stat label="Utgående moms hittills" value={kr(p.position.utgaende)} />
          <Stat label="Ingående moms hittills" value={kr(p.position.ingaende)} />
          <Stat label={p.position.attBetala >= 0 ? "Att betala hittills" : "Att få tillbaka hittills"} value={kr(Math.abs(p.position.attBetala))} />
        </dl>
      </div>
    );
  }
  return (
    <div data-vat-step-body="kontrollera">
      <StepHeading
        title="Steg 1 · Kontrollera underlaget"
        text="Allt i perioden ska vara bokfört innan siffrorna går till Skatteverket. Driva kollar banken och köpen – det som saknas fixar du med ett klick."
      />
      <ul className="space-y-2">
        {flow.checklist.map((c) => (
          <ChecklistRow key={c.key} item={c} link={checklistLink(c, flow, basePath)} />
        ))}
      </ul>
    </div>
  );
}

/** Knappen som tar användaren dit felet fixas – banken, utgifterna eller en tidigare period. */
function checklistLink(item: VatChecklistItem, flow: VatPeriodFlow, basePath: string): { href: string; label: string } | undefined {
  if (item.ok) return undefined;
  if (item.key === "ordning") {
    const first = flow.earlierUndeclared[0];
    if (!first) return undefined;
    const params = new URLSearchParams({ fokus: first.key });
    if (first.fiscalYearLabel) params.set("ar", first.fiscalYearLabel);
    return { href: `${basePath}?${params}#period-${first.key}`, label: `Öppna ${first.label}` };
  }
  return CHECKLIST_LINKS[item.key];
}

function ChecklistRow({ item, link }: { item: VatChecklistItem; link?: { href: string; label: string } }) {
  return (
    <li
      data-vat-check={item.key}
      data-vat-check-ok={item.ok}
      className={cx("flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5", item.ok ? "bg-canvas/70" : "bg-warn-soft/40")}
    >
      {item.ok ? <Check className="size-4 shrink-0 text-ok" /> : <CircleAlert className="size-4 shrink-0 text-warn" />}
      <span className="min-w-0 flex-1">
        <span className={cx("block text-[13px]", item.ok ? "text-soft" : "font-medium text-ink")}>{item.label}</span>
        {item.detail ? <span className="block text-[12px] text-muted">{item.detail}</span> : null}
      </span>
      {link ? (
        <ButtonLink href={link.href} variant="secondary" size="sm">
          {link.label}
          <ArrowRight className="size-3.5" />
        </ButtonLink>
      ) : null}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-canvas/70 px-3.5 py-2.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-[15px] font-semibold tabular">{value}</dd>
    </div>
  );
}

/* ------------------------------- 2. Deklarera ------------------------------- */

function DeklareraStep({ flow, readOnly }: { flow: VatPeriodFlow; readOnly?: boolean }) {
  const p = flow.summary;
  const pay = flow.payment;
  return (
    <div data-vat-step-body="deklarera">
      <StepHeading
        title="Steg 2 · Deklarera hos Skatteverket"
        text="Underlaget är klart. Lämna momsdeklarationen i Skatteverkets e-tjänst – fyll i rutorna eller ladda upp filen – och tala sedan om för Driva att det är gjort."
      >
        <a href={SKV_DECLARE_URL} target="_blank" rel="noreferrer" className={cx("inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline")}>
          Öppna Lämna momsdeklaration
          <ExternalLink className="size-3.5" />
        </a>
      </StepHeading>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line/60 px-4 py-3.5">
          <p className="text-[13px] font-semibold">Fyll i rutorna</p>
          <p className="mt-0.5 text-[12px] text-muted">Bara rutorna med belopp. Kopiera och klistra in i e-tjänsten.</p>
          <ul className="mt-2.5 divide-y divide-line/50">
            {flow.boxesToFill.map((b) => (
              <li key={b.code} className="flex items-center gap-3 py-1.5 text-[13px]">
                <span className="w-7 font-mono text-[12px] text-muted">{b.code}</span>
                <span className="min-w-0 flex-1 truncate text-soft" title={b.label}>
                  {b.label}
                </span>
                <span className={cx("tabular", b.code === "49" && "font-semibold")}>{kr(b.amount)}</span>
                <CopyValue value={String(b.amount)} label={`Ruta ${b.code}`} />
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-line/60 px-4 py-3.5">
          <p className="text-[13px] font-semibold">Eller ladda upp filen</p>
          <p className="mt-0.5 text-[12px] text-muted">
            Deklarationsfilen (eSKD) innehåller samma rutor. I e-tjänsten väljer du Deklarera via fil, granskar och signerar.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <ButtonLink href={`/api/bokforing/deklaration?typ=moms&period=${p.period.key}`} variant="secondary" size="sm">
              <Download className="size-3.5" />
              Hämta deklarationsfil
            </ButtonLink>
            <ButtonLink href={`/api/bokforing/export?typ=moms&period=${p.period.key}`} variant="ghost" size="sm">
              Underlag (CSV)
            </ButtonLink>
          </div>
          {!readOnly && filingSubmissionAvailable() ? <InlamningPanel {...filingPanelData("moms", p.period.key)} className="mt-3" /> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-canvas/70 px-4 py-3.5">
        <div className="text-[13px]">
          <p className="font-medium text-ink">När deklarationen är inlämnad</p>
          <p className="text-soft">
            Driva fryser siffrorna, för momsen till redovisningskontot (2650) och låser perioden.
            {pay.direction === "betala" ? ` Sedan återstår att betala ${kr(pay.amount)} senast ${datumLang(pay.dueDate)}.` : ""}
          </p>
        </div>
        {readOnly ? (
          <p className="text-[13px] text-soft">Endast läsning – revisorer kan inte ändra momsen.</p>
        ) : (
          <DeclareVatButton periodKey={p.period.key} label={p.period.label} attBetala={p.position.attBetala} />
        )}
      </div>
    </div>
  );
}

/* --------------------------------- 3. Betala --------------------------------- */

function BetalaStep({ flow, readOnly }: { flow: VatPeriodFlow; readOnly?: boolean }) {
  const p = flow.summary;
  const pay = flow.payment;
  const report = p.report!;

  if (pay.direction === "tillbaka") {
    return (
      <div data-vat-step-body="betala">
        <StepHeading
          title="Steg 3 · Få tillbaka"
          text={`Du deklarerade ${kr(pay.amount)} att få tillbaka. Skatteverket sätter in pengarna på skattekontot och betalar ut dem till bolagets konto, om skattekontot inte har andra skulder.`}
        />
        {readOnly ? null : (
          <BookVatOnTaxAccountButton reportId={report.id} label={p.period.label} attBetala={report.attBetala} />
        )}
        <p className="mt-2 text-[12px] text-muted">
          När utbetalningen syns i banken bokförs den som skatteåterbetalning i bankinkorgen.
        </p>
      </div>
    );
  }

  return (
    <div data-vat-step-body="betala">
      <StepHeading
        title="Steg 3 · Betala"
        text={`Pengarna ska finnas på skattekontot senast ${datumLang(pay.dueDate)}. Betala från företagskontot till Skatteverkets bankgiro med bolagets OCR-nummer som referens.`}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <PayFact label="Belopp" value={kr(pay.amount)} copy={{ value: String(pay.amount), label: "Belopp" }} />
        <PayFact label="Bankgiro · Skatteverket" value={pay.bankgiro} copy={{ value: pay.bankgiro.replace("-", ""), label: "Bankgiro" }} />
        <div className="rounded-xl bg-canvas/70 px-3.5 py-2.5">
          <p className="text-[11px] text-muted">OCR-nummer</p>
          <div className="mt-0.5">
            <TaxAccountOcrField ocr={pay.ocr} suggested={suggestedTaxAccountOcr()} readOnly={readOnly} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line/60 px-4 py-3.5">
        <div className="text-[13px]">
          <p className="font-medium text-ink">Bokför momsen på skattekontot</p>
          <p className="max-w-prose text-soft">
            Skatteverket drar momsen från skattekontot på förfallodagen. Bokför dragningen så flyttas {kr(pay.amount)} från
            redovisningskontot (2650) till skattekontot (1630) – då stämmer saldot med Skatteverkets.
          </p>
          {pay.transferSeen ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ok">
              <Check className="size-3.5" />
              Överföring på {kr(pay.transferSeen.amount)} till skattekontot {datumLang(pay.transferSeen.date)} syns i banken.
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] text-muted">
              När överföringen syns i banken känns den igen som inbetalning till skattekontot och bokförs därifrån.
            </p>
          )}
        </div>
        {readOnly ? null : <BookVatOnTaxAccountButton reportId={report.id} label={p.period.label} attBetala={report.attBetala} />}
      </div>
    </div>
  );
}

function PayFact({ label, value, copy }: { label: string; value: string; copy: { value: string; label: string } }) {
  return (
    <div className="rounded-xl bg-canvas/70 px-3.5 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="text-[15px] font-semibold tabular">{value}</span>
        <CopyValue value={copy.value} label={copy.label} />
      </div>
    </div>
  );
}

/* --------------------------------- Rutorna --------------------------------- */

function BoxesTable({ flow }: { flow: VatPeriodFlow }) {
  const p = flow.summary;
  return (
    <div className="overflow-x-auto rounded-xl bg-canvas/70 px-4 py-3">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th className="pb-1.5 font-semibold">Ruta</th>
            <th className="pb-1.5 font-semibold">Beskrivning</th>
            <th className="pb-1.5 text-right font-semibold">Belopp</th>
          </tr>
        </thead>
        <tbody>
          {p.position.boxes.map((b) => (
            <tr key={b.code} className="border-t border-line/50">
              <td className="py-1.5 pr-3 font-mono text-[12px] text-muted">{b.code}</td>
              <td className="py-1.5 pr-3">{b.label}</td>
              <td className={cx("py-1.5 text-right tabular", b.code === "49" && "font-semibold")}>{kr(b.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-3">
        <a href={`/api/bokforing/export?typ=moms&period=${p.period.key}`} className="text-[13px] font-medium text-accent hover:underline">
          Exportera underlag (CSV)
        </a>
        {p.state === "pagaende" ? null : (
          <a href={`/api/bokforing/deklaration?typ=moms&period=${p.period.key}`} className="text-[13px] font-medium text-accent hover:underline">
            Hämta deklarationsfil (eSKD)
          </a>
        )}
      </div>
    </div>
  );
}
