"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus, UserRound } from "lucide-react";
import { Avatar, Badge, buttonClasses, Card, EmptyState } from "./ui";
import { Modal } from "./modal";
import { AddressFields } from "./address-input";
import { createCustomerAction } from "@/app/actions";

export interface CustomerRow {
  id: string;
  name: string;
  kind: "privat" | "foretag";
  contactPerson?: string;
  email: string;
  phone: string;
  city?: string;
  openQuotes: number;
  activeJobs: number;
  unpaid: string | null;
  newRequests: number;
}

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export function NewCustomerButton({ full = false }: { full?: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"privat" | "foretag">("privat");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    startTransition(async () => {
      const id = await createCustomerAction({
        kind,
        name: String(formData.get("name") ?? ""),
        contactPerson: String(formData.get("contactPerson") ?? "") || undefined,
        orgNumber: String(formData.get("orgNumber") ?? "") || undefined,
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        address: String(formData.get("address") ?? "") || undefined,
        postalCode: String(formData.get("postalCode") ?? "") || undefined,
        city: String(formData.get("city") ?? "") || undefined,
      });
      setOpen(false);
      router.push(`/kunder/${id}`);
    });
  }

  return (
    <>
      <button className={buttonClasses("primary", full ? "md" : "md")} onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Ny kund
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Ny kund" size="md">
        <form action={submit} className="space-y-4 px-6 py-5">
          <div className="flex rounded-xl bg-canvas p-1">
            {(["privat", "foretag"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-all ${
                  kind === k ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {k === "privat" ? "Privatperson" : "Företag"}
              </button>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">
              {kind === "privat" ? "Namn" : "Företagsnamn"}
            </label>
            <input name="name" required className={inputCls} placeholder={kind === "privat" ? "Anna Andersson" : "Exempel AB"} />
          </div>
          {kind === "foretag" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-soft">Kontaktperson</label>
                <input name="contactPerson" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-soft">Org.nummer</label>
                <input name="orgNumber" className={inputCls} placeholder="556000-0000" />
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-soft">E-post</label>
              <input name="email" type="email" required className={inputCls} placeholder="namn@exempel.se" />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-soft">Telefon</label>
              <input name="phone" className={inputCls} placeholder="070-123 45 67" />
            </div>
          </div>
          <AddressFields />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              Avbryt
            </button>
            <button type="submit" className={buttonClasses("primary")} disabled={isPending}>
              {isPending ? "Sparar …" : "Spara kund"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function CustomerList({ customers }: { customers: CustomerRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.contactPerson ?? "").toLowerCase().includes(q)
    );
  }, [customers, query]);

  return (
    <div>
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök på namn, företag eller e-post …"
          className="w-full rounded-2xl border border-line bg-card py-3 pl-10 pr-4 text-[15px] shadow-card placeholder:text-muted focus:border-accent"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={query ? `Inga kunder matchar ”${query}”` : "Inga kunder ännu"}
          text={query ? "Prova ett annat sökord." : "Lägg till din första kund så håller Driva ordning på allt kring den."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((c) => (
            <Link key={c.id} href={`/kunder/${c.id}` as never}>
              <Card className="flex h-full items-start gap-4 p-5 transition-all hover:-translate-y-0.5 hover:shadow-pop">
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[15px] font-semibold">{c.name}</p>
                    {c.kind === "foretag" ? <Badge tone="neutral">Företag</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-muted">
                    {c.contactPerson ? `${c.contactPerson} · ` : ""}
                    {c.email}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {c.newRequests > 0 ? <Badge tone="info">{c.newRequests} ny förfrågan</Badge> : null}
                    {c.openQuotes > 0 ? <Badge tone="warn">{c.openQuotes} väntar på BankID</Badge> : null}
                    {c.activeJobs > 0 ? <Badge tone="accent">{c.activeJobs} aktivt jobb</Badge> : null}
                    {c.unpaid ? <Badge tone="danger">{c.unpaid} obetalt</Badge> : null}
                    {c.newRequests + c.openQuotes + c.activeJobs === 0 && !c.unpaid ? (
                      <span className="text-[12px] text-muted">Inget pågående</span>
                    ) : null}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
