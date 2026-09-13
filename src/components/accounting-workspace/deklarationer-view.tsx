import { AppLink } from "@/components/app-link";
import { SmartBack } from "@/components/back-link";
import { Badge, Card, EmptyState, PageHeader, SectionTitle, type BadgeTone } from "@/components/ui";
import { FileCheck2 } from "lucide-react";
import { isOwnerSurface, wsCan, wsHref, type AccountingWorkspace } from "@/lib/accounting-workspace/shared";
import { FERVA_DOES_NOT_SEND, FILING_INSTRUCTIONS_VERSION } from "@/lib/filing/instructions";
import { FILING_GROUP_LABEL, filingCases, type FilingCase, type FilingCaseGroup } from "@/lib/filing/deklarationer";
import { filingSubmissionAvailable } from "@/lib/filing/select";
import { datumLang, kr } from "@/lib/format";

/**
 * Deklarationer & inlämning – samma vy för ägaren (/bokforing/deklarationer)
 * och konsulten (/redovisning/k/<id>/deklarationer). Tre grupper, exakt
 * status per ärende, och en rak text om vem som gör vad: konsulten förbereder,
 * ägaren lämnar in.
 */
export function DeklarationerView({ ws }: { ws: AccountingWorkspace }) {
  const cases = filingCases();
  const machine = filingSubmissionAvailable();
  const canSubmit = wsCan(ws, "submit_filing");
  const canPrepare = wsCan(ws, "prepare_filing");

  return (
    <div>
      <PageHeader
        back={isOwnerSurface(ws) ? <SmartBack /> : undefined}
        title="Deklarationer & inlämning"
        subtitle={
          machine
            ? "Moms, arbetsgivardeklaration, ROT/RUT, inkomstdeklaration och årsredovisning. Filerna byggs ur bokföringen; inlämningen går via leverantör eller för hand i myndighetens e-tjänst."
            : `Moms, arbetsgivardeklaration, ROT/RUT, inkomstdeklaration och årsredovisning. ${FERVA_DOES_NOT_SEND}`
        }
      />

      <p className="mb-5 text-[12.5px] leading-relaxed text-muted">
        {canSubmit
          ? "Du kan förbereda, hämta filerna och rapportera att de är inlämnade."
          : canPrepare
            ? "Du kan förbereda och hämta filerna. Att rapportera den slutliga inlämningen är ägarens handling."
            : "Du kan läsa ärendena. Att förbereda och lämna in kräver skrivbehörighet."}{" "}
        Instruktionerna följer myndigheternas e-tjänster, version {FILING_INSTRUCTIONS_VERSION}.
      </p>

      {cases.all.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="Inget att deklarera just nu"
          text="När en momsperiod tar slut, en lön är bokförd eller ett räkenskapsår stängs dyker deklarationen upp här."
        />
      ) : (
        <div className="space-y-8">
          <Group group="behover_goras" cases={cases.behover_goras} ws={ws} today={cases.today} empty="Inget behöver göras just nu." />
          <Group group="kommande" cases={cases.kommande} ws={ws} today={cases.today} empty="Inget kommande inom de närmaste månaderna." />
          <Group group="inlamnat" cases={cases.inlamnat} ws={ws} today={cases.today} empty="Inget är inlämnat ännu." />
        </div>
      )}
    </div>
  );
}

const GROUP_TONE: Record<FilingCaseGroup, BadgeTone> = { behover_goras: "warn", kommande: "info", inlamnat: "ok" };

function Group({
  group,
  cases,
  ws,
  today,
  empty,
}: {
  group: FilingCaseGroup;
  cases: FilingCase[];
  ws: AccountingWorkspace;
  today: string;
  empty: string;
}) {
  return (
    <section>
      <SectionTitle right={<span className="text-[12px] text-muted">{cases.length}</span>}>{FILING_GROUP_LABEL[group]}</SectionTitle>
      {cases.length === 0 ? (
        <p className="text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {cases.map((c) => (
            <li key={c.id}>
              <CaseRow c={c} ws={ws} today={today} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CaseRow({ c, ws, today }: { c: FilingCase; ws: AccountingWorkspace; today: string }) {
  const href = wsHref(ws, c.href);
  const overdue = c.group === "behover_goras" && c.dueDate && c.dueDate < today;
  return (
    <Card className="px-4 py-3.5" data-filing-case={c.id} data-filing-group={c.group}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AppLink href={href} className="text-[14px] font-semibold text-ink hover:underline">
              {c.title} · {c.periodLabel}
            </AppLink>
            <Badge tone={GROUP_TONE[c.group]}>{FILING_GROUP_LABEL[c.group]}</Badge>
            {c.external ? <Badge tone="neutral">På ärendet</Badge> : null}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-soft">{c.status}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {c.authorityName}
            {c.dueDate ? ` · ${c.group === "inlamnat" ? "förfallodag var" : "senast"} ${datumLang(c.dueDate)}` : ""}
            {c.amount != null && c.amount > 0 ? ` · ${kr(c.amount)}` : ""}
          </p>
        </div>
        <div className="text-right text-[12px] text-muted">
          {overdue ? <p className="font-medium text-danger">Förfallen</p> : null}
          <p>{c.responsible.submit}</p>
        </div>
      </div>
      {c.blockers.length > 0 && c.group === "behover_goras" ? (
        <ul className="mt-2 space-y-1">
          {c.blockers.slice(0, 3).map((b, i) => (
            <li key={i} className="text-[12.5px] leading-relaxed text-warn">
              {b}
            </li>
          ))}
          {c.blockers.length > 3 ? <li className="text-[12px] text-muted">+{c.blockers.length - 3} till på ärendets sida</li> : null}
        </ul>
      ) : null}
    </Card>
  );
}
