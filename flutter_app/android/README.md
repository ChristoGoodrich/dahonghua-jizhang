# Signing a release build

The release build is signed with a key this repository does not contain and
never will. `key.properties` and `*.jks` are gitignored; a keystore in version
control is a keystore that has been published.

Without one, `flutter build apk --release` still works — it falls back to the
debug key and stamps the version as `1.0.0-debugsigned`, which you can see in
Android's app info. That is fine for putting the app on your own phone. It is not fine for anything else: an APK signed with the debug key
cannot later be updated by a properly signed one, because Android checks that
the signature matches and refuses when it does not.

## Which APK

`npm run apk` from the repository root, and send `app-arm64-v8a-release.apk`.
The three builds are the same app for three architectures; a phone loads one.

Do not go back to a plain `flutter build apk` afterwards. The split builds
carry an offset versionCode — arm64 is 2001, the universal build is 1 — and
Android refuses to install a lower versionCode over a higher one. The
universal APK will fail to install over a split one with a parse error, and
the only way past it is uninstalling.

## Making one

Run this yourself. It will ask for a password twice; that password is yours and
does not belong in a file anyone else can read.

```
keytool -genkey -v -keystore dahonghua.jks -keyalg RSA -keysize 2048 -validity 10000 -alias dahonghua
```

`-validity 10000` is about 27 years. That is not enthusiasm — Google Play
requires a key valid past 2033, and a key that expires is a key that can no
longer ship updates to an app people have installed.

Then put it somewhere outside this repository, and write
`flutter_app/android/key.properties`:

```
storePassword=<the password you just chose>
keyPassword=<the same one, unless you chose two>
keyAlias=dahonghua
storeFile=C:/path/to/dahonghua.jks
```

Forward slashes even on Windows — Gradle reads this as a properties file, where
a backslash escapes the next character.

## Losing it

There is no recovery. A lost keystore means the app can never be updated again
under `com.dahonghua.app`; a new key means a new package name, and every
installed copy becomes a separate app that no longer receives updates. Back it
up somewhere that is not this machine.

## The existing app

The React Native build published as `com.dahonghua.app` was signed by EAS, and
the Flutter build claims the same package name because it is the same app. If
the original key is not available, installing this over the old one will fail
with a signature mismatch — the path is then uninstall, install, and bring the
ledger across with the JSON backup that Settings → 导出 writes. That export
exists partly for this.
