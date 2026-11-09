#!/usr/bin/env bash
# That the built app carries its App Intents where Siri and Shortcuts look.
#
# An intent is only offered if Xcode extracted its metadata into the bundle
# (Metadata.appintents), and a build that failed to would say so nowhere a
# person reads: Flutter prints none of xcodebuild's output when the build
# succeeds. So the bundle is asked instead — both intents named in the
# metadata, and the zh-Hans strings and Siri phrases beside them.
#
# Usage: check-intents.sh path/to/Runner.app
set -euo pipefail
app=${1:?usage: check-intents.sh path/to/Runner.app}
meta="$app/Metadata.appintents"
if [ ! -d "$meta" ]; then
  echo "::error::no Metadata.appintents in $app: Siri and Shortcuts would not see the app's intents"
  exit 1
fi
for name in RecordEntryIntent RecordPaymentIntent; do
  if ! grep -rqa "$name" "$meta"; then
    ls -la "$meta"
    echo "::error::$name is not in $meta"
    exit 1
  fi
done
for f in Localizable AppShortcuts; do
  if [ ! -e "$app/zh-Hans.lproj/$f.strings" ]; then
    echo "::error::no zh-Hans.lproj/$f.strings in $app"
    exit 1
  fi
done
echo "App Intents: $(ls "$meta" | tr '\n' ' ')"
