# Releasing

Tag a version and CI builds a signed APK and attaches it to a GitHub release.

```bash
git tag -a v1.1.0 -m "…"
git push origin v1.1.0
```

## Before you tag

- `npm run goldens` — the core still answers what the shipping app answered
- `npm run rust:test`, `npm run rust:clippy`, `npm run bridge:clippy`
- `cd flutter_app && flutter test integration_test/all_test.dart`
- Bump `version:` in `flutter_app/pubspec.yaml`. The part after `+` is the
  versionCode, and Android refuses an update whose versionCode did not increase.

## Signing

CI needs two secrets. Without them the build still succeeds, stamps
`-debugsigned` into the version name, and then **fails the release step on
purpose** — a debug-signed APK cannot be updated by a properly signed one, so
publishing one quietly is a mistake that surfaces months later.

| Secret | What |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the `.jks`, base64 encoded |
| `ANDROID_KEY_PROPERTIES` | the contents of `key.properties`, with `storeFile=android/keystore.jks` |

[flutter_app/android/README.md](flutter_app/android/README.md) covers making the
key, why `-validity 10000`, and why losing it ends the app's ability to update
under `com.dahonghua.app` forever.

## Installing over the old app

The React Native build published as `com.dahonghua.app` and was signed by EAS.
If that key is not available, Android refuses the update on a signature
mismatch and the path is uninstall, install, and carry the ledger across with
Settings → 导出. That export exists partly for this.
