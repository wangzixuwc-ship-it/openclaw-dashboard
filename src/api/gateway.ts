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
        const textItem = result.content.find((c: any) => c.type === 'text')
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
 * Gateway health check
 * Maps to: GET /health
 */
export async function health(): Promise<unknown> {
  return gatewayApi.get('/health')
}

export default gatewayApi
