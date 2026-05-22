import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { sessionsList, sessionStatus, health, sessionsHistory, agentsList, getGpuVramUsage, sessionsSend } from '../api/gateway'
import { getUsageStats } from '../api/usage-stats'

// Constants
const HEALTH_CHECK_INTERVAL = 10000 // 10s
const AGENT_POLL_INTERVAL = 10000 // 10s
const GPU_POLL_INTERVAL = 30000 // 30s (REC-091)
const MESSAGE_POLL_INTERVAL = 3000 // 3s (REC-080)
const BUBBLE_DURATION = 20000 // 20s 气泡自动消失
const STORAGE_KEY = 'openclaw_dashboard_agent_filter'

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
  emoji?: string
  historicalTokens?: number  // 从 byAgent 统计的历史总 token
}

export interface ModelUsage {
  tokens: number
  cost: number
}

export interface GlobalUsage {
  totalTokens: number
  totalCost: number
  updatedAt: string
  startTime?: string
  uptimeMs?: number
  byModel?: Record<string, ModelUsage>
  byAgentByModel?: Record<string, Record<string, ModelUsage>>
  byAgent?: Record<string, { tokens: number; cost: number; sessionCount: number }>
}

export interface ImageAttachment {
  mediaType: string
  data: string
}

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<AgentInfo[]>([])
  const globalUsage = ref<GlobalUsage>({ totalTokens: 0, totalCost: 0, updatedAt: '' })
  const healthStatus = ref<'healthy' | 'degraded' | 'unhealthy' | 'unknown'>('unknown')
  const gatewayUptimeMs = ref<number>(0) // Gateway uptime from API
  const gatewayVersion = ref<string>(import.meta.env.VITE_OPENCLAW_VERSION || '') // Gateway version from /health, fallback from env (REC-089)
  const gpuVramPercentage = ref<number | null>(null) // GPU 显存使用占比 (REC-091)
  const gpuVramUsedMb = ref<number>(0) // GPU 已用显存 MB (REC-096)
  const gpuVramTotalMb = ref<number>(0) // GPU 总显存 MB (REC-096)
  // Fallback: use env var if /health doesn't return version (REC-089 fix)
  const fallbackVersion = import.meta.env.VITE_OPENCLAW_VERSION || ''
  const filterStatus = ref<FilterStatus>('all')
  const isPolling = ref(false)
  const lastUpdateTime = ref(0)

  // ============================================
  // REC-071: Agent 消息气泡状态
  // ============================================
  interface MessageBubbleData {
    content: string
    timestamp: number
  }
  const messageBubbles = ref<Record<string, MessageBubbleData>>({})
  const lastMessageCount = ref<Record<string, number>>({})
  let bubbleTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  let messagePollTimer: ReturnType<typeof setInterval> | null = null

  // ============================================
  // Agent 名称映射：API 为主，.env 配置化降级（REC-091）
  // 数据来源优先级：agentsList API > .env VITE_AGENT_* 变量 > 原始 key
  // ============================================
  /** 从 .env VITE_AGENT_* 变量构建降级映射表 */
  function buildEnvFallbackMap(): Record<string, string> {
    const map: Record<string, string> = {}
    const env = import.meta.env
    for (const key of Object.keys(env)) {
      if (key.startsWith('VITE_AGENT_')) {
        // 变量名中连字符用下划线替代，提取后还原为 hyphen（匹配 OpenClaw agent id）
        let agentId = key.slice('VITE_AGENT_'.length).replace(/_/g, '-')
        const name = env[key]
        if (agentId && name) {
          map[agentId] = name
        }
      }
    }
    return map
  }

  const envFallbackMap = buildEnvFallbackMap()
  // 动态 Agent 名称映射：初始使用 .env 降级，API 成功后覆盖
  const agentNameMap = ref<Record<string, string>>({ ...envFallbackMap })
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

    // 名称映射：API 数据优先，.env 配置化降级（REC-091）
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
      // 同时拉三个数据源：活跃会话 + 已配置 agent 列表 + 文件 mtime 运行状态
      const [sessionsData, configuredResp, runningResp] = await Promise.all([
        sessionsList(),
        fetch('/api/agents-configured').then(r => r.ok ? r.json() : { agents: [] }).catch(() => ({ agents: [] })),
        fetch('/api/agent-running-status').then(r => r.ok ? r.json() : { agents: [] }).catch(() => ({ agents: [] })),
      ])

      const sessions = Array.isArray((sessionsData as any).sessions) ? (sessionsData as any).sessions : []
      const configuredAgents = Array.isArray(configuredResp?.agents) ? configuredResp.agents : []

      // 构建运行状态 map（基于 session 文件 mtime，90秒内有写入 = running）
      const runningStatusMap = new Map<string, AgentStatus>()
      for (const ra of (Array.isArray(runningResp?.agents) ? runningResp.agents : [])) {
        if (ra.id && ra.status) runningStatusMap.set(ra.id as string, ra.status as AgentStatus)
      }

      // 规范化 sessions_list 返回的会话；若 mtime 显示 running 则强制覆盖 done 状态
      const sessionAgents = sessions.map((s: any) => {
        const agent = normalizeAgent(s)
        const agentId = (agent.key || '').split(':')[1] || ''
        if (runningStatusMap.get(agentId) === 'running' && agent.status !== 'running') {
          agent.status = 'running'
        }
        return agent
      })

      const sessionAgentIds = new Set(sessionAgents.map((a: AgentInfo) => {
        // session key 格式: agent:{agentId}:{sessionId}
        const parts = (a.key || '').split(':')
        return parts[1] || ''
      }).filter(Boolean))

      // 已配置但无 webchat 会话的 agent → 使用文件 mtime 实时状态（替代硬编码 idle）
      const configuredOnlyAgents: AgentInfo[] = configuredAgents
        .filter((c: any) => !sessionAgentIds.has(c.id))
        .map((c: any) => ({
          key: `agent:${c.id}:main`,
          name: c.name || c.id,
          displayName: c.emoji ? `${c.emoji} ${c.name}` : c.name,
          status: (runningStatusMap.get(c.id) || 'idle') as AgentStatus,
          lastActivity: 0,
          model: c.model,
          kind: 'configured',
          channel: 'none',
          emoji: c.emoji || '',
          historicalTokens: globalUsage.value.byAgent?.[c.id]?.tokens || 0,
        }))

      agents.value = [...sessionAgents, ...configuredOnlyAgents]
      lastUpdateTime.value = Date.now()
      const runningIds = [...runningStatusMap.entries()].filter(([, v]) => v === 'running').map(([k]) => k)
      console.log(`[AgentStore] sessions=${sessions.length} configured=${configuredAgents.length} running=[${runningIds.join(',') || 'none'}] total=${agents.value.length}`)
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
        startTime: (data as any).startTime,
        uptimeMs: (data as any).uptimeMs,
        byModel: data.byModel,
        byAgentByModel: data.byAgentByModel,
        byAgent: data.byAgent,
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
      // /health 返回 { ok: true, status: "live", version: "2026.3.13" }
      // 映射 Gateway 的 status/ok 值到 UI 期望的值
      const raw = String(typed.status ?? '')
      const isOk = typed.ok === true || typed.ok === 'true'
      if (raw === 'degraded') {
        healthStatus.value = 'degraded'
      } else if (isOk || raw === 'ok' || raw === 'live') {
        healthStatus.value = 'healthy'
      } else if (raw === 'error') {
        healthStatus.value = 'unhealthy'
      } else {
        healthStatus.value = 'unknown'
      }
      // 提取版本号 (REC-089: /health 不返回 version 时使用环境变量兜底)
      const version = typed.version
      if (typeof version === 'string' && version) {
        gatewayVersion.value = version
      } else if (fallbackVersion) {
        // Fallback: 从 VITE_OPENCLAW_VERSION 环境变量获取 (来自 openclaw package.json)
        gatewayVersion.value = fallbackVersion
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
   * 获取 GPU 显存使用占比 (REC-091 / REC-096)
   * 通过 /api/gpu-vram 后端 API 获取
   * 返回: { usedPct, usedMb, totalMb }
   */
  async function fetchGpuVram(): Promise<void> {
    try {
      const data = await getGpuVramUsage()
      if (data) {
        gpuVramPercentage.value = data.usedPct
        gpuVramUsedMb.value = data.usedMb
        gpuVramTotalMb.value = data.totalMb
        console.log(`[AgentStore] GPU VRAM: ${data.usedPct}% (${data.usedMb}/${data.totalMb} MB)`)
      }
    } catch (e) {
      console.warn('[AgentStore] fetchGpuVram error:', e)
    }
  }

  /**
   * 动态获取 Agent 名称映射(agentsList API)
   * API 成功 → 覆盖为 API 数据；失败 → 保留 .env 配置化降级（REC-091）
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
        agentNameMap.value = dynamicMap
        agentNameMapLoaded.value = true
        console.log('[AgentStore] Agent names loaded from API:', dynamicMap)
      }
    } catch (e) {
      console.warn('[AgentStore] Failed to load agent names from API, using .env fallback:', e)
    }
  }

  async function resetSession(sessionKey: string): Promise<void> {
    try {
      const agentId = extractAgentId(sessionKey)
      
      // REC-097: 调用合并后的后端服务 (端口 31002/31004)
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:31004'
      const url = `${backendUrl}/reset`
      
      console.log(`[AgentStore] Calling reset service: ${url}`)
      console.log(`[AgentStore] Agent ID: ${agentId}`)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentId }),
      })
      
      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`)
      }
      
      console.log(`[AgentStore] Reset session ${sessionKey} via CLI command, result:`, result)
    } catch (e: any) {
      console.error(`[AgentStore] resetSession(${sessionKey}) error:`, e)
      throw e
    }
  }

  /** 从 sessionKey 提取 agentId（与 resetSession 共用） */
  function extractAgentId(sessionKey: string): string {
    if (sessionKey.includes(':')) {
      const parts = sessionKey.split(':')
      if (parts[0] === 'agent' && parts.length >= 2) {
        return parts[1]
      }
    }
    return sessionKey
  }

  /**
   * 发送消息到 Agent 会话
   * 使用 Gateway REST API /tools/invoke with tool=sessions_send
   */
  async function sendAgentMessage(sessionKey: string, message: string): Promise<void> {
    try {
      console.log(`[AgentStore] Sending to ${sessionKey}: ${message.slice(0, 100)}`)
      const result = await sessionsSend(sessionKey, message, 0)
      console.log(`[AgentStore] Send result:`, result)
    } catch (e: any) {
      console.error(`[AgentStore] sendAgentMessage(${sessionKey}) error:`, e)
      throw e
    }
  }

  /**
   * 发送消息到 Agent 会话（支持图片附件）
   * 方案 B：图片 base64 先写入 Agent workspace，再发送文件路径
   */
  async function sendAgentMessageWithImages(
    sessionKey: string,
    text: string,
    images: ImageAttachment[],
  ): Promise<void> {
    try {
      const agentId = extractAgentId(sessionKey)
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:31004'

      // Step 1: 将所有图片写入 Agent workspace
      const filePaths: string[] = []
      for (const img of images) {
        const uploadUrl = `${backendUrl}/api/upload-image`
        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, mediaType: img.mediaType, data: img.data }),
        })
        const result = await response.json()
        if (result.success) {
          filePaths.push(result.filePath)
          console.log(`[AgentStore] Uploaded image: ${result.filePath}`)
        } else {
          throw new Error(`上传图片失败: ${result.error}`)
        }
      }

      // Step 2: 构建消息 — 文本 + 文件路径
      let fullMessage = text
      for (const fp of filePaths) {
        fullMessage += `\n\n${fp}`
      }

      // Step 3: 发送消息
      console.log(`[AgentStore] Sending to ${sessionKey}: ${fullMessage.slice(0, 120)}`)
      const result = await sessionsSend(sessionKey, fullMessage, 0)
      console.log(`[AgentStore] Send result:`, result)
    } catch (e: any) {
      console.error(`[AgentStore] sendAgentMessageWithImages(${sessionKey}) error:`, e)
      throw e
    }
  }

  function getAgentByKey(key: string): AgentInfo | null {
    const agent = agents.value.find((a) => a.key === key)
    return agent || null
  }

  /** 获取指定 agent 的历史总 token 用量 */
  function getAgentHistoricalTokens(agentId: string): number {
    return globalUsage.value.byAgent?.[agentId]?.tokens || 0
  }

  async function fetchSessionHistory(sessionKey: string, limit: number = 100): Promise<Record<string, unknown>[]> {
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

  // ============================================
  // REC-071: Agent 消息气泡管理
  // ============================================

  /**
   * 显示/更新 Agent 消息气泡
   * 新消息覆盖旧气泡，重置 3 秒倒计时
   */
  function updateAgentBubble(agentKey: string, content: string): void {
    // 清除旧定时器
    if (bubbleTimers[agentKey]) {
      clearTimeout(bubbleTimers[agentKey])
    }

    // 设置新气泡
    messageBubbles.value[agentKey] = {
      content,
      timestamp: Date.now(),
    }

    // 3 秒后自动消失
    bubbleTimers[agentKey] = setTimeout(() => {
      delete messageBubbles.value[agentKey]
      delete bubbleTimers[agentKey]
    }, BUBBLE_DURATION)
  }

  /**
   * 轮询检测 Agent 新消息（增量检测）
   * REC-076: 只显示 running 状态 + 显示所有内容类型（含思考过程、工具调用）
   */
  async function checkNewMessages(): Promise<void> {
    console.log('[REC-082] checkNewMessages 开始，agents 数量:', agents.value.length)

    // 提取消息内容的通用函数
    function extractContent(msg: Record<string, unknown>): string {
      if (typeof msg?.content === 'string') return msg.content as string
      if (typeof msg?.content === 'object' && msg.content !== null && !Array.isArray(msg.content)) {
        const c = msg.content as Record<string, unknown>
        if (typeof c.text === 'string') return c.text
      }
      if (Array.isArray(msg?.content)) {
        const items = msg.content as Array<Record<string, unknown>>
        console.log(`[REC-085] content 数组 (${items.length} 项):`, items.map((x: Record<string, unknown>) => ({
          type: x.type,
          name: x.name,
          input: x.input ? JSON.stringify(x.input).slice(0, 80) : null,
          textLen: typeof x.text === 'string' ? x.text.length : 0,
          thinkingLen: typeof x.thinking === 'string' ? x.thinking.length : 0,
          contentItems: Array.isArray(x.content) ? (x.content as any[]).length : null,
        })))
        const parts = items.map(item => {
          if (!item || typeof item !== 'object') return ''
          const t = String(item.type ?? '')
          if (t === 'text') return (item.text as string) ?? ''
          if (t === 'thinking') return `💭 ${(item.thinking as string) ?? ''}`
          if (t === 'tool_use') {
            const name = String(item.name ?? '')
            if (name) return `[🔧 ${name}]`
            // 没有 name 时尝试从 input 提取信息
            const input = item.input
            if (typeof input === 'string' && input) return `[🔧 工具调用]`
            if (typeof input === 'object' && input !== null) return `[🔧 工具调用]`
            return ''
          }
          if (t === 'tool_result') {
            const name = String(item.name ?? '')
            // tool_result 的 content 可能是数组 [{type:'text', text:'...'}]
            const resultContent = item.content
            if (Array.isArray(resultContent)) {
              const textParts = resultContent
                .filter((r: any) => r?.type === 'text' && typeof r.text === 'string')
                .map((r: any) => r.text)
              if (textParts.length > 0) {
                return `[🔧 ${name || '结果'}] ${textParts.join('\n').slice(0, 200)}`
              }
            }
            // 降级：直接取 text 字段
            if (typeof item.text === 'string' && item.text) return `[🔧 ${name || '结果'}] ${item.text}`
            if (name) return `[🔧 ${name}]`
            return `[🔧 工具结果]`
          }
          return ''
        }).filter(s => s && s !== '[tool_code]')
        console.log(`[REC-085] 提取结果 (${parts.length} 部分):`, parts.map(p => p.slice(0, 80)))
        return parts.join('\n')
      }
      return ''
    }

    // 过滤系统消息
    function isSystemMessage(content: string): boolean {
      return content.includes('巡检异常通知')
        || content.includes('巡检提醒')
        || content.includes('HEARTBEAT_OK')
        || content.startsWith('收到巡检报告')
        || content.includes('巡检异常汇报')
    }

    for (const agent of agents.value) {
      if (agent.key.includes(':cron:')) continue
      if (agent.status !== 'running') continue

      try {
        const history = await fetchSessionHistory(agent.key, 50)
        const currentCount = history.length

        const prevCount = lastMessageCount.value[agent.key] || 0
        // 仅处理会话重置（消息数变少）：重新初始化计数器
        if (prevCount > currentCount) {
          lastMessageCount.value[agent.key] = currentCount
          continue
        }

        if (currentCount > prevCount) {
          // 找最新一条 assistant/agent 消息（而非 user 消息）
          const newCount = currentCount - prevCount
          const newMessages = history.slice(-Math.min(newCount, 20)).reverse()

          let found = false
          for (const raw of newMessages) {
            const msg = (raw && typeof raw === 'object'
              ? ((raw.message && typeof raw.message === 'object' ? raw.message : raw) as Record<string, unknown>)
              : {}) as Record<string, unknown>

            const role = String(msg?.role ?? '')
            console.log(`[REC-085] agent=${agent.key} role="${role}" content 类型=${typeof msg.content}`, typeof msg.content === 'object' ? JSON.stringify(msg.content).slice(0, 200) : String(msg.content ?? '').slice(0, 100))

            // 显示所有角色的消息（包含 user、assistant、tool 等）
            // 避免遗漏，全量显示；extractContent 内部会过滤无意义内容
            if (role === 'user' || role === 'assistant' || role === 'agent' || role === 'tool') {
              const content = extractContent(msg)
              console.log(`[REC-085] 提取内容 长度=${content?.length ?? 0}`, content?.slice(0, 120))
              if (content && !isSystemMessage(content)) {
                console.log(`[REC-085] ✅ agent=${agent.key} 显示:`, content.slice(0, 150))
                updateAgentBubble(agent.key, content)
                found = true
                break // 只显示最新一条
              }
            }
          }

          if (!found) {
            console.log(`[REC-082] agent=${agent.key} 无符合条件的消息（新消息 ${newCount} 条）`)
          }

          lastMessageCount.value[agent.key] = currentCount
        }
      } catch (e) {
        console.warn(`[REC-082] agent=${agent.key} 轮询失败:`, e)
      }
    }
  }

  /**
   * 获取指定 Agent 的当前气泡消息
   */
  function getAgentBubble(agentKey: string): string | null {
    return messageBubbles.value[agentKey]?.content ?? null
  }

  /**
   * 清除指定 Agent 的气泡
   */
  function clearAgentBubble(agentKey: string): void {
    if (bubbleTimers[agentKey]) {
      clearTimeout(bubbleTimers[agentKey])
      delete bubbleTimers[agentKey]
    }
    delete messageBubbles.value[agentKey]
  }

  async function subscribeAgents(): Promise<() => void> {
    isPolling.value = true
    await Promise.all([fetchAgents(), fetchGlobalUsage(), fetchHealth(), fetchGatewayUptime(), fetchAgentNames(), fetchGpuVram()])

    // REC-071: 首次加载时静默初始化消息计数器
    for (const agent of agents.value) {
      if (agent.key.includes(':cron:')) continue
      if (lastMessageCount.value[agent.key] !== undefined) continue
      try {
        const h = await fetchSessionHistory(agent.key, 1)
        lastMessageCount.value[agent.key] = h.length
      } catch { /* ignore */ }
    }
    console.log('[REC-071] 初始化计数器:', lastMessageCount.value)

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

    // GPU VRAM 轮询 (REC-091) - 30秒
    const gpuInterval = setInterval(() => {
      if (!isPolling.value) return
      fetchGpuVram()
    }, GPU_POLL_INTERVAL)

    // REC-071: 消息气泡轮询
    messagePollTimer = setInterval(() => {
      if (!isPolling.value) return
      checkNewMessages()
    }, MESSAGE_POLL_INTERVAL)

    return () => {
      isPolling.value = false
      clearInterval(interval)
      clearInterval(healthInterval)
      clearInterval(gpuInterval)
      if (messagePollTimer) {
        clearInterval(messagePollTimer)
        messagePollTimer = null
      }
      // 清理所有气泡定时器
      Object.values(bubbleTimers).forEach(clearTimeout)
      bubbleTimers = {}
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
    gatewayVersion,
    gpuVramPercentage,
    gpuVramUsedMb,
    gpuVramTotalMb,
    filterStatus,
    agentNameMap,
    messageBubbles,
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
    getAgentHistoricalTokens,
    fetchAgents,
    fetchAgentStatus,
    fetchGlobalUsage,
    fetchHealth,
    fetchGatewayUptime,
    fetchAgentNames,
    fetchGpuVram,
    resetSession,
    sendAgentMessage,
    sendAgentMessageWithImages,
    fetchSessionHistory,
    subscribeAgents,
    stopPolling,
    // REC-071: 消息气泡
    updateAgentBubble,
    getAgentBubble,
    clearAgentBubble,
  }
})
