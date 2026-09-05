"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { buttonClasses, Card, cx } from "./ui";
import { DateField } from "./date-field";
import { kr } from "@/lib/format";
import { updateAnnualReportAction } from "@/app/bokforing-actions";
import type { AnnualReportCertification, AnnualReportSignatory } from "@/lib/types";

/**
 * Redigering av årsredovisningens texter, underskrifter och fastställelseintyg.
 *
 * Siffrorna finns inte här: de kommer ur den stängda bokföringen, och en
 * årsredovisning som säger något annat än böckerna vore en osanning. Det som
 * går att skriva är bolagets egna påståenden – vad verksamheten är, vad som
 * hänt, vad stämman föreslås besluta och vilka som skriver under.
 */

const fieldCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-[13px] font-medium text-danger">{error}</p>;
}

/** En sparknapp som visar att det gick vägen – tyst lyckande känns som en bugg. */
function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(run: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await run();
      if (!res.ok) {
        setError(res.error ?? "Något gick fel.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return { save, pending, error, saved, dirty: () => setSaved(false) };
}

export function NarrativeForm({
  reportId,
  verksamhet,
  vasentligaHandelser,
  tillForfogande,
  utdelning,
  locked,
}: {
  reportId: string;
  verksamhet: string;
  vasentligaHandelser: string;
  tillForfogande: number;
  utdelning?: number;
  locked: boolean;
}) {
  const [v, setV] = useState(verksamhet);
  const [h, setH] = useState(vasentligaHandelser);
  const [u, setU] = useState(utdelning ? String(utdelning) : "");
  const { save, pending, error, saved, dirty } = useSave();

  if (locked) {
    return (
      <Card className="px-6 py-5">
        <h3 className="text-[15px] font-semibold">Förvaltningsberättelsen</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
          Årsredovisningen är signerad och texten är därmed låst – den är underskriven i det skick den står. Skapa en ny
          årsredovisning om något är fel; den signerade versionen står kvar.
        </p>
      </Card>
    );
  }

  return (
    <Card className="px-6 py-5">
      <h3 className="text-[15px] font-semibold">Förvaltningsberättelsen</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-soft">
        Driva skriver ett utkast ur bokföringen, men verksamheten och årets händelser är bolagets egna ord. Skriv om dem
        så att en utomstående läsare förstår vad bolaget gör.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className={labelCls} htmlFor="ar-verksamhet">
            Verksamheten
          </label>
          <textarea
            id="ar-verksamhet"
            rows={4}
            className={fieldCls}
            value={v}
            onChange={(e) => {
              setV(e.target.value);
              dirty();
            }}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="ar-handelser">
            Väsentliga händelser under räkenskapsåret
          </label>
          <textarea
            id="ar-handelser"
            rows={4}
            className={fieldCls}
            value={h}
            onChange={(e) => {
              setH(e.target.value);
              dirty();
            }}
          />
        </div>
        <div className="max-w-xs">
          <label className={labelCls} htmlFor="ar-utdelning">
            Föreslagen utdelning
          </label>
          <input
            id="ar-utdelning"
            inputMode="numeric"
            className={fieldCls}
            placeholder="0"
            value={u}
            onChange={(e) => {
              setU(e.target.value);
              dirty();
            }}
          />
          <p className="mt-1 text-[12px] text-soft">
            Till stämmans förfogande står {kr(tillForfogande)}. Resten balanseras i ny räkning.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className={buttonClasses("primary")}
          onClick={() =>
            save(() =>
              updateAnnualReportAction(reportId, {
                verksamhet: v,
                vasentligaHandelser: h,
                utdelning: Number(u.replace(/\s/g, "").replace(",", ".")) || 0,
              })
            )
          }
        >
          {pending ? "Sparar…" : "Spara texten"}
        </button>
        {saved ? <span className="text-[13px] font-medium text-ok">Sparat</span> : null}
      </div>
      <ErrorNote error={error} />
    </Card>
  );
}

/**
 * Underskrifterna. Driva känner inte styrelsen – den står i bolagsordningen och
 * hos Bolagsverket, inte i bokföringen – så listan fylls i här. Årsredovisningen
 * skrivs under av samtliga styrelseledamöter och av VD.
 */
export function SignatoriesForm({
  reportId,
  signatories,
  locked,
}: {
  reportId: string;
  signatories: AnnualReportSignatory[];
  locked: boolean;
}) {
  const [rows, setRows] = useState<{ name: string; role: string }[]>(
    signatories.length > 0
      ? signatories.map((s) => ({ name: s.name, role: s.role }))
      : [{ name: "", role: "Styrelseledamot" }]
  );
  const { save, pending, error, saved, dirty } = useSave();

  if (locked) {
    return (
      <Card className="px-6 py-5">
        <h3 className="text-[15px] font-semibold">Underskrifter</h3>
        <ul className="mt-3 space-y-1.5 text-[13px]">
          {signatories.map((s) => (
            <li key={`${s.name}-${s.role}`} className="text-soft">
              <span className="font-medium text-ink">{s.name}</span> · {s.role}
              {s.signedAt ? ` · skrev under ${s.signedAt}` : ""}
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  function update(i: number, patch: Partial<{ name: string; role: string }>) {
    setRows((prev) => prev.map((r, j) => (i === j ? { ...r, ...patch } : r)));
    dirty();
  }

  return (
    <Card className="px-6 py-5">
      <h3 className="text-[15px] font-semibold">Underskrifter</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-soft">
        Årsredovisningen skrivs under av samtliga styrelseledamöter och av verkställande direktör om bolaget har en.
        Driva känner inte styrelsen, så ange den här – namnen står på dokumentet.
      </p>

      <div className="mt-4 space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className={labelCls} htmlFor={`sig-name-${i}`}>
                Namn
              </label>
              <input
                id={`sig-name-${i}`}
                className={fieldCls}
                placeholder="Anna Andersson"
                value={row.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <label className={labelCls} htmlFor={`sig-role-${i}`}>
                Befattning
              </label>
              <input
                id={`sig-role-${i}`}
                className={fieldCls}
                placeholder="Styrelseledamot"
                value={row.role}
                onChange={(e) => update(i, { role: e.target.value })}
              />
            </div>
            {rows.length > 1 ? (
              <button
                type="button"
                aria-label="Ta bort underskrift"
                className={cx(buttonClasses("ghost"), "px-2.5")}
                onClick={() => {
                  setRows((prev) => prev.filter((_, j) => j !== i));
                  dirty();
                }}
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        className={cx(buttonClasses("ghost"), "mt-3")}
        onClick={() => {
          setRows((prev) => [...prev, { name: "", role: "Styrelseledamot" }]);
          dirty();
        }}
      >
        <Plus className="mr-1 size-4" />
        Lägg till person
      </button>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className={buttonClasses("primary")}
          onClick={() => save(() => updateAnnualReportAction(reportId, { underskrifter: rows }))}
        >
          {pending ? "Sparar…" : "Spara underskrifterna"}
        </button>
        {saved ? <span className="text-[13px] font-medium text-ok">Sparat</span> : null}
      </div>
      <ErrorNote error={error} />
    </Card>
  );
}

/**
 * Fastställelseintyget. Bolagsverket registrerar inte en årsredovisning utan
 * det: någon i styrelsen intygar att stämman fastställt räkningarna och att
 * kopian stämmer med originalet.
 */
export function CertificationForm({
  reportId,
  certification,
  signatories,
  locked,
}: {
  reportId: string;
  certification?: AnnualReportCertification;
  signatories: AnnualReportSignatory[];
  locked: boolean;
}) {
  const [stammaDate, setStammaDate] = useState(certification?.stammaDate ?? "");
  const [name, setName] = useState(certification?.certifiedByName ?? signatories[0]?.name ?? "");
  const [role, setRole] = useState(certification?.certifiedByRole ?? signatories[0]?.role ?? "Styrelseledamot");
  const [decision, setDecision] = useState(certification?.dispositionDecision ?? "");
  const { save, pending, error, saved, dirty } = useSave();

  if (locked) {
    return (
      <Card className="px-6 py-5">
        <h3 className="text-[15px] font-semibold">Fastställelseintyg</h3>
        {certification?.stammaDate ? (
          <p className="mt-2 text-[13px] leading-relaxed text-soft">
            Fastställd på årsstämma {certification.stammaDate}, bestyrkt av {certification.certifiedByName} (
            {certification.certifiedByRole}).
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-soft">Inget fastställelseintyg är ifyllt.</p>
        )}
      </Card>
    );
  }

  return (
    <Card className="px-6 py-5">
      <h3 className="text-[15px] font-semibold">Fastställelseintyg</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-soft">
        Bolagsverket registrerar inte årsredovisningen utan intyget. Fyll i det efter årsstämman – det trycks sist i
        dokumentet.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="cert-date">
            Datum för årsstämman
          </label>
          <DateField
            id="cert-date"
            value={stammaDate}
            onChange={(v) => {
              setStammaDate(v);
              dirty();
            }}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cert-name">
            Bestyrks av
          </label>
          <input
            id="cert-name"
            className={fieldCls}
            placeholder="Anna Andersson"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              dirty();
            }}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cert-role">
            Befattning
          </label>
          <input
            id="cert-role"
            className={fieldCls}
            placeholder="Styrelseledamot"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              dirty();
            }}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="cert-decision">
            Stämmans beslut om resultatet
          </label>
          <textarea
            id="cert-decision"
            rows={2}
            className={fieldCls}
            placeholder="Årsstämman beslutade att disponera bolagets resultat enligt styrelsens förslag."
            value={decision}
            onChange={(e) => {
              setDecision(e.target.value);
              dirty();
            }}
          />
          <p className="mt-1 text-[12px] text-soft">
            Lämnas tomt används styrelsens förslag i förvaltningsberättelsen som beslutstext.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className={buttonClasses("primary")}
          onClick={() =>
            save(() =>
              updateAnnualReportAction(reportId, {
                fastallelseintyg: {
                  stammaDate: stammaDate || undefined,
                  certifiedByName: name || undefined,
                  certifiedByRole: role || undefined,
                  dispositionDecision: decision || undefined,
                },
              })
            )
          }
        >
          {pending ? "Sparar…" : "Spara intyget"}
        </button>
        {saved ? <span className="text-[13px] font-medium text-ok">Sparat</span> : null}
      </div>
      <ErrorNote error={error} />
    </Card>
  );
}
