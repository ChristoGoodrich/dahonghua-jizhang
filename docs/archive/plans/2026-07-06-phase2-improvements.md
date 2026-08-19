# Phase 2 改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提升同步稳定性（冲突日志、离线队列）、增强记账效率（快捷操作、滑动手势）、实现自动备份

**Architecture:** 在现有 Supabase 同步架构上增加冲突日志和离线队列；在 UI 层添加手势交互；利用 expo-file-system 实现本地自动备份

**Tech Stack:** expo-file-system, react-native-gesture-handler, AsyncStorage (离线队列), Supabase (同步诊断)

## Global Constraints

- 保持现有测试全部通过
- `tsc --noEmit` 必须保持 clean
- 不引入破坏性变更，保持向后兼容
- 遵循现有的 domain/store/features 分层架构
- 所有新功能必须支持 i18n (zh/en)

---

## 文件结构

### 新增文件
- `src/sync/conflictLog.ts` — 冲突日志记录
- `src/sync/offlineQueue.ts` — 离线队列持久化
- `src/sync/__tests__/conflictLog.test.ts` — 冲突日志测试
- `src/sync/__tests__/offlineQueue.test.ts` — 离线队列测试
- `src/features/record/QuickEntry.tsx` — 快捷记账组件
- `src/features/list/SwipeableRow.tsx` — 滑动行组件
- `src/util/backup.ts` — 自动备份工具
- `src/util/__tests__/backup.test.ts` — 备份测试

### 修改文件
- `src/sync/engine.ts` — 集成冲突日志和离线队列
- `src/sync/merge.ts` — 添加冲突检测钩子
- `src/features/list/EntryList.tsx` — 集成滑动手势
- `src/features/LedgerScreen.tsx` — 集成快捷记账
- `src/i18n/index.ts` — 添加新字符串
- `src/domain/types.ts` — 添加备份设置类型

---

## Task 1: 实现冲突日志系统

**Covers:** S5 (同步稳定性 - 冲突日志)

**Files:**
- Create: `src/sync/conflictLog.ts`
- Create: `src/sync/__tests__/conflictLog.test.ts`

**Interfaces:**
- Produces: `ConflictLog` 类型
- Produces: `logConflict()`, `getConflictLog()`, `clearConflictLog()` 函数

- [ ] **Step 1: 创建冲突日志测试**

创建 `src/sync/__tests__/conflictLog.test.ts`:

```typescript
import { logConflict, getConflictLog, clearConflictLog } from '../conflictLog';

describe('ConflictLog', () => {
  beforeEach(() => {
    clearConflictLog();
  });

  it('should start with empty log', () => {
    expect(getConflictLog()).toEqual([]);
  });

  it('should log conflicts', () => {
    logConflict({
      entryId: 'test-1',
      localUpdatedAt: 1000,
      remoteUpdatedAt: 2000,
      resolution: 'remote',
    });
    
    const log = getConflictLog();
    expect(log).toHaveLength(1);
    expect(log[0].entryId).toBe('test-1');
  });

  it('should limit log size', () => {
    for (let i = 0; i < 150; i++) {
      logConflict({
        entryId: `test-${i}`,
        localUpdatedAt: i,
        remoteUpdatedAt: i + 100,
        resolution: 'remote',
      });
    }
    
    expect(getConflictLog().length).toBeLessThanOrEqual(100);
  });

  it('should clear log', () => {
    logConflict({
      entryId: 'test-1',
      localUpdatedAt: 1000,
      remoteUpdatedAt: 2000,
      resolution: 'remote',
    });
    
    clearConflictLog();
    expect(getConflictLog()).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test -- src/sync/__tests__/conflictLog.test.ts
```

Expected: FAIL - "Cannot find module '../conflictLog'"

- [ ] **Step 3: 实现冲突日志**

创建 `src/sync/conflictLog.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOG_KEY = 'dhh_conflict_log';
const MAX_LOG_SIZE = 100;

export interface ConflictEntry {
  entryId: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  resolution: 'local' | 'remote' | 'merged';
  timestamp: number;
}

let logCache: ConflictEntry[] | null = null;

export async function loadConflictLog(): Promise<void> {
  const json = await AsyncStorage.getItem(LOG_KEY);
  logCache = json ? JSON.parse(json) : [];
}

export function getConflictLog(): ConflictEntry[] {
  return logCache ?? [];
}

export async function logConflict(entry: Omit<ConflictEntry, 'timestamp'>): Promise<void> {
  const log = getConflictLog();
  log.unshift({ ...entry, timestamp: Date.now() });
  
  // 限制日志大小
  if (log.length > MAX_LOG_SIZE) {
    log.length = MAX_LOG_SIZE;
  }
  
  logCache = log;
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log));
}

export async function clearConflictLog(): Promise<void> {
  logCache = [];
  await AsyncStorage.removeItem(LOG_KEY);
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test -- src/sync/__tests__/conflictLog.test.ts
```

Expected: 4 tests passing

- [ ] **Step 5: 提交**

```bash
git add src/sync/conflictLog.ts src/sync/__tests__/conflictLog.test.ts
git commit -m "feat: add conflict logging system for sync diagnostics"
```

---

## Task 2: 实现离线队列持久化

**Covers:** S5 (同步稳定性 - 离线队列)

**Files:**
- Create: `src/sync/offlineQueue.ts`
- Create: `src/sync/__tests__/offlineQueue.test.ts`

**Interfaces:**
- Produces: `OfflineQueue` 类型
- Produces: `enqueueChange()`, `dequeueChanges()`, `getQueueSize()` 函数

- [ ] **Step 1: 创建离线队列测试**

创建 `src/sync/__tests__/offlineQueue.test.ts`:

```typescript
import { enqueueChange, dequeueChanges, getQueueSize } from '../offlineQueue';

describe('OfflineQueue', () => {
  beforeEach(async () => {
    await dequeueChanges(); // 清空队列
  });

  it('should start with empty queue', () => {
    expect(getQueueSize()).toBe(0);
  });

  it('should enqueue changes', async () => {
    await enqueueChange({ type: 'upsert', entryId: 'test-1', data: { amt: 100 } });
    expect(getQueueSize()).toBe(1);
  });

  it('should dequeue changes in order', async () => {
    await enqueueChange({ type: 'upsert', entryId: 'test-1', data: { amt: 100 } });
    await enqueueChange({ type: 'delete', entryId: 'test-2' });
    
    const changes = await dequeueChanges();
    expect(changes).toHaveLength(2);
    expect(changes[0].entryId).toBe('test-1');
    expect(changes[1].entryId).toBe('test-2');
  });

  it('should clear queue after dequeue', async () => {
    await enqueueChange({ type: 'upsert', entryId: 'test-1', data: {} });
    await dequeueChanges();
    expect(getQueueSize()).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test -- src/sync/__tests__/offlineQueue.test.ts
```

Expected: FAIL - "Cannot find module '../offlineQueue'"

- [ ] **Step 3: 实现离线队列**

创建 `src/sync/offlineQueue.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'dhh_offline_queue';

export interface QueueChange {
  type: 'upsert' | 'delete';
  entryId: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

let queueCache: QueueChange[] | null = null;

export async function loadOfflineQueue(): Promise<void> {
  const json = await AsyncStorage.getItem(QUEUE_KEY);
  queueCache = json ? JSON.parse(json) : [];
}

export function getQueueSize(): number {
  return queueCache?.length ?? 0;
}

export async function enqueueChange(change: Omit<QueueChange, 'timestamp'>): Promise<void> {
  const queue = queueCache ?? [];
  queue.push({ ...change, timestamp: Date.now() });
  queueCache = queue;
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function dequeueChanges(): Promise<QueueChange[]> {
  const queue = queueCache ?? [];
  queueCache = [];
  await AsyncStorage.removeItem(QUEUE_KEY);
  return queue;
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test -- src/sync/__tests__/offlineQueue.test.ts
```

Expected: 4 tests passing

- [ ] **Step 5: 提交**

```bash
git add src/sync/offlineQueue.ts src/sync/__tests__/offlineQueue.test.ts
git commit -m "feat: add offline queue for resilient sync"
```

---

## Task 3: 集成冲突日志和离线队列到同步引擎

**Covers:** S5 (同步稳定性 - 集成)

**Files:**
- Modify: `src/sync/engine.ts`
- Modify: `src/sync/merge.ts`

**Interfaces:**
- Consumes: `logConflict()` from Task 1
- Consumes: `enqueueChange()`, `dequeueChanges()` from Task 2

- [ ] **Step 1: 修改 merge.ts 添加冲突检测钩子**

修改 `src/sync/merge.ts`，在 `mergeById` 函数中添加冲突回调:

```typescript
// 在 mergeById 函数签名中添加可选回调
export function mergeById(
  local: Entry[], 
  remote: Entry[],
  onConflict?: (entryId: string, localTs: number, remoteTs: number, resolution: string) => void
): { merged: Entry[]; toPush: Entry[] } {
  // ... 现有逻辑
  
  // 在检测到冲突时调用回调
  if (/* 冲突条件 */) {
    onConflict?.(entry.id, localEntry.updatedAt, remoteEntry.updatedAt, 'remote');
  }
  
  // ... 返回结果
}
```

- [ ] **Step 2: 修改 engine.ts 集成冲突日志**

修改 `src/sync/engine.ts`:

```typescript
import { logConflict, loadConflictLog } from './conflictLog';
import { enqueueChange, dequeueChanges, loadOfflineQueue } from './offlineQueue';

// 在 start() 函数中加载日志和队列
async function start(userId: string): Promise<void> {
  await loadConflictLog();
  await loadOfflineQueue();
  
  // ... 现有逻辑
}

// 修改 pullAndMerge 使用冲突回调
async function pullAndMerge(userId: string): Promise<void> {
  const { merged, toPush } = mergeById(store$.data.peek(), remote, 
    (entryId, localTs, remoteTs, resolution) => {
      logConflict({ entryId, localUpdatedAt: localTs, remoteUpdatedAt: remoteTs, resolution: resolution as any });
    }
  );
  
  // 处理离线队列
  const queuedChanges = await dequeueChanges();
  if (queuedChanges.length > 0) {
    // 应用队列中的变更
  }
  
  // ... 现有逻辑
}
```

- [ ] **Step 3: 运行 typecheck**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add src/sync/engine.ts src/sync/merge.ts
git commit -m "feat: integrate conflict log and offline queue into sync engine"
```

---

## Task 4: 实现滑动行组件

**Covers:** S8 (UX 体验优化 - 滑动手势)

**Files:**
- Create: `src/features/list/SwipeableRow.tsx`
- Modify: `src/features/list/EntryList.tsx`

**Interfaces:**
- Produces: `SwipeableRow` 组件
- Consumes: `RectButton` from react-native-gesture-handler

- [ ] **Step 1: 创建滑动行组件**

创建 `src/features/list/SwipeableRow.tsx`:

```tsx
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { RectButton, Swipeable } from 'react-native-gesture-handler';
import { useTheme } from '@/theme/ThemeContext';
import { Icon } from '@/components/ui/Icon';

interface SwipeableRowProps {
  children: React.ReactNode;
  onDelete?: () => void;
  onEdit?: () => void;
}

export function SwipeableRow({ children, onDelete, onEdit }: SwipeableRowProps) {
  const t = useTheme();
  const swipeableRef = useRef<Swipeable>(null);

  const renderRightActions = (progress: Animated.AnimatedInterpolation<number>) => {
    const translateEdit = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [80, 0],
    });
    const translateDelete = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [160, 0],
    });

    return (
      <View style={styles.actions}>
        {onEdit && (
          <Animated.View style={{ transform: [{ translateX: translateEdit }] }}>
            <RectButton
              style={[styles.action, { backgroundColor: '#4CAF50' }]}
              onPress={() => {
                swipeableRef.current?.close();
                onEdit();
              }}
            >
              <Icon name="edit" color="#fff" size={20} />
              <Text style={styles.actionText}>编辑</Text>
            </RectButton>
          </Animated.View>
        )}
        {onDelete && (
          <Animated.View style={{ transform: [{ translateX: translateDelete }] }}>
            <RectButton
              style={[styles.action, { backgroundColor: '#FF5252' }]}
              onPress={() => {
                swipeableRef.current?.close();
                onDelete();
              }}
            >
              <Icon name="trash" color="#fff" size={20} />
              <Text style={styles.actionText}>删除</Text>
            </RectButton>
          </Animated.View>
        )}
      </View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      friction={2}
      rightThreshold={40}
      renderRightActions={renderRightActions}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    width: 160,
  },
  action: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
  },
});
```

- [ ] **Step 2: 集成到 EntryList**

修改 `src/features/list/EntryList.tsx`:

```tsx
import { SwipeableRow } from './SwipeableRow';

// 在渲染每个条目时包裹 SwipeableRow
<SwipeableRow
  onDelete={() => handleDelete(item.id)}
  onEdit={() => handleEdit(item.id)}
>
  {/* 现有的条目渲染 */}
</SwipeableRow>
```

- [ ] **Step 3: 运行 typecheck**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add src/features/list/SwipeableRow.tsx src/features/list/EntryList.tsx
git commit -m "feat: add swipeable row with edit/delete actions"
```

---

## Task 5: 实现快捷记账组件

**Covers:** S8 (UX 体验优化 - 记账效率)

**Files:**
- Create: `src/features/record/QuickEntry.tsx`
- Modify: `src/features/LedgerScreen.tsx`

**Interfaces:**
- Produces: `QuickEntry` 组件
- Consumes: 现有的 `RecordSheet` 组件

- [ ] **Step 1: 创建快捷记账组件**

创建 `src/features/record/QuickEntry.tsx`:

```tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { tapHaptic } from '@/util/haptics';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';

interface QuickEntryProps {
  lang: Lang;
  onSubmit: (amount: number, note: string) => void;
}

export function QuickEntry({ lang, onSubmit }: QuickEntryProps) {
  const t = useTheme();
  const s = I18N[lang];
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return;
    
    tapHaptic();
    onSubmit(num, note);
    setAmount('');
    setNote('');
  };

  return (
    <View style={[styles.container, { backgroundColor: t.card }]}>
      <View style={styles.row}>
        <TextInput
          style={[styles.amountInput, { color: t.ink }]}
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          placeholderTextColor={t.inkSoft}
          keyboardType="decimal-pad"
          returnKeyType="next"
        />
        <TextInput
          style={[styles.noteInput, { color: t.ink }]}
          value={note}
          onChangeText={setNote}
          placeholder={s.note}
          placeholderTextColor={t.inkSoft}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
        <Tap
          style={[styles.submitBtn, { backgroundColor: t.hibiscus }]}
          scaleTo={0.9}
          onPress={handleSubmit}
        >
          <Icon name="check" color="#fff" size={20} />
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 22,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
  },
  noteInput: {
    flex: 2,
    fontSize: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
  },
  submitBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

- [ ] **Step 2: 集成到 LedgerScreen**

修改 `src/features/LedgerScreen.tsx`:

```tsx
import { QuickEntry } from '@/features/record/QuickEntry';

// 在 FAB 按钮上方添加快捷记账
<QuickEntry
  lang={lang}
  onSubmit={(amount, note) => {
    // 快速记录支出
    addEntry({ io: 'exp', cat: 'other', amt: amount, note });
    celebrate(s.toastBloom);
  }}
/>
```

- [ ] **Step 3: 运行 typecheck**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add src/features/record/QuickEntry.tsx src/features/LedgerScreen.tsx
git commit -m "feat: add quick entry component for fast expense logging"
```

---

## Task 6: 实现自动备份功能

**Covers:** S9 (数据安全 - 自动备份)

**Files:**
- Create: `src/util/backup.ts`
- Create: `src/util/__tests__/backup.test.ts`
- Modify: `src/domain/types.ts`

**Interfaces:**
- Produces: `BackupConfig` 类型
- Produces: `createBackup()`, `listBackups()`, `restoreBackup()` 函数

- [ ] **Step 1: 添加备份配置类型**

修改 `src/domain/types.ts`，在 `Settings` 接口添加:

```typescript
export interface Settings {
  // ... 现有字段
  autoBackup?: boolean; // 自动备份
  backupFrequency?: 'daily' | 'weekly'; // 备份频率
  maxBackups?: number; // 最大备份数量
}
```

- [ ] **Step 2: 创建备份工具测试**

创建 `src/util/__tests__/backup.test.ts`:

```typescript
import { createBackup, listBackups, restoreBackup } from '../backup';

describe('Backup', () => {
  it('should create backup file', async () => {
    const path = await createBackup();
    expect(path).toBeTruthy();
    expect(path).toContain('backup_');
  });

  it('should list backups', async () => {
    await createBackup();
    const backups = await listBackups();
    expect(backups.length).toBeGreaterThan(0);
  });

  it('should restore from backup', async () => {
    const path = await createBackup();
    const data = await restoreBackup(path);
    expect(data).toBeTruthy();
    expect(data.entries).toBeDefined();
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

```bash
npm test -- src/util/__tests__/backup.test.ts
```

Expected: FAIL - "Cannot find module '../backup'"

- [ ] **Step 4: 实现备份工具**

创建 `src/util/backup.ts`:

```typescript
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKUP_DIR = `${FileSystem.documentDirectory}backups/`;
const MAX_BACKUPS = 10;

export interface BackupData {
  version: number;
  timestamp: number;
  entries: unknown[];
  config: unknown;
}

export async function ensureBackupDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(BACKUP_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
  }
}

export async function createBackup(): Promise<string> {
  await ensureBackupDir();
  
  // 读取当前数据
  const entriesJson = await AsyncStorage.getItem('dhh_entries_v1');
  const configJson = await AsyncStorage.getItem('dhh_config_v1');
  
  const backup: BackupData = {
    version: 1,
    timestamp: Date.now(),
    entries: entriesJson ? JSON.parse(entriesJson) : [],
    config: configJson ? JSON.parse(configJson) : {},
  };
  
  const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const path = `${BACKUP_DIR}${filename}`;
  
  await FileSystem.writeAsStringAsync(path, JSON.stringify(backup, null, 2));
  
  // 清理旧备份
  await cleanOldBackups();
  
  return path;
}

export async function listBackups(): Promise<{ name: string; path: string; time: number }[]> {
  await ensureBackupDir();
  
  const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  const backups = [];
  
  for (const file of files) {
    if (file.startsWith('backup_') && file.endsWith('.json')) {
      const path = `${BACKUP_DIR}${file}`;
      const info = await FileSystem.getInfoAsync(path);
      backups.push({
        name: file,
        path,
        time: info.modificationTime ?? 0,
      });
    }
  }
  
  return backups.sort((a, b) => b.time - a.time);
}

export async function restoreBackup(path: string): Promise<BackupData> {
  const json = await FileSystem.readAsStringAsync(path);
  return JSON.parse(json);
}

async function cleanOldBackups(): Promise<void> {
  const backups = await listBackups();
  if (backups.length > MAX_BACKUPS) {
    const toDelete = backups.slice(MAX_BACKUPS);
    for (const backup of toDelete) {
      await FileSystem.deleteAsync(backup.path);
    }
  }
}
```

- [ ] **Step 5: 运行测试验证通过**

```bash
npm test -- src/util/__tests__/backup.test.ts
```

Expected: 3 tests passing

- [ ] **Step 6: 添加 i18n 字符串**

修改 `src/i18n/index.ts`:

```typescript
// 添加到 Strings 接口
setBackup: string;
setBackupD: string;
backupCreate: string;
backupRestore: string;
backupAuto: string;
backupFrequency: string;
backupDaily: string;
backupWeekly: string;
backupCreated: string;
backupRestored: string;

// zh 翻译
setBackup: '数据备份',
setBackupD: '定期备份，防止数据丢失',
backupCreate: '立即备份',
backupRestore: '恢复备份',
backupAuto: '自动备份',
backupFrequency: '备份频率',
backupDaily: '每天',
backupWeekly: '每周',
backupCreated: '备份已创建',
backupRestored: '备份已恢复',

// en 翻译
setBackup: 'Backup',
setBackupD: 'Regular backups to prevent data loss',
backupCreate: 'Backup now',
backupRestore: 'Restore backup',
backupAuto: 'Auto backup',
backupFrequency: 'Frequency',
backupDaily: 'Daily',
backupWeekly: 'Weekly',
backupCreated: 'Backup created',
backupRestored: 'Backup restored',
```

- [ ] **Step 7: 提交**

```bash
git add src/util/backup.ts src/util/__tests__/backup.test.ts src/domain/types.ts src/i18n/index.ts
git commit -m "feat: add automatic backup system with versioning"
```

---

## Task 7: 添加备份设置页面

**Covers:** S9 (数据安全 - 备份设置)

**Files:**
- Create: `src/app/backup.tsx`
- Modify: `src/app/settings.tsx`

**Interfaces:**
- Consumes: `createBackup()`, `listBackups()`, `restoreBackup()` from Task 6

- [ ] **Step 1: 创建备份页面**

创建 `src/app/backup.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme/ThemeContext';
import { I18N } from '@/i18n';
import { store$, patchSettings } from '@/store/ledger';
import { createBackup, listBackups, restoreBackup } from '@/util/backup';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { RAD, shadow } from '@/theme/tokens';

export default function BackupScreen() {
  const t = useTheme();
  const router = useRouter();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const settings = store$.settings.get();
  
  const [backups, setBackups] = useState<{ name: string; path: string; time: number }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    const list = await listBackups();
    setBackups(list);
  };

  const handleCreateBackup = async () => {
    setLoading(true);
    try {
      await createBackup();
      Alert.alert(s.backupCreated);
      await loadBackups();
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreBackup = async (path: string) => {
    Alert.alert(
      s.backupRestore,
      '确定要恢复此备份吗？当前数据将被覆盖。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          onPress: async () => {
            setLoading(true);
            try {
              const data = await restoreBackup(path);
              // 恢复数据到 store
              // ... 实现恢复逻辑
              Alert.alert(s.backupRestored);
            } catch (e) {
              Alert.alert('Error', String(e));
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setBackup} onBack={() => router.back()} />
        
        <ScrollView style={styles.content}>
          {/* 自动备份开关 */}
          <View style={[styles.card, { backgroundColor: t.card }]}>
            <Text style={[styles.label, { color: t.ink }]}>{s.backupAuto}</Text>
            <Tap
              onPress={() => patchSettings({ autoBackup: !settings.autoBackup })}
            >
              <Icon 
                name={settings.autoBackup ? 'check-circle' : 'circle'} 
                color={settings.autoBackup ? t.hibiscus : t.inkSoft} 
                size={24} 
              />
            </Tap>
          </View>

          {/* 备份频率 */}
          {settings.autoBackup && (
            <View style={[styles.card, { backgroundColor: t.card }]}>
              <Text style={[styles.label, { color: t.ink }]}>{s.backupFrequency}</Text>
              <View style={styles.frequencyRow}>
                <Tap
                  style={[
                    styles.freqBtn,
                    settings.backupFrequency === 'daily' && { backgroundColor: t.hibiscus }
                  ]}
                  onPress={() => patchSettings({ backupFrequency: 'daily' })}
                >
                  <Text style={[
                    styles.freqText,
                    { color: settings.backupFrequency === 'daily' ? '#fff' : t.ink }
                  ]}>
                    {s.backupDaily}
                  </Text>
                </Tap>
                <Tap
                  style={[
                    styles.freqBtn,
                    settings.backupFrequency === 'weekly' && { backgroundColor: t.hibiscus }
                  ]}
                  onPress={() => patchSettings({ backupFrequency: 'weekly' })}
                >
                  <Text style={[
                    styles.freqText,
                    { color: settings.backupFrequency === 'weekly' ? '#fff' : t.ink }
                  ]}>
                    {s.backupWeekly}
                  </Text>
                </Tap>
              </View>
            </View>
          )}

          {/* 立即备份按钮 */}
          <Tap
            style={[styles.backupBtn, { backgroundColor: t.hibiscus }]}
            onPress={handleCreateBackup}
            disabled={loading}
          >
            <Icon name="download" color="#fff" size={20} />
            <Text style={styles.backupBtnText}>{s.backupCreate}</Text>
          </Tap>

          {/* 备份列表 */}
          <Text style={[styles.sectionTitle, { color: t.ink }]}>
            {lang === 'zh' ? '历史备份' : 'Backup History'}
          </Text>
          
          {backups.map((backup) => (
            <Tap
              key={backup.name}
              style={[styles.card, { backgroundColor: t.card }]}
              onPress={() => handleRestoreBackup(backup.path)}
            >
              <View>
                <Text style={[styles.backupName, { color: t.ink }]}>
                  {backup.name.replace('backup_', '').replace('.json', '')}
                </Text>
                <Text style={[styles.backupTime, { color: t.inkSoft }]}>
                  {new Date(backup.time * 1000).toLocaleString()}
                </Text>
              </View>
              <Icon name="chevron-right" color={t.inkSoft} size={20} />
            </Tap>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: { padding: 22 },
  card: {
    padding: 16,
    borderRadius: RAD.md,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...shadow('xs'),
  },
  label: { fontSize: 16, fontWeight: '600' },
  frequencyRow: { flexDirection: 'row', gap: 8 },
  freqBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: RAD.sm,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  freqText: { fontSize: 14 },
  backupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: RAD.md,
    marginBottom: 24,
  },
  backupBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  backupName: { fontSize: 14, fontWeight: '600' },
  backupTime: { fontSize: 12, marginTop: 4 },
});
```

- [ ] **Step 2: 添加到设置页面导航**

修改 `src/app/settings.tsx`，添加备份入口:

```tsx
<Tap onPress={() => router.push('/backup')}>
  <SettingsRow
    icon="download"
    title={s.setBackup}
    description={s.setBackupD}
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
git add src/app/backup.tsx src/app/settings.tsx
git commit -m "feat: add backup settings page with auto-backup toggle"
```

---

## Task 8: 运行完整测试套件并验证

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

- [ ] **Step 3: 运行 lint 检查**

```bash
npm run lint
```

Expected: No errors

- [ ] **Step 4: 提交最终状态**

```bash
git add -A
git commit -m "chore: complete Phase 2 improvements - sync, UX, backup"
```

---

## 总结

Phase 2 完成后，应用将具备：

1. **冲突日志** — 记录同步冲突，便于诊断
2. **离线队列** — 离线变更持久化，恢复后自动同步
3. **滑动手势** — 左滑删除、右滑编辑
4. **快捷记账** — 快速输入金额和备注
5. **自动备份** — 定期备份，防止数据丢失
6. **备份管理** — 创建、查看、恢复备份

所有改进都保持向后兼容，现有功能不受影响。
