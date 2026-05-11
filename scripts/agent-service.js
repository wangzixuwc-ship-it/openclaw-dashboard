/**
 * OpenClaw Agent Service
 * 综合服务：提供 Usage Stats 和 Reset Agent 功能
 * 端口：3001
 */

import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 加载 .env 文件
dotenv.config({ path: path.join(__dirname, '..', '.env') })

// OpenClaw 数据目录
const OPENCLAW_DIR = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.openclaw')
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents')

// 端口号
const PORT = process.env.AGENT_SERVICE_PORT || 3001

// 缓存结果
let cachedUsageResult = null
let lastUsageUpdate = 0
const CACHE_TTL = 10000 // 10 秒缓存

// 版本号
const openclawVersion = process.env.VITE_OPENCLAW_VERSION || 'unknown'

// 将 exec 转换为 Promise 版本
const execAsync = promisify(exec)

console.log('='.repeat(50))
console.log('   OpenClaw Agent Service')
console.log('='.repeat(50))
console.log(`[配置] 端口：${PORT}`)
console.log(`[功能] Usage Stats + Reset Agent`)
console.log(`[提示] 按 Ctrl+C 可停止服务`)
console.log('')

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
// Reset Agent 功能
// ============================================

/**
 * 重置指定 Agent 的会话
 */
async function resetAgent(agentId) {
  const command = `openclaw agent --agent ${agentId} --message "/reset"`
  console.log(`[重置] Agent: ${agentId}`)
  console.log(`[执行] ${command}`)
  
  try {
    const { stdout, stderr } = await execAsync(command)
    
    console.log(`[成功] Agent ${agentId} 重置成功`)
    if (stdout) console.log(`[输出] ${stdout}`)
    if (stderr) console.warn(`[警告] ${stderr}`)
    
    return {
      success: true,
      agentId,
      command,
      stdout,
      stderr: stderr || null
    }
  } catch (error) {
    console.error(`[错误] 执行命令失败：${error.message}`)
    
    return {
      success: false,
      error: error.message,
      agentId,
      command
    }
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
  // Usage Stats API
  // ============================================
  
  if (pathname === '/api/usage' || pathname === '/api/usage/') {
    if (req.method === 'GET') {
      try {
        const stats = await collectUsageStats()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(stats))
      } catch (error) {
        console.error('Usage stats error:', error.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: error.message }))
      }
      return
    }
  }

  // ============================================
  // Health Check API
  // ============================================
  
  if (pathname === '/api/health' || pathname === '/api/health/') {
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
  
  if (pathname === '/reset' || pathname === '/reset/') {
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
          console.error('Parse error:', error.message)
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
  console.log(`[服务] 正在监听端口 ${PORT}`)
  console.log('')
  console.log('[API 端点]')
  console.log('  GET  /api/usage    - 获取用量统计')
  console.log('  GET  /api/health   - 健康检查')
  console.log('  POST /reset        - 重置 Agent')
  console.log('')
  console.log('使用示例:')
  console.log('  curl http://localhost:3001/api/usage')
  console.log('  curl -X POST http://localhost:3001/reset ^')
  console.log('    -H "Content-Type: application/json" ^')
  console.log('    -d \'{"agentId": "main"}\'')
  console.log('')
})
