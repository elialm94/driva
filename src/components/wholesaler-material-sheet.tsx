"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import type { PurchaseOrderLine } from "@/lib/types";
import type { WholesalerSearchResult, WholesalerSearchRow } from "@/lib/services/wholesalers";
import type { PurchaseOrderMailPreview } from "@/lib/services/purchase-orders";
import type { CartView, JobWholesalerContext, WholesalerPickerConnection } from "@/lib/wholesalers/views";
import { formatOre } from "@/lib/wholesalers/money";
import { CUSTOMER_PRICE_SOURCE_LABELS, DELIVERY_MODE_LABELS } from "@/lib/wholesalers/labels";
import { datumKort } from "@/lib/format";
import {
  addCatalogProductToCartAction,
  addFreeTextLineAction,
  discardCartAction,
  previewPurchaseOrderMailAction,
  removeCartLineAction,
  searchWholesalerProductsAction,
  sendPurchaseOrderAction,
  updateCartDetailsAction,
  updateCartLineAction,
} from "@/app/wholesaler-actions";
import { DemoTag, buttonClasses, cx } from "./ui";
import { Modal } from "./modal";
import { DateField } from "./date-field";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";
/** Smala fält (antal, pris) – utan w-full så bredden kan sättas per fält. */
const compactInputCls =
  "rounded-xl border border-line-strong bg-card px-2 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] text-muted";
const SEARCH_DEBOUNCE_MS = 250;

type View = "search" | "cart" | "review" | "sent" | "freetext";

function newSendKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function unitPriceLabel(row: WholesalerSearchRow): string {
  if (row.netPriceOre != null) return `${formatOre(row.netPriceOre)}/${row.unit}`;
  if (row.listPriceOre != null) return `Listpris ${formatOre(row.listPriceOre)}/${row.unit}`;
  return "Inköpspris saknas";
}

export function WholesalerMaterialSheet({
  open,
  onClose,
  jobId,
  context,
  onManual,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  context: JobWholesalerContext;
  onManual: () => void;
}) {
  const router = useRouter();
  const connections = context.connections;
  const [carts, setCarts] = useState<CartView[]>(context.carts);
  const [connectionId, setConnectionId] = useState<string>(() => connections[0]?.id ?? "");
  const [view, setView] = useState<View>("search");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<WholesalerSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<{ reference: string; simulated: boolean; demoConfirmation: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  // Nya serverdata (router.refresh) vinner över lokal varukorgskopia; och
  // varje öppning börjar i sökvyn. Justeras under render – inte i effekter.
  const [seenCarts, setSeenCarts] = useState(context.carts);
  if (seenCarts !== context.carts) {
    setSeenCarts(context.carts);
    setCarts(context.carts);
  }
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) {
      setView("search");
      setError(null);
      setSent(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  const connection = connections.find((c) => c.id === connectionId) ?? connections[0];
  const cart = carts.find((c) => c.order.connectionId === connection?.id && c.order.status === "draft");
  const cartCount = cart?.lines.length ?? 0;
  const otherCarts = carts.filter((c) => c.order.status === "draft" && c.order.connectionId !== connection?.id);

  const runSearch = useCallback(
    async (q: string, page = 1) => {
      if (!connection) return;
      const seq = ++requestSeq.current;
      if (q.trim().length < 2) {
        setResult(null);
        setSearching(false);
        return;
      }
      setSearching(true);
      setSearchError(null);
      const res = await searchWholesalerProductsAction({ connectionId: connection.id, query: q, page });
      if (seq !== requestSeq.current) return;
      setSearching(false);
      if (!res.ok) {
        setSearchError(res.error);
        return;
      }
      setResult(res.result);
    },
    [connection],
  );

  useEffect(() => {
    if (!open || view !== "search") return;
    const t = window.setTimeout(() => void runSearch(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query, open, view, runSearch]);

  function replaceCart(next: CartView | null | undefined) {
    if (!next) return;
    setCarts((prev) => {
      const others = prev.filter((c) => c.order.id !== next.order.id);
      return [...others, next];
    });
  }

  function addProduct(row: WholesalerSearchRow, qty: number) {
    if (!connection) return;
    setError(null);
    startTransition(async () => {
      const res = await addCatalogProductToCartAction({ jobId, connectionId: connection.id, productId: row.productId, qty });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      replaceCart(res.cart);
    });
  }

  function close() {
    onClose();
    router.refresh();
  }

  if (!connection) return null;

  const title =
    view === "cart"
      ? `Varukorg · ${connection.label}`
      : view === "review"
        ? "Granska beställningen"
        : view === "sent"
          ? "Beställningen är skickad"
          : view === "freetext"
            ? "Egen rad"
            : "Lägg till material";

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        view === "search" || view === "sent" ? (
          title
        ) : (
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="-ml-2 flex size-11 items-center justify-center rounded-lg text-muted hover:bg-ink/5 hover:text-ink"
              aria-label="Tillbaka"
              onClick={() => setView(view === "review" ? "cart" : "search")}
            >
              <ArrowLeft className="size-4.5" />
            </button>
            {title}
          </span>
        )
      }
      size="lg"
      footer={
        view === "search" ? (
          <div className="flex items-center justify-between gap-3">
            <button type="button" className={buttonClasses("ghost", "md")} onClick={onManual} data-wholesaler-manual>
              Lägg till manuellt
            </button>
            <button
              type="button"
              className={buttonClasses("primary", "md")}
              disabled={cartCount === 0 && otherCarts.length === 0}
              onClick={() => setView("cart")}
              data-wholesaler-cart-button
            >
              <ShoppingCart className="size-4" /> Visa varukorg ({cartCount})
            </button>
          </div>
        ) : view === "cart" ? (
          <div className="flex items-center justify-between gap-3">
            <button type="button" className={buttonClasses("ghost", "md")} onClick={() => setView("search")}>
              <Plus className="size-3.5" /> Fler artiklar
            </button>
            <button
              type="button"
              className={buttonClasses("primary")}
              disabled={!cart || cart.lines.length === 0 || pending}
              onClick={() => setView("review")}
              data-wholesaler-review-button
            >
              Granska beställning
            </button>
          </div>
        ) : null
      }
    >
      <div className="px-4 py-4 sm:px-6 sm:py-5">
        {view === "search" ? (
          <SearchView
            connections={connections}
            connection={connection}
            onConnectionChange={(id) => {
              setConnectionId(id);
              setResult(null);
              setQuery("");
              window.setTimeout(() => searchRef.current?.focus(), 30);
            }}
            query={query}
            onQueryChange={setQuery}
            onSubmit={() => void runSearch(query)}
            searchRef={searchRef}
            result={result}
            searching={searching}
            error={searchError ?? error}
            onAdd={addProduct}
            onPage={(p) => void runSearch(query, p)}
            onFreeText={() => setView("freetext")}
            pending={pending}
            cartsForOtherConnections={otherCarts}
            demo={context.demo}
          />
        ) : null}

        {view === "freetext" ? (
          <FreeTextForm
            jobId={jobId}
            connectionId={connection.id}
            onDone={(cartView) => {
              replaceCart(cartView);
              setView("cart");
            }}
          />
        ) : null}

        {view === "cart" && cart ? (
          <CartEditor
            cart={cart}
            connection={connection}
            otherCarts={otherCarts}
            onCartChange={replaceCart}
            onSwitchCart={(id) => setConnectionId(id)}
            onDiscarded={() => {
              setCarts((prev) => prev.filter((c) => c.order.id !== cart.order.id));
              setView("search");
            }}
          />
        ) : view === "cart" ? (
          <p className="text-[14px] text-soft">Varukorgen är tom. Sök artiklar och lägg till dem.</p>
        ) : null}

        {view === "review" && cart ? (
          <ReviewView
            cart={cart}
            demo={context.demo}
            onSent={(info) => {
              setSent(info);
              setView("sent");
            }}
          />
        ) : null}

        {view === "sent" && sent ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-[16px] font-semibold text-ink">
              <CheckCircle2 className="mt-0.5 size-5 text-ok" />
              {sent.simulated
                ? `Beställning ${sent.reference} simulerades`
                : `Beställning ${sent.reference} är skickad – inväntar bekräftelse`}
            </p>
            {sent.simulated ? (
              <p className="flex items-start gap-2 text-[14px] leading-relaxed text-soft">
                <DemoTag />
                <span>
                  Inget mejl lämnade Ferva. {sent.demoConfirmation ? "En demobekräftelse har landat i inboxen och stämts av mot beställningen." : ""}
                </span>
              </p>
            ) : (
              <p className="text-[14px] leading-relaxed text-soft">
                Grossisten svarar med orderbekräftelsen till din Ferva-inbox. Bekräftat material läggs på uppdraget när
                det stämts av – ordern är inte bekräftad bara för att mejlet skickats.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClasses("primary")} onClick={close}>
                Klar
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ---------------------------------- sök ------------------------------------- */

function SearchView({
  connections,
  connection,
  onConnectionChange,
  query,
  onQueryChange,
  onSubmit,
  searchRef,
  result,
  searching,
  error,
  onAdd,
  onPage,
  onFreeText,
  pending,
  cartsForOtherConnections,
  demo,
}: {
  connections: WholesalerPickerConnection[];
  connection: WholesalerPickerConnection;
  onConnectionChange: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  result: WholesalerSearchResult | null;
  searching: boolean;
  error: string | null;
  onAdd: (row: WholesalerSearchRow, qty: number) => void;
  onPage: (page: number) => void;
  onFreeText: () => void;
  pending: boolean;
  cartsForOtherConnections: CartView[];
  demo: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted" />
        <input
          ref={searchRef}
          className={cx(inputCls, "h-12 pl-11 text-[16px]")}
          placeholder="Sök artikel, E-nummer eller RSK-nummer"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          aria-label="Sök artikel, E-nummer eller RSK-nummer"
          aria-busy={searching}
          autoComplete="off"
          autoFocus
          data-wholesaler-search
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="text-muted">Grossist</span>
          {connections.length > 1 ? (
            <select
              className="min-h-11 rounded-xl border border-line-strong bg-card px-3 text-[14px] text-ink"
              value={connection.id}
              onChange={(e) => onConnectionChange(e.target.value)}
              aria-label="Välj grossist"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-medium text-ink">{connection.label}</span>
          )}
          {demo ? <DemoTag /> : null}
        </div>
        <span className={cx("text-muted", connection.stale && "text-warn font-medium")}>
          {connection.hasPriceList && connection.priceDate
            ? connection.stale
              ? `Priser från ${datumKort(connection.priceDate)} – prisfilen kan behöva uppdateras`
              : `Priser från ${datumKort(connection.priceDate)}`
            : "Ingen prislista ännu – ladda upp under Inställningar → Grossister"}
        </span>
      </div>

      {cartsForOtherConnections.length > 0 ? (
        <p className="rounded-xl bg-info-soft/60 px-3 py-2 text-[13px] text-info">
          Du har även en varukorg hos en annan grossist. Artiklar från olika grossister skickas som separata
          beställningar.
        </p>
      ) : null}

      {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}

      {!connection.hasPriceList ? (
        <div className="rounded-2xl border border-line/80 px-4 py-5 text-[14px] text-soft">
          <p>Utan prislista kan du inte söka artiklar, men du kan fortfarande lägga egna rader och beställa.</p>
          <button type="button" className={cx(buttonClasses("secondary", "md"), "mt-3")} onClick={onFreeText}>
            <Plus className="size-3.5" /> Egen rad utan artikelnummer
          </button>
        </div>
      ) : query.trim().length < 2 ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[14px] text-muted">
          Skriv minst två tecken för att söka bland {connection.label}s artiklar.
          <div className="mt-3">
            <button type="button" className={buttonClasses("ghost", "md")} onClick={onFreeText}>
              <Plus className="size-3.5" /> Egen rad utan artikelnummer
            </button>
          </div>
        </div>
      ) : result && result.rows.length === 0 && !searching ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[14px] text-muted">
          Inga artiklar matchade &ldquo;{query}&rdquo;.
          <div className="mt-3">
            <button type="button" className={buttonClasses("ghost", "md")} onClick={onFreeText}>
              <Plus className="size-3.5" /> Lägg till som egen rad
            </button>
          </div>
        </div>
      ) : result ? (
        <div>
          <ul className="divide-y divide-line/70 rounded-2xl border border-line/80" aria-label="Sökresultat" data-wholesaler-results>
            {result.rows.map((row) => (
              <ResultRow key={row.productId} row={row} onAdd={onAdd} pending={pending} />
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between text-[13px] text-muted">
            <span>
              {result.total.toLocaleString("sv-SE")} träffar
              {result.priceDate ? ` · priser från ${datumKort(result.priceDate)}` : ""}
            </span>
            {result.total > result.pageSize ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  className={buttonClasses("ghost", "md")}
                  disabled={result.page <= 1 || searching}
                  onClick={() => onPage(result.page - 1)}
                >
                  Föregående
                </button>
                <span>
                  Sida {result.page} av {Math.ceil(result.total / result.pageSize)}
                </span>
                <button
                  type="button"
                  className={buttonClasses("ghost", "md")}
                  disabled={result.page * result.pageSize >= result.total || searching}
                  onClick={() => onPage(result.page + 1)}
                >
                  Nästa
                </button>
              </span>
            ) : null}
          </div>
        </div>
      ) : searching ? (
        <p className="text-[14px] text-muted">Söker …</p>
      ) : null}
    </div>
  );
}

function ResultRow({
  row,
  onAdd,
  pending,
}: {
  row: WholesalerSearchRow;
  onAdd: (row: WholesalerSearchRow, qty: number) => void;
  pending: boolean;
}) {
  const [qty, setQty] = useState("1");
  const ids = [row.articleNumber ? `Art.nr ${row.articleNumber}` : "", row.eNumber ? `E-nr ${row.eNumber}` : "", row.rskNumber ? `RSK ${row.rskNumber}` : ""]
    .filter(Boolean)
    .join(" · ");
  const pack = row.packSize != null ? `${row.unit} · förp. ${row.packSize.toLocaleString("sv-SE")}` : row.unit;
  const n = Number(qty.replace(",", "."));
  const valid = Number.isFinite(n) && n > 0;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center" data-wholesaler-result>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink">{row.name}</p>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {ids}
          {ids ? " · " : ""}
          {pack}
        </p>
        <p className="mt-1 text-[13px] tabular text-soft">
          <span className="text-ink">{unitPriceLabel(row)}</span>
          {" · "}
          {row.customerPrice.ore != null ? (
            <span>Kundpris {formatOre(row.customerPrice.ore)}</span>
          ) : (
            <span className="text-muted">Kundpris saknas</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          className={cx(compactInputCls, "h-11 w-20 text-center")}
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          aria-label={`Antal ${row.unit} av ${row.name}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) {
              e.preventDefault();
              onAdd(row, n);
            }
          }}
        />
        <button
          type="button"
          className={buttonClasses("secondary", "md")}
          disabled={pending || !valid}
          onClick={() => onAdd(row, n)}
          aria-label={`Lägg ${row.name} i varukorgen`}
          data-wholesaler-add
        >
          <Plus className="size-4" /> Lägg i varukorg
        </button>
      </div>
    </li>
  );
}

/* -------------------------------- egen rad --------------------------------- */

function FreeTextForm({
  jobId,
  connectionId,
  onDone,
}: {
  jobId: string;
  connectionId: string;
  onDone: (cart: CartView) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [articleNumber, setArticleNumber] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("st");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await addFreeTextLineAction({
        jobId,
        connectionId,
        name,
        qty: Number(qty.replace(",", ".")),
        unit,
        articleNumber,
        note,
        customerUnitPriceKr: price.trim() === "" ? null : Number(price.replace(",", ".")),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone(res.cart);
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-[14px] text-soft">Beskriv artikeln så tydligt du kan – grossisten läser raden som du skriver den.</p>
      <label className="block">
        <span className={labelCls}>Beskrivning</span>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelCls}>Artikelnummer (om du vet)</span>
          <input className={inputCls} value={articleNumber} onChange={(e) => setArticleNumber(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Kundpris (kr, valfritt)</span>
          <input className={inputCls} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelCls}>Antal</span>
          <input className={inputCls} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Enhet</span>
          <input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className={labelCls}>Kommentar till grossisten</span>
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}
      <button type="submit" className={buttonClasses("primary")} disabled={pending || !name.trim()}>
        {pending ? "Lägger till …" : "Lägg i varukorg"}
      </button>
    </form>
  );
}

/* --------------------------------- varukorg -------------------------------- */

function CartEditor({
  cart,
  connection,
  otherCarts,
  onCartChange,
  onSwitchCart,
  onDiscarded,
}: {
  cart: CartView;
  connection: WholesalerPickerConnection;
  otherCarts: CartView[];
  onCartChange: (cart: CartView | null | undefined) => void;
  onSwitchCart: (connectionId: string) => void;
  onDiscarded: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const order = cart.order;

  function patchLine(lineId: string, patch: Parameters<typeof updateCartLineAction>[1]) {
    setError(null);
    startTransition(async () => {
      const res = await updateCartLineAction(lineId, patch);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCartChange(res.cart);
    });
  }
  function remove(lineId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeCartLineAction(lineId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCartChange(res.cart);
    });
  }
  function patchDetails(patch: Parameters<typeof updateCartDetailsAction>[1]) {
    setError(null);
    startTransition(async () => {
      const res = await updateCartDetailsAction(order.id, patch);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCartChange(res.cart);
    });
  }
  function discard() {
    startTransition(async () => {
      const res = await discardCartAction(order.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDiscarded();
    });
  }

  return (
    <div className="space-y-5">
      {otherCarts.length > 0 ? (
        <p className="rounded-xl bg-info-soft/60 px-3 py-2 text-[13px] text-info">
          Du har varukorgar hos flera grossister – de skickas som separata beställningar.{" "}
          {otherCarts.map((c) => (
            <button key={c.order.id} type="button" className="underline" onClick={() => onSwitchCart(c.order.connectionId)}>
              Visa den andra varukorgen ({c.lines.length})
            </button>
          ))}
        </p>
      ) : null}

      <ul className="divide-y divide-line/70 rounded-2xl border border-line/80" data-wholesaler-cart-lines>
        {cart.lines.map((line) => (
          <CartLineRow key={line.id} line={line} pending={pending} onPatch={(p) => patchLine(line.id, p)} onRemove={() => remove(line.id)} />
        ))}
      </ul>

      <Totals cart={cart} />

      <fieldset className="space-y-3 rounded-2xl border border-line/80 p-4">
        <legend className="px-1 text-[13px] font-medium text-muted">Leverans</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Hämtning eller leverans</span>
            <select
              className={inputCls}
              value={order.delivery.mode}
              disabled={pending}
              onChange={(e) => patchDetails({ delivery: { mode: e.target.value as "pickup" | "delivery" } })}
            >
              <option value="pickup">{DELIVERY_MODE_LABELS.pickup}</option>
              <option value="delivery">{DELIVERY_MODE_LABELS.delivery}</option>
            </select>
          </label>
          {order.delivery.mode === "pickup" ? (
            <DeferredInput
              label="Butik eller hämtningsplats"
              value={order.delivery.store ?? ""}
              onCommit={(v) => patchDetails({ delivery: { store: v } })}
              disabled={pending}
            />
          ) : (
            <DeferredInput
              label="Leveransadress"
              value={order.delivery.address ?? ""}
              onCommit={(v) => patchDetails({ delivery: { address: v } })}
              disabled={pending}
            />
          )}
        </div>
        <label className="block sm:max-w-xs">
          <span className={labelCls}>Önskat datum</span>
          <DateField value={order.delivery.requestedDate ?? ""} onChange={(v) => patchDetails({ delivery: { requestedDate: v } })} />
        </label>
      </fieldset>

      <fieldset className="space-y-3 rounded-2xl border border-line/80 p-4">
        <legend className="px-1 text-[13px] font-medium text-muted">Beställare</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <DeferredInput label="Namn" value={order.ordererName} onCommit={(v) => patchDetails({ ordererName: v })} disabled={pending} />
          <DeferredInput label="E-post" value={order.ordererEmail} onCommit={(v) => patchDetails({ ordererEmail: v })} disabled={pending} type="email" />
          <DeferredInput label="Telefon" value={order.ordererPhone} onCommit={(v) => patchDetails({ ordererPhone: v })} disabled={pending} type="tel" />
        </div>
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input
            type="checkbox"
            className="size-4"
            checked={order.ccSelf}
            disabled={pending}
            onChange={(e) => patchDetails({ ccSelf: e.target.checked })}
          />
          Skicka en kopia till min e-post
        </label>
        <DeferredInput
          label={`Meddelande till ${connection.label}`}
          value={order.message ?? ""}
          onCommit={(v) => patchDetails({ message: v })}
          disabled={pending}
          multiline
        />
      </fieldset>

      {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}
      <button type="button" className={buttonClasses("ghost", "md")} disabled={pending} onClick={discard}>
        <Trash2 className="size-3.5" /> Töm varukorgen
      </button>
    </div>
  );
}

function CartLineRow({
  line,
  pending,
  onPatch,
  onRemove,
}: {
  line: PurchaseOrderLine;
  pending: boolean;
  onPatch: (patch: { qty?: number; note?: string; customerUnitPriceKr?: number | null }) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(String(line.qty));
  const [price, setPrice] = useState(line.customerUnitPriceOre != null ? String(line.customerUnitPriceOre / 100) : "");
  const [note, setNote] = useState(line.note ?? "");
  // Serverns svar vinner över lokala fält (justera state under render, inte i effekt).
  const [seen, setSeen] = useState({ qty: line.qty, price: line.customerUnitPriceOre });
  if (seen.qty !== line.qty || seen.price !== line.customerUnitPriceOre) {
    setSeen({ qty: line.qty, price: line.customerUnitPriceOre });
    setQty(String(line.qty));
    setPrice(line.customerUnitPriceOre != null ? String(line.customerUnitPriceOre / 100) : "");
  }

  function commitQty() {
    const n = Number(qty.replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n !== line.qty) onPatch({ qty: n });
    else setQty(String(line.qty));
  }
  function step(delta: number) {
    const next = Math.max(0.001, Math.round((line.qty + delta) * 1000) / 1000);
    if (next !== line.qty) onPatch({ qty: next });
  }
  function commitPrice() {
    if (price.trim() === "") {
      if (line.customerPriceSource === "explicit") onPatch({ customerUnitPriceKr: null });
      return;
    }
    const kr = Number(price.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(kr) || kr < 0) return;
    if (Math.round(kr) * 100 !== line.customerUnitPriceOre || line.customerPriceSource !== "explicit") {
      onPatch({ customerUnitPriceKr: Math.round(kr) });
    }
  }

  return (
    <li className="space-y-2 px-4 py-3" data-wholesaler-cart-line>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">{line.name}</p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {line.articleNumber ? `Art.nr ${line.articleNumber}` : "Egen rad"}
            {line.unitCostOre != null ? ` · inköp ${formatOre(line.unitCostOre)}/${line.unit}` : " · inköpspris saknas"}
          </p>
        </div>
        <button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:text-danger" aria-label={`Ta bort ${line.name}`} onClick={onRemove} disabled={pending}>
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className={labelCls}>Antal ({line.unit})</span>
          <div className="flex items-center gap-1">
            <button type="button" className="flex size-11 items-center justify-center rounded-xl border border-line-strong text-ink" aria-label="Minska antal" onClick={() => step(-1)} disabled={pending}>
              <Minus className="size-4" />
            </button>
            <input
              className={cx(compactInputCls, "h-11 w-20 text-center")}
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onBlur={commitQty}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitQty())}
              aria-label={`Antal ${line.name}`}
              disabled={pending}
            />
            <button type="button" className="flex size-11 items-center justify-center rounded-xl border border-line-strong text-ink" aria-label="Öka antal" onClick={() => step(1)} disabled={pending}>
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        <label className="block">
          <span className={labelCls}>Kundpris (kr/{line.unit})</span>
          <input
            className={cx(compactInputCls, "h-11 w-28")}
            inputMode="numeric"
            value={price}
            placeholder="Saknas"
            onChange={(e) => setPrice(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitPrice())}
            disabled={pending}
          />
        </label>
        <p className="pb-2.5 text-[12px] text-muted">{CUSTOMER_PRICE_SOURCE_LABELS[line.customerPriceSource]}</p>
      </div>
      <input
        className={cx(inputCls, "py-2 text-[14px]")}
        placeholder="Kommentar på raden (valfritt)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note.trim() !== (line.note ?? "") && onPatch({ note })}
        aria-label={`Kommentar för ${line.name}`}
        disabled={pending}
      />
    </li>
  );
}

function DeferredInput({
  label,
  value,
  onCommit,
  disabled,
  type = "text",
  multiline,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  type?: string;
  multiline?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    setLocal(value);
  }
  const commit = () => {
    if (local.trim() !== value.trim()) onCommit(local);
  };
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {multiline ? (
        <textarea className={cx(inputCls, "min-h-20")} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={commit} disabled={disabled} />
      ) : (
        <input className={inputCls} type={type} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={commit} disabled={disabled} />
      )}
    </label>
  );
}

function Totals({ cart }: { cart: CartView }) {
  const t = cart.totals;
  return (
    <dl className="grid gap-x-4 gap-y-1 rounded-2xl bg-canvas px-4 py-3 text-[14px] tabular sm:grid-cols-2">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-muted">Förväntad inköpskostnad</dt>
        <dd className="font-medium text-ink">
          {t.expectedCostOre != null ? formatOre(t.expectedCostOre) : `Saknas på ${t.missingCostCount} rad${t.missingCostCount === 1 ? "" : "er"}`}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-muted">Kundpris totalt</dt>
        <dd className="font-medium text-ink">
          {t.customerTotalOre != null
            ? formatOre(t.customerTotalOre)
            : `Kundpris saknas på ${t.missingCustomerPriceCount} rad${t.missingCustomerPriceCount === 1 ? "" : "er"}`}
        </dd>
      </div>
      <p className="col-span-full text-[12px] text-muted">
        Priserna gäller den här beställningen. Uppdragets ekonomi kan påverkas av fler inköp.
      </p>
    </dl>
  );
}

/* ---------------------------------- granska -------------------------------- */

function ReviewView({
  cart,
  demo,
  onSent,
}: {
  cart: CartView;
  demo: boolean;
  onSent: (info: { reference: string; simulated: boolean; demoConfirmation: boolean }) => void;
}) {
  const [preview, setPreview] = useState<PurchaseOrderMailPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendKey = useMemo(() => newSendKey(), []);
  const sentRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void previewPurchaseOrderMailAction(cart.order.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setPreview(res.preview);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [cart.order.id]);

  async function send() {
    if (sentRef.current || sending) return;
    sentRef.current = true;
    setSending(true);
    setError(null);
    const res = await sendPurchaseOrderAction(cart.order.id, sendKey);
    setSending(false);
    if (!res.ok) {
      sentRef.current = false;
      setError(res.error);
      return;
    }
    onSent({ reference: res.reference, simulated: res.simulated, demoConfirmation: res.demoConfirmation });
  }

  const blockers = preview?.blockers ?? [];
  return (
    <div className="space-y-4">
      {preview ? (
        <>
          <dl className="grid gap-x-4 gap-y-1.5 text-[14px] sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Till</dt>
            <dd className="font-medium text-ink">{preview.to}</dd>
            {preview.cc ? (
              <>
                <dt className="text-muted">Kopia</dt>
                <dd className="text-ink">{preview.cc}</dd>
              </>
            ) : null}
            <dt className="text-muted">Svar hamnar i</dt>
            <dd className="text-ink">Din Ferva-inbox ({preview.replyTo})</dd>
            <dt className="text-muted">Ämne</dt>
            <dd className="text-ink">{preview.subject}</dd>
            <dt className="text-muted">Bilagor</dt>
            <dd className="text-ink">{preview.attachments.map((a) => a.filename).join(", ")}</dd>
          </dl>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl bg-canvas px-4 py-3 text-[13px] leading-relaxed text-ink" data-wholesaler-mail-preview>
            {preview.text}
          </pre>
        </>
      ) : error ? null : (
        <p className="text-[14px] text-muted">Förbereder beställningen …</p>
      )}
      <Totals cart={cart} />
      {blockers.length > 0 ? (
        <ul className="space-y-1 rounded-xl bg-warn-soft/40 px-4 py-3 text-[14px] text-warn">
          {blockers.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {b}
            </li>
          ))}
        </ul>
      ) : null}
      {demo ? (
        <p className="flex items-start gap-2 text-[13px] text-soft">
          <DemoTag />
          <span>Utskicket simuleras – inget mejl lämnar Ferva. En demobekräftelse kommer tillbaka i inboxen.</span>
        </p>
      ) : (
        <p className="text-[13px] text-soft">
          Det här skickar beställningen till grossisten. Ordern blir bekräftad först när grossistens svar kommit.
        </p>
      )}
      {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}
      <button
        type="button"
        className={buttonClasses("primary", "lg", "w-full sm:w-auto")}
        disabled={!preview || blockers.length > 0 || sending}
        onClick={send}
        data-wholesaler-send
      >
        {sending ? "Skickar …" : "Skicka beställning"}
      </button>
    </div>
  );
}
