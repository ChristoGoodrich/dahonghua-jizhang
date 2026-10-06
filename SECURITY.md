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

- The Rust core, store and bridge — `rust/core`, `rust/store`, `flutter_app/rust_bridge`
- The Flutter app — `flutter_app/lib`
- The Android components — the notification listener and the home-screen widget,
  in `flutter_app/android/app/src/main/kotlin`
- Anything that makes the ledger leave the device without the user sending it,
  or that lets another app read it

### Where the ledger goes

This is what the app does today, stated so that a report can say where it differs.

- **The ledger stays on the phone**, in the app's own storage.
- **The network is used for two things.** Neither carries the ledger:

  1. **Exchange rates** — a currency pair and a date, to `api.frankfurter.app`
     and `api.exchangerate-api.com`. Nothing from the ledger is sent with the
     request.
  2. **AI, only if you turn it on** — off by default, and dead until the user
     enables it in 设置 and supplies their own key. Even then it only sends
     when they press something: the sentence typed for 一句话记账, the picture
     chosen for 拍小票, or the question asked for 问账本 — plus today's date
     and the category names, and nothing else. A question never carries the
     ledger's rows; it comes back as a query that is counted on the phone.
     The key lives in Android's encrypted store, not in the config, so it is
     in no backup, sync file or export.

  There is no account, no server and no cloud sync.
- **It leaves only when you send it** — 备份 → 导出, 同步's document, or a CSV
  export, each through the system share sheet to wherever you choose.
- **Android's cloud Auto Backup is turned off** (`data_extraction_rules.xml`,
  `backup_rules.xml`). Device-to-device transfer, where you move your data between
  two phones you are holding, is left on for Android 12 and later.
- **Backups can be sealed with a password.** An encrypted snapshot is
  AES-256-GCM over a PBKDF2-SHA256 key; without the password the file cannot
  be opened, and a wrong password is refused rather than half-restored. A
  plain snapshot is still plain JSON — treat an exported file the way you
  would treat the ledger itself. Sync documents are always plain: moving one
  between two phones is already the user carrying their own data.
- **The app lock uses the phone's own biometric or screen-lock credential**
  (`local_auth`). The app never sees or stores a fingerprint or a password.
- **Auto-capture reads notifications only from Alipay, WeChat and banks**, and
  only once you have granted notification access in system settings. Everything
  else is ignored and nothing else is stored.

### What is not a vulnerability

- Findings that need an already-compromised, rooted or jailbroken device, or
  physical access to an unlocked one.
- That an exported backup is readable by whoever has the file — see above.
- That a debug-signed build can be installed over itself. Release builds are signed
  with the project's own key; see `RELEASE.md`.

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

- Rust 内核、存储与桥接层 —— `rust/core`、`rust/store`、`flutter_app/rust_bridge`
- Flutter 应用 —— `flutter_app/lib`
- Android 组件 —— `flutter_app/android/app/src/main/kotlin` 中的通知监听和桌面小组件
- 任何让账本在用户没有主动发送的情况下离开手机,或能被其他 app 读到的问题

### 账本会去哪里

下面是 app 现在的实际行为。写清楚,是为了让报告能指出哪里和这里不一样。

- **账本留在手机上**,存在 app 自己的存储空间里。
- **联网只做两件事,两件都不带账本:**

  1. **取汇率** —— 一对币种和一个日期,发给 `api.frankfurter.app` 和
     `api.exchangerate-api.com`。请求里不带任何账本内容。
  2. **AI,而且只有你打开才有** —— 默认关闭;要在设置里打开并填入你自己的
     密钥才会工作。即便打开了,也只有你按下按钮时才会发:一句话记账里打的
     那句话、拍小票里选的那张图、问账本里问的那个问题 —— 再加上今天的日期
     和分类名称,没有别的。问账本永远不会把账本的行发出去;问题会变成一条
     查询,在手机上算完。密钥存在 Android 的加密存储里,不在配置中,因此
     不会出现在任何备份、同步文件或导出里。

  没有账号、没有服务器,也没有云同步。
- **只有你发送时它才会离开** —— 备份里的「导出」、同步生成的文件、CSV 导出,都经过系统的分享面板,发到你自己选的地方。
- **Android 的云端自动备份是关闭的**(`data_extraction_rules.xml`、`backup_rules.xml`)。设备之间的直接迁移(你在两台手里的手机之间搬自己的数据)在 Android 12 及以上保留开启。
- **备份可以设口令。** 加密快照用的是 AES-256-GCM，密钥由 PBKDF2-SHA256
  从口令导出；没有口令打不开，口令错了会拒绝，不会恢复一半。普通快照
  仍是明文 JSON —— 导出的文件请像对待账本本身一样对待。同步文件始终是
  明文：在两台手机之间搬它，本来就是你自己带着自己的数据走。
- **应用锁用的是手机自己的指纹或锁屏密码**(`local_auth`)。app 看不到、也不保存任何指纹或密码。
- **自动记账只读支付宝、微信和银行的通知**,而且要你先在系统设置里给了通知权限才会读。其余通知一律忽略,什么都不存。

### 不属于漏洞的情况

- 需要设备已被攻陷、已 root/越狱,或需要物理接触已解锁设备才能成立的问题。
- 拿到导出的备份文件就能读到内容 —— 见上文。
- 调试签名的包可以覆盖安装它自己。正式版用项目自己的密钥签名,见 `RELEASE.md`。
