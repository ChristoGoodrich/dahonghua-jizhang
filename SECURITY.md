# Security Policy · 安全政策

*[English](#english) · [简体中文](#简体中文)*

## English

### Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | ✅ |
| < 1.0 | ❌ |

Only the latest release on `main` receives security fixes.

### Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately, either way:

- **Preferred** — [GitHub private vulnerability reporting](https://github.com/ChristoGoodrich/dahonghua-jizhang/security/advisories/new)
- **Email** — christogoodrich@gmail.com

Helpful things to include: what you found, how to reproduce it, the affected version or
commit, the impact you think it has, and any suggested fix.

**What to expect**

| Stage | Target |
| --- | --- |
| Acknowledgement of your report | within 3 days |
| Initial assessment | within 7 days |
| Fix or a mitigation plan | within 30 days for confirmed issues |

You will be credited in the advisory and the changelog unless you'd rather not be. Please
give us a reasonable window to ship a fix before disclosing publicly.

### What is in scope

- The app source in `src/`, `modules/`, `plugins/` and `WidgetExtension/`
- The Supabase schema, row-level-security policies and migrations in `supabase/`
- The `ai-parse` edge function
- The backup encryption path (AES-256-GCM), the app-lock flow, and the sync engine

### What is not a vulnerability

- **The Supabase anon key or `EXPO_PUBLIC_*` variables being readable in a build.** They are client-side by design; row-level security is what protects the data. A *missing or bypassable RLS policy*, on the other hand, very much is a vulnerability — report it.
- **An LLM API key in a build you configured with `EXPO_PUBLIC_MIMO_API_KEY`.** That option is documented as personal-builds-only for exactly this reason; use the proxy for anything you distribute.
- Findings that require an already-compromised, rooted or jailbroken device, or physical access to an unlocked one.

### Handling your own data

The app stores your financial data locally. If you enable cloud sync, entries go to
*your* Supabase project under per-user row-level security. Passcode and biometric-lock
settings are never uploaded.

---

## 简体中文

### 支持的版本

| 版本 | 是否支持 |
| --- | --- |
| 1.0.x | ✅ |
| < 1.0 | ❌ |

只有 `main` 上的最新发布版本会收到安全修复。

### 如何报告漏洞

**请不要为安全问题开公开 issue。**

请通过以下任一方式私下报告：

- **推荐** —— [GitHub 私密漏洞报告](https://github.com/ChristoGoodrich/dahonghua-jizhang/security/advisories/new)
- **邮件** —— christogoodrich@gmail.com

报告中最好包含：你发现了什么、如何复现、受影响的版本或 commit、你认为的影响范围，以及
可能的修复建议。

**你可以期待的处理节奏**

| 阶段 | 目标时间 |
| --- | --- |
| 确认收到报告 | 3 天内 |
| 初步评估 | 7 天内 |
| 修复或缓解方案 | 已确认问题 30 天内 |

除非你希望匿名，我们会在安全公告与变更日志中致谢。在修复发布前，也请给我们一个合理的
时间窗口再公开披露。

### 属于范围内的部分

- `src/`、`modules/`、`plugins/`、`WidgetExtension/` 中的应用源码
- `supabase/` 中的表结构、行级安全策略与迁移脚本
- `ai-parse` 边缘函数
- 备份加密流程（AES-256-GCM）、应用锁流程与同步引擎

### 不属于漏洞的情况

- **构建包中能读到 Supabase anon key 或 `EXPO_PUBLIC_*` 变量。** 它们本来就是给客户端用的，真正保护数据的是行级安全策略。但**缺失或可被绕过的 RLS 策略**确实是漏洞 —— 请报告。
- **你自己用 `EXPO_PUBLIC_MIMO_API_KEY` 打的包里带有大模型密钥。** 该选项在文档中已明确标注仅限个人自用构建，原因正是如此；对外分发请使用代理方案。
- 需要设备已被攻陷、已 root/越狱，或需要物理接触已解锁设备才能成立的问题。

### 关于你的数据

应用把财务数据存在本地。开启云同步后，数据会进入**你自己的** Supabase 项目，并受按用户
隔离的行级安全策略保护。锁屏密码与生物识别相关设置永远不会上传。
