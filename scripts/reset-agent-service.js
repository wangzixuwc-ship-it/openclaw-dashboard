/**
 * OpenClaw Agent Reset Service
 * 接收 HTTP 请求，执行 openclaw agent --agent <id> --message "/reset" 命令
 */

import http from 'http'
import { exec } from 'child_process'
import { promisify } from 'util'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 加载 .env 文件
dotenv.config({ path: path.join(__dirname, '..', '.env') })

// 端口号
const PORT = process.env.RESET_AGENT_PORT || 3002

// 将 exec 转换为 Promise 版本
const execAsync = promisify(exec)

console.log('='.repeat(50))
console.log('   OpenClaw Agent Reset Service')
console.log('='.repeat(50))
console.log(`[配置] 端口：${PORT}`)
console.log(`[提示] 按 Ctrl+C 可停止服务`)
console.log('')

const server = http.createServer(async (req, res) => {
  // CORS 配置
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // 只处理 POST 请求
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  // 解析请求体
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

      console.log(`[请求] 重置 Agent: ${agentId}`)

      // 执行命令：openclaw agent --agent <id> --message "/reset"
      const command = `openclaw agent --agent ${agentId} --message "/reset"`
      console.log(`[执行] ${command}`)

      try {
        const { stdout, stderr } = await execAsync(command)
        
        console.log(`[成功] Agent ${agentId} 重置成功`)
        if (stdout) console.log(`[输出] ${stdout}`)
        if (stderr) console.warn(`[警告] ${stderr}`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          agentId,
          command,
          stdout,
          stderr: stderr || null
        }))
      } catch (error) {
        console.error(`[错误] 执行命令失败：${error.message}`)
        
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          error: error.message,
          agentId,
          command
        }))
      }
    } catch (error) {
      console.error(`[错误] 解析请求失败：${error.message}`)
      
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid JSON' }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`[服务] 正在监听端口 ${PORT}`)
  console.log(`[API] POST http://localhost:${PORT}/reset`)
  console.log('')
  console.log('使用示例:')
  console.log('curl -X POST http://localhost:3002/reset \\')
  console.log('  -H "Content-Type: application/json" \\')
  console.log('  -d \'{"agentId": "main"}\'')
  console.log('')
})
