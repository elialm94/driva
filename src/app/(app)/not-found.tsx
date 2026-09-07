import { SearchX } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui";

/**
 * Fångar notFound() från alla sidor i (app) – t.ex. ett uppdrag, en faktura
 * eller en kund som tagits bort eller tillhör ett annat företag. Sidoskalet
 * ligger kvar så användaren aldrig hamnar utanför appen.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg pt-10">
      <EmptyState
        icon={SearchX}
        title="Sidan finns inte"
        text="Det du letar efter kan ha tagits bort, eller så är länken fel. Kolla adressen eller gå tillbaka till översikten."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink href="/">Till Hem</ButtonLink>
            <ButtonLink href="/uppdrag" variant="secondary">
              Uppdrag
            </ButtonLink>
            <ButtonLink href="/ekonomi" variant="secondary">
              Ekonomi
            </ButtonLink>
          </div>
        }
      />
    </div>
  );
}
