# 参与贡献 · 大红花记账

感谢你愿意花时间。这里说明怎么把项目跑起来、什么样的改动在这里算好改动,以及怎么合并。

[English](CONTRIBUTING.md)

## 可以怎么帮忙

- **报告 bug** —— 用 bug 模板[开一个 issue](https://github.com/ChristoGoodrich/dahonghua-jizhang/issues/new/choose)。复现步骤比描述更有用。
- **提功能建议** —— 说清楚它解决什么问题,而不只是要做什么。
- **提交 PR** —— 小而专一的改动,比大而全的好审得多。

安全漏洞请**不要**开 issue,见 [SECURITY.md](SECURITY.md)。

## 结构,和唯一的规矩

Rust 内核加 Flutter 界面,只做 Android:

    rust/core                 领域逻辑 —— 纯函数,只有一个依赖(regex-lite)
    rust/store                SQLite,特意放在 core 之外
    flutter_app/rust_bridge   FFI 层(flutter_rust_bridge)
    flutter_app/lib           界面
    flutter_app/android/…     通知监听和桌面小组件

**`rust/core` 做决定;其余部分只负责传递和绘制。** 往界面里写逻辑之前先问一句:这件事如果有两份实现,会不会算出不一样的结果?会,就该放进 core。原因见 [AGENTS.md](AGENTS.md),里面也记下了每条规矩是踩了什么坑才定下来的。

## 环境

需要 Flutter SDK、stable Rust,以及带 NDK 的 Android SDK。Node 20+ 只用来跑检查脚本 —— app 里没有 JavaScript。

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cd flutter_app && flutter pub get
flutter run
```

不需要任何密钥或环境变量:app 联网只为了取汇率。Windows 上请把 `TEMP` 和 `TMP` 指到一个短路径(`C:\Temp\dahonghua-build`)—— Gradle 默认的那个路径太长,会让构建失败。

改了 `rust_bridge/src/api/` 里的函数,要重新生成 Dart 一侧:

```bash
cd flutter_app && flutter_rust_bridge_codegen generate
```

## 推送之前

下面这些 CI 都会跑,先自己跑一遍更好:

```bash
npm run rust:fmt && npm run rust:clippy && npm run rust:test
npm run bridge:fmt && npm run bridge:clippy
npm run goldens
npm run tests:check
cd flutter_app && flutter analyze && flutter test integration_test/all_test.dart
```

集成测试需要真机或模拟器。**没有设备的一次运行说明不了任何事** —— 相信绿色结果之前,先看有没有设备报错。

**`npm run goldens` 不是格式检查。** 它拿 core 去对照上线的 TypeScript 版给出过的 125,683 个答案。失败意味着 core 现在给出了用户从没见过的答案。该改的是 core;永远不要重新生成 golden —— 已经没有东西可以用来重新生成它们了。

## 代码约定

- **计算和判断放在 `rust/core`**,测试写在旁边。Dart 只做只有平台能做的事:时区、时钟、文件、网络,以及所有的界面文字。
- **两种语言一起写。** 界面文字就地写成 `zh ? '…' : '…'`,中英文在同一次改动里写完。
- **写 store 走 `store_mut()`**(能证明影响范围时用 `store_marked()`)。`store()` 故意是只读的,AGENTS.md 里写了是什么样的数据丢失让它变成这样的。
- **注释写"为什么"。** 代码本身已经说明它做了什么;注释要写的是背后的原因、约束或边界情况。
- **跟周围的代码保持一致**:命名、结构、注释的密度。

## 测试

- Rust 测试写在代码旁边的 `#[cfg(test)]` 模块里。
- 集成测试在 `flutter_app/integration_test/`,只有一个入口 `all_test.dart`。新加文件后重新运行 `node scripts/gen-all-tests.js`;忘了的话 `npm run tests:check` 会失败。
- 测试需要找到某个控件时,给它一个 `Key`。
- 每个 bug 修复都要带一个在修复前会失败的测试。
- **写完测试,把它覆盖的东西故意改坏,确认它真的会失败。** 这个项目里有三次,一个检查根本不可能失败,而每一次它看上去都是绿的。

## 亲眼看一看

`integration_test/tour.dart` 会把每个界面的日间和夜间模式都截图(真实的屏幕采集,毛玻璃也会渲染),存到 `flutter_app/build/tour/`:

```bash
cd flutter_app
flutter drive --driver=test_driver/tour.dart --target=integration_test/tour.dart -d <device>
```

任何视觉上的改动,改前改后各跑一次,把两组截图放进 PR。

## 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/),括号里写改动的范围:

```
feat(stats): the six sections the port dropped
fix(glass): every band of the scrim now fades in
fix(android): narrow abiFilters to the build's target platform
chore: remove the corpus generators nothing runs
```

用祈使语气,标题控制在 72 个字符左右。改动不是一眼能看懂的,就在正文里写清楚:哪里错了、怎么发现的、怎么确认修好了。

## Pull Request

1. 从 `main` 拉分支(`feat/…`、`fix/…`、`refactor/…`)。
2. 一个 PR 只做一件事;顺手的清理另开 PR。
3. 写清楚改了什么、为什么改、怎么验证的。
4. 视觉改动附上 tour 截图。
5. 学到了下一个人不这样就得吃亏才能学到的东西,更新 AGENTS.md;影响用户的改动,更新 CHANGELOG.md。

Review 是一次对话,不是一道关卡 —— 会有提问,也欢迎你提问。

## 行为准则

参与本项目须遵守[行为准则](CODE_OF_CONDUCT.md)。
