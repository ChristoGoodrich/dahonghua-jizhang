# Phase 6 改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Web 端支持、平板适配、手表端、多人协作、AI 增强

**Architecture:** Web 端使用 react-native-web；平板使用 useWindowDimensions 自适应布局；手表使用 watchOS/WearOS 原生扩展；多人协作扩展 Supabase RLS；AI 使用 Claude API 增强

**Tech Stack:** react-native-web, @expo/ui, Supabase RLS, Claude API, expo-haptics

## Global Constraints

- 保持现有测试全部通过
- `tsc --noEmit` 必须保持 clean
- 不引入破坏性变更
- 遵循现有架构模式

---

## Task 1: 优化 Web 端支持

**Covers:** Web 端支持

**Files:**
- Modify: `src/app/_layout.tsx`
- Modify: `src/features/LedgerScreen.tsx`
- Create: `src/components/WebOnly.tsx`

- [ ] **Step 1: 创建 Web 平台条件组件**

创建 `src/components/WebOnly.tsx`:

```tsx
import { Platform } from 'react-native';

interface WebOnlyProps {
  children: React.ReactNode;
}

export function WebOnly({ children }: WebOnlyProps) {
  if (Platform.OS !== 'web') return null;
  return <>{children}</>;
}
```

- [ ] **Step 2: 添加 Web 特定样式**

修改 `src/features/LedgerScreen.tsx`:

```tsx
import { Platform, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  root: { 
    flex: 1,
    ...(Platform.OS === 'web' && {
      maxWidth: 480,
      marginHorizontal: 'auto',
      boxShadow: '0 0 20px rgba(0,0,0,0.1)',
    }),
  },
});
```

- [ ] **Step 3: 添加 Web 快捷键支持**

创建 `src/hooks/useWebKeyboard.ts`:

```typescript
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useWebKeyboard(handlers: Record<string, () => void>) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    
    const listener = (e: KeyboardEvent) => {
      const handler = handlers[e.key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };
    
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handlers]);
}
```

- [ ] **Step 4: 集成快捷键**

修改 `src/features/LedgerScreen.tsx`:

```tsx
useWebKeyboard({
  'n': () => openNew(),        // N = 新建
  '/': () => searchRef.current?.focus(),  // / = 搜索
  'Escape': () => setSheetOpen(false),
});
```

- [ ] **Step 5: 运行 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: 提交**

```bash
git add src/components/WebOnly.tsx src/hooks/useWebKeyboard.ts src/features/LedgerScreen.tsx
git commit -m "feat: optimize web platform support with keyboard shortcuts"
```

---

## Task 2: 实现平板自适应布局

**Covers:** 平板适配

**Files:**
- Create: `src/hooks/useResponsive.ts`
- Modify: `src/features/LedgerScreen.tsx`
- Modify: `src/features/list/EntryList.tsx`

- [ ] **Step 1: 创建响应式 Hook**

创建 `src/hooks/useResponsive.ts`:

```typescript
import { useWindowDimensions } from 'react-native';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  
  const breakpoint: Breakpoint = width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';
  const isTablet = breakpoint === 'tablet' || breakpoint === 'desktop';
  const isLandscape = width > height;
  
  // 平板布局参数
  const columns = isTablet ? 2 : 1;
  const maxContentWidth = isTablet ? 720 : 480;
  const fontSize = isTablet ? 1.1 : 1; // 平板字体放大 10%
  
  return {
    width,
    height,
    breakpoint,
    isTablet,
    isLandscape,
    columns,
    maxContentWidth,
    fontSize,
  };
}
```

- [ ] **Step 2: 应用响应式布局**

修改 `src/features/LedgerScreen.tsx`:

```tsx
const { isTablet, maxContentWidth, fontSize } = useResponsive();

// 容器样式
<View style={[styles.root, { 
  backgroundColor: t.paper,
  maxWidth: maxContentWidth,
}]}>
```

- [ ] **Step 3: 平板双栏布局**

修改 EntryList 支持平板双栏：

```tsx
const { columns } = useResponsive();

if (columns > 1) {
  return (
    <View style={styles.gridRow}>
      {/* 左栏：今天的记录 */}
      <View style={styles.gridCol}>
        <Text style={styles.sectionTitle}>今天</Text>
        {/* ... */}
      </View>
      {/* 右栏：之前的记录 */}
      <View style={styles.gridCol}>
        <Text style={styles.sectionTitle}>更早</Text>
        {/* ... */}
      </View>
    </View>
  );
}
```

- [ ] **Step 4: 运行 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useResponsive.ts src/features/LedgerScreen.tsx src/features/list/EntryList.tsx
git commit -m "feat: add tablet responsive layout with dual-column support"
```

---

## Task 3: 扩展 AI 功能 - 智能分类

**Covers:** AI 增强

**Files:**
- Modify: `src/ai/parse.ts`
- Create: `src/ai/suggest.ts`

- [ ] **Step 1: 创建智能分类建议**

创建 `src/ai/suggest.ts`:

```typescript
import type { Entry, Category, IO } from '@/domain/types';
import { catName } from '@/domain/cats';
import type { Lang } from '@/i18n';

export interface CategorySuggestion {
  cat: string;
  confidence: number;
  reason: string;
}

/**
 * 基于历史记录预测分类
 */
export function suggestCategory(
  note: string,
  history: Entry[],
  customCats: Record<IO, Category[]>,
  lang: Lang
): CategorySuggestion[] {
  const normalizedNote = note.toLowerCase().trim();
  if (!normalizedNote) return [];
  
  // 统计备注中关键词与分类的关联
  const catScores = new Map<string, { count: number; keywords: Set<string> }>();
  
  for (const entry of history) {
    if (!entry.note) continue;
    const entryNote = entry.note.toLowerCase();
    
    // 检查关键词匹配
    const words = entryNote.split(/\s+/);
    for (const word of words) {
      if (normalizedNote.includes(word) || word.includes(normalizedNote)) {
        const existing = catScores.get(entry.cat) || { count: 0, keywords: new Set() };
        existing.count++;
        existing.keywords.add(word);
        catScores.set(entry.cat, existing);
      }
    }
  }
  
  // 转换为建议列表
  const totalMatches = [...catScores.values()].reduce((s, v) => s + v.count, 0);
  if (totalMatches === 0) return [];
  
  return [...catScores.entries()]
    .map(([cat, { count, keywords }]) => ({
      cat,
      confidence: count / totalMatches,
      reason: lang === 'zh' 
        ? `基于关键词: ${[...keywords].join(', ')}`
        : `Based on keywords: ${[...keywords].join(', ')}`,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

/**
 * 检测异常消费
 */
export function detectAnomaly(
  entry: Entry,
  history: Entry[]
): { isAnomaly: boolean; avgAmount: number; deviation: number } | null {
  const similar = history.filter(
    e => e.cat === entry.cat && e.io === entry.io && !e.deletedAt
  );
  
  if (similar.length < 5) return null; // 数据不足
  
  const amounts = similar.map(e => e.amt);
  const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  const stdDev = Math.sqrt(
    amounts.reduce((s, a) => s + Math.pow(a - avg, 2), 0) / amounts.length
  );
  
  const deviation = Math.abs(entry.amt - avg) / (stdDev || 1);
  
  return {
    isAnomaly: deviation > 2, // 超过 2 个标准差
    avgAmount: avg,
    deviation,
  };
}
```

- [ ] **Step 2: 添加测试**

创建 `src/ai/__tests__/suggest.test.ts`:

```typescript
import { suggestCategory, detectAnomaly } from '../suggest';
import type { Entry } from '@/domain/types';

describe('AI Suggestions', () => {
  const history: Entry[] = [
    { id: '1', ts: Date.now(), io: 'exp', cat: 'food', amt: 30, note: '午餐 麦当劳' },
    { id: '2', ts: Date.now(), io: 'exp', cat: 'food', amt: 25, note: '午餐 肯德基' },
    { id: '3', ts: Date.now(), io: 'exp', cat: 'transport', amt: 15, note: '地铁' },
  ];

  describe('suggestCategory', () => {
    it('should suggest food for lunch-related notes', () => {
      const suggestions = suggestCategory('午餐', history, {} as any, 'zh');
      expect(suggestions[0]?.cat).toBe('food');
    });

    it('should return empty for unknown notes', () => {
      const suggestions = suggestCategory('xyzabc', history, {} as any, 'zh');
      expect(suggestions).toEqual([]);
    });
  });

  describe('detectAnomaly', () => {
    it('should detect anomalous amounts', () => {
      const anomaly = detectAnomaly(
        { id: '4', ts: Date.now(), io: 'exp', cat: 'food', amt: 200 },
        history
      );
      expect(anomaly?.isAnomaly).toBe(true);
    });

    it('should not flag normal amounts', () => {
      const anomaly = detectAnomaly(
        { id: '4', ts: Date.now(), io: 'exp', cat: 'food', amt: 28 },
        history
      );
      expect(anomaly?.isAnomaly).toBe(false);
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- src/ai/__tests__/suggest.test.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/ai/suggest.ts src/ai/__tests__/suggest.test.ts
git commit -m "feat: add AI category suggestion and anomaly detection"
```

---

## Task 4: 实现多人协作 - 家庭账本

**Covers:** 多人协作

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/sync/engine.ts`
- Create: `src/features/sharing/SharingSheet.tsx`

- [ ] **Step 1: 添加家庭账本类型**

修改 `src/domain/types.ts`:

```typescript
export interface FamilyGroup {
  id: string;
  name: string;
  members: FamilyMember[];
  createdBy: string;
  createdAt: number;
}

export interface FamilyMember {
  userId: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
}
```

- [ ] **Step 2: 创建分享表单**

创建 `src/features/sharing/SharingSheet.tsx`:

```tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import type { Lang } from '@/i18n';

interface SharingSheetProps {
  visible: boolean;
  lang: Lang;
  onClose: () => void;
  onInvite: (email: string) => void;
}

export function SharingSheet({ visible, lang, onClose, onInvite }: SharingSheetProps) {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const isZh = lang === 'zh';

  if (!visible) return null;

  const handleInvite = () => {
    if (!email.includes('@')) {
      Alert.alert(isZh ? '请输入有效邮箱' : 'Please enter a valid email');
      return;
    }
    onInvite(email);
    setEmail('');
  };

  return (
    <View style={[styles.container, { backgroundColor: t.card }]}>
      <Text style={[styles.title, { color: t.ink }]}>
        {isZh ? '邀请家人' : 'Invite Family'}
      </Text>
      
      <TextInput
        style={[styles.input, { color: t.ink, borderColor: t.line }]}
        placeholder={isZh ? '输入邮箱地址' : 'Enter email address'}
        placeholderTextColor={t.inkSoft}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      
      <View style={styles.buttons}>
        <Tap style={[styles.btn, { borderColor: t.line }]} onPress={onClose}>
          <Text style={[styles.btnText, { color: t.ink }]}>
            {isZh ? '取消' : 'Cancel'}
          </Text>
        </Tap>
        <Tap style={[styles.btn, { backgroundColor: t.hibiscus }]} onPress={handleInvite}>
          <Text style={[styles.btnText, { color: '#fff' }]}>
            {isZh ? '邀请' : 'Invite'}
          </Text>
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, borderRadius: 16 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 16 },
  buttons: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
  btn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  btnText: { fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 3: 运行 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: 提交**

```bash
git add src/domain/types.ts src/features/sharing/SharingSheet.tsx
git commit -m "feat: add family group sharing foundation"
```

---

## Task 5: AI 消费预测

**Covers:** AI 增强

**Files:**
- Create: `src/ai/forecast.ts`
- Create: `src/ai/__tests__/forecast.test.ts`

- [ ] **Step 1: 创建消费预测**

创建 `src/ai/forecast.ts`:

```typescript
import type { Entry } from '@/domain/types';
import { cycleRange } from '@/domain/cycle';

export interface ForecastResult {
  predicted: number;
  confidence: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  breakdown: { category: string; predicted: number }[];
}

/**
 * 基于历史数据预测本月消费
 */
export function forecastMonthlyExpense(
  history: Entry[],
  cycleStart: number,
  anchor: Date = new Date()
): ForecastResult {
  // 获取过去 3 个月的数据
  const months: Entry[][] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(anchor);
    d.setMonth(d.getMonth() - i);
    const { start, end } = cycleRange(d, cycleStart);
    const monthEntries = history.filter(
      e => e.io === 'exp' && 
           e.ts >= start.getTime() && 
           e.ts < end.getTime() && 
           !e.deletedAt
    );
    months.push(monthEntries);
  }
  
  // 计算每月总支出
  const monthlyTotals = months.map(entries => 
    entries.reduce((s, e) => s + e.amt, 0)
  );
  
  // 简单线性回归预测
  const n = monthlyTotals.length;
  const xMean = (n - 1) / 2;
  const yMean = monthlyTotals.reduce((s, y) => s + y, 0) / n;
  
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (monthlyTotals[i] - yMean);
    denominator += Math.pow(i - xMean, 2);
  }
  
  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;
  const predicted = Math.max(0, intercept + slope * n);
  
  // 计算趋势
  const trend = slope > 50 ? 'increasing' : slope < -50 ? 'decreasing' : 'stable';
  
  // 计算置信度（基于数据一致性）
  const variance = monthlyTotals.reduce((s, y) => s + Math.pow(y - yMean, 2), 0) / n;
  const cv = Math.sqrt(variance) / (yMean || 1); // 变异系数
  const confidence = Math.max(0.3, Math.min(0.95, 1 - cv));
  
  // 分类预测
  const catTotals = new Map<string, number[]>();
  for (const monthEntries of months) {
    const monthCats = new Map<string, number>();
    for (const e of monthEntries) {
      monthCats.set(e.cat, (monthCats.get(e.cat) ?? 0) + e.amt);
    }
    for (const [cat, total] of monthCats) {
      if (!catTotals.has(cat)) catTotals.set(cat, []);
      catTotals.get(cat)!.push(total);
    }
  }
  
  const breakdown = [...catTotals.entries()].map(([cat, totals]) => ({
    category: cat,
    predicted: totals.reduce((s, t) => s + t, 0) / totals.length,
  }));
  
  return { predicted, confidence, trend, breakdown };
}
```

- [ ] **Step 2: 添加测试**

创建 `src/ai/__tests__/forecast.test.ts`:

```typescript
import { forecastMonthlyExpense } from '../forecast';
import type { Entry } from '@/domain/types';

describe('Forecast', () => {
  const now = new Date('2026-07-06');
  
  function makeEntries(monthOffset: number, amounts: number[]): Entry[] {
    const d = new Date(now);
    d.setMonth(d.getMonth() - monthOffset);
    return amounts.map((amt, i) => ({
      id: `${monthOffset}-${i}`,
      ts: d.getTime() + i * 86400000,
      io: 'exp' as const,
      cat: 'food',
      amt,
    }));
  }

  it('should predict based on historical data', () => {
    const history = [
      ...makeEntries(0, [30, 25, 35]),
      ...makeEntries(1, [100, 120, 110]),
      ...makeEntries(2, [90, 100, 95]),
    ];
    
    const result = forecastMonthlyExpense(history, 1, now);
    expect(result.predicted).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should detect increasing trend', () => {
    const history = [
      ...makeEntries(0, [50, 60, 70]),
      ...makeEntries(1, [100, 110, 120]),
      ...makeEntries(2, [80, 90, 100]),
    ];
    
    const result = forecastMonthlyExpense(history, 1, now);
    expect(result.trend).toBe('increasing');
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- src/ai/__tests__/forecast.test.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/ai/forecast.ts src/ai/__tests__/forecast.test.ts
git commit -m "feat: add AI expense forecasting with trend detection"
```

---

## Task 6: 添加 AI 洞察页面

**Covers:** AI 增强

**Files:**
- Create: `src/app/insights.tsx`
- Modify: `src/features/LedgerScreen.tsx`

- [ ] **Step 1: 创建 AI 洞察页面**

创建 `src/app/insights.tsx`:

```tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme/ThemeContext';
import { store$ } from '@/store/ledger';
import { forecastMonthlyExpense } from '@/ai/forecast';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { RAD, shadow } from '@/theme/tokens';

export default function InsightsScreen() {
  const t = useTheme();
  const router = useRouter();
  const lang = store$.lang.get();
  const data = store$.data.get();
  const cycleStart = store$.settings.cycleStart.get() || 1;
  const isZh = lang === 'zh';

  const forecast = useMemo(
    () => forecastMonthlyExpense(data, cycleStart),
    [data, cycleStart]
  );

  const trendIcon = {
    increasing: '📈',
    decreasing: '📉',
    stable: '➡️',
  }[forecast.trend];

  const trendText = {
    increasing: isZh ? '消费上升趋势' : 'Increasing trend',
    decreasing: isZh ? '消费下降趋势' : 'Decreasing trend',
    stable: isZh ? '消费稳定' : 'Stable trend',
  }[forecast.trend];

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader 
          title={isZh ? 'AI 洞察' : 'AI Insights'} 
          onBack={() => router.back()} 
        />

        <ScrollView style={styles.content}>
          {/* 预测卡片 */}
          <View style={[styles.card, { backgroundColor: t.card }]}>
            <Text style={[styles.cardTitle, { color: t.ink }]}>
              {isZh ? '本月预测' : 'Monthly Forecast'}
            </Text>
            <Text style={[styles.predictedAmount, { color: t.hibiscus }]}>
              ¥{Math.round(forecast.predicted)}
            </Text>
            <View style={styles.trendRow}>
              <Text style={styles.trendIcon}>{trendIcon}</Text>
              <Text style={[styles.trendText, { color: t.inkSoft }]}>
                {trendText}
              </Text>
            </View>
            <Text style={[styles.confidence, { color: t.inkSoft }]}>
              {isZh ? '置信度' : 'Confidence'}: {Math.round(forecast.confidence * 100)}%
            </Text>
          </View>

          {/* 分类预测 */}
          <View style={[styles.card, { backgroundColor: t.card }]}>
            <Text style={[styles.cardTitle, { color: t.ink }]}>
              {isZh ? '分类预测' : 'Category Forecast'}
            </Text>
            {forecast.breakdown.map(({ category, predicted }) => (
              <View key={category} style={styles.breakdownRow}>
                <Text style={[styles.breakdownCat, { color: t.ink }]}>{category}</Text>
                <Text style={[styles.breakdownAmt, { color: t.hibiscus }]}>
                  ¥{Math.round(predicted)}
                </Text>
              </View>
            ))}
          </View>

          {/* 提示 */}
          <View style={[styles.card, { backgroundColor: t.card }]}>
            <Text style={[styles.cardTitle, { color: t.ink }]}>
              {isZh ? '智能建议' : 'Smart Tips'}
            </Text>
            <Text style={[styles.tipText, { color: t.inkSoft }]}>
              {forecast.trend === 'increasing' 
                ? (isZh ? '消费呈上升趋势，建议关注预算使用情况。' : 'Spending is trending up. Consider monitoring your budget.')
                : forecast.trend === 'decreasing'
                ? (isZh ? '做得好！消费在下降。继续保持！' : 'Great job! Spending is decreasing. Keep it up!')
                : (isZh ? '消费保持稳定，继续保持良好的记账习惯。' : 'Spending is stable. Keep up the good habits.')
              }
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: { padding: 22 },
  card: { padding: 16, borderRadius: RAD.md, marginBottom: 16, ...shadow('xs') },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  predictedAmount: { fontSize: 36, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  trendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 },
  trendIcon: { fontSize: 20 },
  trendText: { fontSize: 14 },
  confidence: { fontSize: 12, textAlign: 'center' },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  breakdownCat: { fontSize: 14 },
  breakdownAmt: { fontSize: 14, fontWeight: '600' },
  tipText: { fontSize: 14, lineHeight: 20 },
});
```

- [ ] **Step 2: 添加导航入口**

修改 `src/features/LedgerScreen.tsx`:

```tsx
<Tap
  style={[styles.iconBtn, { borderColor: t.line, backgroundColor: t.card }]}
  onPress={() => router.push('/insights')}
  accessibilityLabel={isZh ? 'AI 洞察' : 'AI Insights'}
>
  <Icon name="sparkle" color={t.inkSoft} size={17} />
</Tap>
```

- [ ] **Step 3: 运行 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: 提交**

```bash
git add src/app/insights.tsx src/features/LedgerScreen.tsx src/ai/forecast.ts src/ai/__tests__/forecast.test.ts
git commit -m "feat: add AI insights page with expense forecasting"
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
git commit -m "chore: complete Phase 6 - web, tablet, AI, sharing, insights"
```

---

## 总结

Phase 6 完成后，应用将具备：

1. **Web 端优化** — 键盘快捷键、响应式布局
2. **平板适配** — 双栏布局、自适应字体
3. **AI 增强** — 智能分类建议、异常检测、消费预测
4. **多人协作** — 家庭账本基础架构
5. **AI 洞察页面** — 可视化预测和建议
