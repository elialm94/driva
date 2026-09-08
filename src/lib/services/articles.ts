/**
 * Företagets egna artikelregister – timpris, material och schabloner
 * som återanvänds på offert och faktura. Ligger i meta.articles.
 */
import { db, save } from "../store";
import { uid } from "../ids";
import type { CatalogArticle, LineKind, VatRate } from "../types";
import { createDocLine } from "../line-defaults";
import type { DocLine } from "../types";

export type ArticleInput = {
  description: string;
  kind: LineKind;
  unit: string;
  unitPrice: number;
  vatRate: VatRate;
  discountPercent?: number;
};

function normalize(input: ArticleInput): ArticleInput {
  const description = input.description.trim();
  if (!description) throw new Error("Ange en beskrivning.");
  const unit = input.unit.trim() || (input.kind === "arbete" || input.kind === "resor" ? "tim" : "st");
  const unitPrice = Math.round(input.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Priset måste vara minst 0 kr.");
  const vatRate = input.vatRate;
  if (![0, 6, 12, 25].includes(vatRate)) throw new Error("Ogiltig momssats.");
  const discount =
    input.discountPercent != null && input.discountPercent > 0
      ? Math.min(100, Math.max(0, input.discountPercent))
      : undefined;
  return { description, kind: input.kind, unit, unitPrice, vatRate, discountPercent: discount };
}

export function listArticles(): CatalogArticle[] {
  return [...(db().meta.articles ?? [])];
}

export function upsertArticle(input: ArticleInput & { id?: string }): CatalogArticle {
  const next = normalize(input);
  const data = db();
  data.meta.articles ??= [];
  const existing = input.id ? data.meta.articles.find((a) => a.id === input.id) : undefined;
  const article: CatalogArticle = {
    id: existing?.id ?? uid(),
    ...next,
  };
  if (existing) {
    Object.assign(existing, article);
  } else {
    data.meta.articles.push(article);
  }
  save();
  return article;
}

export function deleteArticle(id: string): void {
  const data = db();
  const before = data.meta.articles?.length ?? 0;
  data.meta.articles = (data.meta.articles ?? []).filter((a) => a.id !== id);
  if ((data.meta.articles?.length ?? 0) === before) return;
  save();
}

export function articleToDocLine(article: CatalogArticle): DocLine {
  const line = createDocLine(article.kind, { defaultVatRate: article.vatRate, defaultHourlyRate: article.unitPrice });
  return {
    ...line,
    description: article.description,
    unit: article.unit,
    unitPrice: article.unitPrice,
    vatRate: article.vatRate,
    discountPercent: article.discountPercent,
  };
}

export function articleFromLine(line: Pick<DocLine, "description" | "kind" | "unit" | "unitPrice" | "vatRate" | "discountPercent" | "isHeading">): CatalogArticle {
  if (line.isHeading) throw new Error("En rubrik kan inte sparas som artikel.");
  return upsertArticle({
    description: line.description,
    kind: line.kind,
    unit: line.unit,
    unitPrice: line.unitPrice,
    vatRate: line.vatRate,
    discountPercent: line.discountPercent,
  });
}
