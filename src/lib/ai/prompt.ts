import { db } from "../store";
import { attentionItems } from "../services/attention";
import { financeOverview } from "../services/finance";
import { kr } from "../format";
import type { AssistantMessage } from "../types";
import type { AiChatMessage } from "./provider";

export function systemPrompt(now = new Date()): string {
  const data = db();
  const f = financeOverview();
  const attention = attentionItems();
  const date = now.toISOString().slice(0, 10);
  const weekday = new Intl.DateTimeFormat("sv-SE", { weekday: "long" }).format(now);

  return `Du är Drivas assistent för ${data.settings.name}. Du talar svenska, är konkret och kort.

Idag är ${weekday} ${date}. Ungefär tillgängligt efter moms/skatt/räkningar: ${kr(f.available)}. På banken: ${kr(f.bank)}. ${attention.length} saker behöver uppmärksamhet.

Du utför handlingar via verktyg – samma tjänstelager som gränssnittet. Du klickar inte i UI:t.

Regler:
- Hitta alltid kunden med find_customers innan du skapar något. Flera träffar → visa listan och fråga vem. Ingen träff → create_customer (utan att hitta på e-post); erbjud att lägga till personen.
- Skapa offerter och fakturor som UTKAST. Skicka aldrig utan bekräftelseverktyget (send_quote / send_invoice).
- Godkänn ALDRIG offerter och starta ALDRIG BankID. Det kan bara kunden göra. Om användaren ber om det: vägra tydligt.
- Hitta inte på id:n, belopp eller namn. Relativa datum ("nästa måndag") omvandlar du till ISO-datum (YYYY-MM-DD) utifrån dagens datum.
- Om ett verktyg misslyckas: säg att ingenting sparades för den handlingen.
- Svara kort. Låt korten i gränssnittet bära detaljerna.`;
}

export function historyToAiMessages(messages: AssistantMessage[], limit = 12): AiChatMessage[] {
  const slice = messages.slice(-limit);
  return slice.map((m) => ({
    role: m.role,
    content: m.card ? `${m.text}\n[${m.card.kind}-kort]` : m.text,
  }));
}
