import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integritetspolicy",
  description: "Hur Driva behandlar personuppgifter.",
};

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "1. Vilka uppgifter vi behandlar",
    body: [
      "När du skapar ett konto behandlar vi din e-postadress, ditt telefonnummer och ditt lösenord (lagrat hashat). När du använder tjänsten behandlar vi de uppgifter du själv registrerar om ditt företag, dina kunder och din verksamhet – till exempel offerter, fakturor och kvitton.",
    ],
  },
  {
    title: "2. Varför vi behandlar dem",
    body: [
      "Uppgifterna behövs för att tillhandahålla tjänsten: inloggning, fakturering, bokföringsunderlag och kommunikation om kontot. Vi säljer aldrig personuppgifter och använder dem inte för tredjeparts marknadsföring.",
    ],
  },
  {
    title: "3. Var uppgifterna lagras",
    body: [
      "Datat lagras hos våra driftleverantörer inom EU/EES eller hos leverantörer som säkerställer motsvarande skyddsnivå. Varje företags data är logiskt åtskilt från andra företags.",
    ],
  },
  {
    title: "4. Hur länge",
    body: [
      "Uppgifterna sparas så länge du har ett konto. Raderar du kontot tas uppgifterna bort, med undantag för det som måste sparas enligt lag, till exempel bokföringsmaterial. Data i den publika demon är tillfällig och raderas automatiskt inom ett dygn.",
    ],
  },
  {
    title: "5. Dina rättigheter",
    body: [
      "Du har rätt att få tillgång till, rätta och radera dina personuppgifter samt att invända mot eller begränsa behandlingen. Du kan också klaga hos Integritetsskyddsmyndigheten (IMY) om du anser att behandlingen strider mot dataskyddsförordningen.",
    ],
  },
  {
    title: "6. Kontakt",
    body: ["Frågor om personuppgiftsbehandlingen besvaras via supporten i tjänsten."],
  },
];

export default function IntegritetPage() {
  return (
    <article>
      <h1 className="text-3xl font-semibold tracking-tight">Integritetspolicy</h1>
      <p className="mt-2 text-sm text-muted">Gäller från 1 september 2026.</p>
      <div className="mt-8 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-lg font-semibold">{s.title}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="mt-2 leading-relaxed text-soft">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
