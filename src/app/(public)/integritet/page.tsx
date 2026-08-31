import type { Metadata } from "next";
import { DocSection, MarketingDocument } from "../marketing";

export const metadata: Metadata = {
  title: "Integritetspolicy – Driva",
  description: "Så behandlar Driva personuppgifter.",
};

/**
 * Drivas egen integritetspolicy (tjänsten). Kundernas publika hemsidor har
 * sina egna policysidor under /integritetspolicy på respektive sajt.
 */
export default function PrivacyPage() {
  return (
    <MarketingDocument title="Integritetspolicy" updated="31 augusti 2026">
      <DocSection heading="Vilka uppgifter vi behandlar">
        <p>
          När du skapar ett konto behandlar vi din e-postadress, ditt telefonnummer och ditt
          lösenord (lagrat krypterat). När du använder tjänsten lagrar vi den företagsdata du
          själv lägger in – kunder, offerter, fakturor, kvitton och bokföringsunderlag.
        </p>
      </DocSection>
      <DocSection heading="Varför vi behandlar dem">
        <p>
          Uppgifterna används för att tillhandahålla tjänsten: inloggning, att skapa och skicka
          dina dokument, bokföring och support. Vi säljer aldrig personuppgifter och använder
          dem inte för tredjeparts­marknadsföring.
        </p>
      </DocSection>
      <DocSection heading="Hur länge de sparas">
        <p>
          Kontouppgifter sparas så länge kontot är aktivt. Raderar du kontot tas uppgifterna
          bort, med undantag för underlag som vi enligt lag måste bevara under en viss tid.
          Demosessioner utan konto raderas automatiskt inom ett dygn.
        </p>
      </DocSection>
      <DocSection heading="Vilka vi delar med">
        <p>
          Vi använder ett fåtal underleverantörer för drift, till exempel serverdrift,
          e-postutskick och BankID-signering. De behandlar uppgifter enbart på vårt uppdrag och
          enligt avtal. Uppgifter lämnas i övrigt bara ut när lagen kräver det.
        </p>
      </DocSection>
      <DocSection heading="Dina rättigheter">
        <p>
          Du har rätt att få tillgång till, rätta och radera dina personuppgifter, samt att
          invända mot eller begränsa behandlingen. Kontakta oss via supporten i tjänsten så
          hjälper vi dig. Du kan också lämna klagomål till Integritetsskyddsmyndigheten (IMY).
        </p>
      </DocSection>
      <DocSection heading="Personuppgiftsansvarig">
        <p>
          Driva är personuppgiftsansvarig för behandlingen som beskrivs här. För data som du
          lägger in om dina egna kunder är ditt företag ansvarigt och Driva
          personuppgiftsbiträde.
        </p>
      </DocSection>
    </MarketingDocument>
  );
}
