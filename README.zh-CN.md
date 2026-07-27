<div align="center">

<img src="assets/images/icon.png" width="112" alt="大红花记账 应用图标" />

# 大红花记账 · Red Blossom

**一款本地优先的个人记账应用，支持 iOS、Android 与网页端 —— 中英双语、默认离线、云同步可选。**

[![CI](https://github.com/ChristoGoodrich/dahonghua-jizhang/actions/workflows/ci.yml/badge.svg)](https://github.com/ChristoGoodrich/dahonghua-jizhang/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Expo SDK 56](https://img.shields.io/badge/Expo%20SDK-56-000020?logo=expo&logoColor=white)](https://docs.expo.dev/versions/v56.0.0/)
[![React Native 0.85](https://img.shields.io/badge/React%20Native-0.85-61DAFB?logo=react&logoColor=white)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Platforms](https://img.shields.io/badge/平台-iOS%20·%20Android%20·%20Web-lightgrey)](#)

[English](README.md) · **简体中文**

</div>

---

每记一笔，就开一朵花。「大红花」是小时候表现好才能拿到的那张贴纸 —— 这款应用把记账
变成同样的小小奖励：一笔一朵花，连续记账攒成连击，一个月下来长成一座花园。

花朵之下是一套完整的账本：账户、转账、多币种、预算、订阅、报销、借贷、净资产、统计
与 PDF 报表。**所有数据都在你自己的设备上。** 云同步、AI 记账、崩溃上报全部是可选项 ——
不填任何密钥，应用就完全不联网。

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
| **AI 记账** | 输入「午饭35」或「coffee 4.5」，点 ✨，金额、分类、收支方向和备注自动填好。可选功能，见 [AI_SETUP.md](AI_SETUP.md)。 |
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

- **账单导入** —— 支付宝、微信的 CSV/Excel 导出，包含它们的 GBK 编码（由生成的纯 JS 码表解码，因此在 Expo Go 中无需原生模块也能用），并会与已有数据做去重。
- **通知自动记账（Android）** —— 可选的通知监听器读取支付通知并解析，拿不准的条目会进入待确认队列，由你确认或忽略。
- **恢复** —— 既能读本应用的备份，也能读旧版应用的 v7 备份 JSON。

### 数据、隐私与安全

- **本地优先。** 所有数据通过 AsyncStorage 存在本机。不配置任何密钥时，数据不会离开设备。
- **可选云同步** —— Supabase，邮箱验证码登录，行级安全策略（RLS）确保每个用户只能读到自己的数据，多设备实时更新，删除通过墓碑标记（soft delete）同步。见 [SYNC_SETUP.md](SYNC_SETUP.md)。
- **备份** —— 手动或自动（每日/每周、限制份数、自动清理最旧的一份），可用 AES-256-GCM 加密。支持导出 CSV、Excel 与 JSON。
- **应用锁** —— 生物识别或设备密码，应用退到后台即重新上锁，认证出错时保持锁定（fail closed）。锁设置与密码永远不会上传。
- **金额隐私** —— 一个眼睛开关即可遮住汇总、资产与账户页上的所有金额。

### 外观与体验

- **中文 / English** 全应用双语，运行时可切换。
- **浅色与深色**，另有花朵主题（默认、海洋、森林、日落）。
- **桌面小组件** —— iOS 端 WidgetKit 预算小组件，Android 端 App Widget。
- **提醒** —— 每日记账提醒，以及周报（周日 20:00）与月报（每月 1 日 09:00）通知。
- 触感反馈、毛玻璃底栏、保存时的花瓣绽放动画。

## 快速开始

### 环境要求

- **Node.js 20+** 与 npm
- 一台真机或模拟器：大部分功能用 [Expo Go](https://expo.dev/go) 即可；生物识别弹窗、
  通知捕获与桌面小组件需要 development build。

### 安装与运行

```bash
git clone https://github.com/ChristoGoodrich/dahonghua-jizhang.git
```

```bash
cd dahonghua-jizhang && npm install
```

```bash
npx expo start
```

然后按 `i` 打开 iOS 模拟器、`a` 打开 Android 模拟器、`w` 打开网页版，或用 Expo Go 扫描二维码。

到这一步应用就已经完全可用了 —— 不需要注册、不需要密钥、不需要后端。

## 配置

把 [`.env.example`](.env.example) 复制为 `.env`，只填你想用的部分。所有变量都是可选的，
没配置的功能只会隐藏起来。

| 变量 | 启用的功能 | 指南 |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | 云同步与账号 | [SYNC_SETUP.md](SYNC_SETUP.md) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | 云同步与账号 | [SYNC_SETUP.md](SYNC_SETUP.md) |
| `EXPO_PUBLIC_AI_PROXY_URL` | 通过你自建的代理服务使用 AI 记账（**推荐**，大模型密钥留在服务端） | [AI_SETUP.md](AI_SETUP.md) |
| `EXPO_PUBLIC_MIMO_API_KEY` | 直连 MiMo 使用 AI 记账 —— **仅限个人自用构建**，密钥会被打进安装包 | [AI_SETUP.md](AI_SETUP.md) |
| `EXPO_PUBLIC_SENTRY_DSN` | 崩溃上报 | [sentry.io](https://sentry.io) |

改完 `.env` 后用 `npx expo start -c` 重启，清缓存后新值才会生效。

> `EXPO_PUBLIC_*` 变量会被**打进客户端包体**，任何安装了这个构建的人都能读到。Supabase 的
> anon key 本来就是给客户端用的（真正保护数据的是行级安全策略）；大模型密钥则不是 ——
> 请把它放在代理服务后面。任何绝不能公开的内容，放进已被 gitignore 的 `.env.local`。

## 项目结构

```
src/
  app/          expo-router 页面（基于文件的路由）
  features/     页面级组合：record、list、stats、budget、assets、me、nav…
  components/   共享组件与 ui/ 基础件（Btn、Chip、Icon、Rows、SheetShell）
  domain/       纯逻辑 —— 金额、周期、预算、统计、账单解析、洞察…
  store/        Legend-State 可观察状态、持久化与各领域的操作
  sync/         Supabase 认证、同步引擎、合并、推送调度、冲突日志
  ai/           提示词构建、结果归一化、客户端（设备上不存密钥）
  i18n/         zh/ 与 en/ 两套 JSON 文案
  theme/        设计 token 与主题 context
  util/         备份、加密、PDF、分享、触感、统计、Sentry、小组件
modules/        notif-capture —— Android 通知监听原生模块
plugins/        android-widget 配置插件（Kotlin provider 与布局）
WidgetExtension/ iOS WidgetKit 预算小组件（Swift）
supabase/       SQL 迁移、RLS 审计、ai-parse 边缘函数
e2e/            Detox 端到端测试
docs/           设计规格与阶段计划
```

`domain/` 刻意不依赖 React 与平台 API，这也是绝大多数测试能在纯 Node 环境下跑的原因。

## 脚本命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 启动 Expo 开发服务器 |
| `npm run ios` / `npm run android` | 构建并运行原生应用 |
| `npm run web` | 在浏览器中运行 |
| `npm test` | 运行 Jest 测试 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | 通过 `expo lint` 运行 ESLint |
| `npm run storybook` | 组件工作台，端口 6006 |
| `npm run e2e:build:ios` / `npm run e2e:test:ios` | 在 iOS 模拟器上跑 Detox |
| `npm run e2e:build:android` / `npm run e2e:test:android` | 在 Android 模拟器上跑 Detox |

## 测试与质量

**69 个测试套件、663 个测试全部通过**，同时 `tsc --noEmit` 无报错、ESLint 零 error。
每次 push 与 PR，CI 都会跑 lint、typecheck 和带覆盖率的测试，**行覆盖率低于 70% 直接判失败**。

```bash
npm test -- --coverage
```

测试放在被测代码同级的 `__tests__/` 目录里。领域逻辑直接测试；同步引擎则针对一个伪造的
Supabase 客户端测试，因此不配置任何密钥也能被完整执行到。

## 构建与发布

构建走 [EAS](https://docs.expo.dev/build/introduction/)，因此打 iOS 包也不需要 Mac。
完整流程（含应用商店提交与 OTA 更新）见 [RELEASE.md](RELEASE.md)。

```bash
eas build -p android --profile preview
```

仓库里已经配好两个 GitHub 工作流：

- **[build-apk.yml](.github/workflows/build-apk.yml)** —— 每次推送到 `main` 时构建可直接安装的 arm64 APK 并作为 artifact 上传。
- **[release.yml](.github/workflows/release.yml)** —— 打 `v*` 标签时，通过 EAS 构建并提交双平台（需要 `EXPO_TOKEN` secret）。

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 运行时 | Expo SDK 56、React Native 0.85、React 19.2，已启用 React Compiler |
| 路由 | expo-router，带类型化路由 |
| 状态 | Legend-State 可观察对象 + 显式的 AsyncStorage 读写循环 |
| 语言 | TypeScript，`strict: true` |
| 后端（可选） | Supabase —— Postgres、认证、实时、边缘函数 |
| 测试 | Jest + jest-expo、Detox、Storybook |
| 监控（可选） | Sentry |

## 文档

| 文档 | 内容 |
| --- | --- |
| [SYNC_SETUP.md](SYNC_SETUP.md) | 搭建 Supabase：表结构、迁移、邮箱验证码、密钥 |
| [AI_SETUP.md](AI_SETUP.md) | AI 记账的代理部署，以及直连密钥的替代方案 |
| [RELEASE.md](RELEASE.md) | EAS 构建、商店提交、OTA 更新、提交前检查清单 |
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
<sub>由 <a href="https://expo.dev">Expo</a> 驱动 🌺</sub>
</div>
