/**
 * Menyvalen för "Förbättra med AI" i rik text-editorn.
 *
 * Egen, klientsäker modul (ren data, inga beroenden): editorn behöver
 * etiketterna i klientbundeln, medan själva AI-anropet (lib/ai/improve-text)
 * är serverkod som drar in store/provider och aldrig får hamna hos klienten.
 */

/** Kort lista, max 8 enligt spec. Instruktionen går ordagrant in i prompten. */
export const RICHTEXT_AI_ACTIONS = [
  { id: "forbattra", label: "Förbättra text", instruction: "Förbättra språket: flyt, ton och struktur." },
  { id: "professionell", label: "Gör mer professionell", instruction: "Gör tonen mer professionell och förtroendeingivande." },
  { id: "tydligare", label: "Gör tydligare", instruction: "Gör texten tydligare och lättare att förstå för kunden." },
  { id: "kortare", label: "Gör kortare", instruction: "Korta texten. Behåll all sakinformation." },
  { id: "ratta", label: "Rätta språk", instruction: "Rätta stavning, grammatik och interpunktion. Ändra inget annat." },
  { id: "punktlista", label: "Gör till punktlista", instruction: "Strukturera om innehållet som punktlista, med korta rubriker om det hjälper läsbarheten." },
] as const;

export type RichTextAiActionId = (typeof RICHTEXT_AI_ACTIONS)[number]["id"];
