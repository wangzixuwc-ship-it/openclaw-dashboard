/**
 * OpenClaw API 使用示例
 * 演示如何通过 API 获取运行时间、TOKEN、费用和会话状态
 */

import { sessionsList, sessionStatus, resetSession, getSessionHistory } from '../api/gateway'
import { getUsageStats } from '../api/usage-stats'

/**
 * 示例 1: 获取所有会话列表和状态
 */
export async function demoGetSessions(): Promise<void> {
  try {
    const data = await sessionsList({ activeMinutes: 1440 }) // 最近 24 小时
    console.log('=== 会话列表 ===')
    console.log(data)
  } catch (error) {
    console.error('获取会话列表失败:', error)
  }
}

/**
 * 示例 2: 获取单个会话状态
 */
export async function demoGetSessionStatus(sessionKey: string): Promise<void> {
  try {
    const status = await sessionStatus(sessionKey)
    console.log('=== 会话状态 ===')
    console.log(status)
  } catch (error) {
    console.error('获取会话状态失败:', error)
  }
}

/**
 * 示例 3: 获取全局用量统计
 */
export async function demoGetUsageStats(): Promise<void> {
  try {
    const stats = await getUsageStats()
    console.log('=== 全局用量统计 ===')
    console.log('总 TOKEN:', stats.totalTokens.toLocaleString())
    console.log('总费用：¥' + stats.totalCost.toFixed(2))
    console.log('更新时间:', stats.updatedAt)
    console.log('各 Agent 用量:', stats.byAgent)
  } catch (error) {
    console.error('获取用量统计失败:', error)
  }
}

/**
 * 示例 4: 重置会话
 */
export async function demoResetSession(sessionKey: string): Promise<void> {
  try {
    await resetSession(sessionKey)
    console.log('=== 会话已重置 ===')
    console.log('会话键:', sessionKey)
  } catch (error) {
    console.error('重置会话失败:', error)
  }
}

/**
 * 示例 5: 获取会话历史记录
 */
export async function demoGetSessionHistory(sessionKey: string, limit: number = 20): Promise<void> {
  try {
    const history = await getSessionHistory(sessionKey, limit)
    console.log('=== 会话历史 ===')
    console.log(`最近 ${limit} 条记录:`)
    console.log(history)
  } catch (error) {
    console.error('获取会话历史失败:', error)
  }
}

/**
 * 示例 6: 计算运行时间
 */
export async function demoCalculateUptime(): Promise<void> {
  try {
    const sessions = await sessionsList() as Record<string, unknown>
    const sessionsArray = Array.isArray((sessions as Record<string, unknown>).sessions) 
      ? (sessions as Record<string, unknown>).sessions as Array<Record<string, unknown>> 
      : []
    
    if (sessionsArray.length === 0) {
      console.log('没有会话数据')
      return
    }
    
    // 找到最早的会话创建时间
    const oldestTime = sessionsArray.reduce((min: number, session: Record<string, unknown>) => {
      const createdAt = session.startedAt || session.createdAt || session.created
      if (!createdAt) return min
      const time = typeof createdAt === 'number' ? createdAt : new Date(createdAt as string).getTime()
      return time < min ? time : min
    }, Infinity)
    
    const now = Date.now()
    const uptimeMs = now - oldestTime
    const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60))
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60))
    
    console.log('=== 运行时间 ===')
    console.log('启动时间:', new Date(oldestTime).toISOString())
    console.log(`已运行：${uptimeHours}小时 ${uptimeMinutes}分钟`)
  } catch (error) {
    console.error('计算运行时间失败:', error)
  }
}

/**
 * 示例 7: 综合演示 - 获取所有指标
 */
export async function demoAllMetrics(): Promise<void> {
  console.log('\n========================================')
  console.log('   OpenClaw 综合指标演示')
  console.log('========================================\n')
  
  // 1. 获取会话列表
  await demoGetSessions()
  
  // 2. 获取用量统计
  await demoGetUsageStats()
  
  // 3. 计算运行时间
  await demoCalculateUptime()
  
  console.log('\n========================================\n')
}
