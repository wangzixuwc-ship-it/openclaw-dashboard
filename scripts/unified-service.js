/**
 * OpenClaw Dashboard Unified Service
 * 合并服务：GPU VRAM + Usage Stats + Reset Agent
 * 端口：31002
 */

import http from 'http'
import fs from 'fs/promises'
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
  console.log('[功能] GPU VRAM + Usage Stats + Reset Agent')
  console.log(`[提示] 按 Ctrl+C 可停止服务`)
  console.log('')
  console.log('[API 端点]')
  console.log('  GET  /api/gpu-vram - GPU VRAM 使用情况')
  console.log('  GET  /api/usage    - 获取用量统计')
  console.log('  GET  /api/health   - 健康检查')
  console.log('  POST /reset        - 重置 Agent')
  console.log('')
})