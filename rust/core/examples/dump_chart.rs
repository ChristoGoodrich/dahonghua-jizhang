//! Emits the Rust chart geometry for the shared parity corpus.
//! Paired with scripts/chart-parity.ts.

use dahonghua_core::chart::{chart_max, polyline, x_of, y_of, SeriesType};
use dahonghua_core::jsval::{parse, Value};
use dahonghua_core::num::js_num;
use std::io::{self, Read};

/// `"nan"` in the corpus is a NaN — JSON has no syntax for one, and a chart
/// series summed from ledger amounts can hold one. See scripts/chart-parity.ts.
fn nums(v: Option<&Value>) -> Vec<f64> {
    match v {
        Some(Value::Arr(items)) => items
            .iter()
            .map(|i| match i {
                Value::Num(n) => *n,
                _ => f64::NAN,
            })
            .collect(),
        _ => vec![],
    }
}

fn num(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Num(n)) => *n,
        Some(Value::Str(s)) if s == "nan" => f64::NAN,
        _ => 0.0,
    }
}

fn text(v: Option<&Value>) -> String {
    match v {
        Some(Value::Str(s)) => s.clone(),
        _ => String::new(),
    }
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
        let (kind, arg) = line.split_once('\t').expect("corpus line is kind<TAB>json");
        let a = parse(arg);

        let value = match kind {
            "max" => js_num(chart_max(
                &nums(a.get("exp")),
                &nums(a.get("inc")),
                SeriesType::parse(&text(a.get("type"))),
            )),
            "x" => js_num(x_of(num(a.get("i")) as usize, num(a.get("n")) as usize)),
            "y" => js_num(y_of(num(a.get("v")), num(a.get("max")))),
            "line" => {
                let exp = nums(a.get("exp"));
                let inc = nums(a.get("inc"));
                let series = SeriesType::parse(&text(a.get("type")));
                let max = chart_max(&exp, &inc, series);
                let count = num(a.get("n")) as usize;
                let draw = |arr: &[f64]| {
                    polyline(arr, max, count)
                        .iter()
                        .map(|p| format!("{},{}", js_num(p.x), js_num(p.y)))
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                format!(
                    "max={} exp=[{}] inc=[{}]",
                    js_num(max),
                    draw(&exp),
                    draw(&inc)
                )
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
