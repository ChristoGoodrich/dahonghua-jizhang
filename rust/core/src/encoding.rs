//! Decoding a bill file's bytes, without a platform decoder.
//!
//! Ported from `src/domain/encoding.ts` and the detection half of
//! `src/domain/billParse.ts`. It exists for the same reason its TypeScript does:
//! **支付宝 exports its CSVs in GBK**, and the engine underneath has no GBK
//! decoder. Hermes has no `'gbk'` label for `TextDecoder`; Dart has no GBK at
//! all. Both fall back to the same table, so the table is here.
//!
//! Two rules decide what happens, and both are the WHATWG decoder's rather than
//! anything invented:
//!
//! * **A UTF-8 BOM or valid UTF-8 means UTF-8; everything else is GBK.** The
//!   test is strict validation, not a guess: 微信 writes a BOM, 支付宝 writes
//!   neither, and a GBK file almost always contains a byte sequence that is not
//!   valid UTF-8.
//! * **An invalid GBK pair emits `U+FFFD` and does not consume an ASCII trail
//!   byte.** That byte decodes as itself on the next pass, which is what keeps a
//!   corrupt cell from eating the comma after it and merging two columns.

use crate::gbk_table::GBK_INDEX;

/// Strict UTF-8 validation, byte by byte.
///
/// Not `str::from_utf8`, though it answers the same question, because the
/// TypeScript's version is the one whose *rejections* matter: it is the switch
/// that sends a file to the GBK decoder instead. Written out so the boundaries
/// are visible — an invalid lead byte is `0x80..=0xC1` or `0xF5..=0xFF`, and a
/// truncated sequence at the end is a rejection rather than a partial read.
pub fn looks_like_utf8(bytes: &[u8]) -> bool {
    let n = bytes.len();
    let mut i = 0;
    while i < n {
        let b = bytes[i];
        if b < 0x80 {
            i += 1;
            continue;
        }
        let extra = match b {
            0xc2..=0xdf => 1,
            0xe0..=0xef => 2,
            0xf0..=0xf4 => 3,
            _ => return false,
        };
        if i + extra >= n {
            return false;
        }
        for j in 1..=extra {
            if bytes[i + j] & 0xc0 != 0x80 {
                return false;
            }
        }
        i += extra + 1;
    }
    true
}

/// Decode GBK two-byte text.
///
/// Matches the WHATWG `gbk` decoder for every two-byte sequence. A gb18030
/// four-byte sequence — rare, and absent from real bill exports — decodes as
/// two replacement errors, which is what the TypeScript does too.
pub fn decode_gbk(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b < 0x80 {
            out.push(b as char);
            i += 1;
            continue;
        }
        if b == 0x80 {
            out.push('€'); // the one GBK single-byte extension
            i += 1;
            continue;
        }
        if b == 0xff || i + 1 >= bytes.len() {
            out.push('\u{fffd}'); // invalid lead, or a lead dangling at EOF
            i += 1;
            continue;
        }
        let trail = bytes[i + 1];
        if (0x40..=0xfe).contains(&trail) && trail != 0x7f {
            let col = if trail < 0x7f {
                trail - 0x40
            } else {
                trail - 0x41
            };
            let cell = GBK_INDEX[(b as usize - 0x81) * 190 + col as usize];
            out.push(char::from_u32(cell as u32).unwrap_or('\u{fffd}'));
            i += 2;
            continue;
        }
        // Invalid trail: the LEAD is the error, and an ASCII trail is not
        // consumed — it decodes as itself next time round. That is what keeps a
        // corrupt cell from swallowing the comma after it.
        out.push('\u{fffd}');
        i += if trail >= 0x80 { 2 } else { 1 };
    }
    out
}

/// Decode UTF-8 that has already passed [`looks_like_utf8`].
///
/// Trusted input, exactly as the TypeScript's is: the sequences are known
/// well-formed, so this does no validation of its own.
pub fn decode_utf8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// Decode a bill file, choosing the encoding by looking at it.
///
/// The BOM is stripped: a platform `TextDecoder` removes it and the fallback
/// path has to as well, or the first header cell would start with an invisible
/// character and never match a column name.
pub fn decode_bill_text(bytes: &[u8]) -> String {
    let bom = bytes.len() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf;
    if bom {
        return decode_utf8(&bytes[3..]);
    }
    if looks_like_utf8(bytes) {
        return decode_utf8(bytes);
    }
    decode_gbk(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_is_utf8() {
        assert!(looks_like_utf8(b"date,amount,note"));
        assert!(looks_like_utf8(b""));
    }

    #[test]
    fn real_utf8_is_utf8() {
        assert!(looks_like_utf8("日期,金额".as_bytes()));
    }

    #[test]
    fn gbk_bytes_are_not_utf8() {
        // 日期 in GBK: C8 D5 C6 DA — C8 is a valid lead but D5 is not a
        // continuation, so validation fails and the file goes to the GBK path
        assert!(!looks_like_utf8(&[0xc8, 0xd5, 0xc6, 0xda]));
    }

    #[test]
    fn an_invalid_lead_byte_is_not_utf8() {
        for b in [0x80u8, 0xc1, 0xf5, 0xff] {
            assert!(!looks_like_utf8(&[b]), "{b:#x} should be rejected");
        }
    }

    #[test]
    fn a_truncated_sequence_is_not_utf8() {
        // the lead promises two more bytes and the file ends
        assert!(!looks_like_utf8(&[0xe6, 0x97]));
    }

    #[test]
    fn gbk_decodes_the_characters_a_bill_actually_contains() {
        // 日期 and 金额 — the two column names every 支付宝 export has
        assert_eq!(decode_gbk(&[0xc8, 0xd5, 0xc6, 0xda]), "日期");
        assert_eq!(decode_gbk(&[0xbd, 0xf0, 0xb6, 0xee]), "金额");
    }

    #[test]
    fn gbk_leaves_ascii_alone() {
        assert_eq!(decode_gbk(b"a,b\n1,2"), "a,b\n1,2");
    }

    #[test]
    fn the_one_single_byte_extension_is_the_euro_sign() {
        assert_eq!(decode_gbk(&[0x80]), "€");
    }

    #[test]
    fn an_invalid_pair_does_not_eat_the_comma_after_it() {
        // this is the rule that keeps a corrupt cell from merging two columns:
        // an ASCII trail is NOT consumed
        assert_eq!(decode_gbk(&[0xc8, b',', b'x']), "\u{fffd},x");
    }

    #[test]
    fn an_invalid_pair_with_a_high_trail_consumes_both() {
        assert_eq!(decode_gbk(&[0xc8, 0x30, b'x']), "\u{fffd}0x");
        assert_eq!(decode_gbk(&[0xff, 0xff]), "\u{fffd}\u{fffd}");
    }

    #[test]
    fn a_lead_dangling_at_the_end_is_one_error() {
        assert_eq!(decode_gbk(&[b'a', 0xc8]), "a\u{fffd}");
    }

    #[test]
    fn detection_sends_each_file_to_the_right_decoder() {
        assert_eq!(decode_bill_text("日期,金额".as_bytes()), "日期,金额");
        assert_eq!(decode_bill_text(&[0xc8, 0xd5, 0xc6, 0xda]), "日期");
    }

    #[test]
    fn a_bom_is_stripped_rather_than_decoded() {
        // 微信 writes one, and a header cell starting with an invisible
        // character matches no column name
        let mut bytes = vec![0xef, 0xbb, 0xbf];
        bytes.extend_from_slice("日期".as_bytes());
        assert_eq!(decode_bill_text(&bytes), "日期");
    }

    #[test]
    fn an_empty_file_decodes_to_nothing() {
        assert_eq!(decode_bill_text(b""), "");
    }
}
