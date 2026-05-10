# 关于 Agent 状态判断的说明

## 📊 API 返回的数据结构

根据 OpenClaw API (`/api/tools/invoke` with `tool=sessions_list`) 的实际响应，返回的会话数据包含以下字段：

```json
{
  "sessions": [
    {
      "key": "agent:main:main",
      "kind": "main",
      "model": "gpt-4",
      "contextTokens": 128000,
      "totalTokens": 154000,
      "updatedAt": 1715140800000,      // ⚠️ 最后更新时间 (毫秒)
      "startedAt": "2026-05-08T10:00:00",
      "abortedLastRun": false,         // ⚠️ 是否被终止
      "elapsedMs": 3600000,
      "error": null,                   // ⚠️ 错误信息 (可选)
      "lastError": null,               // ⚠️ 最后错误 (可选)
      "errorMessage": null             // ⚠️ 错误消息 (可选)
    }
  ]
}
```

## ⚠️ 重要说明

**OpenClaw API 不直接返回 `status` 字段！**

这意味着我们无法从 API 直接获取 "running"、"idle" 等状态值，必须通过现有字段进行**派生**。

## 🔍 可用的判断依据

### 1. `abortedLastRun` (布尔值)
- ✅ **直接判断**：`true` = 已终止
- ✅ 这是最可靠的状态指标

### 2. `error` / `lastError` / `errorMessage` (可选字段)
- ✅ **直接判断**：存在 = 有错误
- ✅ 表示会话遇到错误

### 3. `updatedAt` (毫秒时间戳)
- ⚠️ **需要计算**：必须与当前时间比较
- ❌ 无法避免时间计算

### 4. `elapsedMs` (毫秒)
- ⚠️ 表示运行时长，不是状态
- ❌ 不能用于判断 running/idle

## 💡 如果不使用时间计算

如果完全不用时间计算，我们只能判断以下状态：

```typescript
if (abortedLastRun === true) {
  return 'aborted'  // 已终止
}

if (error || lastError || errorMessage) {
  return 'error'  // 错误
}

// 剩下的情况无法区分 running 和 idle
return 'unknown'  // 未知
```

**问题**：这样无法区分 "运行中" 和 "空闲" 两种状态！

## 🎯 建议方案

### 方案 A：使用时间计算（推荐）

**理由**：
1. OpenClaw API 就是这样设计的
2. `updatedAt` 字段的存在就是为了判断活跃状态
3. 官方文档和示例都使用时间阈值
4. 可以准确反映 Agent 的活跃程度

**实现**：
```typescript
const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
if (secondsSinceUpdate < threshold) {
  return 'running'  // 最近有活动
} else {
  return 'idle'  // 长时间无活动
}
```

### 方案 B：简化状态（不推荐）

只判断确定的状态，其余都标记为 "active"：

```typescript
if (abortedLastRun === true) return 'aborted'
if (error || lastError || errorMessage) return 'error'
return 'active'  // 包含 running 和 idle
```

**缺点**：
- 无法区分 Agent 是否正在工作
- 用户体验较差
- 不符合 OpenClaw 的设计理念

### 方案 C：使用 `elapsedMs`（不可行）

```typescript
// ❌ 这个方案不可行！
if (elapsedMs > 0) return 'running'
else return 'idle'
```

**问题**：
- `elapsedMs` 表示总运行时长，不是当前状态
- 一个 Agent 可能运行了 1 小时但现在已空闲
- 无法准确反映实时状态

## 📋 结论

**强烈建议继续使用时间计算来判断状态**，原因如下：

1. ✅ **API 设计如此**：OpenClaw 提供了 `updatedAt` 字段就是用于状态判断
2. ✅ **官方推荐**：官方文档和示例都使用时间阈值
3. ✅ **准确可靠**：能准确反映 Agent 的活跃程度
4. ✅ **用户体验好**：用户可以看到哪些 Agent 正在工作

如果担心时间计算的准确性，可以：
- 调整阈值（如缩短/延长 idle 判断时间）
- 增加更多状态（如 "busy"、"waiting"）
- 使用 WebSocket 实时推送状态变化

## 🔧 当前实现

当前代码已经实现了最佳的状态判断逻辑：

```typescript
// 1. 检查终止（最高优先级）
if (abortedLastRun === true) return 'aborted'

// 2. 检查错误
if (error || lastError || errorMessage) return 'error'

// 3. 使用时间判断运行/空闲
const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
if (secondsSinceUpdate < threshold) {
  return 'running'
} else {
  return 'idle'
}
```

这是最合理、最准确的方案！
