//! 下月预测 across the boundary: `core::forecast` over the ledger, with each
//! category named — the user's own included — for the screen to draw.

use dahonghua_core::catalog;
use dahonghua_core::entry::Io;
use dahonghua_core::forecast;
use flutter_rust_bridge::frb;

use super::day::parse_day;
use super::store::settings_of;

/// One category's line, read one cycle on.
#[derive(Debug, Clone, PartialEq)]
pub struct CatForecastView {
    pub cat: String,
    pub name: String,
    pub emoji: String,
    /// `#RRGGBB`.
    pub color: String,
    pub predicted: f64,
    /// Its part of the whole forecast, 0..=1, for the bar.
    pub share: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ForecastView {
    /// Any of the three cycles before this one spent anything.
    pub enough: bool,
    pub predicted: f64,
    /// 0..=1.
    pub confidence: f64,
    /// `increasing`, `decreasing` or `stable`.
    pub trend: String,
    pub breakdown: Vec<CatForecastView>,
}

/// The cycle after the one `today` is in, from the three before it.
///
/// `ids` and `days_of` are every live entry and its local day, as for 统计;
/// the cycle start is the setting, so the three cycles are 明细's.
#[frb(sync)]
pub fn next_cycle_forecast(
    ids: Vec<String>,
    days_of: Vec<String>,
    today: String,
    zh: bool,
) -> ForecastView {
    let custom = super::catalog::custom_cats_of(Io::Exp);
    let rows = super::statement::dated(&ids, &days_of);
    let f = forecast::forecast(&rows, settings_of().cycle_start, parse_day(&today));
    let whole = f.predicted;
    ForecastView {
        enough: f.enough,
        predicted: f.predicted,
        confidence: f.confidence,
        trend: f.trend.as_str().to_string(),
        breakdown: f
            .breakdown
            .into_iter()
            .map(|b| {
                let c = catalog::cat_of(Io::Exp, &b.cat, &custom);
                CatForecastView {
                    name: catalog::cat_name(&c, zh),
                    emoji: c.e.clone(),
                    color: c.c.clone(),
                    share: if whole > 0.0 {
                        (b.predicted / whole).clamp(0.0, 1.0)
                    } else {
                        0.0
                    },
                    predicted: b.predicted,
                    cat: b.cat,
                }
            })
            .collect(),
    }
}
