//! Slint probe for the Phase 3 UI decision. See ui/record.slint.
//!
//! Built as a cdylib so cargo-apk can wrap it; `android_main` is the entry
//! point the Android activity calls.

slint::include_modules!();

/// Desktop entry point, used by src/bin/desktop.rs.
pub fn run_desktop() -> Result<(), slint::PlatformError> {
    build()?.run()
}

fn build() -> Result<RecordSheet, slint::PlatformError> {
    let ui = RecordSheet::new()?;
    let weak = ui.as_weak();
    ui.on_key_pressed(move |k| {
        let ui = weak.unwrap();
        let mut amount = ui.get_amount().to_string();
        if k == "back" {
            amount.pop();
        } else {
            amount.push_str(&k);
        }
        ui.set_amount(amount.into());
    });
    Ok(ui)
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
fn android_main(app: slint::android::AndroidApp) {
    slint::android::init(app).unwrap();
    build().unwrap().run().unwrap();
}
