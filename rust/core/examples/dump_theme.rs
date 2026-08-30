//! Rust half of the theme parity harness. See `scripts/theme-parity.ts`.

use dahonghua_core::theme::{make_theme, swatch, ThemeKey};
use std::io::Read;

fn main() {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .expect("corpus on stdin");
    let mut out = String::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let mut it = line.split('\t');
        let key = ThemeKey::parse(it.next().unwrap_or(""));
        let dark = it.next() == Some("1");
        let field = it.next().unwrap_or("");

        let t = make_theme(key, dark);
        let value = match field {
            "hibiscus" => t.hibiscus,
            "hibiscusDeep" => t.hibiscus_deep,
            "hibiscusSoft" => t.hibiscus_soft,
            "stamen" => t.stamen,
            "leaf" => t.leaf,
            "leafDeep" => t.leaf_deep,
            "paper" => t.paper,
            "paperWarm" => t.paper_warm,
            "ink" => t.ink,
            "inkSoft" => t.ink_soft,
            "line" => t.line,
            "card" => t.card,
            "tint" => t.tint,
            "tintStrong" => t.tint_strong,
            "gradFrom" => t.grad_from,
            "gradTo" => t.grad_to,
            "shadow" => t.shadow,
            "glow" => t.glow,
            "overlay" => t.overlay,
            "isDark" => if t.is_dark { "1" } else { "0" }.to_string(),
            "swatch" => swatch(key),
            other => panic!("unknown field {other:?}"),
        };
        out.push_str(&value);
        out.push('\n');
    }
    print!("{out}");
}
