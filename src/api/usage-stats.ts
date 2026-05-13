/**
 * OpenClaw Usage Stats API
 * REC-097: 合并到 NestJS 后端（端口 31004）
 * 通过 Vite 代理 /gpu-vram → localhost:31004
 */

import axios from 'axios'

const USAGE_STATS_BASE_URL = '/gpu-vram'

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

export default usageStatsApi
