import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { sessionsList, sessionStatus, health, sessionsHistory, resetSession as resetSessionApi } from '../api/gateway'
import { getUsageStats } from '../api/usage-stats'

// Constants
const HEALTH_CHECK_INTERVAL = 10000 // 10s
const AGENT_POLL_INTERVAL = 30000 // 30s
const STORAGE_KEY = 'openclaw_dashboard_agent_filter'

// Agent name mapping
const AGENT_NAME_MAP: Record<string, string> = {
  main: '副总',
  recorder: '执行秘书',
  backend: '后端',
  frontend: '前端',
  debugger: '调试员',
  codeaudit: '代码审计',
  cron: '巡检员',
}

// Types
export type AgentStatus = 'running' | 'idle' | 'error' | 'aborted' | 'unknown'
export type FilterStatus = 'all' | 'running' | 'idle' | 'error' | 'aborted'

export interface AgentInfo {
  key: string
  name: string
  status: AgentStatus
  lastActivity: number
  tokenUsage?: {
    current: number
    max: number
    percentage: number
  }
  model?: string
  contextTokens?: number
  totalTokens?: number
  createdAt?: string
  label?: string
  displayName?: string
  kind?: string
  channel?: string
  sessionId?: string
  startedAt?: number
  endedAt?: number
  runtimeMs?: number
  systemSent?: boolean
  abortedLastRun?: boolean
  lastChannel?: string
  transcriptPath?: string
  error?: any
  lastError?: any
  errorMessage?: string
  state?: string
  status_api?: string
}

export interface GlobalUsage {
  totalTokens: number
  totalCost: number
  updatedAt: string
}

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<AgentInfo[]>([])
  const globalUsage = ref<GlobalUsage>({ totalTokens: 0, totalCost: 0, updatedAt: '' })
  const healthStatus = ref<Record<string, unknown>>({})
  const filterStatus = ref<FilterStatus>('all')
  const isPolling = ref(false)
  const lastUpdateTime = ref(0)

  // Computed
  const runningAgents = computed(() => agents.value.filter((a) => a.status === 'running'))
  const idleAgents = computed(() => agents.value.filter((a) => a.status === 'idle'))
  const errorAgents = computed(() => agents.value.filter((a) => a.status === 'error'))
  const abortedAgents = computed(() => agents.value.filter((a) => a.status === 'aborted'))
  const unknownAgents = computed(() => agents.value.filter((a) => a.status === 'unknown'))

  const totalAgents = computed(() => agents.value.length)
  const activeAgents = computed(() => runningAgents.value.length + idleAgents.value.length)

  // Filtered agents based on status
  const filteredAgents = computed(() => {
    if (filterStatus.value === 'all') return agents.value
    return agents.value.filter((a) => a.status === filterStatus.value)
  })

  // Oldest session time (for uptime calculation)
  const oldestSessionTime = computed(() => {
    if (agents.value.length === 0) return 0
    const times = agents.value.map((a) => {
      if (a.createdAt) return new Date(a.createdAt).getTime()
      return a.lastActivity || 0
    }).filter((t) => t > 0)
    if (times.length === 0) return 0
    return Math.min(...times)
  })

  // Uptime in milliseconds
  const uptimeMs = computed(() => {
    if (oldestSessionTime.value === 0) return 0
    return Date.now() - oldestSessionTime.value
  })

  // Total token consumption - sum of all sessions' totalTokens
  const totalTokensUsed = computed(() => {
    return agents.value.reduce((sum, s) => {
      const t = Number(s.totalTokens) || 0
      return sum + t
    }, 0)
  })

  // Total cost = OpenClaw's tracked cost + electricity
  // OpenClaw cost: from usage-stats service (message.usage.cost.total)
  // Electricity cost: ¥2 per hour of uptime
  const ELECTRICITY_PER_HOUR = 2

  const totalCostCny = computed(() => {
    // OpenClaw's actual cost (if available)
    const openclawCost = globalUsage.value.totalCost || 0
    // Electricity cost: uptime hours * 2
    const uptimeHours = uptimeMs.value / (1000 * 60 * 60)
    const electricityCost = uptimeHours * ELECTRICITY_PER_HOUR
    return openclawCost + electricityCost
  })

  // Methods
  function setFilterStatus(status: FilterStatus): void {
    filterStatus.value = status
  }

  /**
   * Format uptime in milliseconds to human-readable string
   */
  function formatUptime(ms: number): string {
    if (ms <= 0) return '未知'
    
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    
    if (hours > 0) {
      return `${hours}小时${minutes}分钟`
    } else if (minutes > 0) {
      return `${minutes}分钟`
    } else {
      return '< 1 分钟'
    }
  }

  /**
   * Format duration (elapsed time) in milliseconds to human-readable string
   */
  function formatDuration(ms: number): string {
    if (!ms || ms <= 0) return '-'
    
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    
    if (hours > 0) {
      return `${hours}小时${minutes}分${seconds}秒`
    } else if (minutes > 0) {
      return `${minutes}分${seconds}秒`
    } else {
      return `${seconds}秒`
    }
  }

  /**
   * Format cost to CNY currency string
   */
  function formatCost(cost: number): string {
    if (cost < 0.01) return '<¥0.01'
    return '¥' + cost.toFixed(2)
  }

  // Helpers
  function normalizeAgent(item: Record<string, unknown>): AgentInfo {
    if (!item || typeof item !== 'object') return { key: '', name: 'Unknown', status: 'unknown' }

    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

    const rawKey = str(item.key ?? item.sessionKey ?? item.id)

    // Force use Chinese name mapping
    // Step 1: Try direct lookup (rawKey might be "main", "recorder", etc.)
    let agentName = AGENT_NAME_MAP[rawKey] || ''

    // Step 2: If not found, try extract from "agent:main:default" format
    if (!agentName && rawKey.includes(':')) {
      const parts = rawKey.split(':')
      // "agent:main:default" -> parts[1] = "main"
      if (parts.length >= 2 && parts[0] === 'agent') {
        agentName = AGENT_NAME_MAP[parts[1]] || parts[1]
      } else if (parts.length >= 1) {
        // Try first part or last part
        agentName = AGENT_NAME_MAP[parts[0]] || AGENT_NAME_MAP[parts[parts.length - 1]] || parts[parts.length - 1]
      }
    }

    // Step 3: Handle cron sessions
    if (!agentName && rawKey.includes('cron:')) {
      const cronMatch = rawKey.match(/cron:(.+?)$/)
      agentName = cronMatch ? '定时任务：' + cronMatch[1] : '定时任务'
    }

    // Step 4: Final fallback
    if (!agentName) {
      agentName = str(item.label) || str(item.name) || rawKey || 'Unnamed'
    }

    // Get status: API returns a 'status' field!
    // Possible values: "running", "done", "error", "aborted", etc.
    // Map these to our AgentStatus type
    const apiStatus = str(item.status || item.state || '').toLowerCase()
    let derivedStatus: AgentStatus = 'unknown'

    // 1) Check if aborted (most reliable)
    const abortedRaw = String(item.abortedLastRun ?? '').toLowerCase()
    const aborted = abortedRaw === 'true' || item.abortedLastRun === true
    if (aborted) {
      derivedStatus = 'aborted'
    } 
    // 2) Check if error
    else if (item.error || item.lastError || item.errorMessage) {
      derivedStatus = 'error'
    }
    // 3) Use API status field
    else if (apiStatus) {
      if (apiStatus === 'running' || apiStatus === 'active' || apiStatus === 'in_progress') {
        derivedStatus = 'running'
      } else if (apiStatus === 'done' || apiStatus === 'completed' || apiStatus === 'finished') {
        derivedStatus = 'idle'
      } else if (apiStatus === 'error' || apiStatus === 'failed') {
        derivedStatus = 'error'
      } else if (apiStatus === 'aborted' || apiStatus === 'cancelled') {
        derivedStatus = 'aborted'
      } else {
        const updatedAt = num(item.updatedAt)
        if (updatedAt > 0) {
          const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
          derivedStatus = secondsSinceUpdate < 600 ? 'running' : 'idle'
        }
      }
    }
    // 4) Fallback to updatedAt if no status field
    else {
      const updatedAt = num(item.updatedAt)
      if (updatedAt > 0) {
        const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
        derivedStatus = secondsSinceUpdate < 600 ? 'running' : 'idle'
      }
    }

    // Token usage - API returns: totalTokens (used), contextTokens (max)
    const totalTokens = num(item.totalTokens)
    const contextTokens = num(item.contextTokens)
    let tokenUsage: AgentInfo['tokenUsage'] | undefined
    
    if (totalTokens > 0 && contextTokens > 0) {
      tokenUsage = {
        current: totalTokens,
        max: contextTokens,
        percentage: Math.round((totalTokens / contextTokens) * 100),
      }
    } else {
      // Fallback: check details/metadata
      const contextRaw = item.context ?? item.contextWindow ?? item.usage
      if (contextRaw && typeof contextRaw === 'object') {
        const ctx = contextRaw as Record<string, unknown>
        const current = num(ctx.currentTokens ?? ctx.tokensUsed ?? ctx.totalTokens ?? 0)
        const max = num(ctx.maxTokens ?? ctx.maxContext ?? ctx.contextWindow ?? ctx.contextTokens ?? 1)
        if (current > 0 && max > 0) {
          tokenUsage = {
            current,
            max,
            percentage: Math.round((current / max) * 100),
          }
        }
      }
    }

    // Get createdAt from startedAt or other fields
    const startedAt = item.startedAt
    const createdAt = typeof startedAt === 'number' ? new Date(startedAt).toISOString() : str(startedAt)

    return {
      key: rawKey,
      name: agentName,
      status: derivedStatus,
      lastActivity: num(item.updatedAt),
      tokenUsage,
      model: str(item.model),
      contextTokens: contextTokens || undefined,
      totalTokens: totalTokens || undefined,
      createdAt,
      label: str(item.label),
      displayName: str(item.displayName),
      kind: str(item.kind),
      channel: str(item.channel),
      sessionId: str(item.sessionId),
      startedAt: typeof startedAt === 'number' ? startedAt : undefined,
      endedAt: typeof item.endedAt === 'number' ? item.endedAt : undefined,
      runtimeMs: typeof item.runtimeMs === 'number' ? item.runtimeMs : undefined,
      systemSent: Boolean(item.systemSent),
      abortedLastRun: Boolean(item.abortedLastRun),
      lastChannel: str(item.lastChannel),
      transcriptPath: str(item.transcriptPath),
      error: item.error,
      lastError: item.lastError,
      errorMessage: str(item.errorMessage),
      state: str(item.state),
      status_api: str(item.status),
    }
  }

  async function fetchAgents(): Promise<void> {
    try {
      const data = await sessionsList()
      const sessions = Array.isArray((data as any).sessions) ? (data as any).sessions : []
      agents.value = sessions.map(normalizeAgent)
      lastUpdateTime.value = Date.now()
      console.log('[AgentStore] Total sessions (raw):', sessions.length)
    } catch (e) {
      console.error('[AgentStore] fetchAgents error:', e)
      agents.value = []
    }
  }

  async function fetchAgentStatus(sessionKey: string): Promise<AgentInfo | null> {
    try {
      const data = await sessionStatus(sessionKey)
      return normalizeAgent(data as Record<string, unknown>)
    } catch (e) {
      console.error(`[AgentStore] fetchAgentStatus(${sessionKey}) error:`, e)
      return null
    }
  }

  async function fetchGlobalUsage(): Promise<void> {
    try {
      const data = await getUsageStats()
      globalUsage.value = {
        totalTokens: data.totalTokens || 0,
        totalCost: data.totalCost || 0,
        updatedAt: data.updatedAt || '',
      }
      console.log('[AgentStore] Global usage loaded:', data.totalTokens, 'tokens, cost:', data.totalCost)
    } catch (e) {
      console.warn('[AgentStore] fetchGlobalUsage error:', e)
    }
  }

  async function fetchHealth(): Promise<void> {
    try {
      healthStatus.value = await health()
    } catch (e) {
      console.warn('[AgentStore] fetchHealth error:', e)
    }
  }

  async function resetSession(sessionKey: string): Promise<void> {
    try {
      await resetSessionApi(sessionKey)
      console.log(`[AgentStore] Reset session ${sessionKey} via sessions_send API`)
    } catch (e) {
      console.error(`[AgentStore] resetSession(${sessionKey}) error:`, e)
      throw e
    }
  }

  function getAgentByKey(key: string): AgentInfo | null {
    const agent = agents.value.find((a) => a.key === key)
    return agent || null
  }

  async function fetchSessionHistory(sessionKey: string, limit: number = 50): Promise<Record<string, unknown>[]> {
    try {
      const data = await sessionsHistory(sessionKey, { limit })
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

  async function subscribeAgents(): Promise<() => void> {
    isPolling.value = true
    await Promise.all([fetchAgents(), fetchGlobalUsage(), fetchHealth()])

    const interval = setInterval(() => {
      if (!isPolling.value) return
      fetchAgents()
      fetchGlobalUsage()
    }, AGENT_POLL_INTERVAL)

    const healthInterval = setInterval(() => {
      if (!isPolling.value) return
      fetchHealth()
    }, HEALTH_CHECK_INTERVAL)

    return () => {
      isPolling.value = false
      clearInterval(interval)
      clearInterval(healthInterval)
    }
  }

  function stopPolling(): void {
    isPolling.value = false
  }

  return {
    // State
    agents,
    globalUsage,
    healthStatus,
    filterStatus,
    isPolling,
    lastUpdateTime,
    // Computed
    runningAgents,
    idleAgents,
    errorAgents,
    abortedAgents,
    unknownAgents,
    totalAgents,
    activeAgents,
    filteredAgents,
    oldestSessionTime,
    uptimeMs,
    totalTokensUsed,
    totalCostCny,
    // Methods
    setFilterStatus,
    formatUptime,
    formatDuration,
    formatCost,
    getAgentByKey,
    fetchAgents,
    fetchAgentStatus,
    fetchGlobalUsage,
    fetchHealth,
    resetSession,
    fetchSessionHistory,
    subscribeAgents,
    stopPolling,
  }
})
