#!/usr/bin/env bash
# The iPhone release build, unsigned, packed as an .ipa.
#
# iOS installs nothing unsigned. Without a paid developer account the person
# installing signs this with their own Apple ID (Sideloadly or the like), so
# the build is left unsigned and an .ipa is just the app in a Payload folder,
# zipped. Run from the repository root, after `flutter pub get`.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/../../flutter_app"
flutter build ios --release --no-codesign
app=build/ios/iphoneos/Runner.app
test -d "$app" || { echo "::error::no $app after the build"; exit 1; }
"$here/check-intents.sh" "$app"
out=build/ios/dahonghua-ios-unsigned.ipa
stage=$(mktemp -d)
mkdir -p "$stage/Payload"
cp -R "$app" "$stage/Payload/"
rm -f "$out"
(cd "$stage" && zip -qry - Payload) > "$out"
rm -rf "$stage"
plist="$app/Info.plist"
echo "$out: $(du -h "$out" | cut -f1)," \
  "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" \
  "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")" \
  "($(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist"))"
