// Pure-JS text decoders for platforms without a (full) TextDecoder — Hermes on
// native has no 'gbk' label, and older engines lack TextDecoder entirely. The
// bill importer must handle GBK because 支付宝 CSV exports ship in GBK.
import { GBK_INDEX } from './gbkTable';

/** Decode GBK two-byte text (the classic Chinese Windows encoding) without a
 *  platform TextDecoder. Matches the WHATWG 'gbk' decoder for all two-byte
 *  sequences: invalid pairs emit U+FFFD, and an ASCII trail byte after an
 *  error is re-decoded as itself. (gb18030 four-byte sequences — rare, absent
 *  from real bill exports — decode as two replacement errors.) */
export function decodeGbkJs(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      continue;
    }
    if (b === 0x80) {
      out += '€'; // € — the one GBK single-byte extension
      continue;
    }
    if (b === 0xff || i + 1 >= bytes.length) {
      out += '�'; // invalid lead, or a dangling lead at EOF
      continue;
    }
    const trail = bytes[i + 1];
    if (trail >= 0x40 && trail <= 0xfe && trail !== 0x7f) {
      out += GBK_INDEX[(b - 0x81) * 190 + (trail < 0x7f ? trail - 0x40 : trail - 0x41)];
      i++;
      continue;
    }
    // invalid trail: error for the lead; an ASCII trail is NOT consumed and
    // decodes as itself on the next pass (WHATWG rule)
    out += '�';
    if (trail >= 0x80) i++;
  }
  return out;
}

/** Decode UTF-8 without a platform TextDecoder. Assumes the input already
 *  passed strict validation (see billImport.looksLikeUtf8) — sequences are
 *  trusted to be well-formed. */
export function decodeUtf8Js(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      out += String.fromCodePoint(
        ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f),
      );
      i += 4;
    }
  }
  return out;
}
