import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Villkor",
  description: "Allmänna villkor för tjänsten Driva.",
};

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "1. Tjänsten",
    body: [
      "Driva är en webbtjänst för småföretagare som samlar offerter, kunder, uppdrag, fakturor och bokföringsunderlag på ett ställe. Tjänsten tillhandahålls i befintligt skick och utvecklas löpande.",
    ],
  },
  {
    title: "2. Konto och provperiod",
    body: [
      "För att använda Driva krävs ett konto med verifierad e-postadress. Nya konton får en kostnadsfri provperiod på 14 dagar utan krav på betalkort. Efter provperioden kostar tjänsten 199 kr per månad exklusive moms. Du kan säga upp när du vill; tjänsten är då tillgänglig till slutet av den betalda perioden.",
    ],
  },
  {
    title: "3. Ditt ansvar",
    body: [
      "Du ansvarar för att uppgifterna du registrerar är korrekta, att inloggningsuppgifter hanteras säkert och att tjänsten används i enlighet med gällande lag. Driva ersätter inte professionell rådgivning – du ansvarar själv för att bokföring, deklarationer och avtal blir korrekta.",
    ],
  },
  {
    title: "4. Data och äganderätt",
    body: [
      "Datat du lägger in i Driva är ditt. Du kan när som helst exportera dina uppgifter och begära att kontot med tillhörande data raderas. Hur personuppgifter behandlas beskrivs i integritetspolicyn.",
    ],
  },
  {
    title: "5. Tillgänglighet och ansvarsbegränsning",
    body: [
      "Vi strävar efter hög tillgänglighet men garanterar inte att tjänsten är fri från avbrott eller fel. Drivas sammanlagda ansvar är begränsat till vad du betalat för tjänsten under de senaste tolv månaderna. Driva ansvarar inte för indirekta skador, till exempel utebliven vinst.",
    ],
  },
  {
    title: "6. Ändringar",
    body: [
      "Vi kan uppdatera dessa villkor, till exempel när tjänsten förändras. Väsentliga ändringar meddelas i tjänsten eller via e-post i god tid innan de börjar gälla. Fortsatt användning efter att ändringarna trätt i kraft innebär att de accepterats.",
    ],
  },
  {
    title: "7. Kontakt",
    body: ["Frågor om villkoren besvaras via supporten i tjänsten."],
  },
];

export default function VillkorPage() {
  return (
    <article>
      <h1 className="text-3xl font-semibold tracking-tight">Allmänna villkor</h1>
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
