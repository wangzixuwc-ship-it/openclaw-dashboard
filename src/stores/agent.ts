import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { sessionsList, sessionStatus, health, sessionsHistory } from '../api/gateway'

export type AgentStatus = 'idle' | 'running' | 'error' | 'aborted' | 'unknown'

export interface TokenUsage {
  current: number
  max: number
  percentage: number
}

export interface AgentInfo {
  key: string
  name: string
  label?: string
  status: AgentStatus
  lastActivity?: string
  createdAt?: string
  tokenUsage?: TokenUsage
  details?: Record<string, unknown>
  elapsedMs?: number
  model?: string
}

// Agent name mapping (from openclaw.json)
const AGENT_NAME_MAP: Record<string, string> = {
  'main': '副总',
  'recorder': '执行秘书',
  'seo': '网站运营',
  'backend': '后端开发',
  'frontend': '前端开发',
  'architect': '架构师',
  'codeaudit': '代码审计',
  'testing': '测试工程师',
  'devops': '运维',
  'product': '产品经理',
  'requirements': '需求分析',
  'researchassistant': '调研员',
  'lesson-assistant': '教研员',
  'debugger': '调试员',
  'comfyui': 'Comfy',
  'uiux': '设计师',
  'ppt-master': 'PPT制作',
  'supervisor': '监督员',
}

interface AgentState {
  agents: AgentInfo[]
  loading: boolean
  error: string | null
  healthStatus: 'healthy' | 'unhealthy' | 'unknown'
}

export type FilterStatus = 'all' | 'running' | 'idle' | 'error' | 'aborted'

export const useAgentStore = defineStore('agent', () => {
  // State
  const agents = ref<AgentInfo[]>([])
  const allSessionsRaw = ref<Record<string, unknown>[]>([]) // Store raw sessions for global stats
  const loading = ref(false)
  const error = ref<string | null>(null)
  const healthStatus = ref<AgentState['healthStatus']>('unknown')
  const now = ref(Date.now()) // Reactive "now" that ticks every second for uptime display
  
  // Global usage stats from usage-stats service
  const globalUsage = ref<{
    totalTokens: number
    totalCost: number
    updatedAt: string
  }>({ totalTokens: 0, totalCost: 0, updatedAt: '' })

  // Getters
  const agentCount = computed(() => agents.value.length)
  const runningAgents = computed(() => agents.value.filter((a) => a.status === 'running'))
  const idleAgents = computed(() => agents.value.filter((a) => a.status === 'idle'))
  const errorAgents = computed(() => agents.value.filter((a) => a.status === 'error'))
  const abortedAgents = computed(() => agents.value.filter((a) => a.status === 'aborted'))
  const unknownAgents = computed(() => agents.value.filter((a) => a.status === 'unknown'))

  // Uptime: use oldest session's createdAt as reference (when openclaw started)
  const oldestSessionTime = computed(() => {
    if (agents.value.length === 0) return 0
    const times = agents.value
      .map((a) => {
        // Use createdAt (startedAt/createdAt/created) as it represents session creation time
        if (a.createdAt) {
          return new Date(a.createdAt).getTime()
        }
        // Fallback to lastActivity if createdAt is unavailable
        return a.lastActivity || 0
      })
      .filter((t) => t > 0)
    if (times.length === 0) return 0
    return Math.min(...times)
  })

  const uptimeMs = computed(() => {
    if (oldestSessionTime.value === 0) return 0
    return now.value - oldestSessionTime.value
  })

  function formatUptime(ms: number): string {
    if (ms <= 0) return '未知'
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days}天${hours % 24}小时`
    if (hours > 0) return `${hours}小时${minutes % 60}分`
    if (minutes > 0) return `${minutes}分${seconds % 60}秒`
    return `${seconds}秒`
  }

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
      agentName = cronMatch ? '定时任务: ' + cronMatch[1] : '定时任务'
    }

    // Step 4: Final fallback
    if (!agentName) {
      agentName = str(item.label) || str(item.name) || rawKey || 'Unnamed'
    }

    // Get status: API does NOT return a 'status' field
    // Must derive from: abortedLastRun, updatedAt
    // Logic: abortedLastRun=true → aborted; recently updated → running; else → idle
    let derivedStatus: AgentStatus = 'unknown'

    // 1) Check if aborted (most reliable)
    const abortedRaw = String(item.abortedLastRun ?? '').toLowerCase()
    const aborted = abortedRaw === 'true' || item.abortedLastRun === true
    if (aborted) {
      derivedStatus = 'aborted'
    } else {
      // 2) Use updatedAt to determine running vs idle
      const updatedAt = num(item.updatedAt)
      if (updatedAt > 0) {
        const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
        // Cron sessions: idle if no update in 1 minute (60 seconds)
        // Regular sessions: idle if no update in 5 minutes (300 seconds)
        const idleThreshold = rawKey.includes(':cron:') ? 60 : 300
        derivedStatus = secondsSinceUpdate < idleThreshold ? 'running' : 'idle'
      } else {
        // No updatedAt at all
        derivedStatus = 'unknown'
      }
    }

    // Token usage - API returns: totalTokens (used), contextTokens (max)
    const totalTokens = num(item.totalTokens)
    const contextTokens = num(item.contextTokens)
    let tokenUsage: TokenUsage | undefined
    
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
        if (max > 0 && current > 0) {
          tokenUsage = {
            current,
            max,
            percentage: Math.round((current / max) * 100),
          }
        }
      }
    }

    // Elapsed time
    let elapsedMs: number | undefined
    const startedAt = str(item.startedAt)
    if (startedAt) {
      elapsedMs = Date.now() - new Date(startedAt).getTime()
    }
    const elapsedVal = num(item.elapsedMs)
    if (elapsedVal > 0) {
      elapsedMs = elapsedVal
    }
    if (!elapsedMs || elapsedMs <= 0) {
      const updatedAt2 = num(item.updatedAt)
      if (updatedAt2 > 0) {
        elapsedMs = Date.now() - updatedAt2
      }
    }

    return {
      key: rawKey,
      name: agentName,
      label: str(item.label) || undefined,
      status: derivedStatus,
      lastActivity: num(item.updatedAt) || undefined, // Store as numeric timestamp for uptime calculation
      createdAt: str(item.startedAt ?? item.createdAt ?? item.created) || undefined,
      tokenUsage,
      elapsedMs,
      details: (item.details ?? item.metadata) as Record<string, unknown> | undefined,
      model: str(item.model) || undefined,
    }
  }

  // Actions

  async function fetchAgents(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // Do NOT pass activeMinutes - let API return default recent sessions
      const data = await sessionsList()
      // Debug: log raw API response
      console.log('[AgentStore] Raw API response:', data)

      // After interceptor, data is typically { count, sessions } (i.e., result.details)
      // Save ALL raw sessions for global stats
      const raw = data as Record<string, unknown>
      const rawSessions = (() => {
        // Case 1: data is already { count, sessions } (interceptor unwrapped result.details)
        if (Array.isArray(raw.sessions)) return raw.sessions as Record<string, unknown>[]
        // Case 2: data has details.sessions
        if (raw.details && typeof raw.details === 'object') {
          const d = raw.details as Record<string, unknown>
          if (Array.isArray(d.sessions)) return d.sessions as Record<string, unknown>[]
        }
        // Case 3: data is an array directly
        if (Array.isArray(data)) return data as Record<string, unknown>[]
        return []
      })()
      allSessionsRaw.value = rawSessions
      console.log('[AgentStore] Total sessions (raw):', rawSessions.length)

      // Normalize into agents
      if (Array.isArray(raw.sessions)) {
        agents.value = (raw.sessions as Record<string, unknown>[]).map((item) => normalizeAgent(item))
      } else if (raw.details && typeof raw.details === 'object') {
        const d = raw.details as Record<string, unknown>
        if (Array.isArray(d.sessions)) {
          agents.value = (d.sessions as Record<string, unknown>[]).map((item) => normalizeAgent(item))
        }
      } else if (Array.isArray(data)) {
        agents.value = (data as unknown[]).map((item) => normalizeAgent(item as Record<string, unknown>))
      } else {
        agents.value = [normalizeAgent(raw)]
      }
    } catch (e) {
      error.value = (e instanceof Error ? e.message : String(e)) || 'Failed to fetch agents'
      console.error('[AgentStore] fetchAgents error:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch global usage stats from usage-stats service
   */
  async function fetchGlobalUsage(): Promise<void> {
    try {
      // Use Vite proxy to avoid CORS issues
      const response = await fetch('/usage-stats/api/usage')
      if (!response.ok) {
        console.warn('[AgentStore] Failed to fetch global usage:', response.status)
        return
      }
      const data = await response.json()
      globalUsage.value = {
        totalTokens: data.totalTokens || 0,
        totalCost: data.totalCost || 0,
        updatedAt: data.updatedAt || '',
      }
      console.log('[AgentStore] Global usage loaded:', data.totalTokens, 'tokens')
    } catch (e) {
      console.warn('[AgentStore] fetchGlobalUsage error:', e)
    }
  }

  let pollingInterval: ReturnType<typeof setInterval> | null = null
  let uptimeTimer: ReturnType<typeof setInterval> | null = null
  const POLL_MS = 30000

  function subscribeAgents(): void {
    fetchAgents()
    fetchGlobalUsage()  // Load global usage stats
    fetchHealth()
    if (pollingInterval) clearInterval(pollingInterval)
    if (uptimeTimer) clearInterval(uptimeTimer)
    pollingInterval = setInterval(() => {
      fetchAgents()
      fetchGlobalUsage()  // Refresh global usage every 30s
    }, POLL_MS)
    // Update 'now' every second so uptime display refreshes
    uptimeTimer = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  }

  function unsubscribeAgents(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
    if (uptimeTimer) {
      clearInterval(uptimeTimer)
      uptimeTimer = null
    }
  }

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

  function formatDuration(ms?: number): string {
    if (!ms || ms <= 0) return '-'
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }

  // Total token consumption within uptime period
  const totalTokensUsed = computed(() => {
    const uptimeStart = oldestSessionTime.value
    if (uptimeStart === 0) return 0

    // Filter sessions created after uptime start
    const sessionsInUptime = allSessionsRaw.value.filter((s) => {
      const r = s as Record<string, unknown>
      const createdAt = r.startedAt ?? r.createdAt ?? r.created
      if (!createdAt) return true // Include sessions without creation time
      const createdTime = typeof createdAt === 'number' ? createdAt : new Date(createdAt as string).getTime()
      return createdTime >= uptimeStart
    })

    // Sum tokens from filtered sessions
    return sessionsInUptime.reduce((sum, s) => {
      const r = s as Record<string, unknown>
      let t = Number(r.totalTokens)
      if (isNaN(t) || t <= 0) {
        const usage = r.usage as Record<string, unknown> | undefined
        if (usage) t = Number(usage.totalTokens ?? usage.total_tokens ?? usage.total)
      }
      return sum + (isNaN(t) ? 0 : t)
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

  function formatCost(cny: number): string {
    if (cny <= 0) return '¥0.00'
    if (cny < 0.01) return '<¥0.01'
    return '¥' + cny.toFixed(2)
  }

  return {
    // State
    agents,
    loading,
    error,
    healthStatus,
    // Getters
    agentCount,
    runningAgents,
    idleAgents,
    errorAgents,
    abortedAgents,
    unknownAgents,
    isHealthy,
    filteredAgents,
    oldestSessionTime,
    uptimeMs,
    totalTokensUsed,
    totalCostCny,
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
    formatUptime,
    formatCost,
  }
})
