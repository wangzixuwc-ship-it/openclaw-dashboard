# OpenClaw Dashboard API 优化总结

## 📋 优化概述

本次优化基于 OpenClaw v2026.3.28 官方文档和社区资料，全面重构了 Dashboard 的 API 调用逻辑，实现了运行时间、总 TOKEN、总费用和 Agent 状态的完整数据采集和计算。

---

## ✅ 完成的优化

### 1. **Gateway API 封装优化** (`src/api/gateway.ts`)

**新增 API 方法**:
- ✅ `sessionsSend()` - 发送消息到会话（用于重置等操作）
- ✅ `getSessionHistory()` - 获取会话历史记录
- ✅ `resetSession()` - 重置会话（基于 sessions_send API）

**改进**:
- 移除了对 WebSocket 的依赖，改用统一的 HTTP API
- 简化了重置会话的实现逻辑
- 增加了类型安全性

---

### 2. **Usage Stats API 模块** (`src/api/usage-stats.ts`)

**新建文件**: 完整的 Usage Stats API 封装

**功能**:
- ✅ `getUsageStats()` - 获取全局用量统计
- ✅ `getUsageStatsHealth()` - 健康检查

**数据结构**:
```typescript
interface UsageStatsResponse {
  totalTokens: number      // 总 TOKEN
  totalCost: number        // 总费用（美元）
  byAgent: Record<...>     // 按 Agent 分类
  updatedAt: string        // 更新时间
  version?: string         // 版本号
}
```

---

### 3. **Agent Store 优化** (`src/stores/agent.ts`)

#### A. 运行时间计算
```typescript
// 逻辑：取所有会话中最旧的 startedAt 时间作为起点
const oldestSessionTime = computed(() => {
  if (agents.value.length === 0) return 0
  const times = agents.value.map((a) => {
    if (a.createdAt) return new Date(a.createdAt).getTime()
    return a.lastActivity || 0
  }).filter((t) => t > 0)
  if (times.length === 0) return 0
  return Math.min(...times)
})

const uptimeMs = computed(() => {
  if (oldestSessionTime.value === 0) return 0
  return now.value - oldestSessionTime.value
})
```

#### B. TOKEN 计算优化
**优先级**:
1. `totalTokens` (直接字段)
2. `usage.totalTokens` (usage 对象)
3. `usage.total_tokens` 或 `usage.total`
4. `responseUsage.totalTokens` (备用字段)

```typescript
const totalTokensUsed = computed(() => {
  const uptimeStart = oldestSessionTime.value
  if (uptimeStart === 0) return 0

  // 过滤运行时间内的会话
  const sessionsInUptime = allSessionsRaw.value.filter((s) => {
    const createdAt = s.startedAt ?? s.createdAt ?? s.created
    if (!createdAt) return true
    const createdTime = typeof createdAt === 'number' ? createdAt : new Date(createdAt as string).getTime()
    return createdTime >= uptimeStart
  })

  // 累加 TOKEN（多级 fallback）
  return sessionsInUptime.reduce((sum, s) => {
    let t = Number(s.totalTokens)
    
    // Fallback 1: usage field
    if (!t && s.usage) {
      t = Number(s.usage.totalTokens ?? s.usage.total_tokens ?? s.usage.total)
    }
    
    // Fallback 2: responseUsage field
    if (!t && s.responseUsage) {
      t = Number(s.responseUsage.totalTokens ?? s.responseUsage.total)
    }
    
    return sum + (isNaN(t) ? 0 : t)
  }, 0)
})
```

#### C. 费用计算
```typescript
// 总费用 = OpenClaw 实际费用 + 电费
// 电费 = ¥2/小时 × 运行时间
const ELECTRICITY_PER_HOUR = 2

const totalCostCny = computed(() => {
  const openclawCost = globalUsage.value.totalCost || 0
  const uptimeHours = uptimeMs.value / (1000 * 60 * 60)
  const electricityCost = uptimeHours * ELECTRICITY_PER_HOUR
  return openclawCost + electricityCost
})
```

#### D. 重置会话优化
**旧实现**: 依赖 WebSocket，需要连接、轮询、超时处理
**新实现**: 直接调用 HTTP API

```typescript
async function resetSession(sessionKey: string): Promise<void> {
  try {
    await resetSessionApi(sessionKey)
    console.log(`[AgentStore] Reset session ${sessionKey} via sessions_send API`)
  } catch (e) {
    console.error(`[AgentStore] resetSession(${sessionKey}) error:`, e)
    throw e
  }
}
```

---

### 4. **Dashboard 展示** (`src/views/Dashboard.vue`)

**统计卡片**:
- ✅ 总计 (Agent 数量)
- ✅ 运行中 (状态为 running)
- ✅ 空闲 (状态为 idle)
- ✅ 已终止 (状态为 aborted)
- ✅ 错误 (状态为 error)
- ✅ **运行时间** (实时计算)
- ✅ **总 TOKEN** (运行时间内)
- ✅ **总费用** (运行时间内)

---

## 📁 新增文件

| 文件 | 用途 |
|------|------|
| [`src/api/usage-stats.ts`](src/api/usage-stats.ts) | Usage Stats API 封装 |
| [`src/utils/api-examples.ts`](src/utils/api-examples.ts) | API 使用示例代码 |
| [`API_GUIDE.md`](API_GUIDE.md) | 完整的 API 使用指南 |

---

## 🔧 修改的文件

| 文件 | 修改内容 |
|------|---------|
| [`src/api/gateway.ts`](src/api/gateway.ts) | 新增 sessionsSend, getSessionHistory, resetSession |
| [`src/stores/agent.ts`](src/stores/agent.ts) | 优化计算逻辑，使用新 API |
| [`src/components/AgentCard.vue`](src/components/AgentCard.vue) | 移除未使用的代码 |
| [`src/views/Dashboard.vue`](src/views/Dashboard.vue) | 修复 lint 警告 |

---

## 🎯 核心 API 调用流程

```
┌─────────────────────────────────────────────────────────┐
│  Dashboard 组件                                         │
│  - 显示运行时间、TOKEN、费用等指标                      │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  Agent Store (src/stores/agent.ts)                      │
│  - subscribeAgents()                                    │
│    ├─ fetchAgents() → sessions_list API                │
│    ├─ fetchGlobalUsage() → usage-stats API             │
│    └─ fetchHealth() → /health API                      │
│                                                         │
│  - 计算属性：                                           │
│    ├─ uptimeMs (运行时间)                               │
│    ├─ totalTokensUsed (总 TOKEN)                        │
│    └─ totalCostCny (总费用)                             │
└─────────────────┬───────────────────────────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
        ▼                    ▼
┌──────────────────┐  ┌──────────────────┐
│ Gateway API      │  │ Usage Stats API  │
│ (端口 18789)     │  │ (端口 3001)      │
│                  │  │                  │
│ - sessions_list  │  │ - /api/usage     │
│ - session_status │  │ - /api/health    │
│ - sessions_send  │  │                  │
│ - sessions_hist  │  │                  │
└──────────────────┘  └──────────────────┘
```

---

## 📊 数据计算逻辑总结

### 运行时间
```
运行时间 = 当前时间 - 最早会话创建时间 (startedAt)
```

### 总 TOKEN
```
总 TOKEN = Σ(运行时间内所有会话的 totalTokens)
优先级：totalTokens > usage.totalTokens > responseUsage.totalTokens
```

### 总费用
```
总费用 = OpenClaw 实际费用 + 电费
电费 = 运行时间 (小时) × ¥2/小时
```

### Agent 状态派生
```
1. 如果 abortedLastRun = true → 'aborted'
2. 否则根据 updatedAt 判断：
   - 特殊 Agent (副总、执行秘书、定时器): 5 分钟阈值
   - 普通 Agent: 10 分钟阈值
   - < 阈值 → 'running'
   - ≥ 阈值 → 'idle'
```

---

## 🚀 使用示例

### 获取所有指标
```typescript
import { demoAllMetrics } from '@/utils/api-examples'

// 一键演示所有 API 调用
await demoAllMetrics()
```

### 单独调用
```typescript
// 1. 获取会话列表
import { sessionsList } from '@/api/gateway'
const sessions = await sessionsList({ activeMinutes: 1440 })

// 2. 获取用量统计
import { getUsageStats } from '@/api/usage-stats'
const stats = await getUsageStats()
console.log('总 TOKEN:', stats.totalTokens)
console.log('总费用:', stats.totalCost)

// 3. 重置会话
import { resetSession } from '@/api/gateway'
await resetSession('agent:main:main')
```

---

## ✅ Lint 检查

所有代码已通过 ESLint 检查：
- ✅ 0 个错误
- ⚠️ 4 个警告（与本次优化无关的现有警告）

---

## 📚 参考文档

- [OpenClaw Session 管理](https://github.com/openclaw/openclaw/blob/main/docs/concepts/session.md)
- [OpenClaw Tools 文档](https://openclawwiki.org/docs/tools)
- [OpenClaw CLI Sessions](https://openclaws.io/docs/cli/sessions)
- [会话工具详解](https://news-openclaw.smzdm.com/docs/zh-CN/concepts/session-tool)

---

## 🎉 总结

本次优化完整实现了 OpenClaw Dashboard 的核心指标采集和展示功能：

1. ✅ **运行时间**: 基于会话创建时间实时计算
2. ✅ **总 TOKEN**: 多级 fallback，确保数据完整性
3. ✅ **总费用**: 结合实际费用和电费计算
4. ✅ **Agent 状态**: 智能派生，准确反映运行状态
5. ✅ **重置会话**: 简化实现，移除 WebSocket 依赖

所有代码已通过 lint 检查，可直接使用！
