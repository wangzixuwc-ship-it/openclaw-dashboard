# OpenClaw Dashboard API 使用指南

## 目录

- [API 概述](#api-概述)
- [核心 API 调用](#核心-api-调用)
- [使用示例](#使用示例)
- [数据计算逻辑](#数据计算逻辑)

---

## API 概述

OpenClaw Dashboard 使用以下 API 端点获取运行指标：

| API | 端点 | 用途 |
|-----|------|------|
| **Gateway API** | `POST /tools/invoke` | 调用 OpenClaw 工具 |
| **Usage Stats API** | `GET /api/usage` | 获取全局用量统计 |
| **Health API** | `GET /health` | 健康检查 |

---

## 核心 API 调用

### 1. 获取会话列表 (sessions_list)

```typescript
import { sessionsList } from '@/api/gateway'

const sessions = await sessionsList({
  activeMinutes: 1440,  // 最近 24 小时 (可选)
  limit: 100,           // 最大返回数量 (可选)
  messageLimit: 0       // 每条会话的消息数，0=不返回 (可选)
})
```

**响应字段**:
```typescript
{
  sessions: [
    {
      key: "agent:main:main",           // 会话键
      kind: "main",                      // 类型：main|group|cron|hook
      model: "gpt-4",                    // 使用的模型
      contextTokens: 128000,            // 上下文窗口大小
      totalTokens: 154000,              // 已使用 TOKEN 数
      updatedAt: 1715140800000,         // 最后更新时间 (毫秒)
      startedAt: "2026-05-08T10:00:00", // 会话创建时间
      abortedLastRun: false,            // 是否被终止
      elapsedMs: 3600000,               // 运行耗时 (毫秒)
      // ... 其他字段
    }
  ]
}
```

### 2. 获取会话状态 (session_status)

```typescript
import { sessionStatus } from '@/api/gateway'

const status = await sessionStatus('agent:main:main')
```

### 3. 重置会话 (sessions_send)

```typescript
import { resetSession } from '@/api/gateway'

// 发送 /reset 命令
await resetSession('agent:main:main')

// 或发送其他命令
import { sessionsSend } from '@/api/gateway'
await sessionsSend('agent:main:main', '/new', 0)  // 新建会话
```

### 4. 获取会话历史 (sessions_history)

```typescript
import { getSessionHistory } from '@/api/gateway'

const history = await getSessionHistory('agent:main:main', {
  limit: 50,           // 返回最近 50 条
  includeTools: false  // 不包含工具调用结果
})
```

### 5. 获取全局用量统计 (Usage Stats API)

```typescript
import { getUsageStats } from '@/api/usage-stats'

const stats = await getUsageStats()
```

**响应字段**:
```typescript
{
  totalTokens: 1250000,     // 总 TOKEN 消耗
  totalCost: 3.45,          // 总费用 (美元)
  byAgent: {
    "main": {
      tokens: 500000,
      cost: 1.20,
      sessionCount: 5
    },
    "backend": {
      tokens: 750000,
      cost: 2.25,
      sessionCount: 3
    }
  },
  updatedAt: "2026-05-10T12:00:00.000Z",
  version: "2026.3.13"
}
```

---

## 使用示例

### 示例 1: 计算运行时间

```typescript
import { sessionsList } from '@/api/gateway'

async function calculateUptime(): Promise<string> {
  const data = await sessionsList() as any
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  
  if (sessions.length === 0) return '未知'
  
  // 找到最早的会话创建时间
  const oldestTime = sessions.reduce((min: number, session: any) => {
    const createdAt = session.startedAt || session.createdAt
    if (!createdAt) return min
    const time = new Date(createdAt).getTime()
    return time < min ? time : min
  }, Infinity)
  
  const now = Date.now()
  const uptimeMs = now - oldestTime
  
  // 格式化
  const hours = Math.floor(uptimeMs / (1000 * 60 * 60))
  const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60))
  
  return `${hours}小时${minutes}分钟`
}
```

### 示例 2: 计算运行时间内的总 TOKEN

```typescript
import { sessionsList } from '@/api/gateway'

async function calculateTotalTokens(): Promise<number> {
  const data = await sessionsList() as any
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  
  // 找到运行开始时间
  const uptimeStart = sessions.reduce((min: number, s: any) => {
    const t = new Date(s.startedAt || s.createdAt).getTime()
    return t < min ? t : min
  }, Infinity)
  
  // 过滤运行时间内的会话并累加 TOKEN
  return sessions
    .filter((s: any) => {
      const t = new Date(s.startedAt || s.createdAt).getTime()
      return t >= uptimeStart
    })
    .reduce((sum: number, s: any) => {
      return sum + (Number(s.totalTokens) || 0)
    }, 0)
}
```

### 示例 3: 计算总费用

```typescript
import { getUsageStats } from '@/api/usage-stats'

async function calculateTotalCost(uptimeMs: number): Promise<string> {
  const stats = await getUsageStats()
  
  // OpenClaw 实际费用
  const openclawCost = stats.totalCost || 0
  
  // 电费：¥2/小时
  const ELECTRICITY_PER_HOUR = 2
  const uptimeHours = uptimeMs / (1000 * 60 * 60)
  const electricityCost = uptimeHours * ELECTRICITY_PER_HOUR
  
  const totalCost = openclawCost + electricityCost
  
  // 格式化
  if (totalCost < 0.01) return '<¥0.01'
  return '¥' + totalCost.toFixed(2)
}
```

### 示例 4: 派生会话状态

```typescript
function deriveSessionStatus(session: any): 'running' | 'idle' | 'error' | 'aborted' | 'unknown' {
  // 1. 检查是否终止
  if (session.abortedLastRun === true) {
    return 'aborted'
  }
  
  // 2. 根据更新时间判断
  const updatedAt = session.updatedAt
  if (updatedAt > 0) {
    const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
    
    // 特殊 Agent (副总、执行秘书、定时器)
    const isSpecialAgent = session.name === '副总' || session.name === '执行秘书'
    const isCronAgent = session.key.includes(':cron:')
    
    if (isSpecialAgent || isCronAgent) {
      const idleThreshold = isCronAgent ? 60 : 300
      return secondsSinceUpdate < idleThreshold ? 'running' : 'idle'
    } else {
      const idleThreshold = 600  // 10 分钟
      return secondsSinceUpdate < idleThreshold ? 'running' : 'idle'
    }
  }
  
  return 'unknown'
}
```

---

## 数据计算逻辑

### 运行时间 (Uptime)

```typescript
// 1. 从 sessions_list 获取所有会话
const sessions = await sessionsList()

// 2. 找到最早的 startedAt 时间
const oldestSessionTime = sessions.reduce((min, s) => {
  const t = new Date(s.startedAt).getTime()
  return t < min ? t : min
}, Infinity)

// 3. 计算差值
const uptimeMs = Date.now() - oldestSessionTime
```

### 总 TOKEN (运行时间内)

**优先级**:
1. `totalTokens` (直接字段)
2. `usage.totalTokens` (usage 对象)
3. `responseUsage.totalTokens` (备用字段)

```typescript
function getTokenCount(session: any): number {
  // 尝试 1: totalTokens
  let tokens = Number(session.totalTokens)
  
  // 尝试 2: usage.totalTokens
  if (!tokens && session.usage) {
    tokens = Number(session.usage.totalTokens)
  }
  
  // 尝试 3: responseUsage.totalTokens
  if (!tokens && session.responseUsage) {
    tokens = Number(session.responseUsage.totalTokens)
  }
  
  return tokens || 0
}
```

### 总费用

```typescript
总费用 = OpenClaw 实际费用 + 电费

其中:
- OpenClaw 实际费用：从 usage-stats API 获取 (message.usage.cost.total)
- 电费 = 运行时间 (小时) × ¥2/小时
```

---

## 完整示例代码

查看 [`src/utils/api-examples.ts`](src/utils/api-examples.ts) 获取完整的演示代码。

---

## 相关文件

- [`src/api/gateway.ts`](src/api/gateway.ts) - Gateway API 封装
- [`src/api/usage-stats.ts`](src/api/usage-stats.ts) - Usage Stats API 封装
- [`src/stores/agent.ts`](src/stores/agent.ts) - Agent 状态管理
- [`src/views/Dashboard.vue`](src/views/Dashboard.vue) - Dashboard 展示

---

## 注意事项

1. **WebSocket 依赖**: 旧版本使用 WebSocket 重置会话，新版本改用 `sessions_send` API
2. **数据缓存**: usage-stats 服务有 10 秒缓存，避免频繁读取文件
3. **代理配置**: Vite 开发服务器已配置 `/api` 和 `/usage-stats` 代理
4. **状态派生**: 会话状态需要从 `updatedAt` 和 `abortedLastRun` 派生，不是直接返回
