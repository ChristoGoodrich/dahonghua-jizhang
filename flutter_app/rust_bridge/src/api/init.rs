//! Bridge start-up.

/// Runs before any other call. `setup_default_user_utils` installs the panic
/// hook and logger, so a Rust panic surfaces in `adb logcat` instead of
/// vanishing into the FFI boundary.
#[flutter_rust_bridge::frb(init)]
pub fn init_app() {
    flutter_rust_bridge::setup_default_user_utils();
}
