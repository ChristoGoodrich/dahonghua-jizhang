// A minimal, dependency-free XLSX writer.
//
// This exists to get `xlsx` (SheetJS) off the dependency list. The app only ever
// *wrote* spreadsheets — four calls, all on the write side — while the npm
// package carries two unfixable high-severity advisories (prototype pollution
// and ReDoS), both in its *parsing* code, with no patched release on npm.
// Carrying a parser we never call, purely to emit a sheet, was the wrong trade.
//
// An .xlsx file is a ZIP of XML parts. Rows here are written as inline strings
// and numbers, so there is no shared-string table to maintain, and entries are
// STOREd rather than deflated — the sheets are small, and it keeps this file
// free of a compression implementation.

export type Cell = string | number;

/* ---------------------------------------------------------------- XML parts */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters outright; Excel rejects the file
    // rather than skipping them, so they are dropped here.
     
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** 0 → A, 25 → Z, 26 → AA … */
export function colName(i: number): string {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sheetXml(rows: Cell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (typeof v === 'number' && Number.isFinite(v)) {
            return `<c r="${ref}"><v>${v}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return (
    `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

function parts(rows: Cell[][], sheetName: string): { name: string; body: string }[] {
  return [
    {
      name: '[Content_Types].xml',
      body:
        `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      body:
        `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      body:
        `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      body:
        `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    { name: 'xl/worksheets/sheet1.xml', body: sheetXml(rows) },
  ];
}

/* -------------------------------------------------------------- ZIP (STORE) */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Little-endian writer over a growable byte list. */
class ByteSink {
  private bytes: number[] = [];
  get length(): number {
    return this.bytes.length;
  }
  u16(v: number): void {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff);
  }
  u32(v: number): void {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  raw(b: Uint8Array): void {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i]);
  }
  toArrayBuffer(): ArrayBuffer {
    return new Uint8Array(this.bytes).buffer;
  }
}

/** Build a ZIP archive with every entry stored uncompressed. */
function zip(files: { name: string; body: string }[]): ArrayBuffer {
  const out = new ByteSink();
  const index: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const f of files) {
    const name = utf8(f.name);
    const data = utf8(f.body);
    const crc = crc32(data);
    const offset = out.length;

    out.u32(0x04034b50); // local file header
    out.u16(20); // version needed
    out.u16(0x0800); // flags: UTF-8 names
    out.u16(0); // method: store
    out.u16(0); // mod time
    out.u16(0x21); // mod date — 1980-01-01, so output is byte-identical run to run
    out.u32(crc);
    out.u32(data.length); // compressed size == uncompressed under STORE
    out.u32(data.length);
    out.u16(name.length);
    out.u16(0); // extra field length
    out.raw(name);
    out.raw(data);

    index.push({ name, crc, size: data.length, offset });
  }

  const dirStart = out.length;
  for (const e of index) {
    out.u32(0x02014b50); // central directory header
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0x0800);
    out.u16(0);
    out.u16(0);
    out.u16(0x21);
    out.u32(e.crc);
    out.u32(e.size);
    out.u32(e.size);
    out.u16(e.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number
    out.u16(0); // internal attrs
    out.u32(0); // external attrs
    out.u32(e.offset);
    out.raw(e.name);
  }
  const dirSize = out.length - dirStart;

  out.u32(0x06054b50); // end of central directory
  out.u16(0); // this disk
  out.u16(0); // disk with directory
  out.u16(index.length);
  out.u16(index.length);
  out.u32(dirSize);
  out.u32(dirStart);
  out.u16(0); // comment length

  return out.toArrayBuffer();
}

/** Rows → a single-sheet .xlsx workbook. */
export function writeXlsx(rows: Cell[][], sheetName = 'Sheet1'): ArrayBuffer {
  return zip(parts(rows, sheetName));
}
