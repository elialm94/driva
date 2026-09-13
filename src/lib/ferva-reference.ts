/**
 * Företagsunik FV-referens. Delas av uppdrag (inköpsreferens) och
 * materialbeställningar så att en tagg aldrig pekar på två saker.
 */
import { db } from "./store";
import { FERVA_REFERENCE_RE } from "./wholesalers/confirmation-parse";

export function normalizeFervaRef(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const m = FERVA_REFERENCE_RE.exec(raw.trim());
  return m ? `FV-${m[1]}` : undefined;
}

export function takenFervaRefs(): Set<string> {
  const data = db();
  const taken = new Set<string>();
  for (const job of data.jobs) {
    if (job.purchaseRef) taken.add(job.purchaseRef);
  }
  for (const order of data.purchaseOrders ?? []) {
    if (order.reference) taken.add(order.reference);
  }
  return taken;
}

export function nextFervaReference(): string {
  const data = db();
  let n = data.meta.purchaseOrderSequence ?? 1001;
  const taken = takenFervaRefs();
  let ref = `FV-${n}`;
  while (taken.has(ref)) {
    n += 1;
    ref = `FV-${n}`;
  }
  data.meta = { ...data.meta, purchaseOrderSequence: n + 1 };
  return ref;
}

export function jobByPurchaseRef(ref: string | undefined | null) {
  const normalized = normalizeFervaRef(ref);
  if (!normalized) return undefined;
  return db().jobs.find((j) => j.purchaseRef === normalized);
}

export function purchaseOrderByReference(ref: string | undefined | null) {
  const normalized = normalizeFervaRef(ref);
  if (!normalized) return undefined;
  return (db().purchaseOrders ?? []).find((o) => o.reference === normalized);
}
