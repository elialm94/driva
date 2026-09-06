/** Gemensam ram för onboardingens två steg: diskret "1 av 2", rubrik, ingress, kort. */
export function OnboardingShell({
  step,
  title,
  lead,
  eyebrow,
  children,
}: {
  step: 1 | 2;
  title: string;
  lead: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-canvas px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <span className="text-[15px] font-semibold tracking-tight text-ink">Ferva</span>
          <span className="text-[13px] text-muted" aria-label={`Steg ${step} av 2`}>
            {step} av 2
          </span>
        </div>
        <div className="mb-6">
          {eyebrow ? <p className="text-[13px] font-medium text-muted">{eyebrow}</p> : null}
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-soft">{lead}</p>
        </div>
        <div className="card p-5 sm:p-7">{children}</div>
      </div>
    </main>
  );
}
