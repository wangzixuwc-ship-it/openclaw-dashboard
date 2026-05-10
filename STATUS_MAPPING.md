# OpenClaw 状态映射文档

## 📊 API 返回字段与状态派生

### API 返回的关键字段

`/api/tools/invoke` (tool: `sessions_list`) 返回的会话数据包含以下关键字段：

```typescript
interface SessionData {
  key: string              // 会话键
  kind: string             // 类型：main|group|cron|hook|node
  model: string            // 使用的模型
  contextTokens: number    // 上下文窗口大小
  totalTokens: number      // 已使用 TOKEN 数
  updatedAt: number        // 最后更新时间（毫秒时间戳）
  startedAt?: string       // 会话创建时间
  abortedLastRun?: boolean // 是否被终止
  elapsedMs?: number       // 运行耗时（毫秒）
  error?: any             // 错误信息（可选）
  lastError?: any         // 最后错误（可选）
  errorMessage?: string   // 错误消息（可选）
  // ... 其他字段
}
```

---

## 🎯 状态派生逻辑

### 状态优先级

```
abortedLastRun = true  →  aborted (已终止)
       ↓
hasError = true        →  error (错误)
       ↓
updatedAt < 阈值        →  running (运行中)
       ↓
updatedAt ≥ 阈值        →  idle (空闲)
       ↓
无 updatedAt           →  unknown (未知)
```

### 详细派生规则

#### 1. **aborted** (已终止)
**条件**: `abortedLastRun === true` 或 `abortedLastRun === 'true'`

**说明**: 
- 这是最高优先级的状态
- 表示会话的最后一次运行被终止
- 用户需要手动重置会话才能继续使用

**显示**: 
- 文本：`已终止`
- 颜色：灰色 (info)
- 图标：`CircleCloseFilled`

---

#### 2. **error** (错误)
**条件**: 
- `error` 字段存在且非空，或
- `lastError` 字段存在且非空，或
- `errorMessage` 字段存在且非空
- 且当前状态不是 `aborted`

**说明**:
- 表示会话在执行过程中遇到错误
- 优先级低于 aborted，高于 running/idle

**显示**:
- 文本：`错误`
- 颜色：红色 (danger)
- 图标：`WarningFilled`

---

#### 3. **running** (运行中)
**条件**: 
- `updatedAt` 存在且大于 0
- 距离现在的时间 < 阈值
- 未设置 abortedLastRun
- 未设置 error 相关字段

**阈值规则**:
- **特殊 Agent** (副总、执行秘书): 300 秒 (5 分钟)
- **定时任务** (cron): 60 秒 (1 分钟)
- **普通 Agent**: 600 秒 (10 分钟)

**说明**:
- 表示 Agent 最近有活动
- 可能正在执行任务，也可能刚刚完成

**显示**:
- 文本：`运行中`
- 颜色：绿色 (success)
- 图标：`CircleCheckFilled`
- 效果：深色背景

---

#### 4. **idle** (空闲)
**条件**:
- `updatedAt` 存在且大于 0
- 距离现在的时间 ≥ 阈值
- 未设置 abortedLastRun
- 未设置 error 相关字段

**说明**:
- 表示 Agent 长时间没有活动
- 处于待机状态，等待新任务

**显示**:
- 文本：`空闲`
- 颜色：黄色 (warning)
- 图标：`Clock`
- 效果：浅色背景

---

#### 5. **unknown** (未知)
**条件**: 
- `updatedAt` 不存在或为 0
- 未设置 abortedLastRun

**说明**:
- 无法确定 Agent 的状态
- 可能是新创建的会话，或者数据不完整

**显示**:
- 文本：`未知`
- 颜色：灰色 (info)
- 图标：`Clock`
- 效果：浅色背景

---

## 📋 状态文本映射表

| 状态值 | 显示文本 | 英文 | 颜色 | 图标 | 说明 |
|--------|---------|------|------|------|------|
| `running` | 运行中 | Running | 绿色 | ✓ | Agent 正在执行任务 |
| `idle` | 空闲 | Idle | 黄色 | 🕐 | Agent 处于空闲状态 |
| `error` | 错误 | Error | 红色 | ⚠️ | Agent 发生错误 |
| `aborted` | 已终止 | Aborted | 灰色 | ✕ | Agent 已被终止 |
| `unknown` | 未知 | Unknown | 灰色 | 🕐 | Agent 状态未知 |

---

## 🔍 状态判断流程图

```
开始
  ↓
检查 abortedLastRun
  ↓ 是
【aborted】已终止 ✓
  ↓ 否
检查 error/lastError/errorMessage
  ↓ 是
【error】错误 ⚠️
  ↓ 否
检查 updatedAt 是否存在
  ↓ 否
【unknown】未知 🕐
  ↓ 是
计算 secondsSinceUpdate
  ↓
判断 Agent 类型
  ├─ 特殊 Agent (副总/执行秘书) → 阈值 300 秒
  ├─ 定时任务 (cron) → 阈值 60 秒
  └─ 普通 Agent → 阈值 600 秒
  ↓
secondsSinceUpdate < 阈值？
  ↓ 是
【running】运行中 ✓
  ↓ 否
【idle】空闲 🕐
```

---

## 💡 使用示例

### 判断 Agent 状态

```typescript
function deriveStatus(session: SessionData): AgentStatus {
  // 1. 检查是否终止
  if (session.abortedLastRun === true) {
    return 'aborted'
  }
  
  // 2. 检查是否错误
  if (session.error || session.lastError || session.errorMessage) {
    return 'error'
  }
  
  // 3. 检查更新时间
  if (!session.updatedAt || session.updatedAt <= 0) {
    return 'unknown'
  }
  
  const secondsSinceUpdate = (Date.now() - session.updatedAt) / 1000
  const agentName = getAgentName(session.key)
  const isSpecialAgent = agentName === '副总' || agentName === '执行秘书'
  const isCronAgent = session.key.includes(':cron:')
  
  // 4. 根据阈值判断
  let idleThreshold = 600  // 默认 10 分钟
  if (isSpecialAgent) {
    idleThreshold = 300  // 5 分钟
  } else if (isCronAgent) {
    idleThreshold = 60   // 1 分钟
  }
  
  return secondsSinceUpdate < idleThreshold ? 'running' : 'idle'
}
```

---

## 🎨 UI 展示建议

### 状态标签样式

```vue
<el-tag
  :type="statusType"
  :effect="status === 'running' ? 'dark' : 'light'"
  size="small"
  :title="statusDescription"
>
  <el-icon><component :is="statusIcon" /></el-icon>
  {{ statusText }}
</el-tag>
```

### 状态类型映射

```typescript
const statusTypeMap: Record<AgentStatus, string> = {
  running: 'success',  // 绿色
  idle: 'warning',     // 黄色
  error: 'danger',     // 红色
  aborted: 'info',     // 灰色
  unknown: 'info',     // 灰色
}
```

### 状态图标映射

```typescript
const statusIconMap: Record<AgentStatus, Component> = {
  running: CircleCheckFilled,
  idle: Clock,
  error: WarningFilled,
  aborted: CircleCloseFilled,
  unknown: Clock,
}
```

---

## 📌 注意事项

1. **abortedLastRun 优先级最高**: 一旦设置，其他状态判断都不再生效
2. **错误检测**: 支持多个错误字段，增加容错性
3. **阈值可配置**: 不同类型的 Agent 使用不同的空闲阈值
4. **时间单位**: `updatedAt` 是毫秒时间戳，计算时需要转换为秒
5. **状态持久化**: 状态是派生的，不会保存到 API 响应中

---

## 🔄 状态变化示例

### 正常运行流程
```
创建 → running → idle → running → idle → ...
```

### 错误流程
```
创建 → running → error → (需要重置) → running
```

### 终止流程
```
创建 → running → aborted → (需要重置) → running
```

---

## ✅ 验证清单

- [x] abortedLastRun 正确映射到 aborted 状态
- [x] error 相关字段正确映射到 error 状态
- [x] updatedAt 阈值判断正确
- [x] 特殊 Agent 使用不同阈值
- [x] cron 任务使用更短阈值
- [x] 状态文本显示正确
- [x] 状态颜色映射正确
- [x] 状态图标显示正确
- [x] tooltip 显示状态说明

---

此文档确保了 Dashboard 的状态显示与 OpenClaw API 返回的数据完全一致！🎉
