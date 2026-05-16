/**
 * OpenClaw Dashboard Unified Service
 * 合并服务：GPU VRAM + Usage Stats + Reset Agent
 * 端口：31002
 */

import http from 'http'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 加载 .env 文件
dotenv.config({ path: path.join(__dirname, '..', '.env') })

// OpenClaw 数据目录
const OPENCLAW_DIR = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.openclaw')
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents')

// 端口号
const PORT = 31002

// 缓存结果
let cachedUsageResult = null
let lastUsageUpdate = 0
const CACHE_TTL = 10000 // 10 秒缓存

// 版本号
const openclawVersion = process.env.VITE_OPENCLAW_VERSION || 'unknown'

// ============================================
// Usage Stats 功能
// ============================================

/**
 * 从 .usage-cost-cache.json 读取某个 agent 的预计算用量
 * 返回 { sessionUuids: Set<string>, totals: { tokens, cost } }
 */
async function readUsageCache(agentSessionsDir) {
  const cachePath = path.join(agentSessionsDir, '.usage-cost-cache.json')
  try {
    const content = await fs.readFile(cachePath, 'utf-8')
    const data = JSON.parse(content)
    if (!data?.files) return { sessionUuids: new Set(), totals: { tokens: 0, cost: 0 } }

    const sessionUuids = new Set()
    let tokens = 0
    let cost = 0

    for (const [filePath, entry] of Object.entries(data.files)) {
      if (entry?.totals) {
        tokens += entry.totals.totalTokens || 0
        cost += entry.totals.totalCost || 0
      }
      // 从绝对路径中提取 UUID（兼容 .jsonl.deleted.* 等变体）
      const basename = path.basename(filePath)
      const uuid = extractSessionUuid(basename)
      if (uuid) sessionUuids.add(uuid)
    }

    return { sessionUuids, totals: { tokens, cost } }
  } catch (e) {
    return { sessionUuids: new Set(), totals: { tokens: 0, cost: 0 } }
  }
}

/**
 * 从文件名中提取 session UUID
 * 格式: "uuid.jsonl", "uuid.jsonl.reset.TIMESTAMP", "uuid.jsonl.deleted.TIMESTAMP" 等
 */
function extractSessionUuid(filename) {
  // 匹配 .jsonl 前的 UUID 部分
  const match = filename.match(/^([a-f0-9-]+)\.jsonl/)
  return match ? match[1] : null
}

/**
 * 解析单个 .jsonl 文件，取最后一条累计值作为该 session 的总用量（含按模型分组）
 * .jsonl 中每行的 message.usage.totalTokens 是会话累计值，
 * 取最后（最大）一条即可得到该 session 的总 token 数。
 */
async function parseJsonlFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim())

    let sessionTotalTokens = 0
    let sessionTotalCost = 0
    const byModel = {}  // model -> { tokens, cost }（各模型的最后累计值）

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.message?.usage) {
          const usage = entry.message.usage
          const model = (entry.message.model || 'unknown').trim()

          // totalTokens 是累计值 — 取最大（最后）一条
          if (usage.totalTokens && usage.totalTokens > sessionTotalTokens) {
            sessionTotalTokens = usage.totalTokens
          }
          // cost.total 也是累计值 — 取最后一条
          if (usage.cost?.total) {
            sessionTotalCost = usage.cost.total
          }

          // 按模型记录（保留每个模型的最新/最大累计值）
          if (model && usage.totalTokens) {
            if (!byModel[model]) byModel[model] = { tokens: 0, cost: 0 }
            if (usage.totalTokens > byModel[model].tokens) {
              byModel[model].tokens = usage.totalTokens
            }
            if (usage.cost?.total) {
              byModel[model].cost = usage.cost.total
            }
          }
        }
      } catch (e) {
        // 忽略单行解析错误
      }
    }

    return { totalTokens: sessionTotalTokens, totalCost: sessionTotalCost, byModel }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message)
    return { totalTokens: 0, totalCost: 0, byModel: {} }
  }
}

/**
 * 判断文件名是否为可解析的 session 文件
 * 包含所有状态：活跃(.jsonl)、已重置(.jsonl.reset.*)、已删除(.jsonl.deleted.*)
 */
function isSessionFile(filename) {
  if (filename.startsWith('.')) return false
  if (filename.endsWith('.trajectory.jsonl')) return false
  if (filename.endsWith('.trajectory-path.json')) return false
  if (filename.includes('.bak-')) return false
  if (filename.endsWith('.tmp')) return false
  if (filename === 'sessions.json') return false
  if (filename.endsWith('.lock')) return false
  // 包含所有 .jsonl 变体
  return filename.includes('.jsonl') && !filename.startsWith('.usage-cost-cache')
}

/**
 * 读取所有 agent 的所有 session 用量
 * 数据来源优先级：
 *   1. .usage-cost-cache.json（OpenClaw 预计算，每行 input/output 非累计）
 *   2. 不在缓存中的 .jsonl 文件（新近会话，取最后一条累计值）
 * 包含 .jsonl.deleted.* 文件，确保清空会话后总量不减少
 */
async function collectUsageStats() {
  const now = Date.now()
  if (cachedUsageResult && (now - lastUsageUpdate) < CACHE_TTL) {
    return cachedUsageResult
  }

  let totalTokens = 0
  let totalCost = 0
  const byAgent = {}
  const byModel = {}        // 全局按模型汇总
  const byAgentByModel = {} // agent -> model -> { tokens, cost }

  try {
    const agents = await fs.readdir(AGENTS_DIR)

    for (const agent of agents) {
      const agentSessionsDir = path.join(AGENTS_DIR, agent, 'sessions')

      try {
        await fs.access(agentSessionsDir)
      } catch (e) {
        continue // 跳过无 sessions 目录的 agent
      }

      // Step 1: 从 usage-cache 获取预计算数据（按 uuid 索引）
      const cache = await readUsageCache(agentSessionsDir)
      const cachedUuids = cache.sessionUuids

      // 构建 uuid → { tokens, cost } 映射，用于替换活跃文件的缓存值
      const cacheByUuid = new Map()
      const cachePath = path.join(agentSessionsDir, '.usage-cost-cache.json')
      try {
        const cacheContent = await fs.readFile(cachePath, 'utf-8')
        const cacheData = JSON.parse(cacheContent)
        if (cacheData?.files) {
          for (const [filePath, entry] of Object.entries(cacheData.files)) {
            if (entry?.totals) {
              const basename = path.basename(filePath)
              const uuid = extractSessionUuid(basename)
              if (uuid) {
                cacheByUuid.set(uuid, {
                  tokens: entry.totals.totalTokens || 0,
                  cost: entry.totals.totalCost || 0
                })
              }
            }
          }
        }
      } catch (e) { /* 已经通过 readUsageCache 处理了 */ }

      // Step 2: 扫描文件系统，每个 uuid 只计一次
      // 优先级：活跃 .jsonl 文件 > 缓存 > 归档文件解析
      const files = await fs.readdir(agentSessionsDir)
      const sessionFiles = files.filter(isSessionFile)

      // 收集所有文件的 uuid 和类型
      const fileEntries = sessionFiles.map(file => ({
        file,
        uuid: extractSessionUuid(file),
        isActive: file.endsWith('.jsonl') &&
          !file.includes('.reset') &&
          !file.includes('.deleted') &&
          !file.includes('.bak') &&
          !file.includes('.lock')
      })).filter(e => e.uuid)

      // 去重：活跃文件优先，同一个 uuid 只保留一个
      const seenUuids = new Set()
      const filesToParse = []

      // 先处理活跃文件（优先级最高）
      for (const entry of fileEntries) {
        if (entry.isActive && !seenUuids.has(entry.uuid)) {
          seenUuids.add(entry.uuid)
          filesToParse.push(entry)
        }
      }
      // 再处理非活跃文件（uuid 未被活跃文件占用）
      for (const entry of fileEntries) {
        if (!entry.isActive && !seenUuids.has(entry.uuid)) {
          seenUuids.add(entry.uuid)
          filesToParse.push(entry)
        }
      }

      let agentTokens = 0
      let agentCost = 0
      let sessionCount = 0

      for (const { file, uuid } of filesToParse) {
        // 缓存优先（包含 cacheRead 等全部历史数据，不受文件截断影响）
        const cacheEntry = cacheByUuid.get(uuid)

        if (cacheEntry) {
          agentTokens += cacheEntry.tokens
          agentCost += cacheEntry.cost
          sessionCount++
          continue
        }

        // 缓存中没有的 → 实时解析 .jsonl 作为后备
        const filePath = path.join(agentSessionsDir, file)
        const result = await parseJsonlFile(filePath)
        if (result.totalTokens > 0 || result.totalCost > 0) {
          agentTokens += result.totalTokens
          agentCost += result.totalCost

          sessionCount++

          // 聚合按模型数据
          for (const [model, data] of Object.entries(result.byModel || {})) {
            if (!byModel[model]) byModel[model] = { tokens: 0, cost: 0 }
            byModel[model].tokens += data.tokens
            byModel[model].cost += data.cost

            if (!byAgentByModel[agent]) byAgentByModel[agent] = {}
            if (!byAgentByModel[agent][model]) byAgentByModel[agent][model] = { tokens: 0, cost: 0 }
            byAgentByModel[agent][model].tokens += data.tokens
            byAgentByModel[agent][model].cost += data.cost
          }
        }
      }

      // 缓存中有但文件系统已完全删除的 session → 计入
      for (const [uuid, entry] of cacheByUuid) {
        if (!seenUuids.has(uuid)) {
          agentTokens += entry.tokens
          agentCost += entry.cost
          if (entry.tokens > 0 || entry.cost > 0) sessionCount++
        }
      }

      if (agentTokens > 0 || agentCost > 0) {
        byAgent[agent] = { tokens: agentTokens, cost: agentCost, sessionCount }
        totalTokens += agentTokens
        totalCost += agentCost
      }
    }

    const result = {
      totalTokens,
      totalCost,
      byAgent,
      byModel,
      byAgentByModel,
      updatedAt: new Date().toISOString(),
      version: openclawVersion
    }

    cachedUsageResult = result
    lastUsageUpdate = now

    return result
  } catch (e) {
    console.error('Error collecting usage stats:', e.message)
    return {
      totalTokens: 0,
      totalCost: 0,
      byAgent: {},
      updatedAt: new Date().toISOString(),
      version: openclawVersion
    }
  }
}

// ============================================
// GPU VRAM 功能
// ============================================

/**
 * 获取 GPU VRAM 使用情况
 */
async function getGpuVram() {
  const platform = os.platform()

  // macOS: 使用 system_profiler 获取 GPU 信息
  if (platform === 'darwin') {
    return getMacOSGpuInfo()
  }

  return runNvidiaSmi()
}

function getMacOSGpuInfo() {
  return new Promise((resolve) => {
    const child = spawn('system_profiler', ['SPDisplaysDataType'], {
      timeout: 10000
    })

    let stdout = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ usedPct: null })
        return
      }

      // 解析 GPU 名称
      const gpuMatch = stdout.match(/Chipset Model:\s*(.+)/)
      const gpuName = gpuMatch?.[1]?.trim() || null

      // 解析 VRAM (如 "VRAM: 16 MB" 或 "VRAM: 16 GB")
      const vramMatch = stdout.match(/VRAM:\s*(\d+)\s*(MB|GB)/i)
      let totalMb = 0
      if (vramMatch) {
        const value = parseInt(vramMatch[1], 10)
        const unit = vramMatch[2].toUpperCase()
        totalMb = unit === 'GB' ? value * 1024 : value
      }

      console.log(`[GPU] macOS GPU: ${gpuName || 'unknown'}, VRAM: ${totalMb}MB`)
      resolve({ usedPct: null, totalMb, gpuName: gpuName || undefined })
    })

    child.on('error', () => resolve({ usedPct: null }))
  })
}

function runNvidiaSmi() {
  return new Promise((resolve, reject) => {
    const isWindows = os.platform() === 'win32'

    let command
    let args

    if (isWindows) {
      command = 'C:\\Windows\\System32\\nvidia-smi.exe'
      args = [
        '--query-gpu=memory.used,memory.total',
        '--format=csv,noheader,nounits'
      ]
    } else {
      command = 'nvidia-smi'
      args = [
        '--query-gpu=memory.used,memory.total',
        '--format=csv,noheader,nounits'
      ]
    }

    const child = spawn(command, args, {
      shell: isWindows,
      timeout: 10000
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`nvidia-smi exited with code ${code}: ${stderr.trim()}`))
      }
    })

    child.on('error', (err) => reject(err))
  })
}

function parseVramOutput(output) {
  const lines = output.split('\n').filter(l => l.trim())
  if (lines.length === 0) {
    return { usedPct: null }
  }

  let totalUsed = 0
  let totalMemory = 0

  for (const line of lines) {
    const parts = line.split(',').map(s => parseFloat(s.trim()))
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      totalUsed += parts[0]
      totalMemory += parts[1]
    }
  }

  if (totalMemory === 0) {
    return { usedPct: null }
  }

  const usedPct = Math.round((totalUsed / totalMemory) * 100)
  console.log(`[GPU] VRAM: ${usedPct}% (${Math.round(totalUsed)}MB / ${Math.round(totalMemory)}MB)`)

  return {
    usedPct,
    usedMb: Math.round(totalUsed),
    totalMb: Math.round(totalMemory)
  }
}

// ============================================
// Reset Agent 功能
// ============================================

/**
 * 重置指定 Agent 的会话
 */
function resetAgent(agentId) {
  return new Promise((resolve) => {
    const isWindows = os.platform() === 'win32'
    const command = isWindows ? 'openclaw.cmd' : 'openclaw'
    const args = ['agent', '--agent', agentId, '--message', '/reset']

    console.log(`[重置] Agent: ${agentId}`)
    console.log(`[执行] ${command} ${args.join(' ')}`)

    const child = spawn(command, args, {
      shell: isWindows,
      timeout: 30000
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[成功] Agent ${agentId} 重置成功`)
        resolve({
          success: true,
          agentId,
          stdout,
          stderr: stderr || undefined
        })
      } else {
        console.error(`[错误] Agent ${agentId} 重置失败: ${stderr.trim()}`)
        resolve({
          success: false,
          agentId,
          error: `Exit code ${code}: ${stderr.trim()}`,
          stdout,
          stderr: stderr || undefined
        })
      }
    })

    child.on('error', (err) => {
      console.error(`[错误] 执行命令失败：${err.message}`)
      resolve({
        success: false,
        agentId,
        error: err.message
      })
    })
  })
}

// ============================================
// Projects 项目管理模块
// ============================================

// projects.json 存储路径配置
function getProjectsJsonPath() {
  // 1. 环境变量（最高优先级）
  if (process.env.PROJECTS_JSON_PATH) {
    return process.env.PROJECTS_JSON_PATH
  }
  // 2. 默认值：{projectRoot}/data/projects.json
  const projectRoot = path.join(__dirname, '..')
  return path.join(projectRoot, 'data', 'projects.json')
}

const PROJECTS_JSON_PATH = getProjectsJsonPath()

// 默认 projects.json 结构
function getDefaultProjectsData() {
  return {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    activeProjectId: null,
    scanIntervalMs: 30000,
    projects: []
  }
}

// 读取 projects.json
async function readProjectsJson() {
  try {
    const content = await fs.readFile(PROJECTS_JSON_PATH, 'utf-8')
    return JSON.parse(content)
  } catch (e) {
    // 文件不存在或解析失败，创建默认结构
    console.log(`[Projects] 文件不存在或解析失败，创建默认结构: ${PROJECTS_JSON_PATH}`)
    const defaultData = getDefaultProjectsData()
    await writeProjectsJson(defaultData)
    return defaultData
  }
}

// 写入 projects.json（原子写入：先写 .tmp 再重命名）
async function writeProjectsJson(data) {
  const tmpPath = PROJECTS_JSON_PATH + '.tmp'
  data.lastUpdated = new Date().toISOString()
  
  // 确保父目录存在
  const dir = path.dirname(PROJECTS_JSON_PATH)
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (e) {
    // 目录已存在或其他错误
  }
  
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmpPath, PROJECTS_JSON_PATH)
  console.log(`[Projects] 已写入 ${PROJECTS_JSON_PATH}`)
}

// 生成唯一项目 ID
function generateProjectId(projects) {
  const maxNum = projects.reduce((max, p) => {
    const match = p.id && p.id.match(/^proj-(\d+)$/)
    if (match) return Math.max(max, parseInt(match[1], 10))
    return max
  }, 0)
  return `proj-${String(maxNum + 1).padStart(3, '0')}`
}

// 生成唯一任务 ID
function generateTaskId(taskQueue) {
  const maxNum = taskQueue.reduce((max, t) => {
    const match = t.id && t.id.match(/^task-(\d+)$/)
    if (match) return Math.max(max, parseInt(match[1], 10))
    return max
  }, 0)
  return `task-${String(maxNum + 1).padStart(3, '0')}`
}

// 计算项目进度（基于任务完成率）
function calculateProgress(taskQueue) {
  if (!taskQueue || taskQueue.length === 0) return 0
  const doneCount = taskQueue.filter(t => t.status === 'done').length
  return Math.round((doneCount / taskQueue.length) * 100)
}

// 确定项目状态转换结果（活跃切换时原项目的降级规则）
function determineStatusTransition(project) {
  if (project.progress === 100) return 'completed'
  if (project.taskQueue && project.taskQueue.some(t => t.status === 'error')) return 'error'
  return 'paused'
}

// 扫描单个项目状态
async function scanProject(project) {
  const updates = {}
  
  // 计算完整路径：rootPath + subPath
  let checkPath = null
  if (project.rootPath && project.subPath) {
    checkPath = path.join(project.rootPath, project.subPath)
  } else if (project.subPath) {
    // 兼容旧数据：只有 subPath 时当作绝对路径
    checkPath = project.subPath
  } else if (project.rootPath) {
    checkPath = project.rootPath
  }
  
  // 检查项目路径是否存在
  if (checkPath) {
    try {
      await fs.access(checkPath)
      // 路径存在
    } catch (e) {
      if (project.status !== 'archived') {
        updates.pathError = true
        if (project.status !== 'error') {
          updates.status = 'error'
        }
      }
    }
  }
  
  // 自动计算进度（如果没有手动覆盖）
  if (!project.manualOverride && project.taskQueue) {
    updates.progress = calculateProgress(project.taskQueue)
  }
  
  // 自动状态转换：如果所有任务完成
  if (project.taskQueue && project.taskQueue.length > 0 && !project.manualOverride) {
    const allDone = project.taskQueue.every(t => t.status === 'done')
    if (allDone && project.status !== 'completed') {
      updates.status = 'completed'
      updates.progress = 100
    }
  }
  
  return updates
}

// 扫描所有项目状态
async function scanAllProjects(projectsData) {
  const updatedIds = []
  
  for (const project of projectsData.projects) {
    try {
      const updates = await scanProject(project)
      if (Object.keys(updates).length > 0) {
        Object.assign(project, updates)
        project.updatedAt = new Date().toISOString()
        updatedIds.push(project.id)
      }
    } catch (e) {
      console.error(`[Projects] 扫描项目 ${project.id} 失败:`, e.message)
    }
  }
  
  if (updatedIds.length > 0) {
    await writeProjectsJson(projectsData)
  }
  
  return updatedIds
}

// 自动扫描定时器
let scanTimer = null
let lastScanTime = null
let lastScanResult = null

function startAutoScan() {
  const interval = 30000 // 默认 30 秒
  
  // 立即执行一次
  scanAllProjectsAndStore().then(() => {
    // 设置定时器
    scanTimer = setInterval(async () => {
      await scanAllProjectsAndStore()
    }, interval)
  })
  
  console.log(`[Projects] 自动扫描已启动，间隔: ${interval}ms`)
}

async function scanAllProjectsAndStore() {
  try {
    const data = await readProjectsJson()
    const updated = await scanAllProjects(data)
    lastScanTime = new Date().toISOString()
    lastScanResult = {
      lastScan: lastScanTime,
      nextScan: new Date(Date.now() + 30000).toISOString(),
      updatedProjects: updated
    }
    if (updated.length > 0) {
      console.log(`[Projects] 扫描完成，更新 ${updated.length} 个项目:`, updated)
    }
  } catch (e) {
    console.error('[Projects] 自动扫描失败:', e.message)
  }
}

// 停止自动扫描
function stopAutoScan() {
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
    console.log('[Projects] 自动扫描已停止')
  }
}

// ============================================
// HTTP Server
// ============================================

const server = http.createServer(async (req, res) => {
  // CORS 配置
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // ============================================
  // GPU VRAM API
  // ============================================

  if (pathname === '/api/gpu-vram') {
    if (req.method === 'GET') {
      try {
        const output = await getGpuVram()
        const result = parseVramOutput(output)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (error) {
        console.error('[GPU] Error:', error.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ usedPct: null }))
      }
      return
    }
  }

  // ============================================
  // Usage Stats API
  // ============================================

  if (pathname === '/api/usage') {
    if (req.method === 'GET') {
      try {
        const stats = await collectUsageStats()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(stats))
      } catch (error) {
        console.error('[Usage] Error:', error.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: error.message }))
      }
      return
    }
  }

  // ============================================
  // Health Check API
  // ============================================

  if (pathname === '/api/health') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        port: PORT,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }))
      return
    }
  }

  // ============================================
  // 已配置 Agent 列表 API（从 openclaw.json 读取）
  // 解决 dashboard 只能显示有 webchat 会话的 agent 的问题
  // ============================================

  if (pathname === '/api/agents-configured' && req.method === 'GET') {
    try {
      const configPath = path.join(OPENCLAW_DIR, 'openclaw.json')
      const raw = await fs.readFile(configPath, 'utf-8')
      const config = JSON.parse(raw)
      const agentsList = config?.agents?.list || []

      // 提取每个 agent 的关键信息
      const agents = agentsList.map(a => ({
        id: a.id,
        name: a?.identity?.name || a.name || a.id,
        emoji: a?.identity?.emoji || '',
        model: a.model || (config?.agents?.defaults?.model?.primary || 'unknown'),
        workspace: a.workspace || null,
        configured: true,  // 标记为"已配置"
      }))

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ agents, count: agents.length }))
    } catch (e) {
      console.error('[agents-configured] 读取失败:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Agent Running Status API（基于 session 文件修改时间检测运行状态）
  // ============================================

  if (pathname === '/api/agent-running-status' && req.method === 'GET') {
    try {
      const RUNNING_THRESHOLD_MS = 90 * 1000  // 90秒内有写入 = 正在运行
      const now = Date.now()
      // agent 目录名即 agent id（main=叶溪, pm, developer, tester, inspector, archivist）
      const agentIds = ['main', 'pm', 'developer', 'tester', 'inspector', 'archivist']
      const results = []

      for (const id of agentIds) {
        const sessionsDir = path.join(AGENTS_DIR, id, 'sessions')
        let latestMtime = 0

        try {
          const files = fsSync.readdirSync(sessionsDir)
          // 只看主会话文件（排除 trajectory、reset 备份、tmp 临时文件）
          const sessionFiles = files.filter(f =>
            f.endsWith('.jsonl') &&
            !f.includes('.trajectory') &&
            !f.includes('.reset') &&
            !f.includes('.bak') &&
            !f.includes('.tmp') &&
            f !== 'sessions.json'
          )
          for (const file of sessionFiles) {
            const stat = fsSync.statSync(path.join(sessionsDir, file))
            if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs
          }
        } catch (e) {
          // 目录不存在或无权限，忽略
        }

        const msAgo = latestMtime > 0 ? now - latestMtime : Infinity
        results.push({
          id,
          status: msAgo < RUNNING_THRESHOLD_MS ? 'running' : 'idle',
          lastModifiedMs: latestMtime,
          msAgo: latestMtime > 0 ? Math.round(msAgo) : null
        })
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ agents: results, checkedAt: now }))
    } catch (e) {
      console.error('[agent-running-status] Error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, agents: [] }))
    }
    return
  }

  // ============================================
  // Reset Agent API
  // ============================================

  if (pathname === '/reset') {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', chunk => {
        body += chunk.toString()
      })

      req.on('end', async () => {
        try {
          const data = JSON.parse(body)
          const { agentId } = data

          if (!agentId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing agentId parameter' }))
            return
          }

          const result = await resetAgent(agentId)

          if (result.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          }
        } catch (error) {
          console.error('[Reset] Parse error:', error.message)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
        }
      })
      return
    }
  }

  // ============================================
  // Upload Image API — 图片上传
  // ============================================

  if (pathname === '/api/upload-image' && req.method === 'POST') {
    // 5MB 大小限制（字节计数，避免超限后还全量加载）
    const MAX_SIZE = 5 * 1024 * 1024
    const chunks = []
    let totalBytes = 0
    let sizeExceeded = false

    req.on('data', chunk => {
      if (sizeExceeded) return // 已超限，丢弃后续 chunk
      totalBytes += chunk.length
      if (totalBytes > MAX_SIZE) {
        sizeExceeded = true
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })

    req.on('end', async () => {
      if (sizeExceeded) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: '图片大小超过 5MB 限制' }))
        return
      }

      try {
        const body = Buffer.concat(chunks).toString()
        const { agentId, mediaType, data } = JSON.parse(body)

        if (!data) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '缺少 data 参数' }))
          return
        }

        // 强制要求 mediaType 参数，缺失即拒绝
        if (!mediaType) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '缺少 mediaType 参数' }))
          return
        }

        // 验证图片格式
        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
        const extMap = {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/jpg': '.jpg',
          'image/gif': '.gif',
          'image/webp': '.webp',
        }

        if (!allowedTypes.includes(mediaType)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: `不支持的图片格式: ${mediaType}` }))
          return
        }

        const ext = extMap[mediaType] || '.png'

        // 解码 base64
        const base64Data = data.startsWith('data:')
          ? data.split(',')[1]
          : data
        const buffer = Buffer.from(base64Data, 'base64')

        // 存储路径：uploads 目录（按日期分文件夹）
        const today = new Date().toISOString().slice(0, 10) // 2026-05-16
        const uploadDir = path.join(__dirname, '..', 'data', 'uploads', today)
        await fs.mkdir(uploadDir, { recursive: true })

        const fileName = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
        const filePath = path.join(uploadDir, fileName)
        await fs.writeFile(filePath, buffer)

        // 返回相对路径，供前端访问
        const relativePath = `/uploads/${today}/${fileName}`

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          filePath: relativePath,
          url: `${relativePath}`
        }))
      } catch (error) {
        console.error('[Upload] Error:', error.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
      }
    })
    return
  }

  // ============================================
  // Static file serving for uploads
  // ============================================

  if (pathname.startsWith('/uploads/')) {
    try {
      // P1 修复：路径遍历防护
      const uploadsBase = path.resolve(path.join(__dirname, '..', 'data', 'uploads'))
      // pathname 格式 /uploads/date/filename，去掉 /uploads/ 前缀
      const relativePath = decodeURIComponent(pathname.slice('/uploads/'.length))
      const filePath = path.resolve(uploadsBase, relativePath)

      // 校验解析后的路径必须在 uploads 目录下
      if (!filePath.startsWith(uploadsBase + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Access denied' }))
        return
      }

      const content = await fs.readFile(filePath)

      const ext = path.extname(filePath).toLowerCase()
      const contentTypeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      }
      const contentType = contentTypeMap[ext] || 'application/octet-stream'

      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'File not found' }))
    }
    return
  }

  // ============================================
  // Projects API — 项目管理
  // ============================================

  // GET /api/projects — 获取所有项目列表
  if (pathname === '/api/projects' && req.method === 'GET') {
    try {
      const data = await readProjectsJson()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        data: {
          activeProjectId: data.activeProjectId,
          scanIntervalMs: data.scanIntervalMs,
          projects: data.projects
        }
      }))
    } catch (error) {
      console.error('[Projects] 读取失败:', error.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: error.message }))
    }
    return
  }

  // POST /api/projects — 创建项目
  if (pathname === '/api/projects' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const input = JSON.parse(body)
        const data = await readProjectsJson()
        const project = {
          id: generateProjectId(data.projects),
          name: input.name || '未命名项目',
          description: input.description || '',
          rootPath: input.rootPath || '',
          subPath: input.subPath || input.path || '',
          status: 'pending',
          progress: 0,
          manualOverride: false,
          tags: input.tags || [],
          linkedAgents: input.linkedAgents || [],
          taskQueue: input.taskQueue || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        data.projects.push(project)
        await writeProjectsJson(data)
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, project }))
      } catch (error) {
        console.error('[Projects] 创建失败:', error.message)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
      }
    })
    return
  }

  // GET /api/projects/scan/status — 获取扫描状态
  if (pathname === '/api/projects/scan/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      data: lastScanResult || { lastScan: null, nextScan: null, updatedProjects: [] }
    }))
    return
  }

  // POST /api/projects/scan — 手动触发扫描所有项目（注意：要放在 :id 之前匹配）
  if (pathname === '/api/projects/scan' && req.method === 'POST') {
    try {
      const data = await readProjectsJson()
      const updated = await scanAllProjects(data)
      lastScanTime = new Date().toISOString()
      lastScanResult = {
        lastScan: lastScanTime,
        nextScan: new Date(Date.now() + (data.scanIntervalMs || 30000)).toISOString(),
        updatedProjects: updated
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, data: lastScanResult }))
    } catch (error) {
      console.error('[Projects] 扫描失败:', error.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: error.message }))
    }
    return
  }

  // POST /api/projects/scan-all — 扫描所有项目（别名）
  if (pathname === '/api/projects/scan-all' && req.method === 'POST') {
    try {
      const data = await readProjectsJson()
      const updated = await scanAllProjects(data)
      lastScanTime = new Date().toISOString()
      lastScanResult = {
        lastScan: lastScanTime,
        nextScan: new Date(Date.now() + (data.scanIntervalMs || 30000)).toISOString(),
        updatedProjects: updated
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, data: lastScanResult }))
    } catch (error) {
      console.error('[Projects] 扫描失败:', error.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: error.message }))
    }
    return
  }

  // 动态路由：/api/projects/:id/*
  const projectRouteMatch = pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/)
  if (projectRouteMatch) {
    const projectId = decodeURIComponent(projectRouteMatch[1])
    const subPath = projectRouteMatch[2] || ''

    // GET /api/projects/:id — 获取单个项目详情
    if (subPath === '' && req.method === 'GET') {
      try {
        const data = await readProjectsJson()
        const project = data.projects.find(p => p.id === projectId)
        if (!project) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '项目不存在' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, project }))
      } catch (error) {
        console.error('[Projects] 读取失败:', error.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
      }
      return
    }

    // PUT /api/projects/:id — 更新项目
    if (subPath === '' && req.method === 'PUT') {
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', async () => {
        try {
          const input = JSON.parse(body)
          const data = await readProjectsJson()
          const project = data.projects.find(p => p.id === projectId)
          if (!project) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: '项目不存在' }))
            return
          }
          // 允许更新的字段
          const updatableFields = ['name', 'description', 'rootPath', 'subPath', 'path', 'status', 'progress', 'manualOverride', 'tags', 'linkedAgents']
          for (const field of updatableFields) {
            if (input[field] !== undefined) {
              // subPath 也可以用 path 传入
              if (field === 'path') {
                project.subPath = input[field]
              } else {
                project[field] = input[field]
              }
            }
          }
          project.updatedAt = new Date().toISOString()
          await writeProjectsJson(data)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, project }))
        } catch (error) {
          console.error('[Projects] 更新失败:', error.message)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: error.message }))
        }
      })
      return
    }

    // DELETE /api/projects/:id — 删除项目
    if (subPath === '' && req.method === 'DELETE') {
      try {
        const data = await readProjectsJson()
        const idx = data.projects.findIndex(p => p.id === projectId)
        if (idx === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '项目不存在' }))
          return
        }
        const deleted = data.projects.splice(idx, 1)[0]
        // 如果删除的是活跃项目，清除活跃标记
        if (data.activeProjectId === projectId) {
          data.activeProjectId = null
        }
        await writeProjectsJson(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, project: deleted }))
      } catch (error) {
        console.error('[Projects] 删除失败:', error.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
      }
      return
    }

    // PATCH /api/projects/:id/active — 设为活跃项目
    // POST /api/projects/:id/active — 别名
    // POST /api/projects/:id/set-active — 需求文档中的路径
    if ((subPath === '/active' && (req.method === 'PATCH' || req.method === 'POST')) ||
        (subPath === '/set-active' && req.method === 'POST')) {
      try {
        const data = await readProjectsJson()
        const target = data.projects.find(p => p.id === projectId)
        if (!target) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '项目不存在' }))
          return
        }

        // 幂等：如果已经是活跃项目
        if (data.activeProjectId === projectId) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            activeProjectId: projectId,
            previousActive: null,
            project: target
          }))
          return
        }

        // 处理原活跃项目状态转换
        let previousActive = null
        if (data.activeProjectId) {
          const prev = data.projects.find(p => p.id === data.activeProjectId)
          if (prev) {
            const oldStatus = prev.status
            prev.status = determineStatusTransition(prev)
            prev.updatedAt = new Date().toISOString()
            previousActive = {
              projectId: prev.id,
              previousStatus: oldStatus,
              newStatus: prev.status
            }
          }
        }

        // 设置新项目为活跃
        data.activeProjectId = projectId
        target.status = 'active'
        target.updatedAt = new Date().toISOString()
        await writeProjectsJson(data)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          activeProjectId: projectId,
          previousActive,
          project: target
        }))
      } catch (error) {
        console.error('[Projects] 切换活跃失败:', error.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
      }
      return
    }

    // POST /api/projects/:id/scan — 扫描单个项目
    if (subPath === '/scan' && req.method === 'POST') {
      try {
        const data = await readProjectsJson()
        const project = data.projects.find(p => p.id === projectId)
        if (!project) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '项目不存在' }))
          return
        }
        const updates = await scanProject(project)
        Object.assign(project, updates)
        project.updatedAt = new Date().toISOString()
        await writeProjectsJson(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, project, updates }))
      } catch (error) {
        console.error('[Projects] 扫描失败:', error.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
      }
      return
    }

    // GET /api/projects/:id/tasks — 获取项目任务队列
    if (subPath === '/tasks' && req.method === 'GET') {
      try {
        const data = await readProjectsJson()
        const project = data.projects.find(p => p.id === projectId)
        if (!project) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '项目不存在' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          tasks: project.taskQueue || [],
          progress: project.progress
        }))
      } catch (error) {
        console.error('[Projects] 读取任务失败:', error.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
      }
      return
    }

    // POST /api/projects/:id/tasks — 添加任务到项目队列
    if (subPath === '/tasks' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', async () => {
        try {
          const input = JSON.parse(body)
          const data = await readProjectsJson()
          const project = data.projects.find(p => p.id === projectId)
          if (!project) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: '项目不存在' }))
            return
          }
          if (!project.taskQueue) project.taskQueue = []
          const task = {
            id: generateTaskId(project.taskQueue),
            title: input.title || '未命名任务',
            status: input.status || 'pending',
            assignedAgent: input.assignedAgent || null,
            createdAt: new Date().toISOString(),
            completedAt: null
          }
          project.taskQueue.push(task)
          // 重新计算进度（如果没有手动覆盖）
          if (!project.manualOverride) {
            project.progress = calculateProgress(project.taskQueue)
          }
          project.updatedAt = new Date().toISOString()
          await writeProjectsJson(data)
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, task, progress: project.progress }))
        } catch (error) {
          console.error('[Projects] 添加任务失败:', error.message)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: error.message }))
        }
      })
      return
    }

    // PUT /api/projects/:id/tasks/:taskId — 更新任务状态
    const taskMatch = subPath.match(/^\/tasks\/([^/]+)$/)
    if (taskMatch && req.method === 'PUT') {
      const taskId = decodeURIComponent(taskMatch[1])
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', async () => {
        try {
          const input = JSON.parse(body)
          const data = await readProjectsJson()
          const project = data.projects.find(p => p.id === projectId)
          if (!project) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: '项目不存在' }))
            return
          }
          const task = (project.taskQueue || []).find(t => t.id === taskId)
          if (!task) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: '任务不存在' }))
            return
          }
          // 更新任务字段
          if (input.status !== undefined) {
            task.status = input.status
            if (input.status === 'done' && !task.completedAt) {
              task.completedAt = new Date().toISOString()
            }
          }
          if (input.title !== undefined) task.title = input.title
          if (input.assignedAgent !== undefined) task.assignedAgent = input.assignedAgent

          // 重新计算进度
          if (!project.manualOverride) {
            project.progress = calculateProgress(project.taskQueue)
          }
          project.updatedAt = new Date().toISOString()
          await writeProjectsJson(data)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, task, progress: project.progress }))
        } catch (error) {
          console.error('[Projects] 更新任务失败:', error.message)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: error.message }))
        }
      })
      return
    }

    // 项目路由未匹配到的子路径
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `未找到路由: ${pathname}` }))
    return
  }

  // ============================================
  // 404 for other routes
  // ============================================

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log('='.repeat(50))
  console.log('   OpenClaw Dashboard Unified Service')
  console.log('='.repeat(50))
  console.log(`[配置] 端口：${PORT}`)
  console.log('[功能] GPU VRAM + Usage Stats + Reset Agent + Projects')
  console.log(`[配置] projects.json: ${PROJECTS_JSON_PATH}`)
  console.log(`[提示] 按 Ctrl+C 可停止服务`)
  console.log('')
  console.log('[API 端点]')
  console.log('  GET  /api/gpu-vram           - GPU VRAM 使用情况')
  console.log('  GET  /api/usage              - 获取用量统计')
  console.log('  GET  /api/health             - 健康检查')
  console.log('  POST /reset                  - 重置 Agent')
  console.log('  POST /api/upload-image       - 图片上传 (base64, ≤5MB)')
  console.log('')
  console.log('[项目管理 API]')
  console.log('  GET    /api/projects              - 获取所有项目列表')
  console.log('  GET    /api/projects/:id           - 获取单个项目详情')
  console.log('  POST   /api/projects               - 创建项目')
  console.log('  PUT    /api/projects/:id            - 更新项目')
  console.log('  DELETE /api/projects/:id            - 删除项目')
  console.log('  PATCH  /api/projects/:id/active     - 设为活跃项目')
  console.log('  POST   /api/projects/:id/scan       - 扫描单个项目')
  console.log('  POST   /api/projects/scan           - 扫描所有项目')
  console.log('  GET    /api/projects/:id/tasks      - 获取项目任务队列')
  console.log('  POST   /api/projects/:id/tasks      - 添加任务')
  console.log('  PUT    /api/projects/:id/tasks/:id  - 更新任务状态')
  console.log('')
})

// 启动自动扫描
startAutoScan()

// 优雅关闭
process.on('SIGINT', () => {
  stopAutoScan()
  server.close(() => {
    console.log('[服务] 已关闭')
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  stopAutoScan()
  server.close(() => {
    console.log('[服务] 已关闭')
    process.exit(0)
  })
})