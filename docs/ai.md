# AI i Driva – deterministiskt först, LLM sedan

Kommandofältet på Hem och `/assistent` är ingen chatbot. Vanliga uppgifter körs
helt utan LLM; fri text som reglerna inte klarar går – om en nyckel finns – till
OpenRouter med verktygsanrop mot samma register som allt annat.

## Arkitektur

```
Användare
   │
   ▼
Kommandofältet (components/command-bar.tsx)
   │
   ├─ Deterministisk tolkning (lib/command-bar.ts – ren klient, noll nätverk)
   │     hög träff  → kommandoflöde (steg, entitetssök, bekräftelsekort)
   │     låg träff  → "Menade du?" + förslag
   │     ingen träff, ingen nyckel → ärlig fallback (inget nätverksanrop)
   │
   └─ ingen träff + nyckel → interpretFreeTextAction (server action, withBusiness)
         │
         ▼
      AiIntentProvider (lib/ai/intent.ts)
         Noop ("not_configured") | OpenRouter (verktygsloop)
         │
         ▼
      Verktygsloop (lib/ai/loop.ts)  ⇄  OpenRouter chat/completions (lib/ai/provider.ts)
         │  modellen väljer verktyg → validering → executeTool(origin: "ai")
         ▼
      Verktygsregistret (lib/ai/tools.ts) → domäntjänster (lib/services/*, lib/ai/domain.ts)
         │
         ▼
      Persistens (lib/store.ts → JSON i dev / Supabase med RLS i produktion)
```

Resultatet (text + ev. kort med djuplänk eller bekräftelsekort) visas i samma
resultatpanel som deterministiska kommandon. Ingen chatt-historik.

## Miljövariabler (alla valfria – utan nyckel är appen fullt fungerande)

| Variabel | Standard | Beskrivning |
| --- | --- | --- |
| `AI_PROVIDER` | `openai-compatible` | `openrouter` aktiverar verktygsloopen. `none/off/rules` stänger av. |
| `OPENROUTER_API_KEY` | – | Endast serversidan. Loggas aldrig, aldrig `NEXT_PUBLIC`. |
| `AI_MODEL_FAST` | `google/gemini-3.7-flash` | Intent/verktygsorkestrering (standardvägen). |
| `AI_MODEL_SMART` | `openai/gpt-5.6-terra` | Långa/fleragsfrågor (enkel heuristik: >220 tecken eller ≥4 turer). |
| `AI_MAX_TOOL_STEPS` | `6` | Stegtak per fråga; överskridet ⇒ ärlig delstatus. |
| `AI_MAX_OUTPUT_TOKENS` | `700` | Svarstak per anrop. |
| `AI_MODEL`/`AI_API_KEY`/`AI_BASE_URL` | – | Äldre generisk OpenAI-kompatibel väg (ett-stegs-tolkning). |

Modellvalen (aug 2026): Gemini 3.7 Flash är billigast i sin kapacitetsklass på
OpenRouter ($0,375/$1,875 per M tokens) med strikt function calling och högst
verktygstillförlitlighet i OpenRouters egna mätningar; GPT-5.6 Terra ($2/$12)
tar de fåtal frågor som behöver djupare resonemang. En enda konfigurerad
modell används alltid.

## Riskklasser (deklarerade OCH serversidigt upprätthållna)

| Klass | Betydelse | Exempel |
| --- | --- | --- |
| `READ_ONLY` | Läser, ändrar inget | `list_unpaid_invoices`, `business_stats` |
| `SAFE_WRITE` | Skapar utkast/ofarligt – skickar aldrig | `create_invoice`, `create_quote`, `create_job_invoice` |
| `CONFIRM_REQUIRED` | Handlern skapar ENDAST bekräftelsekort; åtgärden körs bara via användarens uttryckliga bekräftelse | `send_invoice`, `send_reminders`, `purchase_domain`, `markera_moms_deklarerad` |
| `FORBIDDEN_FOR_AI` | Aldrig anropbart av en modell: exponeras inte i modellens verktygslista och blockeras dessutom i `executeTool` för `origin: "ai"` | `answer_expense_question` (bokför direkt) |

Rå bokföringsmutation, manuell fakturanumrering, radering av bokförda poster,
SQL och auth-/adminoperationer finns inte som verktyg alls – modellen kan inte
anropa det som inte exponeras.

## Påminnelser (persisterade, ur naturligt språk)

"Påminn mig att ringa Göran på onsdag" och "Skapa en påminnelse att ringa
Göran kl 12 nästa onsdag" skapar en riktig `Reminder`-rad som dyker upp
under Hem → "Behöver din uppmärksamhet" när den förfaller.

**Hela originalfrasen parsas först.** Autocomplete "Skapa påminnelse" är
bara intent – resten slängs aldrig och startar inte en tom guide.
`parseCommand` (kommandofältet) + `parseReminderCommandInput` extraherar
`{ intent, title, when }` ur hela meningen. Bara faktiskt saknade fält
efterfrågas. Complett + hög konfidens → `create_reminder` direkt
(`SAFE_WRITE`, reversibelt) med succé + Ångra (`dismiss_reminder`).

Arbetsdelningen är strikt: LLM:n (eller den deterministiska snabbvägen i
`src/lib/reminders/parse.ts`) extraherar ett STRUKTURERAT tidsuttryck –
`src/lib/reminders/when.ts` äger ALL tolkningspolicy och är enhetstestad utan
LLM:

| Uttryck | Policy |
| --- | --- |
| Veckodag ("på onsdag") | Framför oss i veckan → denna vecka; idag/passerad → nästa vecka |
| "nästa onsdag" | Hoppa till nästa vecka **bara om dagen fortfarande är framför oss i denna**. Söndag 30 aug 2026 + nästa onsdag kl 12 → onsdag 2 september kl. 12:00 (CEST). Måndag 24 aug + nästa onsdag → 2 september (hoppar över 26 aug). |
| Ingen tid | 10:00 lokal tid (`DEFAULT_REMINDER_TIME`), dagsnivå (syns från dagsstart) – tiden visas alltid tillbaka |
| Dagsdel | morgon 09:00 · förmiddag 10:00 · eftermiddag 14:00 · kväll 18:00 (`DAYPART_TIMES`) |
| "om 2 timmar" / "om 30 minuter" | Exakt nu + N |
| "i övermorgon" | +2 lokala dagar |
| Tidszon | `businessTimezone()` (Europe/Stockholm som standard), lagras per påminnelse |

Verktyg: `create_reminder`/`update_reminder`/`complete_reminder`/
`snooze_reminder`/`dismiss_reminder` är `SAFE_WRITE` (dismiss = mjuk
borttagning, historiken kvar; one-shot Ångra använder dismiss),
`list_reminders` är `READ_ONLY`.
Entitetskoppling: exakt en kund-/offert-/fakturaträff länkas, flera →
klargörande fråga (inget skapas), noll → ren textpåminnelse – aldrig
gissningar. Deterministisk först (även "skapa en påminnelse …");
OpenRouter bara om parsern inte räcker – samma `create_reminder`-schema.

## Bekräftelsepolicy

Naturligt språk skapar UTKAST. Skicka faktura/offert, påminnelser, kreditering,
bokföringsåtgärder, momsmarkering, publicering och domänköp kräver alltid det
befintliga bekräftelsekortet – loopen stannar vid kortet och bara användarens
knapptryck (server action) utför åtgärden. Modellen kan inte bekräfta.

## Känsliga data

- Modellen ser bara komprimerade verktygsresultat (`forModel`) – aldrig hela
  register (listor är begränsade, oftast ≤20 rader).
- Personnummer skickas ALDRIG till leverantören – bara
  `hasPersonalIdentityNumber: true/false`. Samma princip för kvittorådata.
- Verktygsresultat skickas avgränsade som opålitlig DATA och systemprompten
  instruerar att inbäddade uppmaningar ska ignoreras. Skyddet vilar dock inte
  på prompten: behörigheterna upprätthålls i registret/executorn.
- Tenantisolering: alla anrop går genom `withBusiness` (tenantkontext) och i
  Supabase-läget RLS. Främmande id:n i argument ger "finns inte".

## Kostnadskontroll

- Deterministiska kommandon gör noll LLM-anrop (testat).
- Fri text går till LLM först när deterministisk tolkning ger `none`.
- FAST-modell som standard; SMART bara via enkel heuristik.
- `AI_MAX_TOOL_STEPS` (6) och `AI_MAX_OUTPUT_TOKENS` (700) begränsar varje fråga.
- Timeout 25 s per anrop.
- Varje anrop loggas i `assistantAudit` (`tool: "llm_request"`) med modell,
  tokens in/ut, verktygsnamn, uppskattad kostnad (USD), latens och utfall –
  i Supabase-läget med business/user via audit-mappningen.

## Tester

- `src/lib/ai-loop.test.ts` – transportmockad loop (mockning i TESTER, ingen
  fejk-AI i produkten): flerstegsflöde, tvetydighet, bekräftelsekrav,
  FORBIDDEN_FOR_AI, argumentvalidering, cross-tenant-id, promptinjektion,
  personnummer-frånvaro i utgående anrop, stegtak, saknad nyckel, 429/timeout,
  noll anrop för deterministiska vägar.
- `scripts/smoke-ai.ts` – FÅ riktiga anrop mot OpenRouter (billig FAST-modell)
  för läs- och utkastscenario. Körs manuellt, aldrig i CI.
