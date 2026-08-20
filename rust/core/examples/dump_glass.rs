//! Emits the Rust glass material's answers for the shared parity corpus.
//! Paired with scripts/glass-parity.harness.ts.

use dahonghua_core::glass::{
    ambient_pull, glass_spec, luminance, mix, readability_alpha, resolve_tier, touch_light_color,
    wash_color, GlassLevel, GlassTheme, GlassTier,
};
use dahonghua_core::num::js_num;
use std::io::{self, Read};

fn level(s: &str) -> GlassLevel {
    match s {
        "chrome" => GlassLevel::Chrome,
        "sheet" => GlassLevel::Sheet,
        "card" => GlassLevel::Card,
        other => panic!("unknown level {other}"),
    }
}

fn tier(s: &str) -> GlassTier {
    match s {
        "full" => GlassTier::Full,
        "wash" => GlassTier::Wash,
        "solid" => GlassTier::Solid,
        other => panic!("unknown tier {other}"),
    }
}

fn theme(is_dark: bool, card: &str, paper: &str) -> GlassTheme {
    GlassTheme {
        is_dark,
        card: card.into(),
        paper: paper.into(),
    }
}

fn opt(s: &str) -> Option<&str> {
    (!s.is_empty()).then_some(s)
}

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).expect("read corpus");

    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let (kind, arg) = line.split_once('\t').expect("corpus line is kind<TAB>arg");
        let f: Vec<&str> = arg.split('^').collect();

        let value = match kind {
            "lum" => js_num(luminance(f[0])),
            "mix" => {
                let m = mix(f[0], f[1], f[2].parse().expect("corpus amount"));
                format!("{},{},{}", m[0], m[1], m[2])
            }
            "pull" => js_num(ambient_pull(f[0], f[1])),
            "wash" => wash_color(
                &theme(f[0] == "1", f[1], f[2]),
                level(f[3]),
                opt(f[4]),
                opt(f[5]).map(|s| s.parse().expect("corpus alpha")),
                opt(f[6]),
            ),
            "alpha" => js_num(readability_alpha(
                &theme(f[0] == "1", "#FFFFFF", "#FBF7F0"),
                level(f[1]),
                f[2].parse().expect("corpus density"),
                tier(f[3]),
            )),
            "spec" => {
                let s = glass_spec(&theme(f[0] == "1", "#FFFFFF", "#FBF7F0"), level(f[1]));
                format!(
                    "{}|{}|{}|{}|{}|{}",
                    js_num(s.intensity),
                    js_num(s.wash_alpha),
                    js_num(s.wash_alpha_flat),
                    js_num(s.sheen),
                    js_num(s.sheen_height),
                    s.edge
                )
            }
            // the TypeScript half pins the platform to native; is_web is
            // covered by its own corpus rows below
            "tier" => resolve_tier(f[0] == "1", false).as_str().to_string(),
            "tierweb" => resolve_tier(f[0] == "1", f[1] == "1").as_str().to_string(),
            "touch" => touch_light_color(&theme(f[0] == "1", "#FFFFFF", "#FBF7F0")).to_string(),
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
