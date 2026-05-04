import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { sessionsList, sessionStatus, health, sessionsHistory } from '../api/gateway'
import { useGatewayWebSocket } from '../api/websocket'

export type AgentStatus = 'idle' | 'running' | 'error' | 'aborted' | 'unknown'

export interface TokenUsage {
  current: number
  max: number
  percentage: number
}

export interface AgentInfo {
  key: string
  name: string
  status: AgentStatus
  lastActivity?: string
  createdAt?: string
  model?: string
  tokenUsage?: TokenUsage
  details?: Record<string, unknown>
  elapsedMs?: number
}

interface AgentState {
  agents: AgentInfo[]
  loading: boolean
  error: string | null
  healthStatus: 'healthy' | 'unhealthy' | 'unknown'
  wsConnected: boolean
}

// Filter status type
export type FilterStatus = 'all' | 'running' | 'idle' | 'error' | 'aborted'

export const useAgentStore = defineStore('agent', () => {
  // State
  const agents = ref<AgentInfo[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const healthStatus = ref<AgentState['healthStatus']>('unknown')
  const wsConnected = ref(false)
  const searchQuery = ref('')
  const filterStatus = ref<FilterStatus>('all')

  // Getters (computed)
  const agentCount = computed(() => agents.value.length)
  const runningAgents = computed(() => agents.value.filter((a) => a.status === 'running'))
  const idleAgents = computed(() => agents.value.filter((a) => a.status === 'idle'))
  const errorAgents = computed(() => agents.value.filter((a) => a.status === 'error'))
  const abortedAgents = computed(() => agents.value.filter((a) => a.status === 'aborted'))

  const isHealthy = computed(() => healthStatus.value === 'healthy')

  /**
   * Filtered + searched agents
   */
  const filteredAgents = computed(() => {
    let result = agents.value

    // Apply status filter
    if (filterStatus.value !== 'all') {
      result = result.filter((a) => a.status === filterStatus.value)
    }

    // Apply search
    const query = searchQuery.value.trim().toLowerCase()
    if (query) {
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          a.key.toLowerCase().includes(query)
      )
    }

    return result
  })

  /**
   * Get agent by key
   */
  function getAgentByKey(key: string): AgentInfo | undefined {
    return agents.value.find((a) => a.key === key)
  }

  /**
   * Update search query
   */
  function setSearchQuery(query: string): void {
    searchQuery.value = query
  }

  /**
   * Update status filter
   */
  function setFilterStatus(status: FilterStatus): void {
    filterStatus.value = status
  }

  // Actions

  /**
   * Fetch agents list via HTTP
   */
  async function fetchAgents(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const data = await sessionsList()
      // Normalize response — adapt to actual API shape
      if (Array.isArray(data)) {
        agents.value = data.map((item: unknown) => normalizeAgent(item as Record<string, unknown>))
      } else if (data && typeof data === 'object') {
        const typed = data as Record<string, unknown>
        if (Array.isArray(typed.sessions)) {
          agents.value = typed.sessions.map((item) => normalizeAgent(item as Record<string, unknown>))
        } else if (Array.isArray(typed.data)) {
          agents.value = typed.data.map((item) => normalizeAgent(item as Record<string, unknown>))
        } else {
          agents.value = [normalizeAgent(typed)]
        }
      } else {
        agents.value = [normalizeAgent({})]
      }
    } catch (e) {
      error.value = (e instanceof Error ? e.message : String(e)) || 'Failed to fetch agents'
      console.error('[AgentStore] fetchAgents error:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * Subscribe to agent changes via WebSocket
   */
  function subscribeAgents(): void {
    const ws = useGatewayWebSocket()

    ws.onOpen(() => {
      wsConnected.value = true
    })

    ws.onClose(() => {
      wsConnected.value = false
    })

    ws.onMessage((event) => {
      // Handle session change events
      if (event?.type === 'session:changed' || event?.type === 'sessions:changed') {
        if (event?.data) {
          // Full list replacement
          if (Array.isArray(event.data)) {
            agents.value = event.data.map((item) => normalizeAgent(item as Record<string, unknown>))
          } else if (typeof event.data === 'object' && event.data !== null) {
            const typed = event.data as Record<string, unknown>
            if (Array.isArray(typed.sessions)) {
              agents.value = typed.sessions.map((item) => normalizeAgent(item as Record<string, unknown>))
            } else {
              // Single agent update — merge into existing list
              const updatedAgent = normalizeAgent(typed)
              const index = agents.value.findIndex((a) => a.key === updatedAgent.key)
              if (index >= 0) {
                agents.value[index] = updatedAgent
              } else {
                agents.value.push(updatedAgent)
              }
            }
          }
        } else {
          // Fallback — refresh from HTTP
          fetchAgents()
        }
      }
    })

    ws.onError((err) => {
      console.warn('[AgentStore] WebSocket error:', err)
    })

    ws.connect()
  }

  /**
   * Fetch Gateway health status
   */
  async function fetchHealth(): Promise<void> {
    try {
      const data = await health()
      if (!data || typeof data !== 'object') {
        healthStatus.value = 'unhealthy'
        return
      }
      const status = (data as Record<string, unknown>).status
      const healthy = (data as Record<string, unknown>).healthy
      healthStatus.value = status === 'ok' || status === 'healthy' || healthy === true ? 'healthy' : 'unhealthy'
    } catch {
      healthStatus.value = 'unhealthy'
    }
  }

  /**
   * Fetch specific agent status
   */
  async function fetchAgentStatus(sessionKey: string): Promise<AgentInfo | null> {
    try {
      const data = await sessionStatus(sessionKey)
      const agent = normalizeAgent(data as Record<string, unknown>)
      const index = agents.value.findIndex((a) => a.key === sessionKey)
      if (index >= 0) {
        agents.value[index] = agent
      } else {
        agents.value.push(agent)
      }
      return agent
    } catch (e) {
      console.error(`[AgentStore] fetchAgentStatus(${sessionKey}) error:`, e)
      return null
    }
  }
  async function fetchSessionHistory(sessionKey: string): Promise<Record<string, unknown>[]> {
    try {
      const data = await sessionsHistory(sessionKey)
      if (Array.isArray(data)) return data as Record<string, unknown>[]
      if (data && typeof data === 'object') {
        const typed = data as Record<string, unknown>
        if (Array.isArray(typed.messages)) return typed.messages as Record<string, unknown>[]
        if (Array.isArray(typed.data)) return typed.data as Record<string, unknown>[]
      }
      return []
    } catch (e) {
      console.error(`[AgentStore] fetchSessionHistory(${sessionKey}) error:`, e)
      return []
    }
  }

  /**
   * Format duration from milliseconds
   */
  function formatDuration(ms?: number): string {
    if (!ms || ms <= 0) return '-'
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }

  // Helpers

  function normalizeAgent(item: Record<string, unknown>): AgentInfo {
    if (!item || typeof item !== 'object') return { key: '', name: 'Unknown', status: 'unknown' }

    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

    // Extract token usage from context/usage object
    const contextRaw = item.context ?? item.contextWindow ?? item.usage
    let tokenUsage: TokenUsage | undefined
    if (contextRaw && typeof contextRaw === 'object') {
      const ctx = contextRaw as Record<string, unknown>
      const current = num(ctx.currentTokens ?? ctx.tokensUsed ?? 0)
      const max = num(ctx.maxTokens ?? ctx.maxContext ?? ctx.contextWindow ?? 1)
      if (max > 0) {
        tokenUsage = {
          current,
          max,
          percentage: Math.round((current / max) * 100),
        }
      }
    }

    // Extract elapsed time
    let elapsedMs: number | undefined
    const startedAt = str(item.startedAt)
    if (startedAt) {
      elapsedMs = Date.now() - new Date(startedAt).getTime()
    }
    const elapsedVal = num(item.elapsedMs)
    if (elapsedVal > 0) {
      elapsedMs = elapsedVal
    }

    return {
      key: str(item.key ?? item.sessionKey ?? item.id),
      name: str(item.name ?? item.label ?? item.key ?? item.sessionKey ?? item.id) || 'Unnamed',
      status: (str(item.status) as AgentStatus) || 'unknown',
      lastActivity: str(item.lastActivity ?? item.lastSeen ?? item.updatedAt) || undefined,
      createdAt: str(item.startedAt ?? item.createdAt ?? item.created) || undefined,
      model: str(item.model ?? item.modelName ?? item.modelId) || undefined,
      tokenUsage,
      elapsedMs,
      details: (item.details ?? item.metadata) as Record<string, unknown> | undefined,
    }
  }

  return {
    // State
    agents,
    loading,
    error,
    healthStatus,
    wsConnected,
    searchQuery,
    filterStatus,
    // Getters
    agentCount,
    runningAgents,
    idleAgents,
    errorAgents,
    abortedAgents,
    isHealthy,
    filteredAgents,
    // Actions
    fetchAgents,
    subscribeAgents,
    fetchHealth,
    fetchAgentStatus,
    fetchSessionHistory,
    getAgentByKey,
    setSearchQuery,
    setFilterStatus,
    formatDuration,
  }
})
