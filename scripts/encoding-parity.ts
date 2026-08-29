// TypeScript half of the bill-encoding parity harness.
//
// Compared against the pure-JS fallback rather than against Node's own
// TextDecoder, and that choice is the point: the shipping app runs on Hermes,
// which has no 'gbk' label, so `decodeGbkJs` is what actually decodes a 支付宝
// export on a user's phone. Node has full ICU and would quietly answer for a
// decoder that never runs there.
//
// Bytes arrive as hex, because a corpus line has to survive being a line.

import { looksLikeUtf8 } from '../src/domain/billParse';
import { decodeGbkJs, decodeUtf8Js } from '../src/domain/encoding';

const raw = require('fs').readFileSync(0, 'utf8') as string;

function bytesOf(hex: string): Uint8Array {
  if (hex === '') return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Text as escaped code units, so a decoded U+FFFD or a newline stays on one
 *  line and is visible when it differs. */
function show(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out +=
      c >= 0x20 && c < 0x7f && ch !== '\\'
        ? ch
        : `\\u{${c.toString(16)}}`;
  }
  return out;
}

/** Which decoder `decodeBillText` would pick. Reported rather than run, so the
 *  answer does not depend on which decoders this engine happens to have. */
function decide(bytes: Uint8Array): string {
  const bom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (bom) return 'utf8-bom';
  return looksLikeUtf8(bytes) ? 'utf8' : 'gbk';
}

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const hex = trimmed.slice(tab + 1);
  const bytes = bytesOf(hex);

  let value: string;
  switch (kind) {
    case 'utf8?':
      value = looksLikeUtf8(bytes) ? '1' : '0';
      break;
    case 'decide':
      value = decide(bytes);
      break;
    case 'gbk':
      value = show(decodeGbkJs(bytes));
      break;
    case 'utf8':
      // only meaningful for input that passed validation, which is the
      // contract decodeUtf8Js is written to
      value = looksLikeUtf8(bytes) ? show(decodeUtf8Js(bytes)) : 'invalid';
      break;
    case 'bill': {
      const d = decide(bytes);
      const text =
        d === 'utf8-bom'
          ? decodeUtf8Js(bytes.subarray(3))
          : d === 'utf8'
            ? decodeUtf8Js(bytes)
            : decodeGbkJs(bytes);
      value = show(text);
      break;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(value);
}

process.stdout.write(out.join('\n') + '\n');
