"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus, UserRound } from "lucide-react";
import { Avatar, Badge, buttonClasses, Card, EmptyState } from "./ui";
import { NewCustomerModal } from "./new-customer-modal";

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

export function NewCustomerButton({ full = false }: { full?: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button className={buttonClasses("primary", full ? "md" : "md")} onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Ny kund
      </button>
      <NewCustomerModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={({ id }) => router.push(`/kunder/${id}`)}
      />
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
                    {c.activeJobs > 0 ? (
                      <Badge tone="accent">
                        {c.activeJobs} {c.activeJobs === 1 ? "aktivt uppdrag" : "aktiva uppdrag"}
                      </Badge>
                    ) : null}
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
