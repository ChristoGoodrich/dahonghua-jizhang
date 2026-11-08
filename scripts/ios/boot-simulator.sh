#!/usr/bin/env bash
# Boot an iPhone simulator and print its UDID.
#
# The newest iOS runtime on the runner, and an iPhone 17 on it if there is
# one: 402×874 points, close to the Pixel 7 (412×915) the Android suite runs
# on. Otherwise the newest-named iPhone the runtime has.
set -euo pipefail
udid=$(xcrun simctl list devices available -j | python3 "$(dirname "$0")/pick-simulator.py")
xcrun simctl boot "$udid" >&2 || true   # already booted is fine
xcrun simctl bootstatus "$udid" -b >&2
echo "$udid"
