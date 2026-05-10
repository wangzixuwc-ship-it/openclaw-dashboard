/**
 * OpenClaw Usage Stats API
 * 本地服务端口 3001，提供全局用量统计
 */

import axios from 'axios'

const USAGE_STATS_BASE_URL = '/usage-stats'

const usageStatsApi = axios.create({
  baseURL: USAGE_STATS_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

export interface UsageStatsResponse {
  totalTokens: number
  totalCost: number
  byAgent: Record<string, {
    tokens: number
    cost: number
    sessionCount: number
  }>
  updatedAt: string
  version?: string
  error?: string
}

/**
 * 获取全局用量统计
 */
export async function getUsageStats(): Promise<UsageStatsResponse> {
  const response = await usageStatsApi.get('/api/usage')
  return response.data as UsageStatsResponse
}

/**
 * 获取服务健康状态
 */
export async function getUsageStatsHealth(): Promise<{ status: string; port: number }> {
  const response = await usageStatsApi.get('/api/health')
  return response.data as { status: string; port: number }
}

export default usageStatsApi
