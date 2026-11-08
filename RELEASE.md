# Releasing

Tag a version and CI builds a signed APK and attaches it to a GitHub release.

```bash
git tag -a v1.1.0 -m "…"
git push origin v1.1.0
```

Or, from somewhere that cannot push a tag: Actions › Release › Run workflow,
on `main`, with the version (`v1.1.0`). That run makes the tag itself, on the
commit it built, and refuses a version that is already tagged. Run with no
version, it builds and publishes nothing.

Either way the version has to be the one `flutter_app/pubspec.yaml` says, and
`release-notes/<version>.md` has to exist — both are checked before the build.

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
| `ANDROID_KEY_PROPERTIES` | `storePassword=…`, `keyPassword=…` and `keyAlias=dahonghua`, one per line |

A `storeFile` line in the second is ignored: the workflow writes the key and
points `storeFile` at it. This table used to say `storeFile=android/keystore.jks`,
which Gradle reads relative to `android/app` and so pointed at nothing.

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

## On an iPhone

A release carries `dahonghua-ios-unsigned.ipa` beside the APK, built from the
same commit on one of GitHub's Macs (`ios.yml` builds the same file on every
push and keeps it as an artifact). iOS installs nothing unsigned, and there is
no paid developer account, so the person installing signs it with their own
Apple ID. On Windows that is [Sideloadly](https://sideloadly.io):

1. Install iTunes and iCloud from Apple's website — the Microsoft Store
   versions do not work with it — and then Sideloadly.
2. Connect the iPhone by cable and trust the computer.
3. On the iPhone, turn on 设置 › 隐私与安全性 › 开发者模式 (iOS asks for it before
   it will open an app signed this way) and restart when it asks.
4. Drag the `.ipa` into Sideloadly, enter the Apple ID, and start.
5. On the iPhone, trust the profile under 设置 › 通用 › VPN与设备管理.

A signature from a free Apple ID lasts **seven days**. After that the app does
not open until it is signed again; the ledger is still there. Signing the same
`.ipa` again with the same Apple ID installs over the app and keeps it, so a
re-sign is step 4 and nothing else. Sideloadly can do it unattended over Wi-Fi
while the computer is on.

Keep the Apple ID and the bundle id the same every time. iOS ties the app's
data to its bundle id, so a different one is a different app, which sees none
of the ledger. If Sideloadly says `com.dahonghua.app` is taken, give it one of
your own in its advanced options and use that one from then on.

Nothing the app keeps goes to iCloud (AGENTS.md, "The iPhone"), so the only
copy is the phone's: 我的 › 备份 › 导出 is how a copy leaves it.

### Bringing the ledger from Android

The iPhone app reads the Android app's snapshots: they are the same core.

1. On Android: 我的 › 备份, take a snapshot with ＋ **without a password** —
   a sealed one leaves its receipt photos behind — and 导出 it, with its photos.
2. Send the files to the iPhone: AirDrop does not reach Android, so a chat
   app's file transfer, mail or a network drive, saved into the Files app.
3. On the iPhone: 我的 › 备份 › 从文件恢复, and pick the snapshot and its photos.
