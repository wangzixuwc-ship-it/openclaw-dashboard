import axios from 'axios'
import { getAuthToken } from '../config/auth'

// Use /api proxy in dev mode (localhost/127.0.0.1) to avoid CORS; use direct URL otherwise
const rawUrl = import.meta.env.VITE_GATEWAY_URL
const isLocalTarget = rawUrl && (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1'))
const GATEWAY_BASE_URL = isLocalTarget ? '/api' : (rawUrl || 'http://127.0.0.1:18789')

const gatewayApi = axios.create({
  baseURL: GATEWAY_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor — attach auth token if available
gatewayApi.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor
gatewayApi.interceptors.response.use(
  (response) => {
    const data = response.data
    // Handle tools/invoke response: { ok: true, result }
    if (data?.ok === true && data?.result !== undefined) {
      const result = data.result
      // If result.details exists, use details (structured data)
      if (result?.details) {
        return result.details
      }
      // If result.content exists with text field, parse JSON
      if (result?.content && Array.isArray(result.content)) {
        const textItem = result.content.find((c) => c.type === 'text')
        if (textItem?.text) {
          try {
            return JSON.parse(textItem.text)
          } catch {
            // ignore
          }
        }
      }
      return result
    }
    return data
  },
  (error) => {
    const status = error.response?.status
    const data = error.response?.data
    const message = data?.error?.message || data?.message || error.message || 'Gateway API Error'
    if (status === 401) {
      console.warn('[Gateway] Unauthorized — token may be expired')
    } else if (status === 403) {
      console.warn('[Gateway] Forbidden — insufficient permissions')
    } else if (status && status >= 500) {
      console.error(`[Gateway] Server error (${status}):`, message)
    }
    return Promise.reject(new Error(message))
  }
)

/**
 * Invoke a gateway tool via /tools/invoke
 */
export async function invokeTool(tool: string, args: Record<string, unknown> = {}, sessionKey?: string): Promise<unknown> {
  const body: Record<string, unknown> = {
    tool,
    action: 'json',
    args,
  }
  if (sessionKey) {
    body.sessionKey = sessionKey
  }
  return gatewayApi.post('/tools/invoke', body)
}

/**
 * Get sessions list (Agent 列表和状态)
 * Uses: POST /tools/invoke with tool=sessions_list
 */
export async function sessionsList(args: { activeMinutes?: number; messageLimit?: number; limit?: number } = {}): Promise<unknown> {
  return invokeTool('sessions_list', args)
}

/**
 * Get session history (会话详情)
 * Uses: POST /tools/invoke with tool=sessions_history
 */
export async function sessionsHistory(sessionKey: string, args: { limit?: number; includeTools?: boolean } = {}): Promise<unknown> {
  return invokeTool('sessions_history', { sessionKey, ...args })
}

/**
 * Get agent definitions (name, id, etc.)
 * Uses: POST /tools/invoke with tool=agents_list
 */
export async function agentsList(): Promise<unknown> {
  return invokeTool('agents_list', {})
}

/**
 * Get session status (会话状态)
 * Uses: POST /tools/invoke with tool=session_status
 */
export async function sessionStatus(sessionKey: string): Promise<unknown> {
  return invokeTool('session_status', { sessionKey })
}

/**
 * Send message to session (发送消息到会话，用于重置等操作)
 * Uses: POST /tools/invoke with tool=sessions_send
 */
export async function sessionsSend(sessionKey: string, message: string, timeoutSeconds: number = 0): Promise<unknown> {
  return invokeTool('sessions_send', { sessionKey, message, timeoutSeconds })
}

/**
 * Get session history (会话历史记录)
 * Uses: POST /tools/invoke with tool=sessions_history
 */
export async function getSessionHistory(sessionKey: string, limit: number = 50, includeTools: boolean = false): Promise<unknown> {
  return invokeTool('sessions_history', { sessionKey, limit, includeTools })
}

/**
 * Gateway health check
 * Maps to: GET /health
 */
export async function health(): Promise<unknown> {
  return gatewayApi.get('/health')
}

/**
 * 获取 GPU 显存使用占比（REC-091 / REC-096）
 * 开发环境：通过 Vite proxy (/api/gpu-vram → localhost:31004)
 * 生产环境：直接调用后端地址
 * 返回: { usedPct: number, usedMb: number, totalMb: number }
 */
export async function getGpuVramUsage(): Promise<{ usedPct: number; usedMb: number; totalMb: number } | null> {
  try {
    // 注意：不能用 gatewayApi（其 baseURL='/api' 会导致双重前缀）
    // 开发环境走 Vite proxy，生产环境直连后端
    const url = import.meta.env.DEV
      ? '/api/gpu-vram'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31004'}/api/gpu-vram`
    const resp = await axios.get(url, { timeout: 10000 })
    const data = resp.data as { usedPct: number | null; usedMb?: number; totalMb?: number }
    if (data?.usedPct != null) {
      return {
        usedPct: data.usedPct,
        usedMb: data.usedMb || 0,
        totalMb: data.totalMb || 0,
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 结构化工具限制错误
 */
export class ToolRestrictedError extends Error {
  code = 'TOOLS_RESTRICTED'
  tool: string
  steps: string[]

  constructor(tool: string, steps: string[]) {
    super(`工具 "${tool}" 不可用 — Gateway 安全策略限制`)
    this.name = 'ToolRestrictedError'
    this.tool = tool
    this.steps = steps
  }
}

/**
 * 工具可用性缓存 (key: toolName, value: boolean)
 */
const toolAvailabilityCache = new Map<string, { ok: boolean; expireAt: number }>()

/**
 * 前置检测：某个工具是否被 Gateway 允许调用
 * 通过轻量探测 + 缓存实现，避免每次都触发完整调用
 */
async function isToolAvailable(toolName: string, cacheTtlMs = 60_000): Promise<boolean> {
  const now = Date.now()
  const cached = toolAvailabilityCache.get(toolName)
  if (cached && cached.expireAt > now) return cached.ok

  try {
    // 用空参数做一次探测调用
    const body: Record<string, unknown> = { tool: toolName, action: 'json', args: {} }
    const resp = await gatewayApi.post('/tools/invoke', body)
    // 如果 interceptor 没有 reject，说明调用成功（或至少未被安全策略拒绝）
    const data = resp?.data ?? resp
    // Check inner result status — a tool call can return ok: true at HTTP level
    // but the actual tool execution may have failed (e.g., missing scope)
    const innerError = data?.result?.error || data?.error
    const innerStatus = data?.result?.status
    const ok = data?.ok === true && !innerError && innerStatus !== 'error'
    toolAvailabilityCache.set(toolName, { ok, expireAt: now + cacheTtlMs })
    return ok
  } catch (e: any) {
    const status = e?.response?.status
    const errData = e?.response?.data
    const msg = String(errData?.error?.message ?? errData?.message ?? e?.message ?? '')
    // 403 / "denied" / "not available" / "not allowed" → 不可用
    const isRestricted =
      status === 403 ||
      /denied|forbidden|not\s+available|not\s+allowed|tool.*restrict|invoke.*reject/i.test(msg)
    toolAvailabilityCache.set(toolName, { ok: !isRestricted, expireAt: now + cacheTtlMs })
    return !isRestricted
  }
}

/**
 * Reset session (重置会话)
 * 通过 WebSocket chat.send 发送 /reset 命令，只需要 operator.write 权限
 * sessions_send 需要 operator.admin 权限，Control UI 没有
 */
export async function resetSession(sessionKey: string): Promise<unknown> {
  const { useGatewayWebSocket } = await import('./websocket')
  const ws = useGatewayWebSocket()
  try {
    return await ws.request('chat.send', { sessionKey, message: '/reset' })
  } catch (e: any) {
    console.error('[Gateway] resetSession via chat.send failed:', e)
    throw new Error(`重置失败: ${e.message}`)
  }
}

export default gatewayApi
