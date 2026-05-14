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
 * 解析 .jsonl 文件，累加 token 用量
 */
async function parseJsonlFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim())

    let totalTokens = 0
    let totalCost = 0

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)

        if (entry.message?.usage) {
          const usage = entry.message.usage
          if (usage.totalTokens) {
            totalTokens += usage.totalTokens
          } else if (usage.input || usage.output) {
            totalTokens += (usage.input || 0) + (usage.output || 0)
          }
          if (usage.cost?.total) {
            totalCost += usage.cost.total
          }
        }

        if (entry.responseUsage?.totalTokens) {
          totalTokens += entry.responseUsage.totalTokens
        }

      } catch (e) {
        // 忽略解析错误
      }
    }

    return { totalTokens, totalCost }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message)
    return { totalTokens: 0, totalCost: 0 }
  }
}

/**
 * 读取所有 agent 的所有 session 文件
 */
async function collectUsageStats() {
  const now = Date.now()
  if (cachedUsageResult && (now - lastUsageUpdate) < CACHE_TTL) {
    return cachedUsageResult
  }

  let totalTokens = 0
  let totalCost = 0
  const byAgent = {}

  try {
    const agents = await fs.readdir(AGENTS_DIR)

    for (const agent of agents) {
      const agentSessionsDir = path.join(AGENTS_DIR, agent, 'sessions')

      try {
        await fs.access(agentSessionsDir)
        const files = await fs.readdir(agentSessionsDir)
        const jsonlFiles = files.filter(f => {
          if (f.startsWith('.')) return false
          if (f.endsWith('.trajectory.jsonl')) return false
          if (f.endsWith('.trajectory-path.json')) return false
          if (f.includes('.deleted.')) return false
          if (f.includes('.bak-')) return false
          if (f.endsWith('.tmp')) return false
          if (f.startsWith('.usage-cost-cache')) return false
          if (f === 'sessions.json') return false
          return f.endsWith('.jsonl') || f.endsWith('.jsonl.reset') || f.endsWith('.jsonl.reset.bak')
        })

        let agentTokens = 0
        let agentCost = 0

        for (const file of jsonlFiles) {
          const filePath = path.join(agentSessionsDir, file)
          const result = await parseJsonlFile(filePath)
          agentTokens += result.totalTokens
          agentCost += result.totalCost
        }

        if (agentTokens > 0 || agentCost > 0) {
          byAgent[agent] = {
            tokens: agentTokens,
            cost: agentCost,
            sessionCount: jsonlFiles.length
          }
          totalTokens += agentTokens
          totalCost += agentCost
        }

      } catch (e) {
        // 忽略不存在的目录
      }
    }

    const result = {
      totalTokens,
      totalCost,
      byAgent,
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