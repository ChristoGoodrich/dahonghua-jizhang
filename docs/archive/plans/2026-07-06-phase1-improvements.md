# Phase 1 改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提升统计分析能力、增强预算管理灵活性、迁移到 SQLite 提升性能

**Architecture:** 在现有 Legend State + AsyncStorage 架构上增强统计和预算功能，同时引入 expo-sqlite 作为新的存储层，保持向后兼容

**Tech Stack:** expo-sqlite, react-native-chart-kit 或 victory-native, TypeScript, Legend State

## Global Constraints

- 保持现有 182 个测试全部通过
- `tsc --noEmit` 必须保持 clean
- 不引入破坏性变更，保持向后兼容
- 遵循现有的 domain/store/features 分层架构
- 所有新功能必须支持 i18n (zh/en)

---

## 文件结构

### 新增文件
- `src/domain/trends.ts` — 趋势分析算法
- `src/domain/weekly.ts` — 周预算计算
- `src/features/stats/TrendChart.tsx` — 趋势图表组件
- `src/features/stats/WeekdayChart.tsx` — 星期分布图表
- `src/features/stats/CategoryTrend.tsx` — 分类趋势组件
- `src/features/budget/BudgetProgress.tsx` — 预算进度条
- `src/features/budget/BudgetForecast.tsx` — 预算预测
- `src/store/db.ts` — SQLite 数据库初始化
- `src/store/migration.ts` — AsyncStorage → SQLite 迁移
- `src/domain/__tests__/trends.test.ts` — 趋势算法测试
- `src/domain/__tests__/weekly.test.ts` — 周预算测试

### 修改文件
- `src/domain/stats.ts` — 扩展统计函数
- `src/domain/budget.ts` — 扩展预算计算
- `src/domain/types.ts` — 添加新类型
- `src/features/stats/StatsView.tsx` — 集成新图表
- `src/features/budget/BudgetPot.tsx` — 集成进度条
- `src/store/state.ts` — 添加 SQLite 初始化
- `src/i18n/index.ts` — 添加新字符串
- `package.json` — 添加 expo-sqlite 依赖

---

## Task 1: 安装 expo-sqlite 并创建数据库层

**Covers:** S7 (性能优化 - SQLite 迁移)

**Files:**
- Modify: `package.json`
- Create: `src/store/db.ts`
- Create: `src/store/__tests__/db.test.ts`

**Interfaces:**
- Produces: `getDatabase()` 函数返回 SQLite 数据库实例
- Produces: `initDatabase()` 创建表结构

- [ ] **Step 1: 安装 expo-sqlite**

```bash
cd C:\Users\ChristopherGoodrich\Desktop\大红花记账\dahonghua-app
npx expo install expo-sqlite
```

Expected: 安装成功，package.json 更新

- [ ] **Step 2: 创建数据库初始化模块**

创建 `src/store/db.ts`:

```typescript
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('dahonghua.db');
  }
  return db;
}

export function initDatabase(): void {
  const database = getDatabase();
  
  // 启用 WAL 模式提升性能
  database.execSync('PRAGMA journal_mode = WAL;');
  
  // 创建 entries 表
  database.execSync(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      io TEXT NOT NULL,
      cat TEXT NOT NULL,
      amt REAL NOT NULL,
      note TEXT,
      acct TEXT,
      acct_to TEXT,
      fee REAL,
      discount REAL,
      subcat TEXT,
      cur TEXT,
      orig_amt REAL,
      tags TEXT,
      ledger TEXT,
      rb TEXT,
      rb_amt REAL,
      refund REAL,
      refund_of TEXT,
      from_sub INTEGER,
      deleted_at INTEGER,
      updated_at INTEGER,
      field_ts TEXT,
      user_id TEXT
    );
  `);

  // 创建索引
  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_entries_ts ON entries(ts);
    CREATE INDEX IF NOT EXISTS idx_entries_io ON entries(io);
    CREATE INDEX IF NOT EXISTS idx_entries_cat ON entries(cat);
    CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at);
  `);

  // 创建 accounts 表
  database.execSync(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_en TEXT,
      balance REAL NOT NULL DEFAULT 0,
      kind TEXT DEFAULT 'cash'
    );
  `);

  // 创建 settings 表 (key-value 存储)
  database.execSync(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
```

- [ ] **Step 3: 编写数据库初始化测试**

创建 `src/store/__tests__/db.test.ts`:

```typescript
import { initDatabase, getDatabase } from '../db';

describe('Database', () => {
  beforeEach(() => {
    // 每个测试前重新初始化
    initDatabase();
  });

  it('should initialize database without errors', () => {
    expect(() => initDatabase()).not.toThrow();
  });

  it('should create entries table', () => {
    const db = getDatabase();
    const result = db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entries'"
    );
    expect(result?.name).toBe('entries');
  });

  it('should create accounts table', () => {
    const db = getDatabase();
    const result = db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'"
    );
    expect(result?.name).toBe('accounts');
  });

  it('should create settings table', () => {
    const db = getDatabase();
    const result = db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
    );
    expect(result?.name).toBe('settings');
  });
});
```

- [ ] **Step 4: 运行测试验证**

```bash
npm test -- src/store/__tests__/db.test.ts
```

Expected: 4 tests passing

- [ ] **Step 5: 提交**

```bash
git add package.json src/store/db.ts src/store/__tests__/db.test.ts
git commit -m "feat: add expo-sqlite database layer with table initialization"
```

---

## Task 2: 实现 AsyncStorage → SQLite 数据迁移

**Covers:** S7 (性能优化 - 数据迁移)

**Files:**
- Create: `src/store/migration.ts`
- Create: `src/store/__tests__/migration.test.ts`
- Modify: `src/store/state.ts`

**Interfaces:**
- Consumes: `getDatabase()` from Task 1
- Consumes: 现有的 AsyncStorage 数据格式
- Produces: `migrateToSQLite()` 函数

- [ ] **Step 1: 编写迁移函数测试**

创建 `src/store/__tests__/migration.test.ts`:

```typescript
import { needsMigration, migrateToSQLite } from '../migration';
import { getDatabase } from '../db';

describe('Migration', () => {
  it('should detect when migration is needed', () => {
    // 新数据库应该需要迁移
    expect(needsMigration()).toBe(true);
  });

  it('should complete migration without errors', async () => {
    await expect(migrateToSQLite()).resolves.not.toThrow();
  });

  it('should mark migration as complete', async () => {
    await migrateToSQLite();
    expect(needsMigration()).toBe(false);
  });
});
```

- [ ] **Step 2: 实现迁移函数**

创建 `src/store/migration.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDatabase } from './db';

const MIGRATION_KEY = 'dhh_sqlite_migrated';

export function needsMigration(): boolean {
  const db = getDatabase();
  const result = db.getFirstSync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [MIGRATION_KEY]
  );
  return !result || result.value !== 'true';
}

export async function migrateToSQLite(): Promise<void> {
  const db = getDatabase();
  
  // 读取 AsyncStorage 数据
  const entriesJson = await AsyncStorage.getItem('dhh_entries_v1');
  const configJson = await AsyncStorage.getItem('dhh_config_v1');
  
  if (entriesJson) {
    const entries = JSON.parse(entriesJson);
    
    // 批量插入 entries
    db.execSync('BEGIN TRANSACTION;');
    try {
      for (const entry of entries) {
        db.runSync(
          `INSERT OR REPLACE INTO entries (
            id, ts, io, cat, amt, note, acct, acct_to, fee, discount,
            subcat, cur, orig_amt, tags, ledger, rb, rb_amt, refund,
            refund_of, from_sub, deleted_at, updated_at, field_ts
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id, entry.ts, entry.io, entry.cat, entry.amt,
            entry.note || null, entry.acct || null, entry.acctTo || null,
            entry.fee || null, entry.discount || null, entry.subcat || null,
            entry.cur || null, entry.origAmt || null,
            entry.tags ? JSON.stringify(entry.tags) : null,
            entry.ledger || null, entry.rb || null, entry.rbAmt || null,
            entry.refund || null, entry.refundOf || null,
            entry.fromSub ? 1 : 0, entry.deletedAt || null,
            entry.updatedAt || null,
            entry.fieldTs ? JSON.stringify(entry.fieldTs) : null
          ]
        );
      }
      db.execSync('COMMIT;');
    } catch (e) {
      db.execSync('ROLLBACK;');
      throw e;
    }
  }
  
  if (configJson) {
    const config = JSON.parse(configJson);
    db.runSync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      ['config', JSON.stringify(config)]
    );
  }
  
  // 标记迁移完成
  db.runSync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    [MIGRATION_KEY, 'true']
  );
}
```

- [ ] **Step 3: 运行测试验证**

```bash
npm test -- src/store/__tests__/migration.test.ts
```

Expected: 3 tests passing

- [ ] **Step 4: 集成到启动流程**

修改 `src/store/state.ts`，在 `hydrate()` 中添加迁移检查:

```typescript
import { initDatabase } from './db';
import { needsMigration, migrateToSQLite } from './migration';

export async function hydrate(): Promise<void> {
  // 初始化数据库
  initDatabase();
  
  // 检查是否需要迁移
  if (needsMigration()) {
    await migrateToSQLite();
  }
  
  // 现有的加载逻辑...
  await loadPersisted();
  store$.hydrated.set(true);
  wireDisplaySymbol();
  startAutosave();
  runSubscriptions();
}
```

- [ ] **Step 5: 提交**

```bash
git add src/store/migration.ts src/store/__tests__/migration.test.ts src/store/state.ts
git commit -m "feat: implement AsyncStorage to SQLite migration"
```

---

## Task 3: 扩展统计函数 - 趋势分析

**Covers:** S4 (统计分析增强)

**Files:**
- Create: `src/domain/trends.ts`
- Create: `src/domain/__tests__/trends.test.ts`
- Modify: `src/domain/stats.ts`

**Interfaces:**
- Consumes: `Entry` type from `domain/types.ts`
- Produces: `dailyTrend()`, `weeklyTrend()`, `categoryTrend()` 函数

- [ ] **Step 1: 编写趋势分析测试**

创建 `src/domain/__tests__/trends.test.ts`:

```typescript
import { dailyTrend, weeklyTrend, categoryTrend } from '../trends';
import type { Entry } from '../types';

const mockEntries: Entry[] = [
  { id: '1', ts: new Date('2026-07-01').getTime(), io: 'exp', cat: 'food', amt: 30 },
  { id: '2', ts: new Date('2026-07-01').getTime(), io: 'exp', cat: 'food', amt: 20 },
  { id: '3', ts: new Date('2026-07-02').getTime(), io: 'exp', cat: 'transport', amt: 15 },
  { id: '4', ts: new Date('2026-07-02').getTime(), io: 'inc', cat: 'salary', amt: 5000 },
  { id: '5', ts: new Date('2026-07-03').getTime(), io: 'exp', cat: 'food', amt: 25 },
];

describe('Trends', () => {
  describe('dailyTrend', () => {
    it('should aggregate expenses by day', () => {
      const result = dailyTrend(mockEntries, 3);
      expect(result).toHaveLength(3);
      expect(result[0].exp).toBe(50); // 30 + 20
      expect(result[1].exp).toBe(15);
      expect(result[2].exp).toBe(25);
    });

    it('should include income separately', () => {
      const result = dailyTrend(mockEntries, 3);
      expect(result[1].inc).toBe(5000);
    });

    it('should handle empty entries', () => {
      const result = dailyTrend([], 3);
      expect(result).toHaveLength(3);
      expect(result[0].exp).toBe(0);
    });
  });

  describe('weeklyTrend', () => {
    it('should aggregate by week', () => {
      const result = weeklyTrend(mockEntries, 1);
      expect(result).toHaveLength(1);
      expect(result[0].exp).toBe(90); // 30 + 20 + 15 + 25
    });
  });

  describe('categoryTrend', () => {
    it('should track category over time', () => {
      const result = categoryTrend(mockEntries, 'food', 3);
      expect(result).toHaveLength(3);
      expect(result[0].amt).toBe(50); // 30 + 20
      expect(result[2].amt).toBe(25);
    });

    it('should return zeros for missing days', () => {
      const result = categoryTrend(mockEntries, 'transport', 3);
      expect(result[0].amt).toBe(0);
      expect(result[1].amt).toBe(15);
      expect(result[2].amt).toBe(0);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test -- src/domain/__tests__/trends.test.ts
```

Expected: FAIL - "Cannot find module '../trends'"

- [ ] **Step 3: 实现趋势分析函数**

创建 `src/domain/trends.ts`:

```typescript
import type { Entry } from './types';

export interface TrendPoint {
  date: Date;
  exp: number;
  inc: number;
}

export interface CategoryTrendPoint {
  date: Date;
  amt: number;
}

/**
 * 按天聚合支出/收入，返回最近 N 天的数据
 */
export function dailyTrend(entries: Entry[], days: number): TrendPoint[] {
  const result: TrendPoint[] = [];
  const now = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    
    const dayStart = date.getTime();
    const dayEnd = dayStart + 86400000;
    
    const dayEntries = entries.filter(
      e => e.ts >= dayStart && e.ts < dayEnd && !e.deletedAt
    );
    
    result.push({
      date,
      exp: dayEntries.filter(e => e.io === 'exp').reduce((s, e) => s + e.amt, 0),
      inc: dayEntries.filter(e => e.io === 'inc').reduce((s, e) => s + e.amt, 0),
    });
  }
  
  return result;
}

/**
 * 按周聚合支出/收入，返回最近 N 周的数据
 */
export function weeklyTrend(entries: Entry[], weeks: number): TrendPoint[] {
  const result: TrendPoint[] = [];
  const now = new Date();
  
  for (let i = weeks - 1; i >= 0; i--) {
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - i * 7);
    weekEnd.setHours(23, 59, 59, 999);
    
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEntries = entries.filter(
      e => e.ts >= weekStart.getTime() && e.ts <= weekEnd.getTime() && !e.deletedAt
    );
    
    result.push({
      date: weekStart,
      exp: weekEntries.filter(e => e.io === 'exp').reduce((s, e) => s + e.amt, 0),
      inc: weekEntries.filter(e => e.io === 'inc').reduce((s, e) => s + e.amt, 0),
    });
  }
  
  return result;
}

/**
 * 追踪单个分类在最近 N 天的支出趋势
 */
export function categoryTrend(
  entries: Entry[],
  category: string,
  days: number
): CategoryTrendPoint[] {
  const result: CategoryTrendPoint[] = [];
  const now = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    
    const dayStart = date.getTime();
    const dayEnd = dayStart + 86400000;
    
    const dayEntries = entries.filter(
      e => e.ts >= dayStart && e.ts < dayEnd && 
           e.cat === category && e.io === 'exp' && !e.deletedAt
    );
    
    result.push({
      date,
      amt: dayEntries.reduce((s, e) => s + e.amt, 0),
    });
  }
  
  return result;
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test -- src/domain/__tests__/trends.test.ts
```

Expected: 5 tests passing

- [ ] **Step 5: 提交**

```bash
git add src/domain/trends.ts src/domain/__tests__/trends.test.ts
git commit -m "feat: add trend analysis functions (daily, weekly, category)"
```

---

## Task 4: 实现趋势图表组件

**Covers:** S4 (统计分析增强)

**Files:**
- Create: `src/features/stats/TrendChart.tsx`
- Modify: `src/features/stats/StatsView.tsx`

**Interfaces:**
- Consumes: `dailyTrend()`, `weeklyTrend()` from Task 3
- Produces: `TrendChart` 组件

- [ ] **Step 1: 安装图表库**

```bash
npm install react-native-chart-kit
```

- [ ] **Step 2: 创建趋势图表组件**

创建 `src/features/stats/TrendChart.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useTheme } from '@/theme/ThemeContext';
import type { TrendPoint } from '@/domain/trends';
import type { Lang } from '@/i18n';

interface TrendChartProps {
  data: TrendPoint[];
  lang: Lang;
  type?: 'exp' | 'inc' | 'both';
}

export function TrendChart({ data, lang, type = 'both' }: TrendChartProps) {
  const t = useTheme();
  const screenWidth = Dimensions.get('window').width - 44;
  
  const labels = data.map(d => {
    const date = d.date;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });
  
  const datasets = [];
  
  if (type === 'exp' || type === 'both') {
    datasets.push({
      data: data.map(d => d.exp),
      color: () => t.hibiscus,
      strokeWidth: 2,
    });
  }
  
  if (type === 'inc' || type === 'both') {
    datasets.push({
      data: data.map(d => d.inc),
      color: () => '#4CAF50',
      strokeWidth: 2,
    });
  }
  
  const chartConfig = {
    backgroundColor: t.card,
    backgroundGradientFrom: t.card,
    backgroundGradientTo: t.card,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    labelColor: () => t.inkSoft,
    propsForDots: {
      r: '4',
      strokeWidth: '2',
      stroke: t.hibiscus,
    },
  };
  
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: t.ink }]}>
        {lang === 'zh' ? '趋势' : 'Trend'}
      </Text>
      <LineChart
        data={{
          labels,
          datasets,
        }}
        width={screenWidth}
        height={200}
        chartConfig={chartConfig}
        bezier
        style={styles.chart}
      />
      {type === 'both' && (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: t.hibiscus }]} />
            <Text style={[styles.legendText, { color: t.inkSoft }]}>
              {lang === 'zh' ? '支出' : 'Expense'}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#4CAF50' }]} />
            <Text style={[styles.legendText, { color: t.inkSoft }]}>
              {lang === 'zh' ? '收入' : 'Income'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    paddingHorizontal: 22,
  },
  chart: {
    borderRadius: 12,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
  },
});
```

- [ ] **Step 3: 集成到统计页面**

修改 `src/features/stats/StatsView.tsx`，添加趋势图表:

```tsx
import { TrendChart } from './TrendChart';
import { dailyTrend } from '@/domain/trends';

// 在组件内部添加
const trendData = useMemo(
  () => dailyTrend(all, 7),
  [all]
);

// 在 JSX 中添加
<TrendChart data={trendData} lang={lang} type="both" />
```

- [ ] **Step 4: 运行 TypeScript 检查**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 5: 提交**

```bash
git add src/features/stats/TrendChart.tsx src/features/stats/StatsView.tsx package.json
git commit -m "feat: add trend chart component to stats view"
```

---

## Task 5: 扩展预算功能 - 周预算支持

**Covers:** S6 (预算管理增强)

**Files:**
- Create: `src/domain/weekly.ts`
- Create: `src/domain/__tests__/weekly.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/i18n/index.ts`

**Interfaces:**
- Produces: `WeeklyBudget` 类型
- Produces: `calculateWeeklyBudget()`, `getWeeklyStatus()` 函数

- [ ] **Step 1: 添加周预算类型**

修改 `src/domain/types.ts`，在 `Settings` 接口添加:

```typescript
export interface Settings {
  // ... 现有字段
  weeklyBudget?: number; // 周预算
  budgetMode?: 'monthly' | 'weekly'; // 预算模式
}
```

- [ ] **Step 2: 编写周预算测试**

创建 `src/domain/__tests__/weekly.test.ts`:

```typescript
import { calculateWeeklyBudget, getWeekRange, getWeeklyStatus } from '../weekly';
import type { Entry } from '../types';

describe('Weekly Budget', () => {
  describe('getWeekRange', () => {
    it('should return current week range', () => {
      const { start, end } = getWeekRange(new Date('2026-07-06'));
      expect(start.getDay()).toBe(0); // Sunday
      expect(end.getDay()).toBe(6); // Saturday
    });
  });

  describe('calculateWeeklyBudget', () => {
    it('should calculate daily budget from weekly', () => {
      const daily = calculateWeeklyBudget(700);
      expect(daily).toBe(100);
    });

    it('should handle zero budget', () => {
      const daily = calculateWeeklyBudget(0);
      expect(daily).toBe(0);
    });
  });

  describe('getWeeklyStatus', () => {
    const entries: Entry[] = [
      { id: '1', ts: Date.now(), io: 'exp', cat: 'food', amt: 100 },
      { id: '2', ts: Date.now(), io: 'exp', cat: 'food', amt: 200 },
    ];

    it('should calculate spent amount', () => {
      const status = getWeeklyStatus(entries, 1000);
      expect(status.spent).toBe(300);
      expect(status.remaining).toBe(700);
    });

    it('should detect over budget', () => {
      const status = getWeeklyStatus(entries, 200);
      expect(status.over).toBe(100);
      expect(status.remaining).toBe(0);
    });
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

```bash
npm test -- src/domain/__tests__/weekly.test.ts
```

Expected: FAIL - "Cannot find module '../weekly'"

- [ ] **Step 4: 实现周预算函数**

创建 `src/domain/weekly.ts`:

```typescript
import type { Entry } from './types';

export interface WeekRange {
  start: Date;
  end: Date;
}

export interface WeeklyStatus {
  spent: number;
  remaining: number;
  over: number;
  daysLeft: number;
  dailyBudget: number;
}

/**
 * 获取指定日期所在周的范围（周日到周六）
 */
export function getWeekRange(date: Date): WeekRange {
  const d = new Date(date);
  const day = d.getDay();
  
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
}

/**
 * 从周预算计算每日预算
 */
export function calculateWeeklyBudget(weeklyBudget: number): number {
  return Math.round(weeklyBudget / 7);
}

/**
 * 获取本周预算状态
 */
export function getWeeklyStatus(
  entries: Entry[],
  weeklyBudget: number,
  now: Date = new Date()
): WeeklyStatus {
  const { start, end } = getWeekRange(now);
  
  const weekEntries = entries.filter(
    e => e.ts >= start.getTime() && 
         e.ts <= end.getTime() && 
         e.io === 'exp' && 
         !e.deletedAt
  );
  
  const spent = weekEntries.reduce((s, e) => s + e.amt, 0);
  const remaining = Math.max(0, weeklyBudget - spent);
  const over = Math.max(0, spent - weeklyBudget);
  
  const dayOfWeek = now.getDay();
  const daysLeft = 7 - dayOfWeek;
  const dailyBudget = daysLeft > 0 ? Math.round(remaining / daysLeft) : 0;
  
  return { spent, remaining, over, daysLeft, dailyBudget };
}
```

- [ ] **Step 5: 运行测试验证通过**

```bash
npm test -- src/domain/__tests__/weekly.test.ts
```

Expected: 5 tests passing

- [ ] **Step 6: 添加 i18n 字符串**

修改 `src/i18n/index.ts`，在 `Strings` 接口和翻译对象中添加:

```typescript
// Strings 接口添加
setBudgetWeekly: string;
setBudgetWeeklyD: string;
budgetWeeklyLabel: string;
budgetWeeklyLeft: string;
budgetWeeklyOver: string;

// zh 翻译添加
setBudgetWeekly: '每周预算',
setBudgetWeeklyD: '按周控制花销',
budgetWeeklyLabel: '本周预算',
budgetWeeklyLeft: '本周还能花 %s',
budgetWeeklyOver: '本周超了 %s',

// en 翻译添加
setBudgetWeekly: 'Weekly budget',
setBudgetWeeklyD: 'Control spending by week',
budgetWeeklyLabel: 'This week',
budgetWeeklyLeft: '%s left this week',
budgetWeeklyOver: '%s over this week',
```

- [ ] **Step 7: 提交**

```bash
git add src/domain/weekly.ts src/domain/__tests__/weekly.test.ts src/domain/types.ts src/i18n/index.ts
git commit -m "feat: add weekly budget support with status calculation"
```

---

## Task 6: 实现预算进度条组件

**Covers:** S6 (预算管理增强)

**Files:**
- Create: `src/features/budget/BudgetProgress.tsx`
- Modify: `src/features/budget/BudgetPot.tsx`

**Interfaces:**
- Consumes: `getWeeklyStatus()` from Task 5
- Produces: `BudgetProgress` 组件

- [ ] **Step 1: 创建预算进度条组件**

创建 `src/features/budget/BudgetProgress.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { fmt } from '@/domain/money';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';

interface BudgetProgressProps {
  label: string;
  spent: number;
  total: number;
  lang: Lang;
}

export function BudgetProgress({ label, spent, total, lang }: BudgetProgressProps) {
  const t = useTheme();
  const s = I18N[lang];
  
  const percentage = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
  const remaining = Math.max(0, total - spent);
  const isOver = spent > total;
  
  // 根据使用比例选择颜色
  const getBarColor = () => {
    if (isOver) return '#FF5252';
    if (percentage >= 80) return '#FFA726';
    if (percentage >= 50) return '#FFCA28';
    return t.hibiscus;
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: t.ink }]}>{label}</Text>
        <Text style={[styles.amount, { color: isOver ? '#FF5252' : t.inkSoft }]}>
          {isOver 
            ? s.budgetOver.replace('%s', fmt(spent - total))
            : s.budgetSpentLeft.replace('%s', fmt(spent)).replace('%s', fmt(remaining))
          }
        </Text>
      </View>
      
      <View style={[styles.track, { backgroundColor: t.line }]}>
        <View 
          style={[
            styles.fill, 
            { 
              width: `${Math.min(100, percentage)}%`,
              backgroundColor: getBarColor(),
            }
          ]} 
        />
      </View>
      
      <View style={styles.footer}>
        <Text style={[styles.percent, { color: t.inkSoft }]}>
          {Math.round(percentage)}%
        </Text>
        <Text style={[styles.total, { color: t.inkSoft }]}>
          {fmt(total)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  amount: {
    fontSize: 12,
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  percent: {
    fontSize: 11,
  },
  total: {
    fontSize: 11,
  },
});
```

- [ ] **Step 2: 集成到 BudgetPot 组件**

修改 `src/features/budget/BudgetPot.tsx`，添加进度条:

```tsx
import { BudgetProgress } from './BudgetProgress';

// 在组件内部添加
{settings.weeklyBudget && settings.budgetMode === 'weekly' && (
  <BudgetProgress
    label={s.budgetWeeklyLabel}
    spent={weeklyStatus.spent}
    total={settings.weeklyBudget}
    lang={lang}
  />
)}
```

- [ ] **Step 3: 运行 TypeScript 检查**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add src/features/budget/BudgetProgress.tsx src/features/budget/BudgetPot.tsx
git commit -m "feat: add budget progress bar component"
```

---

## Task 7: 实现预算预测功能

**Covers:** S6 (预算管理增强)

**Files:**
- Create: `src/features/budget/BudgetForecast.tsx`
- Modify: `src/features/budget/BudgetPot.tsx`

**Interfaces:**
- Consumes: 现有的预算数据
- Produces: `BudgetForecast` 组件

- [ ] **Step 1: 创建预算预测组件**

创建 `src/features/budget/BudgetForecast.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { fmt } from '@/domain/money';
import type { Lang } from '@/i18n';

interface BudgetForecastProps {
  spent: number;
  budget: number;
  daysElapsed: number;
  daysInCycle: number;
  lang: Lang;
}

export function BudgetForecast({ 
  spent, budget, daysElapsed, daysInCycle, lang 
}: BudgetForecastProps) {
  const t = useTheme();
  
  if (daysElapsed === 0 || budget === 0) return null;
  
  const dailyRate = spent / daysElapsed;
  const projectedTotal = dailyRate * daysInCycle;
  const projectedOver = projectedTotal - budget;
  const isOnTrack = projectedOver <= 0;
  
  const remainingDays = daysInCycle - daysElapsed;
  const dailyBudgetLeft = remainingDays > 0 
    ? Math.round((budget - spent) / remainingDays) 
    : 0;
  
  return (
    <View style={[styles.container, { backgroundColor: t.card }]}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: t.inkSoft }]}>
          {lang === 'zh' ? '日均消费' : 'Daily avg'}
        </Text>
        <Text style={[styles.value, { color: t.ink }]}>
          {fmt(dailyRate)}
        </Text>
      </View>
      
      <View style={styles.row}>
        <Text style={[styles.label, { color: t.inkSoft }]}>
          {lang === 'zh' ? '月底预测' : 'Month-end forecast'}
        </Text>
        <Text style={[styles.value, { color: isOnTrack ? '#4CAF50' : '#FF5252' }]}>
          {fmt(projectedTotal)}
        </Text>
      </View>
      
      {!isOnTrack && (
        <View style={styles.row}>
          <Text style={[styles.label, { color: t.inkSoft }]}>
            {lang === 'zh' ? '预计超支' : 'Projected over'}
          </Text>
          <Text style={[styles.value, { color: '#FF5252' }]}>
            {fmt(projectedOver)}
          </Text>
        </View>
      )}
      
      {remainingDays > 0 && (
        <View style={styles.row}>
          <Text style={[styles.label, { color: t.inkSoft }]}>
            {lang === 'zh' ? '剩余日均' : 'Daily budget left'}
          </Text>
          <Text style={[styles.value, { color: dailyBudgetLeft > 0 ? t.ink : '#FF5252' }]}>
            {fmt(dailyBudgetLeft)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  label: {
    fontSize: 13,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
  },
});
```

- [ ] **Step 2: 集成到 BudgetPot 组件**

修改 `src/features/budget/BudgetPot.tsx`:

```tsx
import { BudgetForecast } from './BudgetForecast';

// 计算周期天数
const { start, end } = cycleRange(anchor, cycleStart);
const daysInCycle = Math.ceil((end.getTime() - start.getTime()) / 86400000);
const daysElapsed = Math.ceil((Date.now() - start.getTime()) / 86400000);

// 在 JSX 中添加
<BudgetForecast
  spent={exp}
  budget={settings.budget}
  daysElapsed={daysElapsed}
  daysInCycle={daysInCycle}
  lang={lang}
/>
```

- [ ] **Step 3: 运行 TypeScript 检查**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add src/features/budget/BudgetForecast.tsx src/features/budget/BudgetPot.tsx
git commit -m "feat: add budget forecast component with month-end projection"
```

---

## Task 8: 运行完整测试套件并验证

**Covers:** 所有改进的验证

**Files:** 无新增

- [ ] **Step 1: 运行完整测试套件**

```bash
npm test
```

Expected: 所有测试通过（包括新增的测试）

- [ ] **Step 2: 运行 TypeScript 检查**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 3: 运行 lint 检查**

```bash
npm run lint
```

Expected: No errors

- [ ] **Step 4: 提交最终状态**

```bash
git add -A
git commit -m "chore: complete Phase 1 improvements - stats, budget, SQLite"
```

---

## 总结

Phase 1 完成后，应用将具备：

1. **SQLite 存储层** — 更好的性能和查询能力
2. **数据迁移** — 无缝从 AsyncStorage 迁移
3. **趋势分析** — 日/周/分类趋势图表
4. **周预算支持** — 更灵活的预算管理
5. **预算进度条** — 直观的预算使用可视化
6. **预算预测** — 月底支出预测和剩余日均

所有改进都保持向后兼容，现有功能不受影响。
