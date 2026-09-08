"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Card, buttonClasses } from "./ui";
import { kr } from "@/lib/format";
import { lineTypeLabel, lineTypeOf } from "@/lib/economic-line-type";
import type { CatalogArticle, LineKind, VatRate } from "@/lib/types";
import { deleteArticleAction, upsertArticleAction } from "@/app/actions";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

export function ArticleSettings({ articles }: { articles: CatalogArticle[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<LineKind>("arbete");
  const [unit, setUnit] = useState("tim");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function add() {
    start(async () => {
      setError(null);
      const result = await upsertArticleAction({
        description,
        kind,
        unit,
        unitPrice: Number(price.replace(",", ".")),
        vatRate: 25 as VatRate,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDescription("");
      setPrice("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Card className="px-5 py-4">
      <p className="text-[15px] font-semibold">Artikelregister</p>
      <p className="mt-1 text-[13px] leading-relaxed text-soft">
        Samma arbete och samma pris, varje gång. Raderna dyker upp som förslag när du skriver offerter och fakturor.
      </p>
      {articles.length > 0 ? (
        <ul className="mt-3 divide-y divide-line/70">
          {articles.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-[14px]">
              <span>
                <span className="font-medium text-ink">{a.description}</span>
                <span className="text-muted">
                  {" "}
                  · {lineTypeLabel(lineTypeOf({ kind: a.kind }))} · {kr(a.unitPrice)}/{a.unit}
                </span>
              </span>
              <button
                type="button"
                className="text-muted hover:text-danger"
                aria-label={`Ta bort ${a.description}`}
                disabled={isPending}
                onClick={() =>
                  start(async () => {
                    await deleteArticleAction(a.id);
                    router.refresh();
                  })
                }
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-muted">Inga artiklar ännu.</p>
      )}
      {open ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_7rem_5rem_6rem_auto]">
          <input className={inputCls} placeholder="Beskrivning" value={description} onChange={(e) => setDescription(e.target.value)} />
          <select
            className={inputCls}
            value={kind}
            onChange={(e) => {
              const next = e.target.value as LineKind;
              setKind(next);
              setUnit(next === "arbete" || next === "resor" ? "tim" : "st");
            }}
          >
            <option value="arbete">Arbete</option>
            <option value="material">Material</option>
            <option value="resor">Resor</option>
            <option value="ovrigt">Övrigt</option>
          </select>
          <input className={inputCls} placeholder="Enhet" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <input className={inputCls} inputMode="numeric" placeholder="kr" value={price} onChange={(e) => setPrice(e.target.value)} />
          <button type="button" className={buttonClasses("primary", "sm")} disabled={isPending} onClick={add}>
            Spara
          </button>
        </div>
      ) : (
        <button type="button" className={`${buttonClasses("secondary", "sm")} mt-3`} onClick={() => setOpen(true)}>
          Ny artikel
        </button>
      )}
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </Card>
  );
}
