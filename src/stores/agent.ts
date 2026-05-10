import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { sessionsList, sessionStatus, health, sessionsHistory, resetSession as resetSessionApi, agentsList, ToolRestrictedError } from '../api/gateway'
import { getUsageStats } from '../api/usage-stats'

// Constants
const HEALTH_CHECK_INTERVAL = 10000 // 10s
const AGENT_POLL_INTERVAL = 10000 // 10s
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
  testing: '测试',
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
  elapsedMs?: number
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
  startTime?: string  // Gateway or service start time (for uptime calculation)
  uptimeMs?: number   // Service uptime in milliseconds
}

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<AgentInfo[]>([])
  const globalUsage = ref<GlobalUsage>({ totalTokens: 0, totalCost: 0, updatedAt: '' })
  const healthStatus = ref<string>('unknown')
  const gatewayUptimeMs = ref<number>(0) // Gateway uptime from API
  const filterStatus = ref<FilterStatus>('all')
  const isPolling = ref(false)
  const lastUpdateTime = ref(0)
  // 动态 Agent 名称映射:API 优先,硬编码降级
  const agentNameMap = ref<Record<string, string>>({ ...AGENT_NAME_MAP })
  const agentNameMapLoaded = ref(false)

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

  // ============================================
  // 核心指标计算 - 统一维度:本次 Gateway 启动至今
  // 参考:https://clawcn.net/gateway/
  // ============================================

  // 1. 运行时间 (uptime) - Gateway 从启动至今的毫秒数
  // 数据来源(优先级从高到低):
  //   Priority 1: Gateway /health 返回的 uptimeMs(预留接口,当前 Gateway 不返回此字段)
  //   Priority 2: usage-stats 返回的 uptimeMs(预留接口,当前服务不返回此字段)
  //   Fallback: 从最早 agent 会话时间推算(默认路径,精度 ≈ 分钟级,偏差来自会话创建延迟)
  const uptimeMs = computed(() => {
    // Priority 1: Gateway /health 返回的 uptimeMs(若 Gateway 支持)
    // fetchGatewayUptime() 会尝试提取,但当前 Gateway 不返回此字段
    if (gatewayUptimeMs.value > 0) {
      return gatewayUptimeMs.value
    }
    // Priority 2: usage-stats 服务返回的 uptimeMs(若服务支持)
    // 当前 usage-stats 不返回此字段,保留接口以备未来
    if (globalUsage.value.uptimeMs && globalUsage.value.uptimeMs > 0) {
      return globalUsage.value.uptimeMs
    }
    // Fallback: 从最早 agent 会话时间推算(默认路径,精度 ≈ 分钟级)
    if (agents.value.length === 0) return 0
    const times = agents.value.map((a) => {
      if (a.createdAt) return new Date(a.createdAt).getTime()
      return a.lastActivity || 0
    }).filter((t) => t > 0)
    if (times.length === 0) return 0
    const oldestSessionTime = Math.min(...times)
    return Date.now() - oldestSessionTime
  })

  // 2. 总 Token 用量 - Gateway 从启动至今的累计
  // 数据来源:usage-stats 服务统计的全局用量
  const totalTokensUsed = computed(() => {
    // Priority 1: usage-stats 服务的全局用量(Gateway 启动至今的累计)
    if (globalUsage.value.totalTokens > 0) {
      return globalUsage.value.totalTokens
    }
    // Fallback: 累加当前所有会话的用量(降级方案)
    return agents.value.reduce((sum, s) => {
      const t = Number(s.totalTokens) || 0
      return sum + t
    }, 0)
  })

  // 3. 总费用 - Gateway 从启动至今的累计
  // 计算公式:总费用 = OpenClaw API 费用 + 电费
  // 电费系数通过 VITE_ELECTRICITY_PER_HOUR 环境变量配置,默认 ¥2/小时
  // 使用显式检查避免 || 运算符误判 0 值(Number("0") || 2 → 2)
  const raw = import.meta.env.VITE_ELECTRICITY_PER_HOUR
  const parsed = raw === undefined || raw === '' ? undefined : Number(raw)
  const ELECTRICITY_PER_HOUR = (typeof parsed === 'number' && !isNaN(parsed)) ? parsed : 2

  const totalCostCny = computed(() => {
    // OpenClaw API 实际费用(usage-stats 统计的 Gateway 启动至今的费用)
    const openclawCost = globalUsage.value.totalCost || 0

    // 电费 = 运行时长 × 每小时电费
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

    // Force use Chinese name mapping (动态映射优先,硬编码降级)
    const map = agentNameMap.value

    // Step 1: Try direct lookup (rawKey might be "main", "recorder", etc.)
    let agentName = map[rawKey] || ''

    // Step 2: If not found, try extract from "agent:main:default" format
    if (!agentName && rawKey.includes(':')) {
      const parts = rawKey.split(':')
      // "agent:main:default" -> parts[1] = "main"
      if (parts.length >= 2 && parts[0] === 'agent') {
        agentName = map[parts[1]] || parts[1]
      } else if (parts.length >= 1) {
        // Try first part or last part
        agentName = map[parts[0]] || map[parts[parts.length - 1]] || parts[parts.length - 1]
      }
    }

    // Step 3: Handle cron sessions
    if (!agentName && rawKey.includes('cron:')) {
      const cronMatch = rawKey.match(/cron:(.+?)$/)
      agentName = cronMatch ? '定时任务:' + cronMatch[1] : '定时任务'
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
      elapsedMs: typeof item.elapsedMs === 'number' ? item.elapsedMs : (typeof item.runtimeMs === 'number' ? item.runtimeMs : undefined),
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
        startTime: (data as any).startTime,  // Extract start time if available
        uptimeMs: (data as any).uptimeMs,    // Extract uptime if available
      }
      console.log('[AgentStore] Global usage loaded:', data.totalTokens, 'tokens, cost:', data.totalCost)

      // If usage-stats provides uptime, use it to sync with gateway uptime
      if ((data as any).uptimeMs && (data as any).uptimeMs > 0) {
        gatewayUptimeMs.value = (data as any).uptimeMs
        console.log('[AgentStore] Gateway uptime synced from usage-stats:', gatewayUptimeMs.value, 'ms')
      }
    } catch (e) {
      console.warn('[AgentStore] fetchGlobalUsage error:', e)
    }
  }

  async function fetchHealth(): Promise<void> {
    try {
      const data = await health()
      const typed = data as Record<string, unknown>
      // /health 返回 { ok: true, status: "live" }
      // 映射 Gateway 的 status/ok 值到 UI 期望的值
      const raw = String(typed.status ?? '')
      const isOk = typed.ok === true || typed.ok === 'true'
      if (isOk || raw === 'ok' || raw === 'live') {
        healthStatus.value = 'healthy'
      } else if (raw === 'error') {
        healthStatus.value = 'unhealthy'
      } else {
        healthStatus.value = 'unknown'
      }
    } catch (e) {
      console.warn('[AgentStore] fetchHealth error:', e)
      healthStatus.value = 'unhealthy' // 请求失败视为不健康
    }
  }

  async function fetchGatewayUptime(): Promise<void> {
    try {
      const data = await health()
      const typed = data as Record<string, unknown>

      // 当前 Gateway /health 不返回 uptimeMs/uptime/bootTime 字段
      // 保留解析逻辑以备未来 Gateway 支持这些字段
      const uptimeMs = typed.uptimeMs ?? typed.uptime ?? typed.bootTime ?? typed.startTime

      if (typeof uptimeMs === 'number' && uptimeMs > 0) {
        gatewayUptimeMs.value = uptimeMs
        console.log('[AgentStore] Gateway uptime loaded:', uptimeMs, 'ms')
      } else if (typeof uptimeMs === 'string') {
        // If uptime is a string (ISO date), convert to ms
        const ms = new Date(uptimeMs).getTime()
        if (!isNaN(ms)) {
          gatewayUptimeMs.value = Date.now() - ms
          console.log('[AgentStore] Gateway uptime calculated from string:', gatewayUptimeMs.value, 'ms')
        }
      } else {
        // If no uptime field found, reset to 0 to trigger fallback
        console.warn('[AgentStore] Gateway uptime not found in health response, using fallback')
        gatewayUptimeMs.value = 0
      }
    } catch (e) {
      console.warn('[AgentStore] fetchGatewayUptime error:', e)
      // On error, reset to 0 to trigger fallback logic
      gatewayUptimeMs.value = 0
    }
  }

  /**
   * 动态获取 Agent 名称映射(agentsList API)
   * 成功:用 API 返回覆盖 agentNameMap
   * 失败:保持硬编码降级值不变
   */
  async function fetchAgentNames(): Promise<void> {
    if (agentNameMapLoaded.value) return // 只调用一次
    try {
      const data = await agentsList()
      if (Array.isArray(data)) {
        const dynamicMap: Record<string, string> = {}
        for (const item of data) {
          const typed = item as Record<string, unknown>
          const id = String(typed.id ?? typed.agentId ?? typed.key ?? '')
          const name = String(typed.name ?? typed.label ?? typed.displayName ?? '')
          if (id && name) {
            dynamicMap[id] = name
          }
        }
        // 合并:动态映射优先,硬编码作为降级
        agentNameMap.value = { ...AGENT_NAME_MAP, ...dynamicMap }
        agentNameMapLoaded.value = true
        console.log('[AgentStore] Agent names loaded from API:', dynamicMap)
      }
    } catch (e) {
      console.warn('[AgentStore] Failed to load agent names from API, using hardcoded map:', e)
    }
  }

  async function resetSession(sessionKey: string): Promise<void> {
    try {
      await resetSessionApi(sessionKey)
      console.log(`[AgentStore] Reset session ${sessionKey} via sessions_send API`)
    } catch (e: any) {
      // 保留 ToolRestrictedError 的语义,向上层传递
      if (e instanceof ToolRestrictedError) {
        console.warn(`[AgentStore] resetSession(${sessionKey}) blocked: ${e.tool} 不可用`)
        throw e
      }
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
    await Promise.all([fetchAgents(), fetchGlobalUsage(), fetchHealth(), fetchGatewayUptime(), fetchAgentNames()])

    const interval = setInterval(() => {
      if (!isPolling.value) return
      fetchAgents()
      fetchGlobalUsage()
      fetchGatewayUptime() // Also refresh gateway uptime
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
    gatewayUptimeMs,
    filterStatus,
    agentNameMap,
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
    fetchGatewayUptime,
    fetchAgentNames,
    resetSession,
    fetchSessionHistory,
    subscribeAgents,
    stopPolling,
  }
})
