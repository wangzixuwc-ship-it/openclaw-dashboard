/**
 * OpenClaw Usage Stats Service
 * 读取所有 .jsonl 和 .jsonl.reset 文件，累加 cumulativeTokens
 * 暴露 HTTP 端点供 Dashboard 调用
 */

import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// OpenClaw 数据目录
const OPENCLAW_DIR = path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\yc', '.openclaw')
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents')

// 端口号
const PORT = process.env.USAGE_STATS_PORT || 3001

// 缓存结果，避免频繁读取文件
let cachedResult = null
let lastUpdate = 0
const CACHE_TTL = 10000 // 10秒缓存

/**
 * 解析 .jsonl 文件，累加 token 用量
 * 实际数据来源：message.usage.totalTokens 或 message.usage.input + output
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
        
        // 从 message.usage 字段获取 token 用量（主要来源）
        if (entry.message?.usage) {
          const usage = entry.message.usage
          // 优先使用 totalTokens
          if (usage.totalTokens) {
            totalTokens += usage.totalTokens
          } else if (usage.input || usage.output) {
            totalTokens += (usage.input || 0) + (usage.output || 0)
          }
          // 累加费用
          if (usage.cost?.total) {
            totalCost += usage.cost.total
          }
        }
        
        // 从 responseUsage 字段获取（备用）
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
  // 检查缓存
  const now = Date.now()
  if (cachedResult && (now - lastUpdate) < CACHE_TTL) {
    return cachedResult
  }
  
  let totalTokens = 0
  let totalCost = 0
  const byAgent = {}
  
  try {
    // 读取所有 agent 目录
    const agents = await fs.readdir(AGENTS_DIR)
    
    for (const agent of agents) {
      const agentSessionsDir = path.join(AGENTS_DIR, agent, 'sessions')
      
      try {
        // 检查目录是否存在
        await fs.access(agentSessionsDir)
        
        // 读取 .jsonl 和 .jsonl.reset.* 文件，排除 .trajectory.jsonl、.deleted、.bak 等
        const files = await fs.readdir(agentSessionsDir)
        const jsonlFiles = files.filter(f => {
          // 排除隐藏文件和特殊文件
          if (f.startsWith('.')) return false
          // 排除 .trajectory-path.json
          if (f.endsWith('.trajectory-path.json')) return false
          // 排除 .deleted.* 文件
          if (f.includes('.deleted.')) return false
          // 排除 .bak-* 备份文件
          if (f.includes('.bak-')) return false
          // 排除 .tmp 临时文件
          if (f.endsWith('.tmp')) return false
          // 排除 .usage-cost-cache.json
          if (f.startsWith('.usage-cost-cache')) return false
          // 排除 sessions.json
          if (f === 'sessions.json') return false
          // 只保留 .jsonl 和 .jsonl.reset.* 文件
          return f.endsWith('.jsonl') || f.includes('.jsonl.reset.')
        })
        
        let agentTokens = 0
        let agentCost = 0
        
        for (const file of jsonlFiles) {
          const filePath = path.join(agentSessionsDir, file)
          const { totalTokens: fileTokens, totalCost: fileCost } = await parseJsonlFile(filePath)
          agentTokens += fileTokens
          agentCost += fileCost
        }
        
        totalTokens += agentTokens
        totalCost += agentCost
        
        byAgent[agent] = {
          tokens: agentTokens,
          cost: agentCost,
          sessionCount: jsonlFiles.length
        }
        
      } catch (e) {
        // 目录不存在或无权访问，跳过
      }
    }
    
    // 更新缓存
    cachedResult = {
      totalTokens,
      totalCost,
      byAgent,
      updatedAt: new Date().toISOString(),
      version: '2026.3.13'
    }
    lastUpdate = now
    
    return cachedResult
    
  } catch (e) {
    console.error('Error collecting usage stats:', e)
    return {
      totalTokens: 0,
      totalCost: 0,
      byAgent: {},
      error: e.message
    }
  }
}

// 创建 HTTP 服务器
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  
  if (req.method === 'GET') {
    if (req.url === '/api/usage' || req.url === '/api/usage/') {
      const stats = await collectUsageStats()
      res.writeHead(200)
      res.end(JSON.stringify(stats))
      return
    }
    
    if (req.url === '/api/health') {
      res.writeHead(200)
      res.end(JSON.stringify({ status: 'ok', port: PORT }))
      return
    }
    
    // 404
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }
  
  res.writeHead(405)
  res.end(JSON.stringify({ error: 'Method not allowed' }))
})

server.listen(PORT, () => {
  console.log(`\n🦞 OpenClaw Usage Stats Service`)
  console.log(`   Port: ${PORT}`)
  console.log(`   OpenClaw Dir: ${OPENCLAW_DIR}`)
  console.log(`   API: http://localhost:${PORT}/api/usage`)
  console.log(`   Health: http://localhost:${PORT}/api/health`)
  console.log(``)
  console.log(`Dashboard 调用方式: fetch('http://localhost:${PORT}/api/usage')`)
  console.log(``)
})

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  server.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\nShutting down...')
  server.close()
  process.exit(0)
})
