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
- Write `release-notes/v<version>.md`. It becomes the release's text, and the
  release workflow refuses a tag that has none before it builds anything.

CI's release workflow re-runs the core gate (goldens, unit tests, clippy) before
it builds. It does not re-run the emulator suite — that is what the push CI is
for, so tag a commit that is already green there.

## Which APK

CI runs `node scripts/build-apk.js`, the same script this repo tells a person
to run, and attaches **`app-arm64-v8a-release.apk`** — the split that goes on
a phone. Not the universal `app-release.apk`: that file is 67MB of three
copies of the same libraries, and its versionCode is **1** where the arm64
split is **2001**. Android refuses to install a lower versionCode over a
higher one, so a phone that once took the split can never be updated by the
universal — the way out is an uninstall, which on a debug-signed build takes
the ledger with it. The choice is made once and kept.

Local builds should use `npm run apk` for the same reason.

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

Nothing published before v1.1.0 was signed with the release key, so none of it
can be updated by a signed build. Android refuses on the signature mismatch,
and the way past is an uninstall, which deletes the ledger.

**A debug-signed Flutter build** — 设置 › 关于大红花 shows `-debugsigned` — carries
its ledger across with its own snapshot:

1. 我的 › 备份, take a snapshot with ＋, **without a password**. A sealed
   snapshot leaves its receipt photos in the app's own storage, which the
   uninstall empties.
2. 导出 that snapshot somewhere outside the app.
3. Uninstall, then install the signed build.
4. 我的 › 备份 › 从文件恢复, and pick the exported file, with its photos.

**v1.0.0, the React Native app**, cannot be carried across. Its release was
built by Gradle with React Native's template debug key, not by EAS. The only
way its data left the phone was 设置 › 导出备份 (JSON). That document keeps
its rows under `data`, not `entries`, so 从文件恢复 does not recognise it. When
v1.1.0 was cut nobody was on v1.0.0, so no importer was written. If that
changes, the document is `buildBackup()` in `src/store/state.ts` at the
`v1.0.0` tag.
