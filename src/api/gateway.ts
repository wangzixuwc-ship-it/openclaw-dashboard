import axios from 'axios'
import { getAuthToken } from '../config/auth'

// Use /api proxy in dev mode (localhost/127.0.0.1) to avoid CORS; use direct URL otherwise
const rawUrl = import.meta.env.VITE_GATEWAY_URL
const isLocalTarget = rawUrl && (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1'))
const GATEWAY_BASE_URL = isLocalTarget ? '/api' : (rawUrl || 'http://127.0.0.1:18789')

const gatewayApi = axios.create({
  baseURL: GATEWAY_BASE_URL,
  timeout: 10000,
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
  (response) => response.data,
  (error) => {
    const status = error.response?.status
    const message = error.response?.data?.message || error.message || 'Gateway API Error'
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
 * Get sessions list (Agent 列表和状态)
 * Maps to: GET /sessions
 */
export async function sessionsList(): Promise<unknown> {
  return gatewayApi.get('/sessions')
}

/**
 * Get session history (会话详情)
 * Maps to: GET /sessions/:key/history
 */
export async function sessionsHistory(sessionKey: string): Promise<unknown> {
  return gatewayApi.get(`/sessions/${encodeURIComponent(sessionKey)}/history`)
}

/**
 * Get session status (会话状态)
 * Maps to: GET /sessions/:key/status
 */
export async function sessionStatus(sessionKey: string): Promise<unknown> {
  return gatewayApi.get(`/sessions/${encodeURIComponent(sessionKey)}/status`)
}

/**
 * Gateway health check
 * Maps to: GET /health
 */
export async function health(): Promise<unknown> {
  return gatewayApi.get('/health')
}

export default gatewayApi
