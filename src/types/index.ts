/**
 * Shared type definitions for the OpenClaw Dashboard
 */

// ── Gateway Session ──

export interface GatewaySession {
  key: string
  kind: string
  displayName: string
  status: 'running' | 'idle' | 'error' | 'aborted' | 'unknown'
  model: string
  contextTokens: number
  totalTokens: number
  updatedAt: number
  startedAt?: string
  lastActivity?: string
  metadata?: Record<string, unknown>
}

// ── Health Status ──

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  uptime: number
  version?: string
  timestamp?: string
}

// ── WebSocket Message ──

export interface WsMessage {
  type: string
  data: unknown
  timestamp: number
}

// ── API Response Wrappers ──

export interface ApiResponse<T = unknown> {
  data?: T
  message?: string
  success?: boolean
}

// ── Session History Entry ──

export interface SessionHistoryEntry {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  tokens?: number
}

// ── Token Usage ──

export interface TokenUsage {
  current: number
  max: number
  percentage: number
}

// ── Agent Info (normalized) ──

export interface AgentInfo {
  key: string
  name: string
  status: 'running' | 'idle' | 'error' | 'aborted' | 'unknown'
  lastActivity?: string
  createdAt?: string
  model?: string
  tokenUsage?: TokenUsage
  details?: Record<string, unknown>
  elapsedMs?: number
}
