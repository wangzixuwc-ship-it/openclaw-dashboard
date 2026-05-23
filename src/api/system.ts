import axios from 'axios'

/** 技能信息接口 (REC-005) */
export interface SkillInfo {
  name: string
  description: string
  icon?: string
  status?: string
  installed?: boolean
  enabled?: boolean
  // REC-011: 统计信息
  updatedAt?: string
  stars?: number
  downloads?: number
  // REC-018: 技能来源标识
  source?: 'builtin' | 'clawhub'
  [key: string]: unknown
}

/** 技能列表响应接口 (REC-005) */
export interface SkillsResponse {
  success: boolean
  total: number
  ready: number
  skills: SkillInfo[]
}

/**
 * 获取系统版本号 (REC-066)
 * 后端接口: GET /api/system/version → 端口 31002
 * 开发环境通过 Vite proxy 转发，生产环境直连后端
 * 返回: { version: string }
 */
export async function getVersion(): Promise<{ version: string } | null> {
  try {
    const url = import.meta.env.DEV
      ? '/api/system/version'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'}/api/system/version`
    const resp = await axios.get(url, { timeout: 10000 })
    return resp.data as { version: string }
  } catch {
    return null
  }
}

/**
 * 网关诊断修复 (REC-003)
 * 后端接口: POST /api/system/doctor → 端口 31002
 * 执行 openclaw doctor 命令，返回诊断结果
 * 返回: { success: boolean, stdout: string, stderr: string, command: string, platform: string, error?: string }
 */
export interface DoctorResult {
  success: boolean
  stdout: string
  stderr: string
  command: string
  platform: string
  error?: string
}

export async function runDoctor(): Promise<DoctorResult | null> {
  try {
    const url = import.meta.env.DEV
      ? '/api/system/doctor'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'}/api/system/doctor`
    const resp = await axios.post(url, {}, { timeout: 120000 })
    return resp.data as DoctorResult
  } catch (e: unknown) {
    console.error('[System] runDoctor error:', e)
    return null
  }
}

/**
 * 获取 OpenClaw 技能列表 (REC-005)
 * 后端接口: GET /api/system/skills → 端口 31002
 * 返回: { success, total, ready, skills: [{ name, description, icon, status, ... }] }
 */
export async function getSkills(): Promise<SkillsResponse | null> {
  try {
    const url = import.meta.env.DEV
      ? '/api/system/skills'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'}/api/system/skills`
    const resp = await axios.get(url, { timeout: 15000 })
    return resp.data as SkillsResponse
  } catch (e: unknown) {
    console.error('[System] getSkills error:', e)
    return null
  }
}

/**
 * 安装技能 (REC-012 第二阶段)
 * 后端接口: POST /api/system/skills/install → 端口 31002
 * 请求体: { name: string }
 * 返回: { success: boolean, message: string, stdout?: string, stderr?: string }
 */
export interface InstallSkillResult {
  success: boolean
  message: string
  stdout?: string
  stderr?: string
}

export async function installSkill(name: string, source?: 'builtin' | 'clawhub'): Promise<InstallSkillResult | null> {
  try {
    const url = import.meta.env.DEV
      ? '/api/system/skills/install'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'}/api/system/skills/install`
    const body: Record<string, string> = { name }
    if (source) body.source = source
    const resp = await axios.post(url, body, { timeout: 60000 })
    return resp.data as InstallSkillResult
  } catch (e: unknown) {
    console.error('[System] installSkill error:', e)
    const message = (e instanceof Error ? e.message : '安装失败')
    return { success: false, message }
  }
}

/**
 * 搜索 ClawHub 技能 (REC-008)
 * 后端接口: GET /api/system/skills/search?q=关键词 → 端口 31002
 * 返回: { success: boolean, total: number, skills: SkillInfo[] }
 */
export interface SearchSkillsResult {
  success: boolean
  total: number
  skills: SkillInfo[]
}

export async function searchClawHubSkills(query: string): Promise<SearchSkillsResult | null> {
  try {
    const url = import.meta.env.DEV
      ? '/api/system/skills/search'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'}/api/system/skills/search`
    const resp = await axios.get(url, { params: { q: query }, timeout: 60000 }) // REC-013: 30s → 60s
    return resp.data as SearchSkillsResult
  } catch (e: unknown) {
    console.error('[System] searchClawHubSkills error:', e)
    return null
  }
}

/**
 * 获取项目任务进度 (REC-027)
 * 后端接口: GET /api/tasks/current → 端口 31002
 * 返回: { taskId, projectName, taskName, progress, currentStage, totalStages, agents, startedAt, runningMinutes }
 */
export interface TaskProgress {
  taskId: string | null
  projectName: string | null
  taskName: string | null
  progress: number
  currentStage: string | null
  totalStages: number
  agents: string[]
  startedAt: string | null
  runningMinutes: number
}

export async function getTaskProgress(): Promise<TaskProgress | null> {
  try {
    const url = import.meta.env.DEV
      ? '/api/tasks/current'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'}/api/tasks/current`
    const resp = await axios.get(url, { timeout: 10000 })
    return resp.data as TaskProgress
  } catch {
    return null
  }
}

/**
 * 切换技能启用/禁用状态 (REC-022)
 * 后端接口: POST /api/system/skills/toggle → 端口 31002
 * 请求体: { name: string, enabled: boolean }
 * 返回: { success: boolean, message: string, stdout?: string, stderr?: string }
 */
export interface ToggleSkillResult {
  success: boolean
  message: string
  stdout?: string
  stderr?: string
}

export async function toggleSkill(name: string, enabled: boolean): Promise<ToggleSkillResult | null> {
  try {
    const url = import.meta.env.DEV
      ? '/api/system/skills/toggle'
      : `${import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:31002'}/api/system/skills/toggle`
    const resp = await axios.post(url, { name, enabled }, { timeout: 60000 })
    return resp.data as ToggleSkillResult
  } catch (e: unknown) {
    console.error('[System] toggleSkill error:', e)
    const message = (e instanceof Error ? e.message : '切换失败')
    return { success: false, message }
  }
}
