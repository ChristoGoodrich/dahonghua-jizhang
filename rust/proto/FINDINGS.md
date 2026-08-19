# Phase 3 UI framework — what the probes actually showed

Two throwaway prototypes of the record sheet, one per candidate, built and run
on a real Android emulator (Pixel 7, API 34, x86_64). They exist to answer three
questions and nothing else. Layout polish would have told us nothing.

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

## Dioxus

*Pending — the CLI is still building.*

## Where this leaves the decision

The question Slint was probed to answer, it passed: the IME works, and that had
been the strongest argument against it.

What it failed is the one that was assumed safe. An app that spent this same
branch labelling every icon-only control for screen readers cannot ship on a
toolkit where those labels reach nothing. That is not a polish item to revisit
later; it is a floor.

Dioxus has to be measured on the same three points before this is called — the
whole reason for prototyping was to stop arguing from documentation.
