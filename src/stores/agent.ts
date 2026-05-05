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
  status: AgentStatus
  lastActivity?: string
  createdAt?: string
  tokenUsage?: TokenUsage
  details?: Record<string, unknown>
  elapsedMs?: number
}

// Agent name mapping (from openclaw.json)
const AGENT_NAME_MAP: Record<string, string> = {
  'main': '副总',
  'recorder': '副总秘书',
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
  const loading = ref(false)
  const error = ref<string | null>(null)
  const healthStatus = ref<AgentState['healthStatus']>('unknown')

  // Getters
  const agentCount = computed(() => agents.value.length)
  const runningAgents = computed(() => agents.value.filter((a) => a.status === 'running'))
  const idleAgents = computed(() => agents.value.filter((a) => a.status === 'idle'))
  const errorAgents = computed(() => agents.value.filter((a) => a.status === 'error'))
  const abortedAgents = computed(() => agents.value.filter((a) => a.status === 'aborted'))
  const unknownAgents = computed(() => agents.value.filter((a) => a.status === 'unknown'))

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

    // Derive status
    let derivedStatus: AgentStatus = 'idle'
    const abortedRaw = String(item.abortedLastRun ?? '').toLowerCase()
    const systemSentRaw = String(item.systemSent ?? '').toLowerCase()
    const aborted = abortedRaw === 'true' || item.abortedLastRun === true
    const systemSent = systemSentRaw === 'true' || item.systemSent === true
    const updatedAt = num(item.updatedAt)

    if (aborted) {
      derivedStatus = 'aborted'
    } else if (systemSent && updatedAt > 0) {
      const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
      if (secondsSinceUpdate < 120) {
        derivedStatus = 'running'
      } else if (secondsSinceUpdate < 600) {
        derivedStatus = 'running'
      } else {
        derivedStatus = 'idle'
      }
    }

    const explicitStatus = str(item.status) as AgentStatus
    if (explicitStatus && explicitStatus !== 'unknown') {
      derivedStatus = explicitStatus
    }

    // Token usage
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
      status: derivedStatus,
      lastActivity: str(item.lastActivity ?? item.lastSeen ?? item.updatedAt) || undefined,
      createdAt: str(item.startedAt ?? item.createdAt ?? item.created) || undefined,
      tokenUsage,
      elapsedMs,
      details: (item.details ?? item.metadata) as Record<string, unknown> | undefined,
    }
  }

  // Actions

  async function fetchAgents(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const data = await sessionsList()
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

  let pollingInterval: ReturnType<typeof setInterval> | null = null
  const POLL_MS = 30000

  function subscribeAgents(): void {
    fetchAgents()
    fetchHealth()
    if (pollingInterval) clearInterval(pollingInterval)
    pollingInterval = setInterval(() => {
      fetchAgents()
    }, POLL_MS)
  }

  function unsubscribeAgents(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
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
