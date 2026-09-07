"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Cable,
  CheckCircle2,
  ChevronRight,
  CircuitBoard,
  Droplets,
  Flame,
  HardHat,
  Heart,
  History,
  Lightbulb,
  Minus,
  Plug,
  Plus,
  ScanBarcode,
  Search,
  ShoppingCart,
  ShowerHead,
  SlidersHorizontal,
  Trash2,
  Waves,
  Wrench,
  X,
} from "lucide-react";
import type { PurchaseOrderLine } from "@/lib/types";
import type { WholesalerSearchResult, WholesalerSearchRow, WholesalerShopContext } from "@/lib/services/wholesalers";
import type { PurchaseOrderMailPreview } from "@/lib/services/purchase-orders";
import type { CartView, JobWholesalerContext, WholesalerPickerConnection } from "@/lib/wholesalers/views";
import type { CatalogCategory } from "@/lib/wholesalers/catalog-search";
import { normalizeIdentifier } from "@/lib/wholesalers/catalog-search";
import { formatOre } from "@/lib/wholesalers/money";
import { grossMargin } from "@/lib/wholesalers/pricing";
import { categoryHue, productIconKey, type ProductIconKey } from "@/lib/wholesalers/product-image";
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
  toggleWholesalerFavoriteAction,
  updateCartDetailsAction,
  updateCartLineAction,
  wholesalerShopContextAction,
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
/** Så många kategorichips visas innan "Fler kategorier". */
const CHIP_CATEGORY_LIMIT = 8;
/** Kort per sektion på butikens startsida. */
const FRONT_SECTION_LIMIT = 6;

type View = "search" | "cart" | "review" | "sent" | "freetext";

/** Vad butiken visar när sökfältet är tomt (och vad en sökning begränsas till). */
type ShopFilter = { kind: "all" } | { kind: "favorites" } | { kind: "recent" } | { kind: "category"; name: string };

function sameFilter(a: ShopFilter, b: ShopFilter): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "category" || b.kind !== "category" || a.name === b.name;
}

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

/** Nyckel för favoritjämförelse – samma normalisering som servern. */
function favKey(articleNumber: string): string {
  return normalizeIdentifier(articleNumber);
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
  const [filter, setFilter] = useState<ShopFilter>({ kind: "all" });
  const [result, setResult] = useState<WholesalerSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<{ reference: string; simulated: boolean; demoConfirmation: boolean } | null>(null);
  // Butikens startsida per grossist (kategorier, favoriter, tidigare beställt).
  const [shops, setShops] = useState<Record<string, WholesalerShopContext | null>>({});
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [scanning, setScanning] = useState(false);
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
      setScanning(false);
    }
  }

  useEffect(() => {
    if (!open || scanning) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open, scanning]);

  const connection = connections.find((c) => c.id === connectionId) ?? connections[0];
  const cart = carts.find((c) => c.order.connectionId === connection?.id && c.order.status === "draft");
  const cartCount = cart?.lines.length ?? 0;
  const otherCarts = carts.filter((c) => c.order.status === "draft" && c.order.connectionId !== connection?.id);
  const shop = connection ? shops[connection.id] : undefined;

  // Startsidan laddas en gång per grossist och öppning; favoriterna följer med.
  useEffect(() => {
    if (!open || !connection || !connection.hasPriceList || shops[connection.id] !== undefined) return;
    let cancelled = false;
    void wholesalerShopContextAction(connection.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setShops((prev) => ({ ...prev, [connection.id]: null }));
        return;
      }
      setShops((prev) => ({ ...prev, [connection.id]: res.shop }));
      setFavorites(new Set(res.shop.favoriteArticleNumbers.map(favKey)));
    });
    return () => {
      cancelled = true;
    };
  }, [open, connection, shops]);

  // Serversök: fråga ≥ 2 tecken (ev. inom en kategori) eller bläddra en kategori.
  const serverBacked = query.trim().length >= 2 || filter.kind === "category";
  const runSearch = useCallback(
    async (q: string, page = 1, f: ShopFilter = filter) => {
      if (!connection) return;
      const seq = ++requestSeq.current;
      const typed = q.trim().length >= 2;
      if (!typed && f.kind !== "category") {
        setResult(null);
        setSearching(false);
        return;
      }
      setSearching(true);
      setSearchError(null);
      const res = await searchWholesalerProductsAction({
        connectionId: connection.id,
        query: typed ? q : "",
        ...(f.kind === "category" ? { category: f.name } : {}),
        page,
      });
      if (seq !== requestSeq.current) return;
      setSearching(false);
      if (!res.ok) {
        setSearchError(res.error);
        return;
      }
      setResult(res.result);
    },
    [connection, filter],
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

  /** Ändra antal på en rad som redan ligger i varukorgen (0 = ta bort). */
  function setCartQty(line: PurchaseOrderLine, qty: number) {
    setError(null);
    startTransition(async () => {
      const res = qty <= 0 ? await removeCartLineAction(line.id) : await updateCartLineAction(line.id, { qty });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.cart) replaceCart(res.cart);
      else setCarts((prev) => prev.filter((c) => c.order.id !== line.orderId));
    });
  }

  function toggleFavorite(row: WholesalerSearchRow) {
    if (!connection) return;
    const key = favKey(row.articleNumber);
    const wasFavorite = favorites.has(key);
    // Optimistiskt: hjärtat svarar direkt, listan på startsidan följer med.
    setFavorites((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(key);
      else next.add(key);
      return next;
    });
    setShops((prev) => {
      const current = prev[connection.id];
      if (!current) return prev;
      const others = current.favorites.filter((r) => favKey(r.articleNumber) !== key);
      return {
        ...prev,
        [connection.id]: {
          ...current,
          favorites: wasFavorite ? others : [row, ...others],
          favoriteArticleNumbers: wasFavorite
            ? current.favoriteArticleNumbers.filter((n) => favKey(n) !== key)
            : [row.articleNumber, ...current.favoriteArticleNumbers.filter((n) => favKey(n) !== key)],
        },
      };
    });
    void toggleWholesalerFavoriteAction(connection.id, row.articleNumber).then((res) => {
      if (res.ok) return;
      setError(res.error);
      setFavorites((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(key);
        else next.delete(key);
        return next;
      });
    });
  }

  function changeFilter(next: ShopFilter) {
    setFilter((prev) => (sameFilter(prev, next) ? { kind: "all" } : next));
    setResult(null);
  }

  function onScanned(code: string) {
    setScanning(false);
    setFilter({ kind: "all" });
    setQuery(code);
    void runSearch(code, 1, { kind: "all" });
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
            : scanning
              ? "Skanna streckkod"
              : "Lägg till material";

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        view === "search" && scanning ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="-ml-2 flex size-11 items-center justify-center rounded-lg text-muted hover:bg-ink/5 hover:text-ink"
              aria-label="Tillbaka"
              onClick={() => setScanning(false)}
            >
              <ArrowLeft className="size-4.5" />
            </button>
            {title}
          </span>
        ) : view === "search" || view === "sent" ? (
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
      size={view === "search" ? "xl" : "lg"}
      footer={
        view === "search" && scanning ? null : view === "search" ? (
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
              {cart?.totals.customerTotalOre != null ? (
                <span className="hidden text-white/75 sm:inline">· {formatOre(cart.totals.customerTotalOre)}</span>
              ) : null}
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
        {view === "search" && scanning ? (
          <BarcodeScanner onDetected={onScanned} onCancel={() => setScanning(false)} />
        ) : view === "search" ? (
          <ShopView
            connections={connections}
            connection={connection}
            onConnectionChange={(id) => {
              setConnectionId(id);
              setResult(null);
              setQuery("");
              setFilter({ kind: "all" });
              window.setTimeout(() => searchRef.current?.focus(), 30);
            }}
            query={query}
            onQueryChange={setQuery}
            onSubmit={() => void runSearch(query)}
            searchRef={searchRef}
            filter={filter}
            onFilterChange={changeFilter}
            shop={shop}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            result={serverBacked ? result : null}
            searching={searching}
            error={searchError ?? error}
            cart={cart}
            onAdd={addProduct}
            onSetCartQty={setCartQty}
            onPage={(p) => void runSearch(query, p)}
            onFreeText={() => setView("freetext")}
            onScan={() => setScanning(true)}
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

/* --------------------------------- butiken --------------------------------- */

/** Streckkodsläsaren finns bara i vissa webbläsare (Chrome/Edge, Android). */
interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function barcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof w.BarcodeDetector === "function" && typeof navigator.mediaDevices?.getUserMedia === "function"
    ? w.BarcodeDetector
    : null;
}

function ShopView({
  connections,
  connection,
  onConnectionChange,
  query,
  onQueryChange,
  onSubmit,
  searchRef,
  filter,
  onFilterChange,
  shop,
  favorites,
  onToggleFavorite,
  result,
  searching,
  error,
  cart,
  onAdd,
  onSetCartQty,
  onPage,
  onFreeText,
  onScan,
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
  filter: ShopFilter;
  onFilterChange: (filter: ShopFilter) => void;
  shop: WholesalerShopContext | null | undefined;
  favorites: Set<string>;
  onToggleFavorite: (row: WholesalerSearchRow) => void;
  result: WholesalerSearchResult | null;
  searching: boolean;
  error: string | null;
  cart: CartView | undefined;
  onAdd: (row: WholesalerSearchRow, qty: number) => void;
  onSetCartQty: (line: PurchaseOrderLine, qty: number) => void;
  onPage: (page: number) => void;
  onFreeText: () => void;
  onScan: () => void;
  pending: boolean;
  cartsForOtherConnections: CartView[];
  demo: boolean;
}) {
  const [scanSupported] = useState(() => barcodeDetectorCtor() != null);
  const typed = query.trim().length >= 2;
  const cardProps = { favorites, onToggleFavorite, cart, onAdd, onSetCartQty, pending };

  const categories = shop?.categories ?? [];
  const recent = shop?.recent ?? [];
  const favoriteRows = shop?.favorites ?? [];

  let body: React.ReactNode;
  if (!connection.hasPriceList) {
    body = (
      <div className="rounded-2xl border border-line/80 px-4 py-5 text-[14px] text-soft">
        <p>Utan prislista kan du inte söka artiklar, men du kan fortfarande lägga egna rader och beställa.</p>
        <button type="button" className={cx(buttonClasses("secondary", "md"), "mt-3")} onClick={onFreeText}>
          <Plus className="size-3.5" /> Egen rad utan artikelnummer
        </button>
      </div>
    );
  } else if (typed || filter.kind === "category") {
    const scopeLabel = filter.kind === "category" ? filter.name : null;
    body = (
      <ResultGrid
        result={result}
        searching={searching}
        emptyText={
          typed
            ? `Inga artiklar matchade "${query.trim()}"${scopeLabel ? ` i ${scopeLabel}` : ""}.`
            : `Inga artiklar i ${scopeLabel ?? "kategorin"}.`
        }
        emptyAction={
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {scopeLabel ? (
              <button type="button" className={buttonClasses("secondary", "md")} onClick={() => onFilterChange({ kind: "all" })}>
                Sök i hela sortimentet
              </button>
            ) : null}
            <button type="button" className={buttonClasses("ghost", "md")} onClick={onFreeText}>
              <Plus className="size-3.5" /> Lägg till som egen rad
            </button>
          </div>
        }
        onPage={onPage}
        {...cardProps}
      />
    );
  } else if (filter.kind === "favorites") {
    body =
      favoriteRows.length === 0 ? (
        <EmptyShelf icon={Heart} text="Inga favoriter ännu. Tryck på hjärtat på en artikel så hamnar den här – praktiskt för sådant du beställer ofta." />
      ) : (
        <CardGrid rows={favoriteRows} {...cardProps} />
      );
  } else if (filter.kind === "recent") {
    body =
      recent.length === 0 ? (
        <EmptyShelf icon={History} text={`Inget beställt hos ${connection.label} ännu. När en beställning skickats hittar du artiklarna här.`} />
      ) : (
        <CardGrid rows={recent} {...cardProps} />
      );
  } else {
    body = (
      <ShopFront
        connection={connection}
        shop={shop}
        recent={recent}
        favoriteRows={favoriteRows}
        categories={categories}
        onFilterChange={onFilterChange}
        onFreeText={onFreeText}
        onScan={scanSupported ? onScan : undefined}
        {...cardProps}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted" />
          <input
            ref={searchRef}
            className={cx(inputCls, "h-12 pl-11 text-[16px]", query && "pr-11")}
            placeholder={filter.kind === "category" ? `Sök i ${filter.name}` : "Sök artikel, E-nummer, RSK eller EAN"}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
            aria-label="Sök artikel, E-nummer, RSK-nummer eller EAN"
            aria-busy={searching}
            autoComplete="off"
            enterKeyHint="search"
            autoFocus
            data-wholesaler-search
          />
          {query ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-ink/5 hover:text-ink"
              aria-label="Rensa sökningen"
              onClick={() => {
                onQueryChange("");
                searchRef.current?.focus();
              }}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {scanSupported && connection.hasPriceList ? (
          <button
            type="button"
            className={cx(buttonClasses("secondary", "md"), "h-12 shrink-0 px-3.5")}
            onClick={onScan}
            aria-label="Skanna streckkod"
            title="Skanna streckkod (EAN)"
          >
            <ScanBarcode className="size-5" />
            <span className="hidden sm:inline">Skanna</span>
          </button>
        ) : null}
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

      {connection.hasPriceList && (categories.length > 0 || favoriteRows.length > 0 || recent.length > 0 || filter.kind !== "all") ? (
        <FilterChips
          filter={filter}
          onFilterChange={onFilterChange}
          categories={categories}
          favoriteCount={favoriteRows.length}
          recentCount={recent.length}
        />
      ) : null}

      {cartsForOtherConnections.length > 0 ? (
        <p className="rounded-xl bg-info-soft/60 px-3 py-2 text-[13px] text-info">
          Du har även en varukorg hos en annan grossist. Artiklar från olika grossister skickas som separata
          beställningar.
        </p>
      ) : null}

      {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}

      {body}
    </div>
  );
}

function FilterChips({
  filter,
  onFilterChange,
  categories,
  favoriteCount,
  recentCount,
}: {
  filter: ShopFilter;
  onFilterChange: (filter: ShopFilter) => void;
  categories: CatalogCategory[];
  favoriteCount: number;
  recentCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeCategory = filter.kind === "category" ? filter.name : null;
  // Den aktiva kategorin syns alltid, även när listan är ihopfälld.
  const visible = expanded
    ? categories
    : categories.slice(0, CHIP_CATEGORY_LIMIT).concat(
        activeCategory && !categories.slice(0, CHIP_CATEGORY_LIMIT).some((c) => c.name === activeCategory)
          ? categories.filter((c) => c.name === activeCategory)
          : [],
      );
  const hidden = categories.length - Math.min(categories.length, CHIP_CATEGORY_LIMIT);

  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap" role="group" aria-label="Filtrera artiklar">
      <Chip active={filter.kind === "all"} onClick={() => onFilterChange({ kind: "all" })}>
        Alla
      </Chip>
      <Chip active={filter.kind === "favorites"} onClick={() => onFilterChange({ kind: "favorites" })} icon={Heart} count={favoriteCount}>
        Favoriter
      </Chip>
      <Chip active={filter.kind === "recent"} onClick={() => onFilterChange({ kind: "recent" })} icon={History} count={recentCount}>
        Beställt tidigare
      </Chip>
      {visible.map((c) => (
        <Chip key={c.name} active={activeCategory === c.name} onClick={() => onFilterChange({ kind: "category", name: c.name })} count={c.count}>
          {c.name}
        </Chip>
      ))}
      {hidden > 0 ? (
        <Chip active={false} onClick={() => setExpanded((v) => !v)} icon={SlidersHorizontal}>
          {expanded ? "Färre kategorier" : `${hidden} fler kategorier`}
        </Chip>
      ) : null}
    </div>
  );
}

function Chip({
  active,
  onClick,
  icon: Icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ComponentType<{ className?: string }>;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-colors",
        active
          ? "border-ink bg-ink text-white"
          : "border-line-strong bg-card text-ink hover:border-accent/60 hover:bg-accent-soft/40",
      )}
    >
      {Icon ? <Icon className={cx("size-3.5", active ? "text-white" : "text-muted")} /> : null}
      {children}
      {count != null && count > 0 ? (
        <span className={cx("tabular text-[12px]", active ? "text-white/70" : "text-muted")}>{count.toLocaleString("sv-SE")}</span>
      ) : null}
    </button>
  );
}

/** Startsidan när inget är skrivet: tidigare beställt, favoriter och kategorier. */
function ShopFront({
  connection,
  shop,
  recent,
  favoriteRows,
  categories,
  onFilterChange,
  onFreeText,
  onScan,
  ...cardProps
}: {
  connection: WholesalerPickerConnection;
  shop: WholesalerShopContext | null | undefined;
  recent: WholesalerSearchRow[];
  favoriteRows: WholesalerSearchRow[];
  categories: CatalogCategory[];
  onFilterChange: (filter: ShopFilter) => void;
  onFreeText: () => void;
  onScan?: () => void;
} & CardProps) {
  if (shop === undefined) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-56 animate-pulse rounded-2xl bg-canvas" />
        ))}
      </div>
    );
  }
  const nothingToShow = recent.length === 0 && favoriteRows.length === 0 && categories.length === 0;
  return (
    <div className="space-y-6">
      {recent.length > 0 ? (
        <ShelfSection
          icon={History}
          title="Beställt tidigare"
          onShowAll={recent.length > FRONT_SECTION_LIMIT ? () => onFilterChange({ kind: "recent" }) : undefined}
        >
          <CardGrid rows={recent.slice(0, FRONT_SECTION_LIMIT)} {...cardProps} />
        </ShelfSection>
      ) : null}
      {favoriteRows.length > 0 ? (
        <ShelfSection
          icon={Heart}
          title="Favoriter"
          onShowAll={favoriteRows.length > FRONT_SECTION_LIMIT ? () => onFilterChange({ kind: "favorites" }) : undefined}
        >
          <CardGrid rows={favoriteRows.slice(0, FRONT_SECTION_LIMIT)} {...cardProps} />
        </ShelfSection>
      ) : null}
      {categories.length > 0 ? (
        <ShelfSection icon={Box} title="Kategorier">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((c) => (
              <CategoryTile key={c.name} category={c} onClick={() => onFilterChange({ kind: "category", name: c.name })} />
            ))}
          </div>
        </ShelfSection>
      ) : null}
      {nothingToShow ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[14px] text-muted">
          <Search className="mx-auto mb-2 size-6 text-muted/70" />
          Sök bland {connection.label}s artiklar på benämning, E-nummer, RSK-nummer eller EAN.
          {onScan ? (
            <div className="mt-3">
              <button type="button" className={buttonClasses("secondary", "md")} onClick={onScan}>
                <ScanBarcode className="size-4" /> Skanna streckkod
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2 text-[13px] text-muted">
        Hittar du inte artikeln?
        <button type="button" className={buttonClasses("ghost", "md")} onClick={onFreeText}>
          <Plus className="size-3.5" /> Egen rad utan artikelnummer
        </button>
      </div>
    </div>
  );
}

function ShelfSection({
  icon: Icon,
  title,
  onShowAll,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  onShowAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
          <Icon className="size-3.5" /> {title}
        </h3>
        {onShowAll ? (
          <button type="button" className="flex items-center gap-0.5 text-[13px] font-medium text-accent hover:underline" onClick={onShowAll}>
            Visa alla <ChevronRight className="size-3.5" />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const CATEGORY_TILE_TONES = [
  "bg-accent-soft text-accent-deep",
  "bg-info-soft text-info",
  "bg-warn-soft text-warn",
  "bg-ok-soft text-ok",
  "bg-danger-soft/70 text-danger",
  "bg-canvas text-soft",
];

function CategoryTile({ category, onClick }: { category: CatalogCategory; onClick: () => void }) {
  const Icon = PRODUCT_ICONS[productIconKey({ category: category.name, name: "" })];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-line/80 bg-card px-3 py-2.5 text-left transition-colors hover:border-accent/60 hover:bg-accent-soft/30"
    >
      <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-xl", CATEGORY_TILE_TONES[categoryHue(category.name)])}>
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium text-ink">{category.name}</span>
        <span className="block text-[12px] tabular text-muted">
          {category.count.toLocaleString("sv-SE")} artik{category.count === 1 ? "el" : "lar"}
        </span>
      </span>
    </button>
  );
}

function EmptyShelf({ icon: Icon, text }: { icon: ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[14px] text-muted">
      <Icon className="mx-auto mb-2 size-6 text-muted/70" />
      {text}
    </div>
  );
}

interface CardProps {
  favorites: Set<string>;
  onToggleFavorite: (row: WholesalerSearchRow) => void;
  cart: CartView | undefined;
  onAdd: (row: WholesalerSearchRow, qty: number) => void;
  onSetCartQty: (line: PurchaseOrderLine, qty: number) => void;
  pending: boolean;
}

function CardGrid({ rows, cart, favorites, ...rest }: { rows: WholesalerSearchRow[] } & CardProps) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Artiklar" data-wholesaler-results>
      {rows.map((row) => (
        <ProductCard
          key={row.productId}
          row={row}
          favorite={favorites.has(favKey(row.articleNumber))}
          line={cart?.lines.find((l) => l.productId === row.productId)}
          {...rest}
        />
      ))}
    </ul>
  );
}

function ResultGrid({
  result,
  searching,
  emptyText,
  emptyAction,
  onPage,
  ...cardProps
}: {
  result: WholesalerSearchResult | null;
  searching: boolean;
  emptyText: string;
  emptyAction: React.ReactNode;
  onPage: (page: number) => void;
} & CardProps) {
  if (!result) {
    return searching ? (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-56 animate-pulse rounded-2xl bg-canvas" />
        ))}
      </div>
    ) : null;
  }
  if (result.rows.length === 0 && !searching) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[14px] text-muted">
        {emptyText}
        {emptyAction}
      </div>
    );
  }
  const pages = Math.ceil(result.total / result.pageSize);
  return (
    <div className={cx(searching && "opacity-60 transition-opacity")}>
      <CardGrid rows={result.rows} {...cardProps} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
        <span>
          {result.total.toLocaleString("sv-SE")} träff{result.total === 1 ? "" : "ar"}
          {result.priceDate ? ` · priser från ${datumKort(result.priceDate)}` : ""}
        </span>
        {pages > 1 ? (
          <span className="flex items-center gap-2">
            <button type="button" className={buttonClasses("ghost", "md")} disabled={result.page <= 1 || searching} onClick={() => onPage(result.page - 1)}>
              Föregående
            </button>
            <span>
              Sida {result.page} av {pages}
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
  );
}

const PRODUCT_ICONS: Record<ProductIconKey, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  cable: Cable,
  plug: Plug,
  switch: SlidersHorizontal,
  breaker: CircuitBoard,
  light: Lightbulb,
  conduit: Waves,
  pipe: Wrench,
  valve: Droplets,
  tap: ShowerHead,
  drain: Waves,
  heat: Flame,
  fasteners: Wrench,
  tools: Wrench,
  safety: HardHat,
  box: Box,
};

function ProductImage({ row }: { row: WholesalerSearchRow }) {
  const [broken, setBroken] = useState(false);
  const Icon = PRODUCT_ICONS[productIconKey(row)];
  if (row.imageUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- extern bild ur grossistens prisfil, ingen optimering
      <img
        src={row.imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="size-full object-contain p-2"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className={cx("flex size-full items-center justify-center", CATEGORY_TILE_TONES[categoryHue(row.category ?? row.name)])}>
      <Icon className="size-9 opacity-80" strokeWidth={1.5} />
    </span>
  );
}

function MarginBadge({ row }: { row: WholesalerSearchRow }) {
  const margin = grossMargin(row.netPriceOre, row.customerPrice.ore);
  if (!margin) return null;
  const tone = margin.ore < 0 ? "bg-danger-soft text-danger" : margin.percent < 10 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok";
  return (
    <span
      className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular", tone)}
      title={`Marginal ${formatOre(margin.ore)} per ${row.unit} (kundpris − inköpspris)`}
    >
      {margin.ore < 0 ? "Förlust " : ""}
      {margin.percent} %
    </span>
  );
}

const stepBtnCls =
  "flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong text-ink transition-colors hover:bg-ink/5 disabled:opacity-40";

function ProductCard({
  row,
  favorite,
  line,
  onToggleFavorite,
  onAdd,
  onSetCartQty,
  pending,
}: {
  row: WholesalerSearchRow;
  favorite: boolean;
  line: PurchaseOrderLine | undefined;
  onToggleFavorite: (row: WholesalerSearchRow) => void;
  onAdd: (row: WholesalerSearchRow, qty: number) => void;
  onSetCartQty: (line: PurchaseOrderLine, qty: number) => void;
  pending: boolean;
}) {
  const [qty, setQty] = useState("1");
  const ids = [row.eNumber ? `E ${row.eNumber}` : "", row.rskNumber ? `RSK ${row.rskNumber}` : "", `Art.nr ${row.articleNumber}`]
    .filter(Boolean)
    .join(" · ");
  const n = Number(qty.replace(",", "."));
  const valid = Number.isFinite(n) && n > 0;
  const inCart = line != null;

  function stepCart(delta: number) {
    if (!line) return;
    const next = Math.max(0, Math.round((line.qty + delta) * 1000) / 1000);
    onSetCartQty(line, next);
  }

  return (
    <li
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-shadow hover:shadow-sm",
        inCart ? "border-accent/50 ring-1 ring-accent/30" : "border-line/80",
      )}
      data-wholesaler-result
      data-in-cart={inCart || undefined}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-canvas">
        <ProductImage row={row} />
        <button
          type="button"
          onClick={() => onToggleFavorite(row)}
          aria-pressed={favorite}
          aria-label={favorite ? `Ta bort ${row.name} från favoriter` : `Spara ${row.name} som favorit`}
          className={cx(
            "absolute right-1.5 top-1.5 flex size-9 items-center justify-center rounded-full bg-card/90 shadow-sm backdrop-blur transition-colors",
            favorite ? "text-danger" : "text-muted hover:text-ink",
          )}
        >
          <Heart className="size-4" fill={favorite ? "currentColor" : "none"} />
        </button>
        {inCart ? (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white tabular">
            {line.qty.toLocaleString("sv-SE")} {row.unit} i korgen
          </span>
        ) : null}
        {row.packSize != null && row.packSize > 1 ? (
          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-card/90 px-1.5 py-0.5 text-[11px] text-soft tabular backdrop-blur">
            Förp. {row.packSize.toLocaleString("sv-SE")}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 px-3 pt-2.5">
        {row.brand ? <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{row.brand}</p> : null}
        <p className="line-clamp-2 text-[14px] font-medium leading-snug text-ink" title={row.name}>
          {row.name}
        </p>
        <p className="truncate text-[11.5px] text-muted" title={ids}>
          {ids}
        </p>
        <div className="mt-auto pt-1.5">
          <p className="flex items-baseline justify-between gap-2 text-[13px] tabular">
            <span className="text-soft">
              Inköp <span className="font-medium text-ink">{unitPriceLabel(row)}</span>
            </span>
          </p>
          <p className="flex items-center justify-between gap-2 text-[13px] tabular">
            {row.customerPrice.ore != null ? (
              <span className="text-soft">
                Kund <span className="font-semibold text-ink">{formatOre(row.customerPrice.ore)}</span>
              </span>
            ) : (
              <span className="text-muted">Kundpris saknas</span>
            )}
            <MarginBadge row={row} />
          </p>
        </div>
      </div>

      <div className="mt-2.5 border-t border-line/70 px-2.5 py-2">
        {inCart ? (
          <div className="flex items-center justify-between gap-1">
            <button type="button" className={stepBtnCls} aria-label={`Minska antal ${row.name}`} onClick={() => stepCart(-1)} disabled={pending}>
              {line.qty <= 1 ? <Trash2 className="size-4" /> : <Minus className="size-4" />}
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] font-medium tabular text-ink">
              {line.qty.toLocaleString("sv-SE")} {row.unit}
            </span>
            <button type="button" className={stepBtnCls} aria-label={`Öka antal ${row.name}`} onClick={() => stepCart(1)} disabled={pending} data-wholesaler-add>
              <Plus className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={stepBtnCls}
              aria-label={`Minska antal ${row.unit}`}
              disabled={pending || !valid || n <= 1}
              onClick={() => setQty(String(Math.max(1, Math.round(n) - 1)))}
            >
              <Minus className="size-4" />
            </button>
            <input
              className={cx(compactInputCls, "h-9 min-w-0 flex-1 px-1 text-center text-[14px]")}
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
              className={stepBtnCls}
              aria-label={`Öka antal ${row.unit}`}
              disabled={pending || !valid}
              onClick={() => setQty(String(Math.round(n) + 1))}
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              className={cx(buttonClasses("primary", "md"), "h-9 shrink-0 px-3")}
              disabled={pending || !valid}
              onClick={() => onAdd(row, n)}
              aria-label={`Lägg ${row.name} i varukorgen`}
              data-wholesaler-add
            >
              <ShoppingCart className="size-4" />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/* ------------------------------ streckkodsläsare --------------------------- */

const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

function BarcodeScanner({ onDetected, onCancel }: { onDetected: (code: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const Ctor = barcodeDetectorCtor();
    const video = videoRef.current;
    if (!Ctor || !video) {
      setError("Skanning stöds inte i den här webbläsaren. Skriv EAN-koden i sökfältet i stället.");
      return;
    }
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    const detector = new Ctor({ formats: SCAN_FORMATS });

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        await video.play().catch(() => undefined);
        const tick = async () => {
          if (cancelled || done.current) return;
          try {
            if (video.readyState >= 2) {
              const codes = await detector.detect(video);
              const hit = codes.find((c) => c.rawValue && c.rawValue.trim().length >= 6);
              if (hit && !done.current) {
                done.current = true;
                setLast(hit.rawValue);
                if (typeof navigator.vibrate === "function") navigator.vibrate(60);
                window.setTimeout(() => onDetected(hit.rawValue.trim()), 250);
                return;
              }
            }
          } catch {
            // En misslyckad bildruta är inget fel – nästa kommer om 200 ms.
          }
          timer = window.setTimeout(() => void tick(), 200);
        };
        void tick();
      })
      .catch(() => {
        if (!cancelled) setError("Kameran kunde inte startas. Tillåt kameran i webbläsaren eller skriv EAN-koden i sökfältet.");
      });

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [onDetected]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl bg-ink">
        <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted autoPlay aria-label="Kamerabild" />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        {last ? (
          <p className="absolute inset-x-0 bottom-0 bg-ok px-3 py-2 text-center text-[14px] font-medium text-white">
            <CheckCircle2 className="mr-1 inline size-4" /> {last}
          </p>
        ) : null}
      </div>
      {error ? (
        <p className="text-[14px] font-medium text-danger">{error}</p>
      ) : (
        <p className="text-[13px] text-soft">Rikta kameran mot streckkoden på förpackningen. Artikeln söks fram så fort koden läses.</p>
      )}
      <button type="button" className={buttonClasses("secondary", "md")} onClick={onCancel}>
        Avbryt
      </button>
    </div>
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
