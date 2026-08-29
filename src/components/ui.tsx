import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { AppLink } from "./app-link";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------- Button ---------------------------------- */

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "bankid";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap rounded-xl transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-black shadow-sm",
  accent: "bg-accent text-white hover:bg-accent-deep shadow-sm",
  secondary: "bg-card text-ink border border-line-strong hover:bg-canvas hover:border-muted/60",
  ghost: "text-soft hover:bg-ink/5 hover:text-ink",
  danger: "bg-danger-soft text-danger hover:bg-danger hover:text-white",
  bankid: "bg-bankid text-white hover:brightness-110 shadow-sm",
};

/** Under lg växer knapparna något så träffytan blir ≥ ~44px på touch. Desktop oförändrad. */
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] max-lg:h-9",
  md: "h-10 px-4 text-sm max-lg:h-11",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cx(buttonBase, buttonVariants[variant], buttonSizes[size], extra);
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <AppLink href={href} className={buttonClasses(variant, size, className)}>
      {children}
    </AppLink>
  );
}

/* ---------------------------------- Badge ----------------------------------- */

export type BadgeTone = "ok" | "warn" | "danger" | "info" | "neutral" | "bankid" | "accent";

const badgeTones: Record<BadgeTone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-ink/6 text-soft",
  bankid: "bg-bankid-soft text-bankid",
  accent: "bg-accent-soft text-accent-deep",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function StatusDot({ tone }: { tone: BadgeTone }) {
  const colors: Record<BadgeTone, string> = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-info",
    neutral: "bg-muted",
    bankid: "bg-bankid",
    accent: "bg-accent",
  };
  return <span className={cx("inline-block size-1.5 rounded-full", colors[tone])} />;
}

/* ---------------------------------- Layout ----------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  crumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  crumbs?: { href?: string; label: string }[];
}) {
  return (
    <div className="mb-6">
      {back ? <div className="mb-2.5">{back}</div> : null}
      {crumbs && crumbs.length > 0 ? <Breadcrumbs items={crumbs} /> : null}
      <div className={cx("flex flex-wrap justify-between gap-4", back ? "items-start" : "items-end")}>
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-1 text-[15px] text-soft">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Brödsmulor" className="mb-2 flex flex-wrap items-center gap-1 text-[12px] text-muted">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-1">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {item.href && !last ? (
              <Link href={item.href as never} className="transition-colors hover:text-ink">
                {item.label}
              </Link>
            ) : (
              <span className={last ? "text-soft" : undefined}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("card", className)}>{children}</div>;
}

/* --------------------------------- EmptyState -------------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center px-8 py-14 text-center">
      {Icon ? (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft">
          <Icon className="size-6 text-accent" />
        </div>
      ) : null}
      <p className="text-[16px] font-semibold text-ink">{title}</p>
      {text ? <p className="mt-1 max-w-sm text-sm text-soft">{text}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ----------------------------------- Avatar ----------------------------------- */

const avatarPalette = [
  "bg-accent-soft text-accent-deep",
  "bg-info-soft text-info",
  "bg-warn-soft text-warn",
  "bg-bankid-soft text-bankid",
  "bg-danger-soft text-danger",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  const palette = avatarPalette[(name.charCodeAt(0) + name.length) % avatarPalette.length];
  const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg" };
  return (
    <div className={cx("flex shrink-0 items-center justify-center rounded-full font-semibold", palette, sizes[size])}>
      {initials}
    </div>
  );
}

/* ---------------------------------- Diverse ----------------------------------- */

export function DemoTag({ children = "Demo" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-warn/25 bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warn">
      {children}
    </span>
  );
}
