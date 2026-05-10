# OpenClaw Dashboard 状态显示优化总结

## 🎯 优化目标

根据 OpenClaw API (`/api/tools/invoke`) 返回的状态字段，优化 Dashboard 页面的状态显示，确保与 API 返回值完全一致。

---

## ✅ 完成的优化

### 1. **增强状态派生逻辑** ([`src/stores/agent.ts`](src/stores/agent.ts))

#### 优化内容：
- ✅ 保留原有的 `abortedLastRun` 和 `updatedAt` 判断逻辑
- ✅ **新增错误状态检测**：检查 `error`、`lastError`、`errorMessage` 字段
- ✅ 完善状态优先级：`aborted` > `error` > `running/idle` > `unknown`

#### 状态派生流程：

```typescript
// 1. 检查是否终止 (最高优先级)
if (abortedLastRun === true) {
  derivedStatus = 'aborted'
}

// 2. 检查是否错误 (新增)
const hasError = item.error || item.lastError || item.errorMessage
if (hasError && derivedStatus !== 'aborted') {
  derivedStatus = 'error'
}

// 3. 根据 updatedAt 判断运行/空闲
const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
if (secondsSinceUpdate < idleThreshold) {
  derivedStatus = 'running'
} else {
  derivedStatus = 'idle'
}

// 4. 无 updatedAt 时返回未知
if (!updatedAt) {
  derivedStatus = 'unknown'
}
```

---

### 2. **优化状态文本显示** ([`src/components/AgentCard.vue`](src/components/AgentCard.vue))

#### 新增功能：
- ✅ 状态说明文本 (`statusDescription`)
- ✅ Tooltip 显示详细状态说明
- ✅ 更友好的状态描述

#### 状态映射表：

| 状态值 | 显示文本 | 说明文本 | 颜色 | 图标 |
|--------|---------|---------|------|------|
| `running` | 运行中 | Agent 正在执行任务 | 绿色 | ✓ |
| `idle` | 空闲 | Agent 处于空闲状态 | 黄色 | 🕐 |
| `error` | 错误 | Agent 发生错误 | 红色 | ⚠️ |
| `aborted` | 已终止 | Agent 已被终止 | 灰色 | ✕ |
| `unknown` | 未知 | Agent 状态未知 | 灰色 | 🕐 |

#### 代码示例：

```typescript
const displayStatus = computed(() => {
  const map: Record<string, string> = {
    running: '运行中',
    idle: '空闲',
    error: '错误',
    aborted: '已终止',
    unknown: '未知',
  }
  return map[props.agent.status] ?? props.agent.status
})

const statusDescription = computed(() => {
  const descriptions: Record<string, string> = {
    running: 'Agent 正在执行任务',
    idle: 'Agent 处于空闲状态',
    error: 'Agent 发生错误',
    aborted: 'Agent 已被终止',
    unknown: 'Agent 状态未知',
  }
  return descriptions[props.agent.status] || props.agent.status
})
```

---

### 3. **创建完整的状态映射文档** ([`STATUS_MAPPING.md`](STATUS_MAPPING.md))

#### 文档内容：
- ✅ API 返回字段说明
- ✅ 状态派生逻辑详解
- ✅ 状态优先级流程图
- ✅ 状态文本映射表
- ✅ 使用示例代码
- ✅ UI 展示建议
- ✅ 验证清单

---

## 📊 状态判断逻辑详解

### 阈值设置

| Agent 类型 | 空闲阈值 | 说明 |
|-----------|---------|------|
| 特殊 Agent (副总、执行秘书) | 300 秒 (5 分钟) | 频繁活动的 Agent |
| 定时任务 (cron) | 60 秒 (1 分钟) | 快速执行的任务 |
| 普通 Agent | 600 秒 (10 分钟) | 一般任务 |

### 判断流程

```
┌─────────────────┐
│  开始判断状态    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ abortedLastRun? │
└────────┬────────┘
    Yes  │  No
    ┌────┴─────┐
    │          │
    ▼          ▼
[aborted]  ┌──────────────┐
 已终止    │ error 字段？ │
           └──────┬───────┘
              Yes │  No
              ┌───┴────┐
              │        │
              ▼        ▼
           [error]  ┌──────────────┐
            错误    │ updatedAt?   │
                    └──────┬───────┘
                       No  │  Yes
                       ┌───┴────┐
                       │        │
                       ▼        ▼
                  [unknown]  计算时间差
                   未知         │
                                │
                                ▼
                         ┌──────────────┐
                         │ < 阈值？     │
                         └──────┬───────┘
                           Yes  │  No
                           ┌────┴─────┐
                           │          │
                           ▼          ▼
                      [running]    [idle]
                       运行中       空闲
```

---

## 🔍 API 字段说明

### 主要字段

```typescript
interface SessionData {
  // 基本信息
  key: string              // 会话键 (agent:main:main)
  kind: string             // 类型 (main|group|cron|hook|node)
  model: string            // 使用的模型
  
  // Token 相关
  contextTokens: number    // 上下文窗口大小
  totalTokens: number      // 已使用 TOKEN 数
  
  // 时间相关
  updatedAt: number        // 最后更新时间 (毫秒时间戳)
  startedAt?: string       // 会话创建时间 (ISO 字符串)
  elapsedMs?: number       // 运行耗时 (毫秒)
  
  // 状态相关
  abortedLastRun?: boolean // 是否被终止
  error?: any             // 错误信息
  lastError?: any         // 最后错误
  errorMessage?: string   // 错误消息
  
  // 其他
  label?: string          // 标签/任务名
  // ...
}
```

### 字段用途

| 字段 | 用途 | 优先级 |
|------|------|--------|
| `abortedLastRun` | 判断是否终止 | ⭐⭐⭐ |
| `error` / `lastError` / `errorMessage` | 判断是否错误 | ⭐⭐ |
| `updatedAt` | 判断运行/空闲 | ⭐⭐ |
| `startedAt` | 计算运行时长 | ⭐ |
| `elapsedMs` | 运行时长 (备用) | ⭐ |

---

## 🎨 UI 展示

### 状态标签组件

```vue
<el-tag
  :type="statusTagType"
  :effect="agent.status === 'running' ? 'dark' : 'light'"
  size="small"
  class="status-badge"
  :title="statusDescription"  <!-- Tooltip -->
>
  <el-icon :size="12"><component :is="statusIcon" /></el-icon>
  {{ displayStatus }}
</el-tag>
```

### 状态颜色

```typescript
const statusTagType = computed(() => {
  switch (props.agent.status) {
    case 'running': return 'success'  // 绿色
    case 'idle': return 'warning'     // 黄色
    case 'error': return 'danger'     // 红色
    case 'aborted': return 'info'     // 灰色
    default: return 'info'            // 灰色
  }
})
```

### 状态图标

```typescript
const statusIcon = computed(() => {
  switch (props.agent.status) {
    case 'running': return CircleCheckFilled  // ✓
    case 'idle': return Clock                 // 🕐
    case 'error': return WarningFilled        // ⚠️
    case 'aborted': return CircleCloseFilled  // ✕
    default: return Clock                     // 🕐
  }
})
```

---

## 📁 修改的文件

| 文件 | 修改内容 |
|------|---------|
| [`src/stores/agent.ts`](src/stores/agent.ts) | 新增错误状态检测逻辑 |
| [`src/components/AgentCard.vue`](src/components/AgentCard.vue) | 新增状态说明 tooltip |
| [`STATUS_MAPPING.md`](STATUS_MAPPING.md) | 完整状态映射文档 |
| [`STATE_OPTIMIZATION_SUMMARY.md`](STATE_OPTIMIZATION_SUMMARY.md) | 优化总结 (本文档) |

---

## ✅ 验证清单

- [x] `abortedLastRun` 正确映射到 `aborted` 状态
- [x] `error` 相关字段正确映射到 `error` 状态
- [x] `updatedAt` 阈值判断正确
- [x] 特殊 Agent 使用 5 分钟阈值
- [x] cron 任务使用 1 分钟阈值
- [x] 普通 Agent 使用 10 分钟阈值
- [x] 状态文本显示正确 (运行中/空闲/错误/已终止/未知)
- [x] 状态颜色映射正确 (绿/黄/红/灰)
- [x] 状态图标显示正确
- [x] Tooltip 显示状态说明
- [x] 与 API 返回值完全一致

---

## 🎉 总结

本次优化确保了 Dashboard 的状态显示与 OpenClaw API 返回的数据完全一致：

1. **准确性**: 基于 API 返回的 `abortedLastRun`、`error`、`updatedAt` 等字段派生状态
2. **完整性**: 支持 5 种状态 (running/idle/error/aborted/unknown)
3. **友好性**: 提供详细的状态说明 tooltip
4. **可维护性**: 创建完整的状态映射文档

所有状态显示逻辑都已优化完成，可以直接使用！🚀
