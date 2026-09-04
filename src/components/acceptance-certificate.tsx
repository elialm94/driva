import {
  CERTIFICATE_TITLE,
  SIMPLE_SIGNATURE_DISCLAIMER,
  type AcceptanceCertificateModel,
} from "@/lib/quote-acceptance-certificate";

/**
 * Intyg om godkännande – samma fakta på webben och i A4-utskriften.
 * Webben döljer hashar bakom Teknisk kontroll. PDF lägger dem i sidfoten.
 */
export function AcceptanceCertificate({
  cert,
  variant,
}: {
  cert: AcceptanceCertificateModel;
  variant: "web" | "pdf";
}) {
  const facts = (
    <dl data-acceptance-certificate-facts="" className={variant === "pdf" ? "mt-6" : "mt-7"}>
      {cert.facts.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[9.5rem_1fr] gap-x-5 border-t border-line/80 py-2.5 first:border-t-0"
        >
          <dt className="text-[13px] text-muted">{row.label}</dt>
          <dd className="text-[14px] text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );

  const statement = cert.statement ? (
    <section className={variant === "pdf" ? "mt-7" : "mt-8"}>
      <h2 className="text-[13px] font-semibold text-ink">Det kunden såg</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink">{cert.statement}</p>
    </section>
  ) : null;

  const status = (
    <p
      data-acceptance-certificate-status=""
      className={`mt-7 text-[14px] leading-relaxed ${cert.intact ? "text-ink" : "text-danger"}`}
    >
      {cert.statusText}
    </p>
  );

  const disclaimer = (
    <p className="mt-6 text-[13px] leading-relaxed text-muted">{SIMPLE_SIGNATURE_DISCLAIMER}</p>
  );

  if (variant === "pdf") {
    return (
      <article
        data-acceptance-certificate=""
        data-acceptance-certificate-pdf=""
        className="bg-white px-2 py-1 text-ink print:px-0 print:py-0"
      >
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">Intyg</p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight">{CERTIFICATE_TITLE}</h1>
        <p className="mt-5 text-[14px] leading-relaxed text-ink">{cert.summary}</p>
        {facts}
        {statement}
        {status}
        {disclaimer}
        <footer className="mt-10 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
          <p className="font-medium text-soft">Teknisk kontroll</p>
          <p className="mt-1">
            {cert.versionLabel}. {cert.methodText} SHA-256 vid godkännandet: {cert.storedHash}. Hash nu:{" "}
            {cert.currentHash}.
            {cert.linkSentTo ? ` Offertlänken skickades till ${cert.linkSentTo}.` : ""}
            {cert.ip || cert.device
              ? ` Varifrån: ${[cert.ip, cert.device].filter(Boolean).join(" · ")}.`
              : ""}
          </p>
        </footer>
      </article>
    );
  }

  return (
    <article data-acceptance-certificate="" className="text-ink">
      <h1 className="text-[24px] font-semibold tracking-tight">{CERTIFICATE_TITLE}</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink">{cert.summary}</p>
      {facts}
      {statement}
      {status}
      <details data-acceptance-teknisk-kontroll="" className="mt-8 border-t border-line pt-4">
        <summary className="cursor-pointer text-[14px] font-medium text-ink">Teknisk kontroll</summary>
        <dl className="mt-3 space-y-2 text-[13px]">
          <div>
            <dt className="text-muted">Offertversion</dt>
            <dd className="text-ink">{cert.versionLabel}</dd>
          </div>
          <div>
            <dt className="text-muted">SHA-256 vid godkännandet</dt>
            <dd className="break-all font-mono text-[12px] text-soft">{cert.storedHash}</dd>
          </div>
          <div>
            <dt className="text-muted">Hash vid kontroll nu</dt>
            <dd className="break-all font-mono text-[12px] text-soft">{cert.currentHash}</dd>
          </div>
          <div>
            <dt className="text-muted">Sätt</dt>
            <dd className="text-ink">{cert.methodText}</dd>
          </div>
          {cert.linkSentTo ? (
            <div>
              <dt className="text-muted">Offertlänken skickades till</dt>
              <dd className="text-ink">{cert.linkSentTo}</dd>
            </div>
          ) : null}
          {cert.ip || cert.device ? (
            <div>
              <dt className="text-muted">Varifrån</dt>
              <dd className="text-ink">{[cert.ip, cert.device].filter(Boolean).join(" · ")}</dd>
            </div>
          ) : null}
        </dl>
      </details>
      {disclaimer}
      {cert.legacyDemo ? (
        <p className="mt-3 text-[13px] text-warn">
          Detta är en äldre demo-signering – ingen legitimering har skett och inga personuppgifter har hämtats.
        </p>
      ) : null}
    </article>
  );
}
