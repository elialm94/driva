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

## Vad Driva gör – och inte gör

- `src/lib/hus-begaran.ts` bygger filen och kontrollerar den mot schemats regler
  plus e-tjänstens inskickskontroller (begärt ≤ betalt, begärt + betalt ≤ arbetskostnad,
  samma betalningsår, minst ett arbetsområde, max 100 köpare …).
- `src/lib/services/hus-export.ts` fyller filen från ett ROT/RUT-ärende med skapat
  ansökningsunderlag. Ett `Arenden` per betald faktura.
- Användaren laddar ner filen (`GET /api/skatteverket/hus?jobb=|faktura=`) och
  importerar den själv i e-tjänsten. **Driva skickar ingenting till Skatteverket**
  och markerar aldrig ett beslut automatiskt.
- ROT och RUT hamnar aldrig i samma fil (`RotBegaran` respektive `HushallBegaran`).
- Utföraren (företagets organisationsnummer) finns inte i schemat – det är det
  inloggade företaget i e-tjänsten.

## Validera lokalt

```sh
xmllint --noout --schema docs/skatteverket/hus/begaran/V6/Begaran.xsd fil.xml
```

Testerna (`src/lib/hus-begaran.test.ts`, `src/lib/hus-export.test.ts`) kör samma
kontroll när `xmllint` finns i miljön och hoppar annars över just XSD-steget.
Gyllene filer: `src/lib/__fixtures__/hus/*.xml`.
