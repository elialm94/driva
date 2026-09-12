"use client";

import { useMemo, useState, useTransition } from "react";
import { addCustomAccountAction, archiveAccountAction, renameAccountAction } from "@/app/bokforing-actions";
import { buttonClasses, Card } from "./ui";

export interface ChartAccountRow {
  number: number;
  name: string;
  section: string;
  custom?: boolean;
  archived?: boolean;
}

const SECTION_LABEL: Record<string, string> = {
  immateriella_anlaggningstillgangar: "Immateriella anläggningstillgångar",
  materiella_anlaggningstillgangar: "Materiella anläggningstillgångar",
  finansiella_anlaggningstillgangar: "Finansiella anläggningstillgångar",
  varulager: "Varulager",
  kortfristiga_fordringar: "Kortfristiga fordringar",
  kassa_och_bank: "Kassa och bank",
  bundet_eget_kapital: "Bundet eget kapital",
  fritt_eget_kapital: "Fritt eget kapital",
  obeskattade_reserver: "Obeskattade reserver",
  avsattningar: "Avsättningar",
  langfristiga_skulder: "Långfristiga skulder",
  kortfristiga_skulder: "Kortfristiga skulder",
  nettoomsattning: "Nettoomsättning",
  ovriga_rorelseintakter: "Övriga rörelseintäkter",
  ravaror_och_fornodenheter: "Råvaror och förnödenheter",
  ovriga_externa_kostnader: "Övriga externa kostnader",
  personalkostnader: "Personalkostnader",
  avskrivningar: "Avskrivningar",
  ovriga_rorelsekostnader: "Övriga rörelsekostnader",
  finansiella_intakter: "Finansiella intäkter",
  finansiella_kostnader: "Finansiella kostnader",
  bokslutsdispositioner: "Bokslutsdispositioner",
  skatt: "Skatt",
  arets_resultat: "Årets resultat",
};

export function ChartAccountsView({ accounts }: { accounts: ChartAccountRow[] }) {
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => String(a.number).includes(q) || a.name.toLowerCase().includes(q) || (SECTION_LABEL[a.section] ?? a.section).toLowerCase().includes(q)
    );
  }, [accounts, query]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 px-5 py-4">
        <p className="text-[15px] font-semibold">Lägg till konto</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Nummer</span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              inputMode="numeric"
              className="h-10 w-28 rounded-xl border border-line bg-card px-3 text-[14px] tabular"
            />
          </label>
          <label className="block min-w-48 flex-1">
            <span className="mb-1 block text-[12px] text-muted">Namn</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-card px-3 text-[14px]"
            />
          </label>
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const res = await addCustomAccountAction(Number(number), name);
                if (!res.ok) setError(res.error);
                else {
                  setNumber("");
                  setName("");
                }
              });
            }}
          >
            {pending ? "Sparar …" : "Lägg till"}
          </button>
        </div>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </Card>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Sök konto"
        className="h-11 w-full rounded-xl border border-line bg-card px-3 text-[14px]"
      />

      <Card className="overflow-x-auto px-5 py-4">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="pb-2">Konto</th>
              <th className="pb-2">Namn</th>
              <th className="pb-2">Klass</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.number} className="border-t border-line/50">
                <td className="py-2 pr-3 font-mono tabular">{a.number}</td>
                <td className="py-2 pr-3">
                  {renameId === a.number ? (
                    <input
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      className="h-9 w-full rounded-lg border border-line px-2"
                    />
                  ) : (
                    <span>
                      {a.name}
                      {a.archived ? <span className="ml-2 text-[12px] text-muted">Arkiverat</span> : null}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-soft">{SECTION_LABEL[a.section] ?? a.section}</td>
                <td className="py-2 text-right">
                  {renameId === a.number ? (
                    <button
                      type="button"
                      className={buttonClasses("primary", "sm")}
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const res = await renameAccountAction(a.number, renameName);
                          if (!res.ok) setError(res.error);
                          else setRenameId(null);
                        })
                      }
                    >
                      Spara
                    </button>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className={buttonClasses("ghost", "sm")}
                        onClick={() => {
                          setRenameId(a.number);
                          setRenameName(a.name);
                        }}
                      >
                        Byt namn
                      </button>
                      <button
                        type="button"
                        className={buttonClasses("ghost", "sm")}
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await archiveAccountAction(a.number, !a.archived);
                            if (!res.ok) setError(res.error);
                          })
                        }
                      >
                        {a.archived ? "Återställ" : "Arkivera"}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
