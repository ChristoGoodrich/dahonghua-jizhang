#!/usr/bin/env bash
# Use the newest released Xcode on a GitHub macOS runner.
#
# The runner image carries several and defaults to whichever it was built
# with. The newest SDK is the one the app should be built against (the App
# Store asks for the iOS 27 SDK from April 2027), and a beta is not a
# release, so betas are passed over.
set -euo pipefail
newest=$(ls -d /Applications/Xcode_*.app 2>/dev/null | grep -v -i beta | sort -V | tail -1 || true)
if [ -z "$newest" ]; then
  echo "no Xcode_*.app on this runner; keeping $(xcode-select -p)"
else
  sudo xcode-select -s "$newest"
fi
xcodebuild -version
