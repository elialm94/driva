/**
 * XML-prisfil → tabell. Grossisternas XML-exporter skiljer sig, så läsaren
 * är generisk: det upprepade elementet (t.ex. <Artikel>, <Item>, <Product>)
 * blir rader och dess barnelement/attribut blir kolumner. Kolumnnamnen går
 * sedan genom samma automatiska mappning som CSV-rubriker.
 */
import { localName, parseXml, textContent, type XmlElement } from "./xml";
import { TABLE_LIMITS, TableLimitError, cleanCell, type RawTable } from "./table";

export class XmlTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlTableError";
  }
}

/** Hitta det element vars barn har samma namn flest gånger (datablocket). */
type RecordParent = { parent: XmlElement; recordName: string; count: number };

function findRecordParent(root: XmlElement): { parent: XmlElement; recordName: string } | null {
  let best: RecordParent | null = null;
  const visit = (el: XmlElement, depth: number) => {
    if (depth > 8) return;
    const counts = new Map<string, number>();
    for (const c of el.children) {
      const name = localName(c.name).toLowerCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const [name, count] of counts) {
      // Ett datablock: minst 1 post med egna barn/attribut. Fler poster vinner,
      // och vid lika räknas en grundare nivå som mer trolig.
      const sample = el.children.find((c) => localName(c.name).toLowerCase() === name);
      const structured = Boolean(sample && (sample.children.length > 0 || Object.keys(sample.attrs).length > 0));
      if (!structured) continue;
      if (!best || count > best.count) best = { parent: el, recordName: name, count };
    }
    for (const c of el.children) visit(c, depth + 1);
  };
  visit(root, 0);
  // Tilldelningen sker i closure – TS ser inte den, därav casten.
  const found = best as RecordParent | null;
  return found ? { parent: found.parent, recordName: found.recordName } : null;
}

function flattenRecord(record: XmlElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(record.attrs)) out.set(localName(k), cleanCell(v));
  for (const child of record.children) {
    const key = localName(child.name);
    if (child.children.length > 0 && Object.keys(child.attrs).length === 0) {
      // Ett nivå ner (t.ex. <Priser><Listpris>…</Listpris></Priser>) → "Priser.Listpris".
      for (const grand of child.children) {
        const gk = `${key}.${localName(grand.name)}`;
        if (!out.has(gk)) out.set(gk, cleanCell(textContent(grand)));
      }
      if (child.text.trim()) out.set(key, cleanCell(child.text));
      continue;
    }
    for (const [ak, av] of Object.entries(child.attrs)) {
      const attrKey = `${key}@${localName(ak)}`;
      if (!out.has(attrKey)) out.set(attrKey, cleanCell(av));
    }
    if (!out.has(key)) out.set(key, cleanCell(textContent(child)));
  }
  return out;
}

export function xmlToTable(text: string): RawTable {
  const root = parseXml(text);
  const found = findRecordParent(root);
  if (!found) throw new XmlTableError("XML-filen innehåller inga upprepade artikelposter som kan läsas.");
  const records = found.parent.children.filter((c) => localName(c.name).toLowerCase() === found.recordName);
  if (records.length > TABLE_LIMITS.maxRows) {
    throw new TableLimitError(
      `XML-filen innehåller fler än ${TABLE_LIMITS.maxRows.toLocaleString("sv-SE")} artiklar. Exportera ett mindre urval.`,
    );
  }

  const headers: string[] = [];
  const headerIndex = new Map<string, number>();
  const flat = records.map(flattenRecord);
  for (const rec of flat) {
    for (const key of rec.keys()) {
      if (!headerIndex.has(key)) {
        if (headers.length >= TABLE_LIMITS.maxColumns) {
          throw new TableLimitError(`XML-filen har fler än ${TABLE_LIMITS.maxColumns} fält per artikel.`);
        }
        headerIndex.set(key, headers.length);
        headers.push(key);
      }
    }
  }
  const rows = flat.map((rec) => {
    const row: string[] = new Array(headers.length).fill("");
    for (const [key, value] of rec) row[headerIndex.get(key)!] = value;
    return row;
  });
  return { headers, rows, hasHeaderRow: true, firstDataRowNumber: 1 };
}
