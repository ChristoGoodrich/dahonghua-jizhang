# 为 大红花记账 · Red Blossom 做贡献

感谢你愿意花时间。这份文档说明如何把项目跑起来、这里认可什么样的改动，以及怎样让它被合并。

[English version](CONTRIBUTING.md)

## 你可以怎样帮忙

- **报告问题** —— 用 bug 模板[新建 issue](https://github.com/ChristoGoodrich/dahonghua-jizhang/issues/new/choose)。可复现的步骤远胜于一段描述。
- **提出需求** —— 用 feature 模板，并说明它解决的是什么问题，而不只是要做什么。
- **改进翻译** —— 所有面向用户的文案都在 `src/i18n/zh/` 与 `src/i18n/en/`，两边必须保持同步。
- **提交 PR** —— 小而聚焦的改动，比大而全的改动好审得多。

如果是安全漏洞，请**不要**开 issue —— 见 [SECURITY.md](SECURITY.md)。

## 开发环境

需要 Node.js 20+。

```bash
npm install
```

```bash
npx expo start
```

开发本身不需要任何环境变量：云同步、AI 记账、崩溃上报在没配密钥时都会保持隐藏。想开启
它们，见 [README](README.zh-CN.md#配置)。

**Expo SDK 56 改动很大。** 用到 Expo API 之前，请查阅对应版本的官方文档
<https://docs.expo.dev/versions/v56.0.0/> —— 旧教程和 56 之前的答案现在经常是错的。

## 提交前自检

三项都必须通过；CI 会跑同样的三项，并额外要求行覆盖率不低于 70%。

```bash
npm run lint && npm run typecheck && npm test
```

本地查看覆盖率：

```bash
npm test -- --coverage
```

## 代码约定

- **TypeScript，`strict: true`。** 生产代码里不要出现 `any`；类型确实无法确定时，请显式收窄。
- **保持 `src/domain/` 纯净。** 不引入 React、平台 API 和网络请求 —— 这正是大多数测试能在纯 Node 环境下运行的原因。页面和 hooks 负责组合这些逻辑，而不是重新实现一遍。
- **用 `@/` 别名导入**（如 `@/domain/money`），不要写一长串相对路径。
- **默认双语。** 任何用户可见的文案都要以同一个 key 同时写进 `src/i18n/zh/*.json` 和 `src/i18n/en/*.json` —— 不要在组件里硬编码文字。
- **注释解释「为什么」。** 代码本身已经说明了「做了什么」；注释的价值在于记录原因、约束或边界情况。
- **与所在文件保持一致** —— 命名、结构和注释密度都随周围代码。

## 测试

- 测试放在被测代码同级的 `__tests__/` 目录中，命名为 `*.test.ts(x)`。
- 每个 bug 修复都应带上一个「修复前会失败」的测试。
- 领域逻辑直接测试；涉及网络的部分用伪造对象测试 —— 参考 `src/sync/__tests__/engine.test.ts` 的写法。
- Detox 端到端测试在 `e2e/`；如果某个流程需要被它触达，请补上 `testID`。

## 提交信息

历史记录遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: add per-category budgets
fix: keep delete-undo from clobbering concurrent edits
refactor: split billImport.ts into billParse.ts and billDedup.ts
test: cover the subscription charge-id derivation
chore: bump expo to 56.0.12
docs: document the AI proxy contract
```

标题用祈使句，控制在 72 字符以内。改动不够一目了然时，在正文里说明理由。

## Pull Request

1. 从 `main` 拉分支（`feat/…`、`fix/…`、`refactor/…`）。
2. 一个 PR 只做一件事，无关的清理请另开 PR。
3. 按模板填写：改了什么、为什么改、怎么验证的。
4. 涉及界面的改动请附截图或一小段录屏。
5. 确保 lint、typecheck、测试全绿 —— CI 会检查，但别让它第一个发现问题。
6. 行为发生变化时，在同一个 PR 里更新文档；面向用户的改动请在 `CHANGELOG.md` 里补一条。

代码评审是交流而非关卡 —— 会有人提问，也欢迎你提问。

## 行为准则

参与本项目须遵守[行为准则](CODE_OF_CONDUCT.md)。请互相尊重。
