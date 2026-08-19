# Phase 3 UI framework — what the probes actually showed

Two throwaway prototypes of the record sheet, one per candidate. They exist to
answer three questions and nothing else; layout polish would have told us
nothing.

**They were not measured on equal ground, and the difference matters.** Slint
ran on a real Android emulator (Pixel 7, API 34, x86_64). Dioxus could not:
assembling its APK needs Gradle, and Gradle cannot open a loopback socket in
this environment, so it was measured on the web target instead. Every claim
below says which.

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

The Rust side builds for Android cleanly (485/485 crates). **The APK does not
assemble in this environment**, and not for any reason to do with Dioxus:

```
java.io.IOException: Unable to establish loopback connection
  at sun.nio.ch.PipeImpl$Initializer$LoopbackConnector.run
Caused by: java.net.SocketException: Invalid argument: connect
```

The JVM cannot open its own internal NIO pipe over loopback, so Gradle cannot
talk to its worker. Slint got past this only because `cargo apk` drives the
Android build tools directly and never starts Gradle. Dioxus needs Gradle
because its Android app is a real Activity hosting a WebView, with Kotlin
sources to compile.

**This is an environment wall, not a configuration problem**, and that was
established rather than assumed. Forcing IPv4 in the daemon's own `jvmargs` and
switching to the Android Studio JBR both failed identically. A ten-line probe
isolates it:

```
plain loopback TCP:            OK      ← which is why adb works at all
NIO Selector.open (PipeImpl):  FAILED  ← exactly what Gradle needs
```

Ordinary loopback sockets connect fine; the JVM's NIO `SocketChannel` pair does
not. `PipeImpl` uses the latter. No Gradle or JDK setting reaches that, so the
Dioxus APK has to be assembled somewhere else — nothing in this repository
needs changing for it.

So Dioxus was measured on the **web** target instead — same renderer family as
the Android WebView, which answers two of the three questions directly and
leaves the third genuinely open.

### 柔光玻璃 — the full tier renders

```
backdrop-filter : blur(18px) saturate(1.2)      ← live
background      : color(srgb 0.9956 0.9912 0.9835)   ← color-mix resolved
border          : 0.67px rgba(255,255,255,0.65)
radius          : 26px,  ::before sheen present
```

The blur Slint has no equivalent of is one CSS declaration here, and
`washColor`'s ambient pull — which `src/theme/glass.ts` computes by hand and
Slint would need pushed in from Rust — is `color-mix` in the stylesheet.

### Accessibility — every label present

Read through the browser's accessibility API, the same class of API TalkBack
consumes:

```
textbox "备注"     button "7" … "0"     button "退格"     div aria-label="金额"
```

Fourteen labelled nodes, Chinese intact. Against Slint's eight anonymous ones,
this is the sharpest contrast in the whole comparison.

On Android the DOM is exposed to TalkBack by the system WebView's own
`AccessibilityNodeProvider` — platform behaviour rather than a Dioxus feature —
but that step was **not measured here**, because the APK never assembled.

### IME — not measured, and the one thing left open

Chinese text round-trips through the controlled input correctly (`午饭 麻辣烫`,
6 characters, read back intact). That is not the same as IME composition.

Driving a synthetic `compositionstart`/`compositionupdate`/`compositionend`
sequence did **not** update the readback. That is weak evidence either way —
synthetic composition events are a poor imitation of a real IME — but it points
at a real and well-known hazard: a *controlled* input that rewrites `value` on
every keystroke can break candidate selection mid-composition. React has this
bug class; Dioxus's controlled input has the same shape.

Slint was measured on device and **passed** this. Dioxus has not been measured
on device at all. That asymmetry is the honest state of the comparison, and it
is the one thing worth spending more time on before committing.

## Where this leaves the decision

Slint failed the risk that was assumed safe and passed the one everyone worried
about. A branch that just labelled 42 files of icon-only controls cannot ship on
a toolkit where those labels reach nothing — that is a floor, not a polish item.
Losing the blur on the app's most visible surface is a second real cost.

Dioxus clears both of those, and its component model means 9,209 lines of UI
move by translation rather than redesign. What it has not yet cleared is the
IME, on the platform that matters, for a Chinese-language ledger.

**Recommended next step, before committing to either:** assemble the Dioxus APK
somewhere Gradle can open a loopback socket, install a Pinyin IME on the
emulator, and type a note in both builds. That is a short experiment and it
closes the last open question. Until then this document says Dioxus is ahead on
two of three and untested on the third — not that the decision is made.

### Reproducing

```bash
# Slint — works here
cd rust/proto/slint && cargo apk build --lib
adb install -r -t target/debug/apk/proto-slint.apk

# Dioxus — needs an environment where Gradle can use loopback
cd rust/proto/dioxus && dx build --platform android --device

# Dioxus on the web, which is what was measured
cd rust/proto/dioxus && dx serve --platform web
```
