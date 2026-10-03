//! Build a request, or read a reply, the way the app does — for checking the
//! prompts against a real service by hand. Nothing here holds a key or opens a
//! connection; a script does that and hands the bytes back.
//!
//!     ai_smoke quick "<sentence>"          prints the request body
//!     ai_smoke ask "<question>"            prints the request body
//!     ai_smoke receipt <base64-file>       prints the request body
//!     ai_smoke read-quick <reply-file>     prints the drafts
//!     ai_smoke read-ask <reply-file>       prints the query

use dahonghua_core::ai::{ask, quick, wire};
use dahonghua_core::civil::Civil;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let today = Civil::new(2026, 8, 23);
    let c = quick::Custom::default();
    let base = std::env::var("AI_BASE").unwrap_or_else(|_| wire::default_base_url("tp-").into());
    let mimo = wire::is_mimo(&base);
    match args.get(1).map(String::as_str) {
        Some("quick") => print!(
            "{}",
            wire::quick_body(wire::DEFAULT_MODEL, mimo, &args[2], today, c, true, true)
        ),
        Some("ask") => print!(
            "{}",
            wire::ask_body(wire::DEFAULT_MODEL, mimo, &args[2], today, c, true, true)
        ),
        Some("receipt") => {
            let b64 = std::fs::read_to_string(&args[2]).expect("the picture, as base64");
            print!(
                "{}",
                wire::receipt_body(
                    wire::DEFAULT_VISION_MODEL,
                    mimo,
                    b64.trim(),
                    "image/jpeg",
                    today,
                    c,
                    true,
                    true
                )
            );
        }
        Some(k @ ("read-quick" | "read-ask")) => {
            let body = std::fs::read_to_string(&args[2]).expect("the reply");
            let status: u16 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(200);
            match wire::reply_content(status, &body) {
                Err(f) => println!("FAILURE {:?} {}", f.kind, f.detail),
                Ok(content) => {
                    if k == "read-quick" {
                        match quick::parse_reply(&content, today, &[], c) {
                            Ok(ds) => {
                                for d in ds {
                                    println!(
                                        "{:?} {} {} {:?} {:?}",
                                        d.io, d.cat, d.amt, d.note, d.day
                                    );
                                }
                            }
                            Err(e) => println!("UNREADABLE {e:?}: {content}"),
                        }
                    } else {
                        match ask::parse_reply(&content, today, 1, c) {
                            Some(q) => println!("{q:?}"),
                            None => println!("UNREADABLE: {content}"),
                        }
                    }
                }
            }
        }
        _ => eprintln!("see the header"),
    }
}
