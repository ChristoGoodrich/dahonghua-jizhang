<div align="center">

<img src="assets/images/icon.png" width="112" alt="大红花记账 图标" />

# 大红花记账 · Red Blossom

**一个离线优先的个人记账 App（Android），中英双语 —— 隐私不是靠承诺，是靠构造。**

[![CI](https://github.com/ChristoGoodrich/dahonghua-jizhang/actions/workflows/ci.yml/badge.svg)](https://github.com/ChristoGoodrich/dahonghua-jizhang/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust core](https://img.shields.io/badge/core-Rust-CE422B?logo=rust&logoColor=white)](rust/core)
[![Flutter](https://img.shields.io/badge/UI-Flutter-02569B?logo=flutter&logoColor=white)](flutter_app)

[English](README.md) · **简体中文**

</div>

---

每记一笔，开一朵花。大红花是小时候做得好会拿到的那个贴纸 —— 这个 App 把记账变成同样的
一点小奖励：一笔一朵花，连续记账有记录，一个月下来是一片花园。

花的底下是一个完整的复式账本：账户、转账、多币种、预算、订阅、报销、借贷、净资产、统计和
回顾。**所有东西都在你的手机上。** 它唯一联网的地方是汇率 —— 一个货币对和一个日期。两台
设备之间的同步是一个你自己搬运的文件，所以连那个也不会自己去任何地方。

## 怎么搭起来的

一个 **Rust 内核**决定一切：金额算术、预算周期、统计、账单日、两台设备之间的合并。
一个 **Flutter 界面**把它画出来，另外两个小的 Kotlin 组件处理只有 Android 能做的事 ——
读取支付通知，和桌面小组件。

规则是：**内核做决定，其余的只负责搬运和绘制。** 一个自己算答案的界面可能和 App 的其余
部分给出不同的结果，而那个答案恰恰是没人会想到去测的。

这个 App 在 2026 年之前是一个 React Native 应用。重写过程靠一套 parity 工具保持诚实：
每一个移植过的模块都要和线上的 TypeScript 跑同一份语料，并且答案必须完全一致。那
125,683 个答案被冻结在 [`rust/parity/golden/`](rust/parity/golden) 里，至今仍然守着每一次
提交 —— 每一行都出自当时真正在用户手上跑的代码。TypeScript 本身留在 `rn-final` 这个标签上。


## 目录

- [功能](#功能)
- [快速开始](#快速开始)
- [配置](#配置)
- [项目结构](#项目结构)
- [脚本命令](#脚本命令)
- [测试与质量](#测试与质量)
- [构建与发布](#构建与发布)
- [技术栈](#技术栈)
- [文档](#文档)
- [参与贡献](#参与贡献)
- [安全](#安全)
- [许可协议](#许可协议)

## 功能

### 记一笔

| | |
| --- | --- |
| **计算器键盘** | 直接输入 `12.5+8`，金额自己算好。 |
| **智能备注** | 按所选分类下的使用频率与时间新近度排序，把你最常写的备注做成一点即用的标签，无需任何配置。 |
| **补记** | 今天 / 昨天 / 前天快捷标签加日期选择器 —— 一笔账不必只能是「此刻」。 |
| **再记一笔** | 保存后不关闭面板，连着记几笔可以一气呵成；任何一笔也能复制成一笔今天的新账。 |
| **模板** | 把房租、通勤这类重复支出固定成键盘上方的标签。 |
| **转账** | 账户之间转账，支持手续费与优惠。 |
| **多币种** | 每笔账都带自己的币种与汇率。切换本位币时会真正换算条目、余额、资产、借贷、订阅、模板和预算，而不是只改个标签。 |
| **票据识别** | 拍一张小票，让模型把金额读出来。同样可选，配置方式相同。 |

### 手里的钱

- **账户** —— 余额、归档（从选择器中隐藏，但保留历史与余额）、信用卡账单日。
- **其他资产与负债** —— 房产、车辆、基金等手动记录的部分。
- **借贷** —— 借出与借入，支持分次还款。
- **净资产** —— 账户 + 资产 − 负债，汇成一个数字。
- **预算** —— 一个按月填满的「罐子」，可自定义周期起始日，含进度、预测与洞察提示。
- **订阅** —— 按月/按年自动入账并显示下次扣费日。扣费记录的 id 由（订阅、扣费时刻）推导得出，多设备并发也只会收敛成同一条，不会重复扣。
- **报销** —— 先标记为待报销，钱回来了再确认。
- **多账本、标签与子分类** —— 把工作与私人、或一次旅行与日常分开。

### 看懂数字

- **流水与日历** 两种视角看同一本账，支持搜索与筛选；点日历上的某天，记账面板会直接预填那天的日期。
- **统计** —— 分类环形图、六期趋势、按星期、按时段，日/周/月/半年/年切换，以及本月与上月同期对比。
- **洞察** —— 基于最近三个周期预测下个周期的支出，给出趋势方向、置信度与建议。
- **月度报表** —— 生成可分享的 PDF。
- **回顾与连击** —— 月度总结和连续记账天数。

### 把数据导进来

- **账单导入** —— 支付宝、微信的 CSV 导出，包含它们的 GBK 编码（GBK 码表移植进了内核），并会与已有数据做去重。
- **通知自动记账（Android）** —— 可选的通知监听器读取支付通知并解析，拿不准的条目会进入待确认队列，由你确认或忽略。
- **恢复** —— 既能读本应用的备份，也能读旧版应用的 v7 备份 JSON。

### 数据、隐私与安全

- **本地优先。** SQLite，由 Rust 内核拥有，一次只写改动的那一行。
- **应用锁** —— 生物识别或设备密码，App 一离开前台就重新上锁，遇到任何认证错误都**锁上**而不是放行。
- **余额隐私** —— 一个眼睛开关，把总览、资产、账户页上的所有金额遮住。

### 两台设备，没有服务器

同步是一个文件。App 写出一个文档，你把它放进任何一个会跟着你走的文件夹 —— 网盘、WebDAV、
U 盘都行 —— 另一台设备读它、**合并**、再写回去。两边都改过的同一笔，按最后修改时间逐字段
取舍；这边删掉的不会被带回来。

没有账号、没有服务器、没有凭据 —— 这也正是 manifest 里那句「唯一联网的地方是汇率」至今
仍然成立的原因。账本可能出现在网盘里，但那是因为**你**把它放进去的。

## 这个版本没有的

列在这里，是因为一个悄悄砍掉功能的 README 比一个说清楚的更糟。React Native 版有这些，
这一版没有。

| | 为什么 |
| --- | --- |
| **iOS 和 Web** | 没有 iOS 设备可测，发布一个没人跑过的二进制不算发布。 |
| **AI 记账、票据扫描** | 需要一个模型 API 密钥和一次网络往返，而计算器键盘两下就做完了同样的事。 |
| **云同步（Supabase）** | 换成了上面那个文件同步。合并逻辑是同一份代码，而且测得好得多。 |
| **备份加密** | 快照会写，但还没加密；这个 App 仍然**能读**旧版加密的备份。 |
| **PDF 月报** | 回顾作为一个屏幕是在的，渲染成 PDF 没有。 |
| **日历视图** | 明细列表和统计覆盖了它做的事。 |
| **xlsx 导出** | CSV 每个表格软件都认得，而写 xlsx 要给内核加一堆依赖，却没有任何决策在里面。 |


### 外观与体验

- **中文 / English** 全应用双语，运行时可切换。
- **浅色与深色**，另有花朵主题（默认、海洋、森林、日落）。
- **桌面小组件** —— Android 端预算 App Widget。
- **提醒** —— 每日记账提醒，以及周报（周日 20:00）与月报（每月 1 日 09:00）通知。
- 触感反馈、毛玻璃底栏、保存时的花瓣绽放动画。

## 快速开始

需要 Flutter SDK、装了 Android 目标的 Rust 工具链，以及一台 Android 设备或模拟器。
没有 Node 依赖要装 —— 这里剩下的脚本都是纯 Node，`node_modules` 已经不存在了。

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

cd flutter_app
flutter pub get
flutter run
```

`flutter run` 会顺带通过 cargokit 把 Rust 内核编译成你设备的 ABI。第一次会为每个目标从
源码编译 SQLite，比较慢；之后就不会了。

## 项目结构

```
rust/
  core/            领域逻辑。纯的，只有一个依赖（regex-lite）。
  store/           SQLite。特意放在 core 外面 —— 一个能碰硬盘的 crate，
                   它的答案就会取决于硬盘。
  parity/golden/   TypeScript 给过的 125,683 个答案，已冻结。
  MIGRATION.md     每一个决定为什么是那样做的。

flutter_app/
  lib/             界面，一个屏幕一个文件。
  rust_bridge/     FFI 层（flutter_rust_bridge）。自己独立的 cargo 项目。
  integration_test/  601 个测试。all_test.dart 一次构建跑完全部。
  android/…/kotlin/  通知监听服务和桌面小组件。
  tool/gen_icons.py  从 assets/images/ 生成图标和启动图。

scripts/           goldens、语料生成器、测试聚合器。
assets/images/     图标，和 Kotlin 小组件画的是同一份。
```

## 脚本命令

| 命令 | 作用 |
| --- | --- |
| `npm run goldens` | 内核 vs 125,683 个已记录的答案 |
| `npm run rust:test` | 764 个 Rust 测试 |
| `npm run rust:clippy` / `rust:fmt` | workspace 的 lint 和格式 |
| `npm run bridge:clippy` / `bridge:fmt` | 桥接层是独立的 cargo 项目 |
| `npm run tests:check` | `all_test.dart` 过期就报错 |
| `flutter test integration_test/all_test.dart` | 全套，约 5 分钟 |

## 测试与质量

三层，各自回答不同的问题。

**Rust 单元测试**证明内核做了作者以为它做的事。**Goldens** 证明它做的和当年发到用户手上
的 App 一样 —— 这是更强的断言，也是重写过程中真正抓到分歧的那一个（JavaScript 的
`Math.round` 遇到 .5 向 +∞ 取整，Rust 的 `f64::round` 向远离零的方向取整）。
**集成测试**在真实设备上跑，证明用它们搭起来的 App 是能用的。

golden 挂了意味着内核现在给出的答案，和当年发出去的 App 不一样。那不是格式问题，也**不能**
靠重新生成 goldens 来解决 —— 已经没有东西可以用来重新生成它们了。

这里的测试本身也要被检验：写完之后把它覆盖的东西弄坏，确认它会挂。这个项目里有三次，
某个检查被发现根本不可能失败，而每一次它看起来都是绿的。

## 构建与发布

```bash
cd flutter_app
flutter build apk --release
```

没有签名密钥时，release 构建会退回用 debug 密钥，并在版本号里盖上 `-debugsigned` ——
在 Android 的应用信息里能看到。装自己手机上没问题，别的都不行：debug 签名的 APK 之后
无法被正式签名的版本更新。[`flutter_app/android/README.md`](flutter_app/android/README.md)
写了怎么生成真正的密钥，以及弄丢它的代价。

debug 构建装成 `com.dahonghua.app.debug`，所以在手机上跑测试不会把你正在用的那个 App 卸掉。

## 技术栈

| 层 | 是什么 |
| --- | --- |
| 领域 | Rust 2021，一个依赖（`regex-lite`） |
| 存储 | SQLite，`rusqlite`，按 ABI 从源码编译 |
| 界面 | Flutter，`flutter_rust_bridge` 2.12 |
| Android | Kotlin：一个 `NotificationListenerService` 和一个 `RemoteViews` 小组件 |
| 同步 | 一个你自己搬运的文件。没有服务器、没有账号、没有凭据 |
| 平台 | Android。iOS 是主动放弃的 —— 见 AGENTS.md |


## 文档

| 文档 | 内容 |
| --- | --- |
| [rust/MIGRATION.md](rust/MIGRATION.md) | 重写为什么是那样做的，一个模块一个模块，包括先做错的那些 |
| [flutter_app/android/README.md](flutter_app/android/README.md) | 生成签名密钥，以及弄丢它的代价 |
| [RELEASE.md](RELEASE.md) | 打标签发版 |
| [DATA_MODEL_assets.md](DATA_MODEL_assets.md) | 账户、资产、借贷与净资产之间的关系 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
| [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) | 开发流程、提交与 PR 规范 |
| [SECURITY.md](SECURITY.md) | 如何报告安全漏洞 |

## 参与贡献

欢迎提 issue 和 PR。请先看 [贡献指南](CONTRIBUTING.zh-CN.md)
（[English](CONTRIBUTING.md)）了解流程；每个改动都需要保证 lint、typecheck 与测试全绿。
参与本项目即表示同意遵守[行为准则](CODE_OF_CONDUCT.md)。

## 安全

发现安全漏洞请**不要**开公开 issue —— 按 [SECURITY.md](SECURITY.md) 的方式私下报告。

## 许可协议

[MIT](LICENSE)。

<div align="center">
<sub>一个 Rust 内核、一个 Flutter 界面，没有服务器 🌺</sub>
</div>
