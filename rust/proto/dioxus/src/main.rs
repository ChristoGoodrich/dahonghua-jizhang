//! Dioxus prototype of the record sheet.
//!
//! The counterpart to rust/proto/slint. Same three questions, same crude
//! layout — the point is the answers, not the polish:
//!
//!   1. Does a Chinese IME work? On Android this renders in the system
//!      WebView, so the IME is the platform's own — the expectation is that it
//!      simply works, and the probe is here to confirm rather than assume.
//!   2. Can 柔光玻璃 be expressed? CSS has `backdrop-filter`, which is the
//!      thing Slint has no equivalent of, and `color-mix` for the ambient pull.
//!   3. Do accessibility labels survive? ARIA goes straight through.
//!
//! Note how much of this reads like the React it would replace. That is the
//! argument for Dioxus in one glance: 9,209 lines of UI move by translation,
//! not by redesign.

use dioxus::prelude::*;

fn main() {
    dioxus::launch(App);
}

/// The palette, lifted from src/theme/tokens.ts so the comparison is fair.
const CSS: &str = r#"
:root {
  --paper: #FBF7F0;
  --paper-warm: #F6EEE2;
  --ink: #2B2622;
  --ink-soft: #8A8178;
  --line: #EADFCF;
  --hibiscus: #D94E5C;
  --hibiscus-deep: #B83A48;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font-family: -apple-system, "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif;
}
.sheet { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.h1 { font-size: 22px; font-weight: 700; }

/* something busy underneath, so the translucency is visible */
.behind {
  background: var(--paper-warm); border-radius: 16px; padding: 8px;
  color: var(--ink-soft); font-size: 13px; line-height: 1.6;
}

/* 柔光玻璃 — the full tier, the one Slint cannot render.
   backdrop-filter blurs what is behind; color-mix does the ambient pull that
   src/theme/glass.ts computes by hand. */
.glass {
  position: relative; overflow: hidden;
  border-radius: 26px; border: 1px solid rgba(255,255,255,0.65);
  background: color-mix(in srgb, #FFFFFF 72%, var(--paper) 28%);
  opacity: 0.999; /* keeps the wash alpha explicit below */
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
}
.glass::before {           /* the specular top edge */
  content: ""; position: absolute; inset: 0 0 auto 0; height: 26px;
  background: linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0));
  pointer-events: none;
}
.amount {
  display: flex; align-items: center; justify-content: center;
  height: 78px; font-size: 38px; font-weight: 800;
}
.label { font-size: 11px; color: var(--ink-soft); }
.field {
  width: 100%; padding: 12px 14px; font-size: 15px;
  border: 1px solid var(--line); border-radius: 10px;
  background: #fff; color: var(--ink);
}
.readback { font-size: 12px; color: var(--hibiscus-deep); }
.pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.key {
  height: 46px; font-size: 17px; border: 0; border-radius: 12px;
  background: var(--paper-warm); color: var(--ink);
}
.key:active { background: var(--line); }   /* the touch response */
"#;

#[component]
fn App() -> Element {
    let mut amount = use_signal(String::new);
    let mut note = use_signal(String::new);

    const KEYS: [&str; 12] = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"];

    rsx! {
        style { {CSS} }
        div { class: "sheet",
            div { class: "h1", "记一笔" }

            div { class: "behind",
                div { "餐饮 · 现金 · -35.00" }
                div { "交通 · 支付宝 · -12.00" }
                div { "工资 · 招行 · +9,000.00" }
            }

            // RISK 2: the material
            div { class: "glass",
                div {
                    class: "amount",
                    role: "text",
                    "aria-label": "金额",
                    { if amount().is_empty() { "0".to_string() } else { amount() } }
                }
            }

            // RISK 1: the IME. Type Chinese here.
            div { class: "label", "备注（在这里用中文输入法打字）" }
            input {
                class: "field",
                placeholder: "午饭、打车、房租…",
                "aria-label": "备注",
                value: "{note}",
                oninput: move |e| note.set(e.value()),
            }
            div { class: "readback", "读回：「{note}」 长度 {note().chars().count()}" }

            // RISK 3: labels on controls
            div { class: "pad",
                for k in KEYS {
                    button {
                        key: "{k}",
                        class: "key",
                        "aria-label": { if k == "back" { "退格" } else { k } },
                        onclick: move |_| {
                            let mut v = amount();
                            if k == "back" { v.pop(); } else { v.push_str(k); }
                            amount.set(v);
                        },
                        { if k == "back" { "⌫" } else { k } }
                    }
                }
            }
        }
    }
}
