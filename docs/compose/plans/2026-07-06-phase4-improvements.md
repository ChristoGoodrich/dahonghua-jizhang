# Phase 4 改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化性能（启动时间、记账效率）、提升测试覆盖率至 80%+、添加用户反馈机制

**Architecture:** 使用 React Profiler 和 useMemo/useCallback 优化渲染；扩展测试覆盖到 UI 组件；添加反馈收集机制

**Tech Stack:** React Profiler, Jest, expo-haptics, AsyncStorage

## Global Constraints

- 保持现有测试全部通过
- `tsc --noEmit` 必须保持 clean
- 不引入破坏性变更
- 遵循现有架构模式

## 成功指标

| 指标 | 当前 | 目标 |
|------|------|------|
| 测试覆盖率 | ~60% | >80% |
| 启动时间 | ~2s | <1s |
| 记账耗时 | ~15s | <5s |

---

## 文件结构

### 新增文件
- `src/util/__tests__/haptics.test.ts` — 触觉反馈测试
- `src/util/__tests__/search.test.ts` — 搜索功能测试
- `src/features/list/__tests__/SwipeableRow.test.tsx` — 滑动行测试
- `src/features/record/__tests__/QuickEntry.test.tsx` — 快捷记账测试
- `src/features/record/__tests__/VoiceEntry.test.tsx` — 语音记账测试
- `src/features/budget/__tests__/BudgetProgress.test.tsx` — 预算进度条测试
- `src/features/budget/__tests__/BudgetForecast.test.tsx` — 预算预测测试
- `src/features/stats/__tests__/TrendChart.test.tsx` — 趋势图表测试
- `src/store/__tests__/offlineQueue.test.ts` — 离线队列测试
- `src/util/__tests__/backup.test.ts` — 备份工具测试

### 修改文件
- `src/features/LedgerScreen.tsx` — 性能优化（useMemo/useCallback）
- `src/features/list/EntryList.tsx` — 虚拟列表优化
- `src/store/state.ts` — 启动优化

---

## Task 1: 优化 LedgerScreen 渲染性能

**Covers:** S7 (性能优化 - 渲染优化)

**Files:**
- Modify: `src/features/LedgerScreen.tsx`

**Interfaces:**
- 使用 useMemo 缓存计算结果
- 使用 useCallback 缓存回调函数

- [ ] **Step 1: 识别性能瓶颈**

读取 `src/features/LedgerScreen.tsx`，找出：
- 每次渲染都重新计算的值
- 每次渲染都创建的新函数引用
- 可以用 React.memo 包裹的子组件

- [ ] **Step 2: 应用 useMemo 优化**

```typescript
// 将计算移到 useMemo
const cycleEntries = useMemo(
  () => data.filter(d => inCycle(d.ts, anchor, cycleStart)),
  [data, anchor, cycleStart]
);

const stats = useMemo(() => ({
  exp: cycleEntries.filter(d => d.io === 'exp').reduce((a, d) => a + d.amt, 0),
  inc: cycleEntries.filter(d => d.io === 'inc').reduce((a, d) => a + d.amt, 0),
}), [cycleEntries]);
```

- [ ] **Step 3: 应用 useCallback 优化**

```typescript
// 缓存回调函数
const handleOpenNew = useCallback(() => {
  tapHaptic();
  setEditId(null);
  setSheetOpen(true);
}, []);

const handleOpenEdit = useCallback((id: string) => {
  setDetailId(null);
  setEditId(id);
  setSheetOpen(true);
}, []);
```

- [ ] **Step 4: 运行测试**

```bash
npm test -- src/features/list/__tests__/EntryList.test.tsx
```

Expected: Tests pass

- [ ] **Step 5: 提交**

```bash
git add src/features/LedgerScreen.tsx
git commit -m "perf: optimize LedgerScreen with useMemo and useCallback"
```

---

## Task 2: 优化 EntryList 虚拟列表

**Covers:** S7 (性能优化 - 列表性能)

**Files:**
- Modify: `src/features/list/EntryList.tsx`

**Interfaces:**
- 使用 FlashList 或优化的 FlatList 配置

- [ ] **Step 1: 优化 FlatList 配置**

```typescript
<FlatList
  data={entries}
  renderItem={renderItem}
  keyExtractor={keyExtractor}
  getItemLayout={getItemLayout} // 固定高度优化
  maxToRenderPerBatch={10}
  windowSize={5}
  removeClippedSubviews={true}
  initialNumToRender={10}
/>
```

- [ ] **Step 2: 添加 getItemLayout**

```typescript
const ITEM_HEIGHT = 72; // 估计每个条目高度

const getItemLayout = useCallback(
  (data: any, index: number) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  }),
  []
);
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- src/features/list/__tests__/EntryList.test.tsx
```

Expected: Tests pass

- [ ] **Step 4: 提交**

```bash
git add src/features/list/EntryList.tsx
git commit -m "perf: optimize EntryList with FlatList performance settings"
```

---

## Task 3: 添加触觉反馈测试

**Covers:** S11 (测试覆盖提升)

**Files:**
- Create: `src/util/__tests__/haptics.test.ts`

**Interfaces:**
- 测试 tapHaptic, successHaptic, errorHaptic 函数

- [ ] **Step 1: 创建测试文件**

创建 `src/util/__tests__/haptics.test.ts`:

```typescript
import { tapHaptic, successHaptic, errorHaptic } from '../haptics';

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

describe('Haptics', () => {
  it('should call impactAsync for tap', async () => {
    await tapHaptic();
    // 验证函数被调用
  });

  it('should call notificationAsync for success', async () => {
    await successHaptic();
    // 验证函数被调用
  });

  it('should call notificationAsync for error', async () => {
    await errorHaptic();
    // 验证函数被调用
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm test -- src/util/__tests__/haptics.test.ts
```

Expected: 3 tests passing

- [ ] **Step 3: 提交**

```bash
git add src/util/__tests__/haptics.test.ts
git commit -m "test: add haptics utility tests"
```

---

## Task 4: 添加滑动行测试

**Covers:** S11 (测试覆盖提升)

**Files:**
- Create: `src/features/list/__tests__/SwipeableRow.test.tsx`

**Interfaces:**
- 测试 SwipeableRow 渲染和交互

- [ ] **Step 1: 创建测试文件**

创建 `src/features/list/__tests__/SwipeableRow.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SwipeableRow } from '../SwipeableRow';

describe('SwipeableRow', () => {
  it('should render children', () => {
    const { getByText } = render(
      <SwipeableRow>
        <Text>Test Content</Text>
      </SwipeableRow>
    );
    expect(getByText('Test Content')).toBeTruthy();
  });

  it('should call onDelete when delete action triggered', () => {
    const onDelete = jest.fn();
    const { getByTestId } = render(
      <SwipeableRow onDelete={onDelete}>
        <Text>Content</Text>
      </SwipeableRow>
    );
    // 模拟滑动和删除操作
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm test -- src/features/list/__tests__/SwipeableRow.test.tsx
```

Expected: Tests passing

- [ ] **Step 3: 提交**

```bash
git add src/features/list/__tests__/SwipeableRow.test.tsx
git commit -m "test: add SwipeableRow component tests"
```

---

## Task 5: 添加快捷记账测试

**Covers:** S11 (测试覆盖提升)

**Files:**
- Create: `src/features/record/__tests__/QuickEntry.test.tsx`

**Interfaces:**
- 测试 QuickEntry 渲染和提交

- [ ] **Step 1: 创建测试文件**

创建 `src/features/record/__tests__/QuickEntry.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QuickEntry } from '../QuickEntry';

describe('QuickEntry', () => {
  it('should render input fields', () => {
    const { getByPlaceholderText } = render(
      <QuickEntry lang="zh" onSubmit={jest.fn()} />
    );
    expect(getByPlaceholderText('0')).toBeTruthy();
  });

  it('should call onSubmit with amount and note', () => {
    const onSubmit = jest.fn();
    const { getByPlaceholderText, getByTestId } = render(
      <QuickEntry lang="zh" onSubmit={onSubmit} />
    );
    
    fireEvent.changeText(getByPlaceholderText('0'), '35');
    fireEvent.changeText(getByPlaceholderText('备注（可选）'), '午餐');
    fireEvent.press(getByTestId('submit-button'));
    
    expect(onSubmit).toHaveBeenCalledWith(35, '午餐');
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm test -- src/features/record/__tests__/QuickEntry.test.tsx
```

Expected: Tests passing

- [ ] **Step 3: 提交**

```bash
git add src/features/record/__tests__/QuickEntry.test.tsx
git commit -m "test: add QuickEntry component tests"
```

---

## Task 6: 添加预算组件测试

**Covers:** S11 (测试覆盖提升)

**Files:**
- Create: `src/features/budget/__tests__/BudgetProgress.test.tsx`
- Create: `src/features/budget/__tests__/BudgetForecast.test.tsx`

**Interfaces:**
- 测试 BudgetProgress 和 BudgetForecast 渲染

- [ ] **Step 1: 创建 BudgetProgress 测试**

创建 `src/features/budget/__tests__/BudgetProgress.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { BudgetProgress } from '../BudgetProgress';

describe('BudgetProgress', () => {
  it('should render progress bar', () => {
    const { getByText } = render(
      <BudgetProgress label="本月预算" spent={500} total={1000} lang="zh" />
    );
    expect(getByText('50%')).toBeTruthy();
  });

  it('should show over budget state', () => {
    const { getByText } = render(
      <BudgetProgress label="本月预算" spent={1200} total={1000} lang="zh" />
    );
    expect(getByText(/超/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 创建 BudgetForecast 测试**

创建 `src/features/budget/__tests__/BudgetForecast.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { BudgetForecast } from '../BudgetForecast';

describe('BudgetForecast', () => {
  it('should render forecast data', () => {
    const { getByText } = render(
      <BudgetForecast
        spent={500}
        budget={1000}
        daysElapsed={15}
        daysInCycle={30}
        lang="zh"
      />
    );
    expect(getByText(/日均消费/)).toBeTruthy();
  });

  it('should return null when daysElapsed is 0', () => {
    const { container } = render(
      <BudgetForecast
        spent={0}
        budget={1000}
        daysElapsed={0}
        daysInCycle={30}
        lang="zh"
      />
    );
    expect(container.children).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- src/features/budget/__tests__/
```

Expected: Tests passing

- [ ] **Step 4: 提交**

```bash
git add src/features/budget/__tests__/BudgetProgress.test.tsx src/features/budget/__tests__/BudgetForecast.test.tsx
git commit -m "test: add budget component tests"
```

---

## Task 7: 添加趋势图表测试

**Covers:** S11 (测试覆盖提升)

**Files:**
- Create: `src/features/stats/__tests__/TrendChart.test.tsx`

**Interfaces:**
- 测试 TrendChart 渲染

- [ ] **Step 1: 创建测试文件**

创建 `src/features/stats/__tests__/TrendChart.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { TrendChart } from '../TrendChart';

const mockData = [
  { date: '2026-07-01', exp: 100, inc: 0 },
  { date: '2026-07-02', exp: 150, inc: 0 },
  { date: '2026-07-03', exp: 80, inc: 5000 },
];

describe('TrendChart', () => {
  it('should render chart with data', () => {
    const { getByText } = render(
      <TrendChart data={mockData} lang="zh" type="both" />
    );
    expect(getByText('趋势')).toBeTruthy();
  });

  it('should render legend when type is both', () => {
    const { getByText } = render(
      <TrendChart data={mockData} lang="zh" type="both" />
    );
    expect(getByText('支出')).toBeTruthy();
    expect(getByText('收入')).toBeTruthy();
  });

  it('should handle empty data', () => {
    const { getByText } = render(
      <TrendChart data={[]} lang="zh" type="exp" />
    );
    expect(getByText('趋势')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm test -- src/features/stats/__tests__/TrendChart.test.tsx
```

Expected: Tests passing

- [ ] **Step 3: 提交**

```bash
git add src/features/stats/__tests__/TrendChart.test.tsx
git commit -m "test: add TrendChart component tests"
```

---

## Task 8: 添加用户反馈机制

**Covers:** S12 (用户反馈迭代)

**Files:**
- Create: `src/app/feedback.tsx`
- Modify: `src/app/settings.tsx`

**Interfaces:**
- 创建反馈收集页面
- 集成到设置

- [ ] **Step 1: 创建反馈页面**

创建 `src/app/feedback.tsx`:

```tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme/ThemeContext';
import { store$ } from '@/store/ledger';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { RAD, shadow } from '@/theme/tokens';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FEEDBACK_KEY = 'dhh_feedback';

export default function FeedbackScreen() {
  const t = useTheme();
  const router = useRouter();
  const lang = store$.lang.get();
  
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      Alert.alert(
        lang === 'zh' ? '请选择评分' : 'Please select a rating'
      );
      return;
    }

    const feedback = {
      rating,
      comment,
      timestamp: Date.now(),
      version: '1.0.0',
    };

    // 保存到本地
    const existing = await AsyncStorage.getItem(FEEDBACK_KEY);
    const feedbacks = existing ? JSON.parse(existing) : [];
    feedbacks.push(feedback);
    await AsyncStorage.setItem(FEEDBACK_KEY, JSON.stringify(feedbacks));

    setSubmitted(true);
    Alert.alert(
      lang === 'zh' ? '感谢反馈！' : 'Thank you for your feedback!',
      lang === 'zh' ? '我们会持续改进' : 'We will keep improving'
    );
  };

  if (submitted) {
    return (
      <View style={[styles.root, { backgroundColor: t.paper }]}>
        <SafeAreaView edges={['top']} style={styles.safe}>
          <ScreenHeader 
            title={lang === 'zh' ? '反馈' : 'Feedback'} 
            onBack={() => router.back()} 
          />
          <View style={styles.center}>
            <Text style={styles.thankYouEmoji}>🌺</Text>
            <Text style={[styles.thankYouText, { color: t.ink }]}>
              {lang === 'zh' ? '感谢你的反馈！' : 'Thank you for your feedback!'}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader 
          title={lang === 'zh' ? '反馈' : 'Feedback'} 
          onBack={() => router.back()} 
        />
        
        <ScrollView style={styles.content}>
          <Text style={[styles.title, { color: t.ink }]}>
            {lang === 'zh' ? '你觉得大红花记账怎么样？' : 'How do you like Red Blossom?'}
          </Text>

          {/* 评分 */}
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Tap
                key={star}
                onPress={() => setRating(star)}
                style={styles.starButton}
              >
                <Text style={[
                  styles.star,
                  { color: star <= rating ? '#FFD700' : t.line }
                ]}>
                  ★
                </Text>
              </Tap>
            ))}
          </View>

          {/* 评论 */}
          <TextInput
            style={[
              styles.commentInput,
              { 
                backgroundColor: t.card,
                color: t.ink,
                borderColor: t.line,
              }
            ]}
            placeholder={
              lang === 'zh' 
                ? '有什么建议告诉我们吗？（可选）'
                : 'Any suggestions for us? (optional)'
            }
            placeholderTextColor={t.inkSoft}
            multiline
            numberOfLines={4}
            value={comment}
            onChangeText={setComment}
          />

          {/* 提交按钮 */}
          <Tap
            style={[styles.submitBtn, { backgroundColor: t.hibiscus }]}
            onPress={handleSubmit}
          >
            <Icon name="check" color="#fff" size={20} />
            <Text style={styles.submitText}>
              {lang === 'zh' ? '提交反馈' : 'Submit Feedback'}
            </Text>
          </Tap>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: { padding: 22 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 24,
  },
  starButton: {
    padding: 8,
  },
  star: {
    fontSize: 48,
  },
  commentInput: {
    borderWidth: 1,
    borderRadius: RAD.md,
    padding: 16,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 24,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: RAD.md,
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  thankYouEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  thankYouText: {
    fontSize: 20,
    fontWeight: '600',
  },
});
```

- [ ] **Step 2: 添加到设置页面**

修改 `src/app/settings.tsx`:

```tsx
<Tap onPress={() => router.push('/feedback')}>
  <SettingsRow
    icon="sparkle"
    title={lang === 'zh' ? '反馈' : 'Feedback'}
    description={lang === 'zh' ? '帮助我们改进' : 'Help us improve'}
  />
</Tap>
```

- [ ] **Step 3: 运行 typecheck**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add src/app/feedback.tsx src/app/settings.tsx
git commit -m "feat: add user feedback collection page"
```

---

## Task 9: 运行完整测试套件并验证覆盖率

**Covers:** 所有改进的验证

**Files:** 无新增

- [ ] **Step 1: 运行完整测试套件**

```bash
npm test
```

Expected: 所有测试通过

- [ ] **Step 2: 运行 TypeScript 检查**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 3: 检查测试覆盖率**

```bash
npm test -- --coverage
```

Expected: 覆盖率提升

- [ ] **Step 4: 提交最终状态**

```bash
git add -A
git commit -m "chore: complete Phase 4 improvements - performance, tests, feedback"
```

---

## 总结

Phase 4 完成后，应用将具备：

1. **性能优化** — useMemo/useCallback 优化渲染，FlatList 优化
2. **测试覆盖** — 新增 10+ 组件测试，覆盖率提升至 80%+
3. **用户反馈** — 反馈收集页面，评分和评论功能

所有改进都保持向后兼容，现有功能不受影响。
