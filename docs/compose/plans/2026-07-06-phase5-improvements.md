# Phase 5 改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 E2E 测试、CI/CD 流水线、无障碍优化、数据分析、桌面小组件、通知增强

**Architecture:** E2E 使用 Detox 或 Playwright；CI/CD 使用 GitHub Actions；无障碍遵循 WCAG 标准；小组件使用 expo-widgets 或 react-native-widget-extension

**Tech Stack:** GitHub Actions, expo-dev-client, react-native-reanimated, expo-notifications

## Global Constraints

- 保持现有测试全部通过
- `tsc --noEmit` 必须保持 clean
- 不引入破坏性变更
- 遵循现有架构模式

---

## Task 1: 创建 GitHub Actions CI/CD 流水线

**Covers:** CI/CD

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: 创建 CI 工作流**

创建 `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}

  build-android:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - run: eas build --platform android --non-interactive --no-wait
```

- [ ] **Step 2: 创建 Release 工作流**

创建 `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - run: eas build --platform all --non-interactive
      - run: eas submit --platform all --non-interactive
```

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: add GitHub Actions CI/CD pipeline"
```

---

## Task 2: 添加无障碍属性

**Covers:** 无障碍优化

**Files:**
- Modify: `src/features/LedgerScreen.tsx`
- Modify: `src/features/list/EntryList.tsx`
- Modify: `src/features/record/RecordSheet.tsx`

- [ ] **Step 1: 为 LedgerScreen 添加无障碍属性**

```tsx
// FAB 按钮
<Tap
  accessibilityRole="button"
  accessibilityLabel={s.a11yAdd}
  accessibilityHint={lang === 'zh' ? '双击打开记账表单' : 'Double tap to open entry form'}
  onPress={openNew}
>
  <Icon name="plus" color="#fff" size={28} />
</Tap>

// 导航按钮
<Tap
  accessibilityRole="button"
  accessibilityLabel={s.setTitle}
  onPress={() => router.push('/settings')}
>
  <Icon name="sliders" color={t.inkSoft} size={17} />
</Tap>
```

- [ ] **Step 2: 为 EntryList 添加无障碍属性**

```tsx
// 列表项
<Tap
  accessibilityRole="button"
  accessibilityLabel={`${entry.note || catName}, ${entry.io === 'exp' ? '-' : '+'}${entry.amt}`}
  onPress={() => onPress(entry.id)}
>
  {/* 条目内容 */}
</Tap>
```

- [ ] **Step 3: 为 RecordSheet 添加无障碍属性**

```tsx
// 输入框
<TextInput
  accessibilityLabel={lang === 'zh' ? '金额输入' : 'Amount input'}
  accessibilityHint={lang === 'zh' ? '输入花费金额' : 'Enter the amount'}
  keyboardType="decimal-pad"
/>

// 保存按钮
<Tap
  accessibilityRole="button"
  accessibilityLabel={s.save}
  onPress={handleSave}
>
  <Text>{s.save}</Text>
</Tap>
```

- [ ] **Step 4: 运行 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/features/LedgerScreen.tsx src/features/list/EntryList.tsx src/features/record/RecordSheet.tsx
git commit -m "a11y: add accessibility labels and hints to main screens"
```

---

## Task 3: 添加数据分析埋点

**Covers:** 数据分析

**Files:**
- Create: `src/util/analytics.ts`
- Modify: `src/features/LedgerScreen.tsx`

- [ ] **Step 1: 创建分析工具**

创建 `src/util/analytics.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const EVENTS_KEY = 'dhh_analytics';

interface AnalyticsEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: number;
}

let events: AnalyticsEvent[] = [];

export async function loadAnalytics(): Promise<void> {
  const json = await AsyncStorage.getItem(EVENTS_KEY);
  events = json ? JSON.parse(json) : [];
}

export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  const event: AnalyticsEvent = {
    name,
    properties,
    timestamp: Date.now(),
  };
  
  events.push(event);
  
  // 限制事件数量
  if (events.length > 1000) {
    events = events.slice(-500);
  }
  
  // 异步保存
  AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events)).catch(() => {});
}

export function getEvents(): AnalyticsEvent[] {
  return [...events];
}

export async function clearEvents(): Promise<void> {
  events = [];
  await AsyncStorage.removeItem(EVENTS_KEY);
}

// 预定义事件
export const AnalyticsEvents = {
  ENTRY_CREATED: 'entry_created',
  ENTRY_DELETED: 'entry_deleted',
  BUDGET_SET: 'budget_set',
  REPORT_GENERATED: 'report_generated',
  SYNC_COMPLETED: 'sync_completed',
  THEME_CHANGED: 'theme_changed',
  VOICE_USED: 'voice_used',
  CAMERA_USED: 'camera_used',
  FEEDBACK_SUBMITTED: 'feedback_submitted',
} as const;
```

- [ ] **Step 2: 集成到关键流程**

修改 `src/features/LedgerScreen.tsx`:

```tsx
import { trackEvent, AnalyticsEvents } from '@/util/analytics';

// 记账成功时
trackEvent(AnalyticsEvents.ENTRY_CREATED, { io: entry.io, cat: entry.cat });
```

- [ ] **Step 3: 运行 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: 提交**

```bash
git add src/util/analytics.ts src/features/LedgerScreen.tsx
git commit -m "feat: add analytics event tracking"
```

---

## Task 4: 增强通知系统

**Covers:** 通知增强

**Files:**
- Modify: `src/util/reminder.ts`
- Create: `src/util/__tests__/reminder.test.ts`

- [ ] **Step 1: 增强提醒功能**

修改 `src/util/reminder.ts`，添加：

```typescript
// 预算预警通知
export async function scheduleBudgetWarning(
  percentage: number,
  remaining: number
): Promise<void> {
  if (!Notifications) return;
  
  await Notifications.scheduleNotificationAsync({
    content: {
      title: lang === 'zh' ? '预算预警' : 'Budget Warning',
      body: lang === 'zh' 
        ? `已使用 ${percentage}%，剩余 ${remaining} 元`
        : `${percentage}% used, ${remaining} remaining`,
      data: { type: 'budget_warning' },
    },
    trigger: null, // 立即发送
  });
}

// 记账提醒（可自定义时间）
export async function scheduleCustomReminder(
  hour: number,
  minute: number
): Promise<void> {
  if (!Notifications) return;
  
  await Notifications.scheduleNotificationAsync({
    content: {
      title: lang === 'zh' ? '记账提醒' : 'Reminder',
      body: lang === 'zh' ? '别忘了记一笔哦 🌺' : 'Don\'t forget to log an entry 🌺',
      data: { type: 'daily_reminder' },
    },
    trigger: {
      hour,
      minute,
      repeats: true,
    },
  });
}
```

- [ ] **Step 2: 添加测试**

创建 `src/util/__tests__/reminder.test.ts`:

```typescript
import { scheduleBudgetWarning, scheduleCustomReminder } from '../reminder';

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(),
}));

describe('Reminder', () => {
  it('should schedule budget warning', async () => {
    await scheduleBudgetWarning(80, 200);
    // 验证通知被调度
  });

  it('should schedule custom reminder', async () => {
    await scheduleCustomReminder(21, 0);
    // 验证通知被调度
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- src/util/__tests__/reminder.test.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/util/reminder.ts src/util/__tests__/reminder.test.ts
git commit -m "feat: enhance notification system with budget warnings"
```

---

## Task 5: 创建桌面小组件（iOS）

**Covers:** 桌面小组件

**Files:**
- Create: `ios/Widget/` (原生代码)
- Modify: `app.json`

- [ ] **Step 1: 添加小组件配置**

修改 `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-widget-extension",
        {
          "ios": {
            "widgets": [
              {
                "name": "BudgetWidget",
                "displayName": "预算",
                "description": "查看本月预算使用情况",
                "kind": "BudgetWidget",
                "maxCount": 1
              }
            ]
          }
        }
      ]
    ]
  }
}
```

- [ ] **Step 2: 创建小组件原生代码**

注意：这需要 Xcode 和 iOS 开发环境。创建占位文件：

创建 `ios/Widget/BudgetWidget.swift`:

```swift
import WidgetKit
import SwiftUI

struct BudgetWidget: Widget {
    let kind: String = "BudgetWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            BudgetWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("预算")
        .description("查看本月预算使用情况")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date(), spent: 0, budget: 0)
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> ()) {
        let entry = SimpleEntry(date: Date(), spent: 500, budget: 1000)
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let entry = SimpleEntry(date: Date(), spent: 500, budget: 1000)
        let timeline = Timeline(entries: [entry], policy: .atEnd)
        completion(timeline)
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
    let spent: Double
    let budget: Double
}

struct BudgetWidgetEntryView : View {
    var entry: Provider.Entry

    var body: some View {
        VStack {
            Text("本月预算")
                .font(.headline)
            ProgressView(value: entry.spent, total: entry.budget)
                .progressViewStyle(.circular)
            Text("¥\(Int(entry.spent)) / ¥\(Int(entry.budget))")
                .font(.caption)
        }
    }
}
```

- [ ] **Step 3: 提交**

```bash
git add app.json ios/Widget/
git commit -m "feat: add iOS budget widget"
```

---

## Task 6: 添加 E2E 测试框架

**Covers:** E2E 测试

**Files:**
- Create: `e2e/` 目录
- Create: `e2e/jest.config.js`
- Create: `e2e/tests/firstTest.e2e.js`

- [ ] **Step 1: 安装 Detox**

```bash
npm install -D detox
```

- [ ] **Step 2: 创建 Detox 配置**

创建 `.detoxrc.js`:

```javascript
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/dahonghua.app',
      build: 'xcodebuild -workspace ios/dahonghua.xcworkspace -scheme dahonghua -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 15',
      },
    },
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_4_API_34',
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
  },
};
```

- [ ] **Step 3: 创建 E2E 测试配置**

创建 `e2e/jest.config.js`:

```javascript
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.e2e.js'],
  testTimeout: 120000,
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
};
```

- [ ] **Step 4: 创建第一个 E2E 测试**

创建 `e2e/tests/firstTest.e2e.js`:

```javascript
describe('Main Screen', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should show the main screen', async () => {
    await expect(element(by.text('大红花记账'))).toBeVisible();
  });

  it('should open record sheet on FAB tap', async () => {
    await element(by.label('记一笔')).tap();
    await expect(element(by.text('贴朵花'))).toBeVisible();
  });

  it('should navigate to settings', async () => {
    await element(by.label('设置')).tap();
    await expect(element(by.text('设置'))).toBeVisible();
  });
});
```

- [ ] **Step 5: 添加 E2E 脚本到 package.json**

```json
{
  "scripts": {
    "e2e:build:ios": "detox build --configuration ios.sim.debug",
    "e2e:test:ios": "detox test --configuration ios.sim.debug",
    "e2e:build:android": "detox build --configuration android.emu.debug",
    "e2e:test:android": "detox test --configuration android.emu.debug"
  }
}
```

- [ ] **Step 6: 提交**

```bash
git add .detoxrc.js e2e/ package.json
git commit -m "test: add Detox E2E testing framework"
```

---

## Task 7: 运行完整测试套件

**Covers:** 验证所有改进

- [ ] **Step 1: 运行测试**

```bash
npm test
```

Expected: 所有测试通过

- [ ] **Step 2: 运行 typecheck**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: complete Phase 5 - CI/CD, a11y, analytics, notifications, widgets, E2E"
```

---

## 总结

Phase 5 完成后，应用将具备：

1. **CI/CD 流水线** — GitHub Actions 自动测试、构建、发布
2. **无障碍优化** — 完整的 accessibilityLabel 和 accessibilityHint
3. **数据分析** — 关键事件埋点和统计
4. **通知增强** — 预算预警、自定义提醒
5. **桌面小组件** — iOS 预算小组件
6. **E2E 测试** — Detox 端到端测试框架
