# Runbook: filing-fel (deklarationer och inlämning)

Ferva är **export-först**: momsdeklaration, AGI, INK2 och årsredovisning
genereras som filer som företagaren lämnar in själv (steg för steg i appen)
eller via en filing-leverantör när en sådan är kontrakterad och konfigurerad.
Riktiga företag ser aldrig en låtsad inlämning eller fejkad BankID-signering;
mock-leverantören finns bara i demo/JSON-läge.

## 1. Vilken väg är aktiv?

`/admin/system` → *Myndighetsinlämning*:

- **Manuell inlämning (ingen leverantör)** – normalläget i produktion utan
  `FILING_API_BASE_URL`/`FILING_API_TOKEN`. Kunden laddar ner filen och
  rapporterar inlämningen manuellt (referens eller kvittofil).
- **Live-leverantör** – båda variablerna satta; `FILING_ENV` styr test/prod.
- **Mock (endast demo/dev)** – får aldrig visas i produktion. Om det syns:
  `DRIVA_STORAGE`/JSON-läge i prod ⇒ stoppa och åtgärda miljön.

## 2. Filen kan inte genereras

Genereringen är deterministisk och blockeras av **ordningsspärrar** (moms före
bokslut, AGI per månad, bokslut före INK2 osv.). Kunden ser spärren i appen
(*Deklarationer*). Vanliga orsaker:

- Perioden är inte stängd / bokföringen har oklarade poster ⇒ kunden slutför
  bokföringen; ingen adminåtgärd.
- Kontrollsumma stämmer inte vid rapportering ⇒ filen har ändrats efter
  nedladdning; status återgår till *genererad* – ladda ner på nytt.
- Serverfel ⇒ Sentry tagg `integration:filing`, korrelations-id i felrutan.

Filerna valideras med `xmllint` i CI (se `.github/workflows`) – ett
schemafel ska aldrig nå produktion.

## 3. Live-leverantören felar

| Symptom | Åtgärd |
| --- | --- |
| `401/403` från leverantören | Token utgången/roterad – uppdatera `FILING_API_TOKEN` ([nyckelrotation.md](nyckelrotation.md)) |
| `5xx`/timeout | Leverantörsstörning; inlämningen ligger kvar som *signerad*, kunden kan försöka igen eller lämna in manuellt (alltid tillgängligt) |
| *avvisad* med felkod | Visas kunden i ärendet; koden loggas i `filing_submissions`. Kunden korrigerar och skapar ny inlämning (rättelser är nya rader, aldrig ändrade) |
| Kvittens saknas | Statusen stannar på *inlamnad*; kontrollera leverantörens portal och registrera kvittensen via kundens *Rapportera inlämning* |

## 4. Aldrig

- Aldrig markera något som inlämnat åt kunden utan underlag (referens/kvitto).
- Aldrig aktivera mock-leverantören för riktiga företag.
- Aldrig ändra en signerad/inlämnad rad – skapa en ny.

## 5. Kontroll efteråt

`/admin/businesses/<id>` → inlämningshistorik (status, provider, tidpunkt) och
`audit_log` för företaget. Deadline-kalendern i appen (moms/AGI/INK2) hjälper
kunden att prioritera om något försenats.
