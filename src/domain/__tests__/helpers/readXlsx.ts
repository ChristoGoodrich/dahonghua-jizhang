// A reader for the archives src/domain/xlsxWrite.ts produces, used only by
// tests. It exists so the suite can assert on real workbook contents without
// pulling SheetJS back in as a dev dependency — the package was removed for its
// two unfixable parser advisories, and re-adding it "just for tests" would put
// the same code back in the tree.
//
// Deliberately narrow: STORE-only entries, inline strings and numeric cells,
// which is exactly what the writer emits. Anything else throws rather than
// guessing, so a writer regression surfaces as a loud failure here.

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

/** Every part of a STORE-only ZIP, decoded as UTF-8, with CRCs verified. */
export function unzip(ab: ArrayBuffer): Record<string, string> {
  const b = new Uint8Array(ab);
  const dv = new DataView(ab);
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= b.length && dv.getUint32(i, true) === 0x04034b50) {
    const method = dv.getUint16(i + 8, true);
    if (method !== 0) throw new Error(`entry is not STOREd (method ${method})`);
    const crc = dv.getUint32(i + 14, true);
    const size = dv.getUint32(i + 18, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const nameAt = i + 30;
    const dataAt = nameAt + nameLen + extraLen;
    const name = new TextDecoder().decode(b.subarray(nameAt, nameAt + nameLen));
    const data = b.subarray(dataAt, dataAt + size);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    out[name] = new TextDecoder().decode(data);
    i = dataAt + size;
  }
  return out;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface Workbook {
  sheetNames: string[];
  /** Row-major cell values, in sheet order. */
  rows: (string | number)[][];
}

export function readXlsx(ab: ArrayBuffer): Workbook {
  const parts = unzip(ab);
  const wb = parts['xl/workbook.xml'] ?? '';
  const sheetNames = [...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => unescapeXml(m[1]));

  const sheet = parts['xl/worksheets/sheet1.xml'] ?? '';
  const rows = [...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rm) =>
    [...rm[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map((cm) => {
      const inline = cm[1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
      if (inline) return unescapeXml(inline[1]);
      const num = cm[1].match(/<v>([\s\S]*?)<\/v>/);
      if (num) return Number(num[1]);
      return '';
    }),
  );

  return { sheetNames, rows };
}
