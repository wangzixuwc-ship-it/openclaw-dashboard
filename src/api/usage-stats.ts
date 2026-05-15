/**
 * OpenClaw Usage Stats API
 * 通过 Vite 代理 /api/usage → 后端服务
 */

import axios from 'axios'

const usageStatsApi = axios.create({
  baseURL: '',
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

export default usageStatsApi
