//! Run the Slint probe on the desktop, for a quick look at the material
//! without an Android round-trip. The IME question can only be answered on
//! the device.
fn main() {
    proto_slint::run_desktop().unwrap();
}
