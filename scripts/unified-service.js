/**
 * OpenClaw Dashboard Unified Service
 * 合并服务：GPU VRAM + Usage Stats + Reset Agent
 * 端口：31002
 */

import http from 'http'
import https from 'https'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { spawn, execSync } from 'child_process'
import iconv from 'iconv-lite'
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

// 读取 gateway token，设置 OPENCLAW_GATEWAY_TOKEN 环境变量
// openclaw CLI 通过此环境变量认证网关（否则报 missing scope: operator.admin）
async function initGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return // 已手动设置，优先

  // 从 .env 的 VITE_GATEWAY_TOKEN 读取
  const envToken = process.env.VITE_GATEWAY_TOKEN
  if (envToken) {
    process.env.OPENCLAW_GATEWAY_TOKEN = envToken
    console.log('[Auth] 从 VITE_GATEWAY_TOKEN 设置 OPENCLAW_GATEWAY_TOKEN')
    return
  }

  // 降级：从 openclaw.json 读取 gateway.auth.token
  try {
    const configPath = path.join(OPENCLAW_DIR, 'openclaw.json')
    const content = await fs.readFile(configPath, 'utf-8')
    const config = JSON.parse(content)
    const token = config?.gateway?.auth?.token
    if (token) {
      process.env.OPENCLAW_GATEWAY_TOKEN = token
      console.log('[Auth] 从 openclaw.json 读取 gateway.auth.token')
    } else {
      console.warn('[Auth] 未找到 gateway.auth.token，Agent 重置等功能可能无法使用')
    }
  } catch (e) {
    // openclaw.json 不存在或无法读取
  }
}
// 立即执行初始化（同步设置 env，异步读取文件）
initGatewayToken()

// Windows 代码页 → iconv-lite 编码名映射
const CP_TO_ENCODING = {
  437: 'cp437',
  65001: 'utf8',
  936: 'gbk',
  932: 'shiftjis',
  949: 'euc-kr',
  950: 'big5',
  850: 'cp850',
  1252: 'cp1252',
  20127: 'ascii',
}

let cachedSystemEncoding = null

/**
 * 检测 Windows 系统活动 OEM 代码页，返回 iconv-lite 编码名
 * chcp 65001 只影响控制台，不影响管道输出（管道始终使用 OEM 代码页）
 * 因此必须通过 chcp.com 检测实际代码页，用 iconv-lite 正确解码
 */
function detectSystemEncoding() {
  if (cachedSystemEncoding) return cachedSystemEncoding
  cachedSystemEncoding = 'utf8'
  if (os.platform() !== 'win32') return cachedSystemEncoding
  try {
    const output = execSync('chcp.com', { encoding: 'utf8', timeout: 3000 })
    const match = output.match(/(\d+)/)
    const cp = match ? parseInt(match[1], 10) : 0
    cachedSystemEncoding = CP_TO_ENCODING[cp] || 'utf8'
    console.log(`[System] Windows 代码页: ${cp} → 编码: ${cachedSystemEncoding}`)
  } catch (e) {
    // 默认使用 utf8
  }
  return cachedSystemEncoding
}

/**
 * 解码子进程输出 Buffer
 * 优先尝试 UTF-8（Node.js CLI 工具输出），若含替换字符则回退到系统编码
 */
function decodeBuffer(buf) {
  if (!buf || buf.length === 0) return ''
  if (os.platform() !== 'win32') return buf.toString('utf8')
  const utf8Result = buf.toString('utf8')
  // 检测是否包含 U+FFFD（替换字符）—— 说明不是合法 UTF-8
  if (!utf8Result.includes('\uFFFD')) {
    return utf8Result
  }
  // 回退到系统代码页编码
  const enc = detectSystemEncoding()
  if (enc === 'utf8') return utf8Result
  try {
    return iconv.decode(buf, enc)
  } catch (e) {
    return utf8Result
  }
}

// ============================================
// 版本管理功能
// ============================================

// 缓存文件路径：public/versions-cache.json
const VERSIONS_CACHE_PATH = path.join(__dirname, '..', 'public', 'versions-cache.json')

// 并发锁：防止并发操作
let syncingVersions = false
let switchingVersion = false

/**
 * 读取版本缓存文件
 */
async function readVersionsCache() {
  try {
    const content = await fs.readFile(VERSIONS_CACHE_PATH, 'utf-8')
    const data = JSON.parse(content)
    return data
  } catch (e) {
    return { lastSync: null, source: null, versions: [] }
  }
}

/**
 * 原子写入版本缓存（.tmp + rename）
 */
async function writeVersionsCache(data) {
  const tmpPath = VERSIONS_CACHE_PATH + '.tmp'
  const dir = path.dirname(VERSIONS_CACHE_PATH)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmpPath, VERSIONS_CACHE_PATH)
}

/**
 * 清理 GitHub release body：去除 Markdown 标记，合并多余换行和空白
 */
function cleanReleaseBody(body) {
  if (!body || typeof body !== 'string') return ''
  return body
    .replace(/#{1,6}\s?/g, '')           // 移除 Markdown 标题标记 # ## ###
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
    .replace(/[*_~`]/g, '')              // 移除加粗/斜体/代码标记
    .replace(/^-+\s+/gm, '• ')           // 列表 - → •
    .replace(/\n{2,}/g, '\n')            // 合并多余换行
    .replace(/\r/g, '')                  // 移除 \r
    .trim()
}

/**
 * 从 GitHub Releases API 拉取版本列表（含镜像站回退，自动分页获取全部）
 */
async function fetchReleasesFromGitHub() {
  const officialBase = 'https://api.github.com/repos/openclaw/openclaw/releases?per_page=100'
  const proxyBase = 'https://gh-proxy.com/' + officialBase

  // 分页拉取所有版本
  async function fetchAllReleases(basePage) {
    let allReleases = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const pageUrl = `${basePage}&page=${page}`
      const data = await fetchWithTimeout(pageUrl, 30000)
      const releases = JSON.parse(data)

      if (!Array.isArray(releases) || releases.length === 0) {
        hasMore = false
        break
      }

      allReleases = allReleases.concat(releases)

      // GitHub 返回少于 per_page 说明已经是最后一页
      if (releases.length < 100) {
        hasMore = false
      } else {
        page++
      }
    }

    console.log(`[Version Sync] 共拉取 ${allReleases.length} 条 release（${page} 页）`)
    return allReleases
  }

  // 1. 尝试官方 API
  try {
    const releases = await fetchAllReleases(officialBase)
    const source = 'github-api'

    const versions = releases
      .filter(r => !r.draft)
      .map(r => ({
        version: r.tag_name.replace(/^v/, ''),
        name: r.name || r.tag_name,
        description: cleanReleaseBody(r.body),
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        htmlUrl: r.html_url
      }))

    return { versions, source }
  } catch (e) {
    console.log(`[Version Sync] 官方 API 失败，尝试镜像站: ${e.message}`)
  }

  // 2. 回退到 gh-proxy.com
  try {
    const releases = await fetchAllReleases(proxyBase)
    const source = 'gh-proxy'

    const versions = releases
      .filter(r => !r.draft)
      .map(r => ({
        version: r.tag_name.replace(/^v/, ''),
        name: r.name || r.tag_name,
        description: cleanReleaseBody(r.body),
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        htmlUrl: r.html_url
      }))

    return { versions, source }
  } catch (e) {
    console.error(`[Version Sync] 镜像站也失败: ${e.message}`)
    throw new Error(`无法从 GitHub 拉取版本列表: ${e.message}`)
  }
}

/**
 * 带超时的 HTTP GET 请求（使用静态导入的 http/https 模块）
 */
function fetchWithTimeout(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const isHttps = urlObj.protocol === 'https:'
    const fetchMod = isHttps ? https : http

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'OpenClaw-Dashboard',
        'Accept': 'application/vnd.github.v3+json'
      }
    }

    const req = fetchMod.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        clearTimeout(timeoutId)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data)
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      })
    })

    const timeoutId = setTimeout(() => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    req.on('error', (err) => {
      clearTimeout(timeoutId)
      reject(err)
    })

    req.end()
  })
}

/**
 * 执行单个命令（spawn），返回 { success, stdout, stderr, error }
 */
function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const spawnEnv = { ...process.env }

    const child = spawn(command, args, {
      shell: true,
      env: spawnEnv,
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timeoutId = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
      resolve({ success: false, error: `命令超时（${timeoutMs / 1000}秒）`, stderr: '超时终止' })
    }, timeoutMs)

    child.stdout.on('data', data => { stdout += decodeBuffer(data) })
    child.stderr.on('data', data => { stderr += decodeBuffer(data) })
    child.stdout.on('error', () => { })
    child.stderr.on('error', () => { })

    child.on('close', code => {
      clearTimeout(timeoutId)
      if (timedOut) return
      if (code === 0) {
        resolve({ success: true, stdout, stderr })
      } else {
        resolve({ success: false, error: `exit code ${code}: ${stderr.trim()}`, stdout, stderr })
      }
    })

    child.on('error', err => {
      clearTimeout(timeoutId)
      resolve({ success: false, error: err.message })
    })
  })
}

/**
 * 切换 OpenClaw 版本：串行执行 npm install → gateway restart
 * 支持 Windows / Linux / macOS 跨平台
 */
async function switchOpenClawVersion(version) {
  const INSTALL_TIMEOUT = 1200000  // 安装 20 分钟超时
  const RESTART_TIMEOUT = 60000   // 重启 60 秒超时
  const platform = os.platform()  // win32 | linux | darwin

  console.log(`[Switch Version] 开始安装 openclaw@${version}（平台：${platform}）`)

  // Step 1: npm install -g（Linux/macOS 可能需要 sudo）
  const isWindows = platform === 'win32'
  const isLinux = platform === 'linux'
  const isMacOS = platform === 'darwin'

  // 构建 npm install 命令（不依赖 chcp，由 runCommand 通过环境变量控制编码）
  let installCommand = 'npm'
  let installArgs = ['install', '-g', `openclaw@${version}`, '--registry=https://repo.huaweicloud.com/repository/npm/']

  // Linux 系统：检测是否需要 sudo（方案 A：非 root + 系统级 prefix → 返回手动操作引导）
  if (isLinux) {
    // 检查 npm 全局前缀
    const prefixCheck = await runCommand('npm', ['prefix', '-g'], 5000)
    const rawPrefix = prefixCheck.stdout?.trim()
    const npmPrefix = rawPrefix?.replace(/\/$/, '') // 去除尾部斜杠

    // 如果 prefix 是 /usr/local 或 /usr，通常需要 root 权限
    if (npmPrefix && /^\/usr(\/local)?$/.test(npmPrefix)) {
      // 检测当前用户是否为 root
      const uidCheck = await runCommand('id', ['-u'], 5000)
      const uid = uidCheck.stdout?.trim()
      if (uid !== '0') {
        // 非 root 用户 + 系统级 npm 前缀 → 无法通过 Web API 自动安装（sudo 需要 TTY）
        console.log(`[Switch Version] 非 root 用户(u=${uid}) + 系统 prefix(${npmPrefix})，返回手动引导`)
        return {
          success: false,
          error: `需要 root 权限安装全局包。请手动执行：\n  sudo npm install -g openclaw@${version}\n  sudo openclaw gateway restart`,
          requiresManualAction: true,
          manualCommands: [
            `sudo npm install -g openclaw@${version} --registry=https://repo.huaweicloud.com/repository/npm/`,
            'sudo openclaw gateway restart'
          ]
        }
      }
      // root 用户，直接 npm install（无需 sudo）
      console.log(`[Switch Version] root 用户，直接执行 npm install`)
    }
    // nvm/fnm 等用户级 prefix 不需要 sudo，直接执行
  }

  const installResult = await runCommand(installCommand, installArgs, INSTALL_TIMEOUT)

  if (!installResult.success) {
    console.error(`[Switch Version] 安装失败: ${installResult.error}`)
    // 如果是权限问题，提示用户手动执行
    if (installResult.stderr && /EACCES|permission denied|EPERM/i.test(installResult.stderr)) {
      return {
        success: false,
        error: `权限不足，请手动执行：sudo npm install -g openclaw@${version}`,
        stdout: installResult.stdout,
        stderr: installResult.stderr
      }
    }
    return { success: false, error: `安装失败: ${installResult.error}`, stdout: installResult.stdout, stderr: installResult.stderr }
  }

  console.log(`[Switch Version] 安装成功，开始重启网关`)

  // Step 2: openclaw gateway restart
  let restartCommand = isWindows ? 'openclaw.cmd' : 'openclaw'

  const restartResult = await runCommand(restartCommand, ['gateway', 'restart'], RESTART_TIMEOUT)

  if (!restartResult.success) {
    console.error(`[Switch Version] 网关重启失败: ${restartResult.error}`)
    // 如果命令不存在，给出友好提示
    if (restartResult.error && /not found|ENOENT/i.test(restartResult.error)) {
      return {
        success: false,
        error: `openclaw 命令未找到，请确认已正确安装或手动重启网关`,
        stdout: restartResult.stdout,
        stderr: restartResult.stderr
      }
    }
    return { success: false, error: `安装成功但网关重启失败: ${restartResult.error}`, stdout: restartResult.stdout, stderr: restartResult.stderr }
  }

  console.log(`[Switch Version] 版本切换完成（${version}），网关已重启`)
  return { success: true, message: `版本已切换到 ${version}，网关已重启` }
}

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
 * 本地查询：macOS system_profiler > nvidia-smi
 */
async function getGpuVram() {
  const platform = os.platform()

  if (platform === 'darwin') {
    return getMacOSGpuInfo()
  }

  try {
    return await runNvidiaSmi()
  } catch (e) {
    console.log('[GPU] nvidia-smi 不可用:', e.message)
    return { usedPct: null, nvidiaSmiAvailable: false }
  }
}

function getMacOSGpuInfo() {
  return new Promise((resolve) => {
    // 修复 R-10: spawn 选项不支持 timeout，改用 setTimeout + child.kill()
    const child = spawn('system_profiler', ['SPDisplaysDataType'])

    const timeoutId = setTimeout(() => {
      console.log('[GPU] macOS system_profiler 超时，强制终止')
      child.kill('SIGKILL')
      resolve({ usedPct: null })
    }, 10000)

    let stdout = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
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

      resolve({ usedPct: null, totalMb, gpuName: gpuName || undefined })
    })

    child.on('error', () => {
      clearTimeout(timeoutId)
      resolve({ usedPct: null })
    })
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

    // 修复 R-13: spawn 选项不支持 timeout，改用 setTimeout + child.kill()
    const child = spawn(command, args, { shell: isWindows })

    const timeoutId = setTimeout(() => {
      console.log('[GPU] nvidia-smi 超时，强制终止')
      child.kill('SIGKILL')
      reject(new Error('nvidia-smi timeout after 10s'))
    }, 10000)

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`nvidia-smi exited with code ${code}: ${stderr.trim()}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeoutId)
      reject(err)
    })
  })
}

function parseVramOutput(output) {
  // 兼容非字符串输入（如 getGpuVram 错误分支返回的对象）
  if (typeof output !== 'string' || !output.trim()) {
    return { usedPct: null }
  }
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
    const args = ['agent', '--agent', agentId, '--message', '/reset', '--local']

    console.log(`[重置] Agent: ${agentId}`)
    console.log(`[执行] ${command} ${args.join(' ')}`)

    const child = spawn(command, args, {
      shell: true,
      env: { ...process.env },
      windowsHide: true
    })

    const timeoutId = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({
        success: false,
        agentId,
        error: '重置超时（30秒）'
      })
    }, 30000)

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += decodeBuffer(data)
    })

    child.stderr.on('data', (data) => {
      stderr += decodeBuffer(data)
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      // --local 模式即使重置成功也可能返回非零退出码（如 CLI 内部信号），
      // 只要进程正常退出（非超时/崩溃）即视为成功
      const hasError = code !== null && code !== 0 && stderr.trim()
      if (hasError) {
        console.error(`[错误] Agent ${agentId} 重置可能失败: exit ${code}, ${stderr.trim()}`)
      } else {
        console.log(`[成功] Agent ${agentId} 重置成功`)
      }
      resolve({
        success: true,
        agentId,
        stdout,
        stderr: stderr || undefined
      })
    })

    child.on('error', (err) => {
      clearTimeout(timeoutId)
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
// Tasks API — 当前任务进度
// ============================================

// .openclaw 目录（项目级）
const PROJECT_OPENCLAW_DIR = path.join(__dirname, '..', '.openclaw')

/**
 * 读取 REC-STATUS.json 和 REC-TASK-DOING.json，获取当前任务数据
 */
async function getCurrentTaskData() {
  const recStatusPath = path.join(PROJECT_OPENCLAW_DIR, 'REC-STATUS.json')
  const recDoingPath = path.join(PROJECT_OPENCLAW_DIR, 'REC-TASK-DOING.json')

  let recStatus = { currentTask: null, status: 'idle', phase: null, agent: null, lastUpdate: null }
  let recDoing = { tasks: [], pendingTasks: [] }

  try {
    const content = await fs.readFile(recStatusPath, 'utf-8')
    recStatus = JSON.parse(content)
  } catch (e) { /* 文件不存在或解析失败 */ }

  try {
    const content = await fs.readFile(recDoingPath, 'utf-8')
    recDoing = JSON.parse(content)
  } catch (e) { /* 文件不存在或解析失败 */ }

  // 合并：以 recDoing 中对应任务的信息补充
  const taskId = recStatus.currentTask
  let taskInfo = null
  if (taskId) {
    taskInfo = recDoing.tasks.find(t => t.rec === taskId) || null
  }

  return {
    taskId: taskId,
    status: recStatus.status,
    phase: taskInfo?.phase || recStatus.phase,
    agent: taskInfo?.agent || recStatus.agent,
    lastUpdate: taskInfo?.lastUpdate || recStatus.lastUpdate,
    dispatchedAt: taskInfo?.dispatchedAt || null,
    description: taskInfo?.description || null,
    pendingTasks: recDoing.pendingTasks || recStatus.pendingTasks || []
  }
}

/**
 * 扫描 .openclaw 目录下 REC-{taskId}-* 文件，检测涉及的 agent 和阶段完成度
 */
async function scanTaskProgress(taskId) {
  try {
    const files = await fs.readdir(PROJECT_OPENCLAW_DIR)
    const prefix = `${taskId}-`

    // 检测阶段文件是否存在
    let hasAnalyze = false, hasExecute = false, hasAudit = false, hasTest = false

    // 检测是否有多 agent（通过文件名中的 agent 前缀识别）
    const multiAgentFiles = {}

    for (const file of files) {
      if (!file.startsWith(prefix)) continue

      // 识别 agent 前缀：REC-XXX-backend-* 或 REC-XXX-frontend-*
      const agentMatch = file.match(/^REC-\d+-(backend|frontend)-/)
      const agentName = agentMatch ? agentMatch[1] : null

      // 有 agent 前缀的文件：按 agent 分类
      if (agentName) {
        if (!multiAgentFiles[agentName]) multiAgentFiles[agentName] = []
        multiAgentFiles[agentName].push(file)
        continue
      }

      // 前端专属文件（检测前端 agent）— 不参与通用阶段标志
      if (file.includes('前端')) {
        if (!multiAgentFiles['frontend']) multiAgentFiles['frontend'] = []
        multiAgentFiles['frontend'].push(file)
        continue
      }

      // 无 agent 前缀的通用阶段文件（backend 拥有）
      if (file.includes('分析')) hasAnalyze = true
      if (file.includes('修复') || (file.match(/\.md$/i) && file.includes('fix'))) hasExecute = true
      if (file.includes('代码审计')) hasAudit = true
      if (file.includes('测试')) hasTest = true
    }

    // 构建 agent 列表
    const allAgents = Object.keys(multiAgentFiles)

    // 如果有通用阶段文件，添加 backend agent
    const hasAnyStageFile = hasAnalyze || hasExecute || hasAudit || hasTest
    if (!allAgents.includes('backend') && hasAnyStageFile) {
      allAgents.unshift('backend')
    }

    // 如果没有 agent 但无阶段文件，返回空
    if (allAgents.length === 0 && !hasAnyStageFile) {
      return { agents: [], error: null }
    }

    const totalPhases = 4
    const agents = allAgents.map(name => {
      const agentFiles = multiAgentFiles[name] || []

      let analyze = false
      let execute = false
      let audit = false
      let test = false

      // 如果有多 agent 文件，按 agent 分类计算
      if (agentFiles.length > 0) {
        analyze = agentFiles.some(f => f.includes('分析'))
        execute = agentFiles.some(f => f.includes('修复') || f.includes('fix'))
        audit = agentFiles.some(f => f.includes('代码审计') || f.includes('audit'))
        test = agentFiles.some(f => f.includes('测试') || f.includes('test'))
      } else if (name === 'backend') {
        // backend 无专属文件时，继承通用文件标志（backend 拥有通用文件）
        analyze = hasAnalyze
        execute = hasExecute
        audit = hasAudit
        test = hasTest
      }

      const completedCount = [analyze, execute, audit, test].filter(Boolean).length
      const progress = Math.round((completedCount / totalPhases) * 100)

      let currentStage = 'completed'
      if (!analyze) currentStage = 'analyze'
      else if (!execute) currentStage = 'execute'
      else if (!audit) currentStage = 'audit'
      else if (!test) currentStage = 'test'

      const status = currentStage === 'completed' ? '已完成' : '执行中'

      return {
        name,
        status,
        currentStage: currentStage === 'completed' ? null : currentStage,
        _analyze: analyze,
        _execute: execute,
        _audit: audit,
        _test: test
      }
    })

    return { agents, error: null }
  } catch (e) {
    return { agents: [], error: e.message }
  }
}

/**
 * 获取当前任务进度
 * @param {string} taskId - 可选，指定任务 ID（默认从 REC-STATUS.json 读取）
 */
async function getCurrentTaskProgress(taskId) {
  const data = await getCurrentTaskData()
  const targetTaskId = taskId || data.taskId

  if (!targetTaskId) {
    return {
      taskId: null,
      projectName: null,
      taskName: null,
      progress: 0,
      currentStage: null,
      totalStages: 0,
      agents: [],
      startedAt: null,
      runningMinutes: 0
    }
  }

  const { agents } = await scanTaskProgress(targetTaskId)

  // 计算整体进度（取所有 agent 平均进度）
  let overallProgress = 0
  let overallStage = null
  if (agents.length > 0) {
    let totalPct = 0
    let firstRunning = null
    for (const a of agents) {
      const cnt = [a._analyze, a._execute, a._audit, a._test].filter(Boolean).length
      totalPct += cnt * 25
      if (!firstRunning && a.currentStage) firstRunning = a.currentStage
    }
    overallProgress = Math.round(totalPct / agents.length)
    overallStage = firstRunning
  }

  // 开始时间
  const startedAt = data.dispatchedAt || data.lastUpdate || new Date().toISOString()
  const startedMs = new Date(startedAt).getTime()
  const runningMinutes = Math.max(0, Math.round((Date.now() - startedMs) / 60000))

  // 查找任务描述
  const taskDescription = data.taskId === targetTaskId ? data.description : null

  return {
    taskId: targetTaskId,
    projectName: 'OpenClaw Dashboard',
    taskName: taskDescription || targetTaskId,
    progress: overallProgress,
    currentStage: overallStage,
    totalStages: 4,
    agents: agents.map(a => {
      const label = `${a.name}(${a.status})`
      return a.currentStage ? `${label}[${a.currentStage}]` : label
    }),
    startedAt,
    runningMinutes
  }
}

/**
 * 解析 clawhub search 命令的输出为技能数组
 * 格式: "name  @author  description  (score)"
 */
function parseClawHubSearchOutput(rawOutput) {
  const skills = []
  const lines = rawOutput.split('\n').filter(l => l.trim())

  for (const line of lines) {
    // 跳过 "- Searching" 等提示行
    if (line.startsWith('-') || line.startsWith('Searching') || line.startsWith('No results')) continue

    // 按双空格分割: name  @author  description  (score)
    const parts = line.split('  ').map(s => s.trim()).filter(Boolean)
    if (parts.length < 1) continue

    const name = parts[0] || ''
    const authorPart = parts[1] || ''
    const description = parts[2] || ''
    const scoreMatch = parts[3]?.match(/\(([\d.]+)\)/)
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0

    const author = authorPart.replace(/^@/, '')

    skills.push({
      name,
      author,
      description,
      score,
      installed: false
    })
  }

  return skills
}

/**
 * REC-014: 获取已安装技能名称集合
 * 通过 openclaw skills list --json 获取，判断 missing 为空即为已安装
 */
async function getInstalledSkillNames() {
  const isWindows = os.platform() === 'win32'
  const command = isWindows ? 'openclaw.cmd' : 'openclaw'
  const installedNames = new Set()

  try {
    const result = await runCommand(command, ['skills', 'list', '--json'], 30000)
    if (result.success) {
      let rawOutput = result.stdout || result.stderr || ''
      const jsonStart = rawOutput.indexOf('{')
      if (jsonStart >= 0) {
        const jsonStr = rawOutput.slice(jsonStart)
        const parsed = JSON.parse(jsonStr)
        const skills = parsed.skills || []
        for (const skill of skills) {
          const m = skill.missing || {}
          const isInstalled = (m.bins || []).length === 0
            && (m.anyBins || []).length === 0
            && (m.env || []).length === 0
            && (m.config || []).length === 0
            && (m.os || []).length === 0
          if (isInstalled && skill.name) {
            installedNames.add(skill.name)
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Installed Skills] 获取失败:', err.message)
  }

  console.log(`[Installed Skills] 已安装技能: ${[...installedNames].join(', ') || '(none)'}`)
  return installedNames
}

/**
 * REC-016: 获取已安装技能信息，用于与 ClawHub 搜索结果匹配
 * 
 * 问题根因：
 *   - ClawHub 搜索返回 slug: "douyin-no-watermark-downloader"
 *   - 已安装技能名称是文件夹名: "无水印抖音视频下载器"
 *   - 部分技能无 homepage 字段，无法提取 slug
 * 
 * 匹配策略（优先级从高到低）:
 *   1. slug 精确匹配（从 homepage URL 提取的 ClawHub slug）
 *   2. 名称精确匹配（skill.name 直接对比）
 *   3. 描述关键词匹配（搜索结果的 description 包含在已安装技能的 description 中或反之）
 */
async function getInstalledSkillInfo() {
  const isWindows = os.platform() === 'win32'
  const command = isWindows ? 'openclaw.cmd' : 'openclaw'
  const installedSlugs = new Set()
  const installedNames = new Set()
  const installedDescriptions = [] // {name, description}

  try {
    const result = await runCommand(command, ['skills', 'list', '--json'], 30000)
    if (result.success) {
      let rawOutput = result.stdout || result.stderr || ''
      const jsonStart = rawOutput.indexOf('{')
      if (jsonStart >= 0) {
        const jsonStr = rawOutput.slice(jsonStart)
        const parsed = JSON.parse(jsonStr)
        const skills = parsed.skills || []
        for (const skill of skills) {
          // 从 homepage URL 提取 ClawHub slug（clawhub.ai / clawic.com）
          const homepage = skill.homepage || ''
          const slugMatch = homepage.match(/(?:clawhub\.ai|clawic\.com)\/skills\/([^/?#]+)/)
          if (slugMatch) {
            installedSlugs.add(slugMatch[1])
          }

          // 名称集合
          if (skill.name) {
            installedNames.add(skill.name)
          }

          // 描述信息（用于模糊匹配）
          const desc = (skill.description || '').trim()
          if (desc) {
            installedDescriptions.push({ name: skill.name, description: desc })
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Installed Skill Info] 获取失败:', err.message)
  }

  console.log(`[Installed Skill Info] slugs: ${installedSlugs.size}, names: ${installedNames.size}, descriptions: ${installedDescriptions.length}`)
  return { installedSlugs, installedNames, installedDescriptions }
}

/**
 * 通过 clawhub inspect --json 获取单个技能的统计信息
 * 返回 { updatedAt, stars, downloads } 或 null
 * 注意: clawhub inspect --json 可能返回非 0 退出码但仍有有效 JSON 输出
 */
async function getClawHubSkillInfo(skillName) {
  const isWindows = os.platform() === 'win32'
  const command = isWindows ? 'npx.cmd' : 'npx'
  const INSPECT_TIMEOUT = 5000 // 5 秒超时（REC-013 优化：缩短超时减少阻塞）

  const result = await runCommand(command, ['clawhub', 'inspect', '--json', skillName], INSPECT_TIMEOUT)

  // clawhub inspect --json 可能返回非 0 退出码但仍有有效 JSON，所以即使 success=false 也尝试解析
  const output = (result.stdout || '') + (result.stderr || '')
  
  // 解析 JSON 输出（跳过 "- Fetching skill" 等提示行）
  // JSON 对象可能跨多行，从第一个 { 开始到最后一个 } 结束
  const firstBrace = output.indexOf('{')
  const lastBrace = output.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return null
  }
  const jsonStr = output.substring(firstBrace, lastBrace + 1)

  if (!jsonStr) {
    return null
  }

  try {
    const data = JSON.parse(jsonStr)
    const skill = data.skill || {}
    const stats = skill.stats || {}

    // updatedAt 是毫秒时间戳，转为 ISO 日期字符串
    const updatedAt = skill.updatedAt ? new Date(skill.updatedAt).toISOString().split('T')[0] : null

    return {
      updatedAt,
      slug: skill.slug || null,
      displayName: skill.displayName || null,
      stars: stats.stars || 0,
      downloads: stats.downloads || 0
    }
  } catch (parseError) {
    return null
  }
}

/**
 * 批量获取技能统计信息（并行调用，限制并发数）
 * REC-013 优化：
 * - 并发数 5 → 10（减少批次，降低总耗时）
 * - 单个超时 15s → 5s（快速跳过慢响应）
 * - 失败立即跳过而非阻塞
 */
async function enrichSkillsWithInfo(skills, maxConcurrent = 10) {
  if (skills.length === 0) return

  const enrichStartTime = Date.now()

  // 按批次并行执行，提高并发数减少批次
  for (let i = 0; i < skills.length; i += maxConcurrent) {
    const batch = skills.slice(i, i + maxConcurrent)
    // Promise.allSettled 确保单个失败不影响其他请求
    const results = await Promise.allSettled(
      batch.map(skill => getClawHubSkillInfo(skill.name))
    )

    // 将结果合并回 skills 数组
    for (let j = 0; j < batch.length; j++) {
      const result = results[j]
      // 处理 rejected 或返回 null 的情况（REC-013：失败跳过而非阻塞）
      if (result.status === 'fulfilled' && result.value) {
        batch[j].updatedAt = result.value.updatedAt
        batch[j].slug = result.value.slug || null
        batch[j].displayName = result.value.displayName || null
        batch[j].stars = result.value.stars
        batch[j].downloads = result.value.downloads
      } else {
        batch[j].updatedAt = null
        batch[j].slug = null
        batch[j].displayName = null
        batch[j].stars = 0
        batch[j].downloads = 0
      }
    }
  }

  const enrichDuration = ((Date.now() - enrichStartTime) / 1000).toFixed(1)
  console.log(`[Skills Enrich] 完成 ${skills.length} 个技能 enrich，耗时 ${enrichDuration}s`)
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

      const agents = agentsList.map(a => ({
        id: a.id,
        name: a?.identity?.name || a.name || a.id,
        emoji: a?.identity?.emoji || '',
        model: a.model || (config?.agents?.defaults?.model?.primary || 'unknown'),
        workspace: a.workspace || null,
        configured: true,
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
      const RUNNING_THRESHOLD_MS = 90 * 1000
      const now = Date.now()

      // 动态读取 openclaw.json 中的 agent 列表，避免硬编码
      let agentIds = ['main']
      try {
        const configRaw = await fs.readFile(path.join(OPENCLAW_DIR, 'openclaw.json'), 'utf-8')
        const config = JSON.parse(configRaw)
        const list = config?.agents?.list || []
        if (list.length > 0) agentIds = list.map(a => a.id).filter(Boolean)
      } catch (e) {
        console.warn('[agent-running-status] 读取 openclaw.json 失败，使用默认列表:', e.message)
      }

      const results = []

      for (const id of agentIds) {
        const sessionsDir = path.join(AGENTS_DIR, id, 'sessions')
        let latestMtime = 0

        try {
          const files = fsSync.readdirSync(sessionsDir)
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
        } catch (e) { /* 目录不存在，忽略 */ }

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
  // System Version API
  // ============================================

  if (pathname === '/api/system/version') {
    if (req.method === 'GET') {
      try {
        const versionCommand = os.platform() === 'win32' ? 'openclaw.cmd' : 'openclaw'
        const result = await runCommand(versionCommand, ['-v'], 10000)
        if (result.success) {
          const match = result.stdout.match(/(\d{4}\.\d+\.\d+)/)
          const version = match ? match[1] : 'unknown'
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ version }))
        } else {
          console.error(`[System Version] Error: ${result.error}`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ version: 'unknown', error: result.error }))
        }
      } catch (err) {
        console.error(`[System Version] Unexpected error: ${err.message}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ version: 'unknown', error: err.message }))
      }
      return
    }
  }

  // ============================================
  // GET /api/system/versions — 获取版本列表
  // ============================================

  if (pathname === '/api/system/versions' && req.method === 'GET') {
    try {
      const cache = await readVersionsCache()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        versions: cache.versions || [],
        lastSync: cache.lastSync || null
      }))
    } catch (error) {
      console.error('[Versions] 读取缓存失败:', error.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ versions: [], lastSync: null }))
    }
    return
  }

  // ============================================
  // POST /api/system/sync-versions — 同步版本列表
  // ============================================

  if (pathname === '/api/system/sync-versions' && req.method === 'POST') {
    if (syncingVersions) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: '版本同步正在进行中，请稍后再试' }))
      return
    }

    syncingVersions = true
    try {
      const result = await fetchReleasesFromGitHub()

      // 增量合并：读取现有缓存 → 按 tag_name 去重合并 → 写回
      const existingCache = await readVersionsCache()
      const existingTags = new Set((existingCache.versions || []).map(v => v.version))

      // 新版本追加到开头，已存在版本保留
      const newVersions = result.versions.filter(v => !existingTags.has(v.version))
      const mergedVersions = [...result.versions, ...(existingCache.versions || []).filter(v => !result.versions.some(r => r.version === v.version))]

      // 按 published_at 降序排列
      mergedVersions.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))

      const cacheData = {
        lastSync: new Date().toISOString(),
        source: result.source,
        versions: mergedVersions
      }

      await writeVersionsCache(cacheData)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        count: mergedVersions.length,
        added: newVersions.length,
        source: result.source
      }))
    } catch (error) {
      console.error('[Version Sync] 同步失败:', error.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: error.message }))
    } finally {
      syncingVersions = false
    }
    return
  }

  // ============================================
  // POST /api/system/switch-version — 切换版本
  // ============================================

  if (pathname === '/api/system/switch-version' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const input = JSON.parse(body)
        const { version } = input

        if (!version) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '缺少 version 参数' }))
          return
        }

        // 验证版本格式: YYYY.N.N / YYYY.N.N.P / YYYY.N.N-beta.N
        if (!/^\d{4}\.\d+\.\d+(\.\d+)?(-(beta|alpha|rc)\.\d+)?$/.test(version)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '版本格式不正确，应为 YYYY.N.N（如 2026.3.28）' }))
          return
        }

        if (switchingVersion) {
          res.writeHead(429, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '版本切换正在进行中，请稍后再试' }))
          return
        }

        switchingVersion = true
        try {
          const result = await switchOpenClawVersion(version)

          if (result.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              success: true,
              message: result.message || `版本已切换到 ${version}，网关已重启`,
              restarted: true
            }))
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              success: false,
              error: result.error,
              stdout: result.stdout || '',
              stderr: result.stderr || ''
            }))
          }
        } finally {
          switchingVersion = false
        }
      } catch (error) {
        console.error('[Switch Version] 解析错误:', error.message)
        switchingVersion = false
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }))
      }
    })
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
  // GET /api/tasks/current — 获取当前任务进度
  // ============================================

  if (pathname === '/api/tasks/current' && req.method === 'GET') {
    // 5 秒超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('GET /api/tasks/current timeout after 5s')), 5000)
    })

    const handler = async () => {
      try {
        const params = url.searchParams
        const overrideTaskId = params.get('taskId')

        // 支持 ?taskId= 查询参数，无参数时读取 REC-STATUS.json
        const progress = await getCurrentTaskProgress(overrideTaskId || null)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(progress))
      } catch (error) {
        console.error('[Tasks] Error:', error.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          taskId: null,
          projectName: null,
          taskName: null,
          progress: 0,
          currentStage: null,
          totalStages: 0,
          agents: [],
          startedAt: null,
          runningMinutes: 0
        }))
      }
    }

    Promise.race([handler(), timeoutPromise]).catch(err => {
      console.error('[Tasks] Route handler error:', err.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        taskId: null,
        projectName: null,
        taskName: null,
        progress: 0,
        currentStage: null,
        totalStages: 0,
        agents: [],
        startedAt: null,
        runningMinutes: 0
      }))
    })
    return
  }

  // ============================================
  // GET /api/system/skills — 获取技能列表
  // ============================================

  if (pathname === '/api/system/skills' && req.method === 'GET') {
    const isWindows = os.platform() === 'win32'
    const command = isWindows ? 'openclaw.cmd' : 'openclaw'
    const SKILLS_TIMEOUT = 60000 // 60 秒超时

    console.log(`[Skills] 执行: ${command} skills list --json`)

    const result = await runCommand(command, ['skills', 'list', '--json'], SKILLS_TIMEOUT)

    if (result.success) {
      try {
        // openclaw 在 Windows 上将 JSON 输出到 stderr（含配置警告）
        // 优先从 stdout 取，为空则从 stderr 取，跳过非 JSON 前缀
        let rawOutput = result.stdout || result.stderr || ''
        const jsonStart = rawOutput.indexOf('{')
        const jsonStr = jsonStart >= 0 ? rawOutput.slice(jsonStart) : rawOutput
        const parsed = JSON.parse(jsonStr)
        const skills = parsed.skills || []

        // 为每个技能增强 installed、enabled 和 source 字段
        const skillsWithStatus = skills.map(skill => ({
          ...skill,
          installed: (() => {
            const m = skill.missing || {}
            return (m.bins || []).length === 0
              && (m.anyBins || []).length === 0
              && (m.env || []).length === 0
              && (m.config || []).length === 0
              && (m.os || []).length === 0
          })(),
          enabled: skill.disabled !== true,
          source: skill.source === 'openclaw-bundled' ? 'builtin' : 'clawhub'
        }))

        const ready = skillsWithStatus.filter(s => s.eligible).length

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          total: skillsWithStatus.length,
          ready: ready,
          skills: skillsWithStatus,
          workspaceDir: parsed.workspaceDir,
          managedSkillsDir: parsed.managedSkillsDir
        }))
      } catch (parseError) {
        console.error('[Skills] JSON 解析失败:', parseError.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          error: '解析技能列表失败',
          raw: (result.stdout || result.stderr || '').substring(0, 200)
        }))
      }
    } else {
      console.error(`[Skills] 命令执行失败: ${result.error}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: false,
        error: result.error,
        stderr: result.stderr || ''
      }))
    }
    return
  }

  // ============================================
  // POST /api/system/skills/install — 安装技能
  // ============================================

  if (pathname === '/api/system/skills/install' && req.method === 'POST') {
    let body = ''
    let bodyExceeded = false
    const MAX_BODY_SIZE = 1024 // 1KB 限制

    req.on('data', chunk => {
      body += chunk.toString()
      if (body.length > MAX_BODY_SIZE && !bodyExceeded) {
        bodyExceeded = true
        req.destroy() // H-2 残留修复：立即终止请求，不再入内存
      }
    })
    req.on('end', async () => {
      if (bodyExceeded) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          message: '请求体过大（限制 1KB）',
          stdout: '',
          stderr: ''
        }))
        return
      }
      try {
        const input = JSON.parse(body)
        const skillName = input?.name

        // 输入验证：类型检查 + 非空 + 白名单 + 长度 + 路径遍历防护
        if (!skillName || typeof skillName !== 'string' || !skillName.trim()) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: '缺少技能名称参数',
            stdout: '',
            stderr: ''
          }))
          return
        }

        const trimmed = skillName.trim()

        // 长度上限 100 字符
        if (trimmed.length > 100) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: '技能名称过长（限制 100 字符）',
            stdout: '',
            stderr: ''
          }))
          return
        }

        // 路径遍历防护：禁止包含 ..
        if (/(\.\.[\\/]|^\.+$)/.test(trimmed)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: '技能名称包含非法路径',
            stdout: '',
            stderr: ''
          }))
          return
        }

        // 扩展白名单：支持 @scope/package 格式，允许字母、数字、连字符、下划线、@ / -
        if (!/^[a-zA-Z0-9_@/.-]+$/.test(trimmed)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: '技能名称包含非法字符',
            stdout: '',
            stderr: ''
          }))
          return
        }

        const isWindows = os.platform() === 'win32'
        const command = isWindows ? 'npx.cmd' : 'npx'
        const INSTALL_TIMEOUT = 60000 // 60 秒超时

        console.log(`[Skills Install] 执行: ${command} clawhub install ${trimmed}`)

        const result = await runCommand(command, ['clawhub', 'install', trimmed], INSTALL_TIMEOUT)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: result.success,
          message: result.success ? `技能 ${trimmed} 安装成功` : `技能 ${trimmed} 安装失败`,
          stdout: result.stdout || '',
          stderr: result.stderr || ''
        }))
      } catch (parseError) {
        console.error('[Skills Install] 请求解析失败:', parseError.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          message: '请求参数格式错误',
          stdout: '',
          stderr: parseError.message
        }))
      }
    })
    return
  }

  // ============================================
  // GET /api/system/skills/search — 搜索 ClawHub 技能
  // ============================================

  if (pathname === '/api/system/skills/search' && req.method === 'GET') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams
    const query = params.get('q') || ''

    if (!query.trim()) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, total: 0, skills: [] }))
      return
    }

    const isWindows = os.platform() === 'win32'
    const command = isWindows ? 'npx.cmd' : 'npx'
    const SEARCH_TIMEOUT = 30000 // 30 秒超时

    console.log(`[Skills Search] 执行: ${command} clawhub search "${query.trim()}"`)

    const result = await runCommand(command, ['clawhub', 'search', query.trim()], SEARCH_TIMEOUT)

    if (result.success) {
      try {
        let rawOutput = result.stdout || result.stderr || ''
        // clawhub search 输出是纯文本格式，需要解析
        // 格式: "name  @author  description  (score)"
        const skills = parseClawHubSearchOutput(rawOutput)

        // 通过 clawhub inspect --json 补充统计信息（含描述）
        if (skills.length > 0) {
          console.log(`[Skills Search] 获取 ${skills.length} 个技能的统计信息...`)
          await enrichSkillsWithInfo(skills)
        }

        // REC-016: enrich 后再标记 installed（多重匹配策略）
        if (skills.length > 0) {
          const { installedSlugs, installedNames, installedDescriptions } = await getInstalledSkillInfo()
          for (const skill of skills) {
            // 策略 1: enrich 获取的 slug 与 homepage 提取的 slug 精确匹配
            if (skill.slug && installedSlugs.has(skill.slug)) {
              skill.installed = true
            }
            // 策略 2: 搜索名称与 homepage 提取的 slug 匹配
            else if (installedSlugs.has(skill.name)) {
              skill.installed = true
            }
            // 策略 3: 搜索名称与已安装名称精确匹配
            else if (installedNames.has(skill.name)) {
              skill.installed = true
            }
            // 策略 4: enrich 获取的 displayName 与已安装名称匹配
            else if (skill.displayName && installedNames.has(skill.displayName)) {
              skill.installed = true
            }
            // 策略 5: description 与已安装技能的 description 模糊匹配（兜底）
            else if (skill.description) {
              for (const inst of installedDescriptions) {
                const sDesc = skill.description.trim()
                const iDesc = inst.description.trim()
                if (sDesc === iDesc || sDesc.includes(iDesc) || iDesc.includes(sDesc)) {
                  skill.installed = true
                  break
                }
              }
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          total: skills.length,
          skills
        }))
      } catch (parseError) {
        console.error('[Skills Search] 解析失败:', parseError.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          total: 0,
          skills: [],
          _debug: (result.stdout || result.stderr || '').substring(0, 500)
        }))
      }
    } else {
      console.error(`[Skills Search] 搜索失败: ${result.error}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: false,
        total: 0,
        skills: [],
        error: result.error,
        stderr: (result.stderr || '').substring(0, 500)
      }))
    }
    return
  }

  // ============================================
  // POST /api/system/skills/toggle — 启用/禁用技能
  // ============================================

  if (pathname === '/api/system/skills/toggle' && req.method === 'POST') {
    let body = ''
    let bodyExceeded = false
    const MAX_BODY_SIZE = 1024

    req.on('data', chunk => {
      body += chunk.toString()
      if (body.length > MAX_BODY_SIZE && !bodyExceeded) {
        bodyExceeded = true
        req.destroy()
      }
    })
    req.on('end', async () => {
      if (bodyExceeded) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          message: '请求体过大（限制 1KB）'
        }))
        return
      }
      try {
        const input = JSON.parse(body)
        const { name, enabled } = input

        // 参数验证
        if (!name || typeof name !== 'string' || !name.trim()) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: '缺少 name 参数'
          }))
          return
        }
        if (typeof enabled !== 'boolean') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: 'enabled 参数必须为布尔值'
          }))
          return
        }

        const skillName = name.trim()

        // 路径遍历防护
        if (/(\.\.[\\/]|^\.+$)/.test(skillName)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: '技能名称包含非法路径'
          }))
          return
        }

        // 读取 openclaw.json
        const openclawJsonPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
        const content = await fs.readFile(openclawJsonPath, 'utf-8')
        const config = JSON.parse(content)

        // 确保 skills.entries 存在
        if (!config.skills) config.skills = {}
        if (!config.skills.entries) config.skills.entries = {}

        // 检查技能是否存在
        if (!config.skills.entries[skillName]) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: `技能 "${skillName}" 不存在于配置中`
          }))
          return
        }

        // 修改 enabled 字段
        config.skills.entries[skillName].enabled = enabled

        // 原子写入：.tmp + rename
        const tmpPath = openclawJsonPath + '.tmp'
        await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
        await fs.rename(tmpPath, openclawJsonPath)

        console.log(`[Skills Toggle] ${skillName} → enabled: ${enabled}`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          name: skillName,
          enabled
        }))
      } catch (error) {
        console.error('[Skills Toggle] 失败:', error.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          message: error.message
        }))
      }
    })
    return
  }

  // ============================================
  // POST /api/system/doctor — 执行 openclaw doctor 诊断
  // ============================================

  if (pathname === '/api/system/doctor' && req.method === 'POST') {
    const isWindows = os.platform() === 'win32'
    const command = isWindows ? 'openclaw.cmd' : 'openclaw'
    const DOCTOR_TIMEOUT = 120000 // 120 秒

    console.log(`[Doctor] 执行诊断: ${command} doctor`)

    const result = await runCommand(command, ['doctor', '--fix'], DOCTOR_TIMEOUT)

    if (result.success) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        stdout: result.stdout,
        stderr: result.stderr || '',
        command: `${command} doctor`,
        platform: os.platform()
      }))
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: result.success,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error || '',
        command: `${command} doctor`,
        platform: os.platform()
      }))
    }
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
  console.log('[功能] GPU VRAM + Usage Stats + Reset Agent')
  console.log(`[提示] 按 Ctrl+C 可停止服务`)
  console.log('')
  console.log('[API 端点]')
  console.log('  GET  /api/gpu-vram              - GPU VRAM 使用情况')
  console.log('  GET  /api/usage                 - 获取用量统计')
  console.log('  GET  /api/health                - 健康检查')
  console.log('  GET  /api/system/version        - OpenClaw 版本号')
  console.log('  GET  /api/system/versions       - 获取版本列表')
  console.log('  POST /api/system/sync-versions  - 同步版本列表')
  console.log('  POST /api/system/switch-version - 切换版本')
  console.log('  GET  /api/tasks/current           - 获取当前任务进度')
  console.log('  GET  /api/system/skills           - 获取技能列表')
  console.log('  POST /api/system/skills/install   - 安装技能')
  console.log('  POST /api/system/skills/toggle    - 启用/禁用技能')
  console.log('  GET  /api/system/skills/search    - 搜索 ClawHub 技能')
  console.log('  POST /api/system/doctor          - 执行 openclaw doctor 诊断')
  console.log('  POST /reset                     - 重置 Agent')
  console.log('  POST /api/upload-image           - 图片上传 (base64, ≤5MB)')
  console.log('')
})

// 优雅关闭
process.on('SIGINT', () => {
  server.close(() => {
    console.log('[服务] 已关闭')
    process.exit(0)
  })
})

// SIGTERM 仅在 Unix 平台注册（Windows 不支持）
if (os.platform() !== 'win32') {
  process.on('SIGTERM', () => {
    server.close(() => {
      console.log('[服务] 已关闭')
      process.exit(0)
    })
  })
}