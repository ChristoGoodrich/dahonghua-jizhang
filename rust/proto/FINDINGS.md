# Phase 3 UI framework — what the probes actually showed

Two throwaway prototypes of the record sheet, one per candidate. They exist to
answer three questions and nothing else; layout polish would have told us
nothing.

**Both were measured on the same Android emulator** (Pixel 7, API 34, x86_64).
An earlier revision of this document measured Dioxus on the web target instead,
because its APK would not assemble here. That turned out to be a fixable local
problem rather than a wall; the Dioxus section below says what it actually was.

| Risk | Why it decides this |
| --- | --- |
| **Chinese IME** | Notes, category names and search all go through one. If composition does not work, the app does not work. |
| **柔光玻璃** | The material shipped in `src/theme/glass.ts` is built on a real backdrop blur, with a designed fallback for devices that cannot do it. |
| **Accessibility** | 42 files got `accessibilityLabel`/`accessibilityRole` in this same branch. If they do not reach the platform, that work evaporates. |

## Slint 1.17.1

Built with `cargo apk`, NDK 27.1, min SDK 26. Runs as `android.app.NativeActivity`.

### IME — works, including composition

This was the unknown, and the reason Slint was probed first: [the official Android
guide](https://docs.slint.dev/latest/docs/slint/guide/platforms/mobile/android/)
says nothing about input methods.

It works. `dumpsys input_method` shows a live connection through a real Android
view:

```
mCurrentEditorInfo:
  inputType=0x1 imeOptions=0x10000000
  initialSelStart=6 initialSelEnd=6
  packageName=com.dahonghua.proto.slint
mServedInputConnection=RemoteInputConnectionImpl{connection=SlintInputView$1@…
                        finished=false  isActive()=true}
```

`inputType=0x1` is `TYPE_CLASS_TEXT`, and the selection is reported back
correctly. Tapping letters on the soft keyboard produced a **candidate strip**
and **composing text rendered with composition styling** in the field — which is
exactly the mechanism Pinyin uses: compose, offer candidates, commit.

No Chinese IME is installed on the stock emulator image, so composition was
verified through Gboard's English path. That is the same `setComposingText`
call; a Chinese IME differs in its candidate source, not in its plumbing.

*(An earlier read of `dumpsys` showed `inputType=0x0` and looked alarming. Those
lines belonged to other windows. The app's own `mCurrentEditorInfo` is the one
that counts.)*

### 柔光玻璃 — the blur is not available

Slint has no backdrop blur. There is no equivalent of CSS `backdrop-filter` or
`expo-blur`: a surface can be translucent, but it cannot blur what is behind it.
On screen the glass panel reads as a flat translucent slab with a lit top edge.

In the material's own terms that is the **`wash` tier** — which is a designed,
shipping state, so this is a cost rather than a blocker. But the `full` tier
would have to be rebuilt as a hand-written shader pass: render the background to
a texture, blur it, sample it. That is real work on the app's most visible
surface.

Slint also has no colour-mix primitive, so `washColor`'s ambient pull would move
from the stylesheet into Rust and be pushed in as a property.

### Accessibility — does not reach Android

`accessible-role` and `accessible-label` were set on the amount display, the note
field and all twelve keypad keys. With `uiautomator` — itself an accessibility
client — attached to the running app:

```
topResumedActivity = com.dahonghua.proto.slint/android.app.NativeActivity
total nodes in the accessibility tree: 8
  android.widget.TextView  text="proto-slint"   ← the task label
  android.view.View        text=""  desc=""
  android.view.View        text=""  desc=""
  … five bare containers
```

Not one label, role or text from the UI. The entire rendered surface is two
anonymous `android.view.View` nodes. TalkBack would read nothing.

`accesskit` is in the dependency tree, but by way of the winit/desktop backend;
nothing appears to bridge it to Android's `AccessibilityNodeProvider`. No
documentation was found stating either way.

### Also observed

The `⌫` glyph (U+232B) rendered as a missing-glyph box. Slint's default font has
no coverage for it, so the app would need to bundle an icon font — not hard, but
the kind of thing that only turns up on device.

CJK text itself rendered correctly throughout.

## Dioxus 0.7.10

Built with `dx build --platform android`. Runs as `dev.dioxus.main.MainActivity`
hosting a `RustWebView`. 71 MB debug APK, five dex files, `lib/x86_64/libmain.so`.

### The build wall was a misdiagnosis

An earlier revision of this document said the APK could not be assembled here,
that this was "an environment wall, not a configuration problem", and that it
"was established rather than assumed". That was wrong, and the way it was wrong
is worth keeping.

The probe behind that claim tested two things — a plain loopback `Socket`, which
worked, and `Selector.open()`, which failed — and concluded that the JVM's NIO
socket pair was blocked. The symptom was real. The mechanism was invented,
because the stack trace was never read. It says:

```
Caused by: java.net.SocketException: Invalid argument: connect
  at sun.nio.ch.UnixDomainSockets.connect0(Native Method)
  at sun.nio.ch.PipeImpl$Initializer$LoopbackConnector.run(PipeImpl.java:132)
```

`UnixDomainSockets`, not TCP. Since JDK 16, `PipeImpl` on Windows reaches for an
**AF_UNIX** socket first and puts its socket file under the process's temp
directory. On this machine AF_UNIX files cannot be created inside
`%LOCALAPPDATA%\Temp`: `bind` reports success, no file appears, `connect`
returns `WSAEINVAL`, and deleting the phantom path fails with "the system cannot
access this file". The identical call in any other directory works.

```
%LOCALAPPDATA%\Temp   bind OK, file created = false, connect FAILED
C:\Temp\afunix        bind OK, file created = true,  connect OK
```

So the fix is one environment variable. `TEMP`/`TMP` steer that directory — the
`jdk.nio.channels.unixdomain.tmpdir` property does **not**, which is worth
recording because it is the setting one would reach for first.

With `TEMP` redirected, `Selector.open()` and `Pipe.open()` both succeed on JDK
17, JDK 21 and the Android Studio JBR alike, Gradle runs, and the APK assembles.
Nothing in this repository needed changing — but nothing about the environment
was unfixable either, which is the opposite of what the earlier text asserted.

### IME — works, including composition, and the composing text reaches the app

This was the one question left open, and the worry was specific: a *controlled*
input that rewrites `value` on every keystroke can break candidate selection
mid-composition, and Dioxus's input has that shape.

It does not break. Tapping `h`, `e`, `l` on the soft keyboard:

```
mInputShown=true
mCurrentEditorInfo: inputType=0xc0a1 imeOptions=0x12000002
  packageName=com.example.ProtoDioxus
mServedInputConnection=RemoteInputConnectionImpl{... isActive()=true
  mServedView=dev.dioxus.main.RustWebView{...}}
```

On screen: `Hel` **underlined** in the field — composing-text styling — with a
candidate strip reading `Hel | Hello | Help`. `inputType=0xc0a1` is
`TYPE_CLASS_TEXT` with the web-edit-text variation, against Slint's plain `0x1`.

The readback line, which is rendered from Rust state, showed `读回：「Hel」 长度 3`
**during** composition rather than only after commit. The composing text reaches
the app's own state live, and the hazard did not materialise.

As with Slint, no Chinese IME is installed on the stock emulator image, so
composition was exercised through Gboard's English path — the same
`setComposingText` mechanism Pinyin uses, differing in candidate source rather
than in plumbing. Both toolkits were held to that same standard.

### 柔光玻璃 — the full tier renders on device

Read from the live WebView over the Chrome DevTools Protocol:

```json
{ "backdropFilter": "blur(18px) saturate(1.2)",
  "background": "color(srgb 0.995608 0.991216 0.983529)",
  "supportsBackdropFilter": true,
  "supportsColorMix": true }
```

The blur Slint has no equivalent of is one CSS declaration, and `washColor`'s
ambient pull — which `src/theme/glass.ts` computes by hand and Slint would need
pushed in from Rust — is `color-mix` in the stylesheet.

**With one caveat that matters for this app's market.** That WebView is Chrome
113. `backdrop-filter` has shipped since Chrome 76 and is safe; `color-mix`
needs **Chrome 111+**, and on Android the WebView updates through Play Store,
which many devices in China do not have. `color-mix` is the fragile half. Not a
blocker — `glass.ts` already computes the pull itself, so the resolved value can
be passed in rather than delegated to CSS — but it should be computed, not
relied upon.

### Accessibility — reaches Android

`uiautomator`, itself an accessibility client, attached to the running app:

```
topResumedActivity = com.example.ProtoDioxus/dev.dioxus.main.MainActivity
total nodes in the accessibility tree: 31    (20 labelled)
  android.webkit.WebView   text="Dioxus app"
  android.widget.TextView  text="记一笔"
  android.widget.TextView  text="备注（在这里用中文输入法打字）"
  android.widget.EditText
  android.widget.Button    text="7" … text="0"     android.widget.Button text="退格"
```

Real roles rather than anonymous containers: a `Button` per keypad key, an
`EditText` for the note field, Chinese intact. Against Slint's eight nodes with
zero labels, this is the sharpest contrast in the comparison. The bridge is the
system WebView's own `AccessibilityNodeProvider` — platform behaviour rather
than a Dioxus feature, but behaviour that arrives for free where Slint's does
not arrive at all.

Worth noting against the earlier Slint finding: `退格` renders as text here,
where Slint's `⌫` glyph came out as tofu.

## Flutter 3.44.1 — measured to the same three standards

Added after the decision rather than before it, which is the wrong order and
worth admitting. The decision was taken on Xiaomi's precedent; these are the
readings that confirm it, on the same Pixel 7 / API 34 emulator as the other
two, driving the same soft keyboard through the same Gboard English path.

**IME — works, including composition, and the composing text reaches the app.**

```
mInputShown=true
mCurrentEditorInfo:
  inputType=0x8001 imeOptions=0x2000006
  packageName=com.dahonghua.flutter_app
mServedView=io.flutter.embedding.android.FlutterView{d87eebb …}
```

`hel` rendered underlined in the field with a `hel | hello | help` candidate
strip, and the readback line — rendered from Dart state, from a value Rust
returned — read `读回：「hel」 长度 3` *during* composition rather than after
commit.

*(The same trap as last time: other windows report `inputType=0x0` in the same
dump. Only the app's own `mCurrentEditorInfo` counts.)*

**柔光玻璃 — the full tier renders, natively.** `BackdropFilter` with
`ImageFilter.blur` over a gradient carrying four ledger rows: the content behind
is visibly blurred through the card, not merely tinted. No browser is involved,
so no `backdrop-filter` support question and no WebView version to worry about.

**Accessibility — reaches Android.** 36 nodes, 21 labelled:

```
android.widget.Button    desc='退格⏎⌫'    ← the Semantics label, then the glyph
android.widget.Button    desc='7⏎7' … desc='0⏎0'
android.widget.EditText
android.view.View        desc='备注（在这里用中文输入法打字）'
android.view.View        desc='金额⏎0'
```

Flutter routes `Semantics` through `contentDescription` where the Dioxus WebView
used `text`; TalkBack reads either. Against Slint's eight nodes with zero
labels, the same gap as before.

**And the fourth question, which is the one this architecture introduces.** The
line at the bottom of the screen is `tier=full intensity=30.0
alpha=0.9450000000000001` over `rgba(254, 253, 251, 0.9450000000000001)` — every
number computed in `dahonghua-core` and carried across FFI. The float is spelled
the way JavaScript spells it because `js_num` produced the string, which is the
same contract the parity corpus enforces. Fourteen integration tests run on the
device against the real cross-compiled `libdahonghua_bridge.so`, covering
strings, floats, enums in both directions, `Option`, and a struct.

**⌫ renders.** Slint's came out as tofu.

### Two things the scaffold needed before it would build

Neither is a Flutter problem; both are cargokit not having caught up, and both
are patched in the vendored copy rather than worked around.

* **`Project.exec()` was removed in Gradle 9.** `cargokit/gradle/plugin.gradle`
  still called it. Replaced with an injected `ExecOperations`, which is the
  supported replacement and exists from Gradle 6, so the patch works on both.
* **The cargokit Android module pinned `compileSdkVersion 33`**, which AGP
  rejects against an app compiling at 36. It now follows the app rather than a
  hardcoded number.

The `TEMP` redirect from the Dioxus section is needed here too, and confirming
that was worth the build: Flutter's Gradle hits the same AF_UNIX wall, and the
same one-variable fix carries it through.

## Where this leaves the decision

All three measured on the same emulator, by the same method:

| | Slint | Dioxus | Flutter |
| --- | --- | --- | --- |
| Chinese IME, with composition | works | works, composing text reaches app state | works, composing text reaches app state |
| 柔光玻璃 `full` tier | **no blur at all** | renders, in a WebView | renders, natively |
| Accessibility on Android | **0 of 8 labelled** | 20 of 31 | 21 of 36 |
| Rendering | Skia, native | web engine | Impeller / Skia, native |
| UI language | Rust | Rust | **Dart** |

**Flutter**, with the Rust core underneath — the shape Xiaomi shipped for Weather
and Gallery.

Slint fails two of three, and both failures are floors rather than polish items:
a branch that labelled 42 files of icon-only controls cannot ship on a toolkit
where those labels reach nothing, and the blur is the app's most visible surface.

Dioxus clears all three and would have been a workable answer. It loses on the
row that has no column of its own above: it draws into a WebView, so the engine
rendering this app is one the app does not ship and cannot pin, on a market where
many devices have no Play Store to update it.

Two things to be clear-eyed about before treating this as settled.

**The UI is Dart.** "Rust rewrite" now means what it means at Xiaomi: the logic,
the money, the calendar, the ledger, the sync and the material's arithmetic are
Rust; the widget tree is not. Anyone expecting a single-language codebase should
read that twice, because it is the whole trade.

**One device.** Everything above is one x86_64 emulator, API 34. Flutter's own
engine ships inside the APK, which removes the fragmentation question that the
WebView answer carried — but it does not make one device into a fleet.

### Reproducing

```bash
# Slint
cd rust/proto/slint && cargo apk build --lib
adb install -r -t target/debug/apk/proto-slint.apk
```

```bash
# Flutter — the one that ships. TEMP as below; see the AF_UNIX section.
cd flutter_app
TEMP='C:\Temp\dahonghua-build' TMP='C:\Temp\dahonghua-build' flutter build apk --debug --target-platform android-x64
flutter test integration_test/bridge_test.dart -d emulator-5554
```

```bash
# Dioxus — TEMP must point somewhere AF_UNIX sockets can be created; see above
mkdir -p /c/Temp/dahonghua-build
cd rust/proto/dioxus && TEMP='C:\Temp\dahonghua-build' TMP='C:\Temp\dahonghua-build' dx build --platform android --features mobile
```

```bash
adb install -r rust/proto/dioxus/target/dx/proto-dioxus/debug/android/app/app/build/outputs/apk/debug/app-debug.apk
```
