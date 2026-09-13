# Skatteverket – HUS-schema (rot och rut), version 6

Vendorade kopior av Skatteverkets XML-schema för **Begäran om utbetalning**
för rot- och rutarbete, det som e-tjänsten *Rot och rut – företag* importerar.

| Fil | Namespace |
| --- | --- |
| `begaran/V6/Begaran.xsd` | `http://xmls.skatteverket.se/se/skatteverket/ht/begaran/6.0` |
| `komponent/V6/BegaranCOMPONENT.xsd` | `http://xmls.skatteverket.se/se/skatteverket/ht/komponent/begaran/6.0` |

Källa: Skatteverkets schemalager, sidan *Schema för rot och rut* (skatteverket.se →
Företag → E-tjänster och blanketter → Schemalager (XML) → Rot och rut). Mappstrukturen
speglar schemalagret så att `Begaran.xsd`:s relativa import
(`../../komponent/V6/BegaranCOMPONENT.xsd`) fungerar oförändrad.

## Version, källa, licens och checksumma

| Fil | Version | Skapad (schemats metadata) | Senaste ändring i schemat | SHA-256 |
| --- | --- | --- | --- | --- |
| `begaran/V6/Begaran.xsd` | 6.0 | 2016-09-28 | 2020-11-26 (ruttjänster från 2021-01-01) | `98463ee0…cad5c7` |
| `komponent/V6/BegaranCOMPONENT.xsd` | 6.0 | 2016-09-28 | – | `b49c3692…319bec` |

- **Källa:** Skatteverkets schemalager (XML), *Rot och rut*, som ovan. Publiceras
  av Skatteverket (`dc:publisher`/`dcq:owner` i schemats egen metadata) för att
  företag ska kunna bygga filer till e-tjänsten.
- **Licens:** Skatteverket anger ingen licenstext i filerna. De är offentligt
  publicerade tekniska specifikationer från en svensk myndighet, kopierade
  oförändrade för validering. Ferva gör inga ändringar i dem.
- **Pinning:** de fullständiga checksummorna ligger i `SCHEMAS.sha256` och
  testet `src/lib/hus-schema-pin.test.ts` faller om en fil ändras utan att
  raden uppdateras. CI validerar med `xmllint --nonet`: inget schema hämtas
  från nätet vid körning. Byte till en ny officiell version är ett medvetet
  steg: ny fil + ny checksumma + ny rad i tabellen ovan i samma commit.

## Vad Ferva gör – och inte gör

- `src/lib/hus-begaran.ts` bygger filen och kontrollerar den mot schemats regler
  plus e-tjänstens inskickskontroller (begärt ≤ betalt, begärt + betalt ≤ arbetskostnad,
  samma betalningsår, minst ett arbetsområde, max 100 köpare …).
- `src/lib/services/hus-export.ts` fyller filen från ett ROT/RUT-ärende med skapat
  ansökningsunderlag. Ett `Arenden` per betald faktura.
- Användaren laddar ner filen (`GET /api/skatteverket/hus?jobb=|faktura=`) och
  importerar den själv i e-tjänsten. **Ferva skickar ingenting till Skatteverket**
  och markerar aldrig ett beslut automatiskt.
- ROT och RUT hamnar aldrig i samma fil (`RotBegaran` respektive `HushallBegaran`).
- Utföraren (företagets organisationsnummer) finns inte i schemat – det är det
  inloggade företaget i e-tjänsten.

## Validera lokalt

```sh
xmllint --noout --schema docs/skatteverket/hus/begaran/V6/Begaran.xsd fil.xml
```

Testerna (`src/lib/hus-begaran.test.ts`, `src/lib/hus-export.test.ts`) kör samma
kontroll när `xmllint` finns i miljön och hoppar annars över just XSD-steget –
**utom i CI**, där `libxml2-utils` installeras i workflowen och ett saknat
`xmllint` är ett testfel (`src/lib/__fixtures__/xmllint.ts`). Samma hjälpare
kontrollerar att AGI-, eSKD- och iXBRL-filerna är välformade enligt libxml2
(`src/lib/accounting/filing.test.ts`).
Gyllene filer: `src/lib/__fixtures__/hus/*.xml`.
