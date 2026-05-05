import { defineStore } from 'pinia'
import { ref, computed, onUnmounted } from 'vue'
import { sessionsList, sessionStatus, health, sessionsHistory } from '../api/gateway'
import { useGatewayWebSocket, type SessionStateEvent } from '../api/websocket'

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

  // WebSocket instance for real-time session state updates
  const ws = useGatewayWebSocket()
  let wsInitialized = false

  /**
   * Initialize WebSocket listeners for session.state events.
   * Called once on first subscribeAgents() call.
   */
  function initWsListeners(): void {
    if (wsInitialized) return
    wsInitialized = true

    ws.onSessionState((event: SessionStateEvent) => {
      // Map gateway state to our AgentStatus
      let status: AgentStatus = 'unknown'
      switch (event.state) {
        case 'processing':
          status = 'running'
          break
        case 'waiting':
          // Could be queue waiting — treat as running
          status = 'running'
          break
        case 'idle':
          status = 'idle'
          break
        default:
          // Unknown state — keep current status
          return
      }

      // Update the agent in the list
      const index = agents.value.findIndex((a) => a.key === event.key)
      if (index >= 0) {
        agents.value[index] = { ...agents.value[index], status }
      }
    })

    ws.onOpen(() => {
      wsConnected.value = true
    })

    ws.onClose(() => {
      wsConnected.value = false
    })

    ws.onError(() => {
      wsConnected.value = false
    })
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

  // Fallback polling interval (slow poll as safety net alongside WebSocket)
  let pollingInterval: ReturnType<typeof setInterval> | null = null
  const FALLBACK_POLL_MS = 30000 // 30 seconds — only as fallback

  /**
   * Subscribe to agent changes:
   * 1) Initial HTTP fetch for immediate data
   * 2) WebSocket for real-time session.state updates
   * 3) Slow HTTP poll as fallback if WS drops
   */
  function subscribeAgents(): void {
    // Initial HTTP fetch
    fetchAgents()
    fetchHealth()

    // Initialize WebSocket listeners (once)
    initWsListeners()

    // Connect WebSocket (auto-subscribes to sessions.subscribe on open)
    ws.connect()

    // Fallback: slow HTTP poll in case WS fails
    pollingInterval = setInterval(() => {
      if (ws.is !== 'connected') {
        // WS down — refresh via HTTP
        fetchAgents()
      }
    }, FALLBACK_POLL_MS)
  }

  /**
   * Unsubscribe from agent updates
   */
  function unsubscribeAgents(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
    ws.disconnect()
    wsInitialized = false
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
      const ok = (data as Record<string, unknown>).ok
      healthStatus.value =
        status === 'ok' || status === 'healthy' || status === 'live' || healthy === true || ok === true
          ? 'healthy'
          : 'unhealthy'
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

    const rawKey = str(item.key ?? item.sessionKey ?? item.id)

    // Extract agent name from key: "agent:recorder:main" -> "recorder"
    let agentName = str(item.label) || str(item.name)
    if (!agentName) {
      // Check for cron sessions
      if (rawKey.includes('cron:')) {
        const cronMatch = rawKey.match(/cron:(.+?)$/)
        agentName = cronMatch ? 'Cron: ' + cronMatch[1] : '定时任务'
      } else {
        // Extract from key: agent:<agentId>:<type>[:<subId>]
        const parts = rawKey.split(':')
        if (parts.length >= 3) {
          agentName = parts[1] // agentId
        } else {
          agentName = rawKey
        }
      }
    }

    // Derive status from available fields
    // Note: API returns Python-style booleans as strings: "True"/"False" or actual booleans
    let derivedStatus: AgentStatus = 'idle'
    const abortedRaw = String(item.abortedLastRun ?? '').toLowerCase()
    const systemSentRaw = String(item.systemSent ?? '').toLowerCase()
    const aborted = abortedRaw === 'true' || item.abortedLastRun === true
    const systemSent = systemSentRaw === 'true' || item.systemSent === true
    const updatedAt = num(item.updatedAt)

     if (aborted) {
       derivedStatus = 'aborted'
     } else if (systemSent && updatedAt > 0) {
       // systemSent=true means the agent has been initialized and is (or was) active.
       // The only reliable signal for "still running" is whether updatedAt is recent.
       // However, updatedAt only refreshes when output is produced; a running agent
       // thinking without output will appear stale. Use a more generous threshold:
       // < 120s → running, < 600s → idle (likely still processing), ≥ 600s → idle.
       const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
       if (secondsSinceUpdate < 120) {
         derivedStatus = 'running'
       } else if (secondsSinceUpdate < 600) {
         // Still within a window where the agent could be processing;
         // trust systemSent and keep it as running to avoid false idle.
         derivedStatus = 'running'
       } else {
         derivedStatus = 'idle'
       }
     }

    // Use explicit status if available
    const explicitStatus = str(item.status) as AgentStatus
    if (explicitStatus && explicitStatus !== 'unknown') {
      derivedStatus = explicitStatus
    }

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
    // Fallback: use updatedAt timestamp to compute elapsedMs when startedAt/elapsedMs are missing
    if (!elapsedMs || elapsedMs <= 0) {
      const updatedAt = num(item.updatedAt)
      if (updatedAt > 0) {
        elapsedMs = Date.now() - updatedAt
      }
    }

    return {
      key: rawKey,
      name: agentName || 'Unnamed',
      status: derivedStatus,
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
    unsubscribeAgents,
    fetchHealth,
    fetchAgentStatus,
    fetchSessionHistory,
    getAgentByKey,
    setSearchQuery,
    setFilterStatus,
    formatDuration,
  }
})
