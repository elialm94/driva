import type { Metadata } from "next";
import { DocSection, MarketingDocument } from "../marketing";

export const metadata: Metadata = {
  title: "Villkor – Driva",
  description: "Allmänna villkor för tjänsten Driva.",
};

/** Drivas egna användarvillkor – inte att förväxla med kundsajternas sidor. */
export default function TermsPage() {
  return (
    <MarketingDocument title="Allmänna villkor" updated="31 augusti 2026">
      <DocSection heading="1. Tjänsten">
        <p>
          Driva är en webbtjänst för småföretagare som samlar offerter, kunder, uppdrag,
          fakturor och bokföring på ett ställe. Tjänsten tillhandahålls i befintligt skick och
          utvecklas löpande.
        </p>
      </DocSection>
      <DocSection heading="2. Provperiod och pris">
        <p>
          Nya konton får en kostnadsfri provperiod på 14 dagar. Inget betalkort krävs under
          provperioden. Därefter kostar tjänsten 199 kr per månad exklusive moms. Du kan säga
          upp när du vill; tjänsten löper då ut vid slutet av den betalda perioden.
        </p>
      </DocSection>
      <DocSection heading="3. Ditt ansvar">
        <p>
          Du ansvarar för att uppgifterna du registrerar är korrekta och för att bevara dina
          inloggningsuppgifter säkert. Underlag som skapas i Driva (offerter, fakturor och
          bokföring) är ditt företags handlingar – du ansvarar för att de uppfyller de krav som
          gäller för din verksamhet, till exempel bokförings- och skattelagstiftning.
        </p>
      </DocSection>
      <DocSection heading="4. Dina data">
        <p>
          Företagsdatan du lägger in i Driva är din. Vi använder den bara för att tillhandahålla
          tjänsten och lämnar aldrig ut den till tredje part för marknadsföring. Du kan när som
          helst begära export eller radering av ditt konto. Hur personuppgifter behandlas
          beskrivs i vår <a href="/integritet" className="font-medium text-ink underline">integritetspolicy</a>.
        </p>
      </DocSection>
      <DocSection heading="5. Drift och tillgänglighet">
        <p>
          Vi strävar efter hög tillgänglighet men garanterar inte att tjänsten är fri från
          avbrott. Planerat underhåll aviseras när det är möjligt. Driva ansvarar inte för
          indirekta skador, till exempel utebliven vinst, som orsakas av avbrott i tjänsten.
        </p>
      </DocSection>
      <DocSection heading="6. Ändringar">
        <p>
          Vi kan uppdatera villkoren, till exempel när tjänsten får ny funktionalitet.
          Väsentliga ändringar meddelas i tjänsten eller via e-post innan de börjar gälla.
          Fortsatt användning efter att ändringarna trätt i kraft innebär att du accepterar dem.
        </p>
      </DocSection>
      <DocSection heading="7. Kontakt">
        <p>
          Frågor om villkoren? Hör av dig via supporten i tjänsten så hjälper vi dig.
        </p>
      </DocSection>
    </MarketingDocument>
  );
}
