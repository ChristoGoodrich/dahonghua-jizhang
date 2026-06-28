# Building & shipping 大红花记账

The app is built with **Expo**, so iOS builds happen **in the cloud (EAS)** — you
do **not** need a Mac. You do need developer accounts to publish to the stores.

## Accounts you'll need
- **Expo account** — free, <https://expo.dev>
- **Apple Developer Program** — US$99/yr, for the App Store
- **Google Play Console** — US$25 one-time, for Google Play

App identity is already set in `app.json`:
`ios.bundleIdentifier` / `android.package` = `com.dahonghua.app` (change if you like).

## One-time setup
```bash
npm i -g eas-cli
cd dahonghua-app
eas login
eas build:configure        # links the project to your Expo account
```

### Cloud sync keys (optional but recommended)
The Supabase URL + anon key are **public** (safe to embed). Either keep them in a
local `.env` (already read via `EXPO_PUBLIC_*`) and they'll be baked into the build,
or add them as EAS env vars in `eas.json` under each profile's `"env"`.

## Try it on a device first (fastest)
```bash
npx expo start            # scan the QR with Expo Go (most features work)
```
Expo Go can't run a few native-only pieces (biometric lock prompt UI, push
scheduling, future OCR). For those, build a **development client**:
```bash
eas build -p android --profile development
eas build -p ios     --profile development
```

## Internal test builds (shareable, no store)
```bash
eas build -p android --profile preview   # produces an installable .apk
eas build -p ios     --profile preview   # ad-hoc/internal distribution
```
Download the artifact from the link EAS prints (or the Expo dashboard) and install.

## Production store builds
```bash
eas build -p android --profile production   # .aab for Google Play
eas build -p ios     --profile production   # for App Store
```

## Submit to the stores
```bash
eas submit -p android --profile production   # needs a Play service-account JSON
eas submit -p ios     --profile production   # walks you through App Store Connect
```
First-time submission also needs store listings (screenshots, description, privacy
policy). Since data can sync to the cloud, both stores will ask about data
collection — declare: account email (auth) + the user's own financial entries,
stored under per-user row-level security, never shared. The on-device lock and
passcodes are never uploaded.

## OTA updates (after the first store release)
```bash
eas update --branch production --message "fix xyz"
```
Ships JS/asset changes without a new store review (native changes still need a build).

## Checklist before first submit
- [ ] Bump `version` in `app.json` (and let `autoIncrement` handle build numbers)
- [ ] Confirm `.env` Supabase keys are set (or sync stays off — that's fine for v1)
- [ ] `npx tsc --noEmit` and `npm test` are green
- [ ] Walk the app once on a real device (record → tabs → settings → export)
- [ ] Prepare store screenshots (the 4 tabs + a recap make good shots)
