/**
 * OpenClaw Dashboard Unified Service
 * 合并服务：GPU VRAM + Usage Stats + Reset Agent
 * 端口：31002
 */

import http from 'http'
import https from 'https'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { spawn, execSync } from 'child_process'
import iconv from 'iconv-lite'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { DatabaseSync } from 'node:sqlite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 加载 .env 文件
dotenv.config({ path: path.join(__dirname, '..', '.env') })

// OpenClaw 数据目录
const OPENCLAW_DIR = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.openclaw')
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents')

// ===== Sprint 7: 全局搜索 SQLite 索引 =====
const SEARCH_DB_PATH = path.join(OPENCLAW_DIR, 'search-index.db')
let _searchDb = null

function getSearchDb() {
  if (_searchDb) return _searchDb
  try {
    _searchDb = new DatabaseSync(SEARCH_DB_PATH)
    _searchDb.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT DEFAULT '',
        file_path TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fp ON messages(file_path);
      CREATE INDEX IF NOT EXISTS idx_ts ON messages(timestamp);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content, content='messages', content_rowid='id'
      );
      CREATE TRIGGER IF NOT EXISTS msg_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS msg_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
      CREATE TABLE IF NOT EXISTS indexed_files (
        path TEXT PRIMARY KEY,
        mtime_ms INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      -- #9: 文档文件索引（.md 文件，管理目录 + agent 目录）
      CREATE TABLE IF NOT EXISTS docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
        content, title UNINDEXED, path UNINDEXED,
        content='docs', content_rowid='id'
      );
      CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
        INSERT INTO docs_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
        INSERT INTO docs_fts(docs_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
    `)
    return _searchDb
  } catch (e) {
    console.error('[search-db] init error:', e.message)
    _searchDb = null
    return null
  }
}

// #9: 索引 .md 文档文件
function indexDocFiles() {
  const db = getSearchDb()
  if (!db) return { error: 'SQLite unavailable' }

  const home = os.homedir()
  // 搜索范围：~/clawd/ 顶层 .md + ~/clawd/admin/**/*.md + ~/clawd/memory/**/*.md + ~/clawd/agents/**/*.md
  const searchDirs = [
    { dir: path.join(home, 'clawd'), depth: 1 },
    { dir: path.join(home, 'clawd', 'admin'), depth: 2 },
    { dir: path.join(home, 'clawd', 'memory'), depth: 2 },
    { dir: path.join(home, 'clawd', 'agents'), depth: 3 },
  ]

  function collectMdFiles(dir, maxDepth, curDepth = 0) {
    const files = []
    try {
      for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath)
        else if (entry.isDirectory() && curDepth < maxDepth) files.push(...collectMdFiles(fullPath, maxDepth, curDepth + 1))
      }
    } catch { /* 目录不存在忽略 */ }
    return files
  }

  const getDoc = db.prepare('SELECT mtime_ms FROM docs WHERE path = ?')
  const upsertDoc = db.prepare('INSERT OR REPLACE INTO docs (path, title, content, mtime_ms) VALUES (?, ?, ?, ?)')
  const deleteDoc = db.prepare('DELETE FROM docs WHERE path = ?')

  let added = 0, updated = 0, skipped = 0

  for (const { dir, depth } of searchDirs) {
    for (const filePath of collectMdFiles(dir, depth)) {
      try {
        const stat = fsSync.statSync(filePath)
        const mtime = Math.round(stat.mtimeMs)
        const existing = getDoc.get(filePath)
        if (existing && existing.mtime_ms === mtime) { skipped++; continue }

        const raw = fsSync.readFileSync(filePath, 'utf8')
        const title = path.basename(filePath, '.md')
        const content = raw.slice(0, 8000) // 限制每个文件最多 8000 字符

        if (existing) { deleteDoc.run(filePath) }
        upsertDoc.run(filePath, title, content, mtime)
        if (existing) updated++; else added++
      } catch { /* 读取失败忽略 */ }
    }
  }

  db.prepare("INSERT OR REPLACE INTO meta VALUES ('docs_indexed_at', ?)").run(new Date().toISOString())
  const total = db.prepare('SELECT COUNT(*) as n FROM docs').get()
  return { added, updated, skipped, totalDocs: total?.n || 0 }
}

// #8: 技能调用统计（扫 session .jsonl 里的 tool_use 事件，内存缓存 30 分钟）
let _toolCallCache = null
let _toolCallCacheTime = 0
const TOOL_CALL_TTL = 30 * 60 * 1000 // 30 分钟

function buildToolCallStats(days = 30) {
  const now = Date.now()
  if (_toolCallCache && now - _toolCallCacheTime < TOOL_CALL_TTL) return _toolCallCache

  const since = now - days * 86400000
  const counts = {} // { toolName: { total: N, byAgent: { agentId: N } } }

  try {
    for (const agentId of fsSync.readdirSync(AGENTS_DIR)) {
      const sessDir = path.join(AGENTS_DIR, agentId, 'sessions')
      let files
      try { files = fsSync.readdirSync(sessDir) } catch { continue }

      for (const f of files) {
        if (!f.endsWith('.jsonl') || f.includes('.trajectory') || f.includes('.bak') || f.includes('.tmp')) continue
        const filePath = path.join(sessDir, f)
        try {
          const stat = fsSync.statSync(filePath)
          if (stat.mtimeMs < since) continue // 跳过超出时间范围的旧文件
          const lines = fsSync.readFileSync(filePath, 'utf8').split('\n')
          for (const line of lines) {
            if (!line.trim()) continue
            let d
            try { d = JSON.parse(line) } catch { continue }
            if (d.type !== 'message' || d.message?.role !== 'assistant') continue
            const content = d.message?.content
            if (!Array.isArray(content)) continue
            for (const c of content) {
              // OpenClaw session 格式：type='toolCall'（不是 'tool_use'）
              const isToolCall = c?.type === 'toolCall' || c?.type === 'tool_use'
              if (!isToolCall || !c.name) continue
              if (!counts[c.name]) counts[c.name] = { total: 0, byAgent: {} }
              counts[c.name].total++
              counts[c.name].byAgent[agentId] = (counts[c.name].byAgent[agentId] || 0) + 1
            }
          }
        } catch { }
      }
    }
  } catch { }

  const ranked = Object.entries(counts)
    .map(([name, data]) => ({ name, total: data.total, byAgent: data.byAgent }))
    .sort((a, b) => b.total - a.total)

  _toolCallCache = { ranked, generatedAt: now, days }
  _toolCallCacheTime = now
  return _toolCallCache
}

function doIndexMessages(opts = {}) {
  const { rebuild = false } = opts
  const db = getSearchDb()
  if (!db) return { error: 'SQLite unavailable' }

  if (rebuild) {
    db.exec('DELETE FROM messages; DELETE FROM indexed_files;')
    db.exec("INSERT OR REPLACE INTO messages_fts(messages_fts) VALUES('rebuild')")
  }

  const getIndexed = db.prepare('SELECT mtime_ms FROM indexed_files WHERE path = ?')
  const upsertIndexed = db.prepare('INSERT OR REPLACE INTO indexed_files (path, mtime_ms, message_count) VALUES (?, ?, ?)')
  const deleteMsgs = db.prepare('DELETE FROM messages WHERE file_path = ?')
  const insertMsg = db.prepare('INSERT INTO messages (agent_id, session_id, role, content, timestamp, file_path) VALUES (?, ?, ?, ?, ?, ?)')

  let newFiles = 0, updatedFiles = 0, skippedFiles = 0, totalMessages = 0

  try {
    const agentIds = fsSync.readdirSync(AGENTS_DIR)
    for (const agentId of agentIds) {
      const sessDir = path.join(AGENTS_DIR, agentId, 'sessions')
      let files
      try { files = fsSync.readdirSync(sessDir) } catch { continue }

      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue
        if (f.includes('.trajectory') || f.includes('.bak') || f.includes('.tmp')) continue
        if (f === 'sessions.json') continue
        const filePath = path.join(sessDir, f)
        const sessionId = f.replace('.jsonl', '')
        try {
          const stat = fsSync.statSync(filePath)
          const mtime = Math.round(stat.mtimeMs)
          const indexed = getIndexed.get(filePath)
          if (indexed && indexed.mtime_ms === mtime) { skippedFiles++; continue }
          if (indexed) { deleteMsgs.run(filePath); updatedFiles++ }
          else { newFiles++ }

          const lines = fsSync.readFileSync(filePath, 'utf8').split('\n')
          let msgCount = 0
          db.exec('BEGIN')
          try {
            for (const line of lines) {
              if (!line.trim()) continue
              let d
              try { d = JSON.parse(line) } catch { continue }
              if (d.type !== 'message') continue
              const msg = d.message || {}
              const role = msg.role || ''
              if (role === 'system') continue
              let text = ''
              const content = msg.content
              if (typeof content === 'string') text = content
              else if (Array.isArray(content)) {
                text = content.map(c => {
                  if (typeof c === 'string') return c
                  if (c?.type === 'text') return c.text || ''
                  if (c?.type === 'tool_result') {
                    const inner = c.content
                    if (typeof inner === 'string') return inner
                    if (Array.isArray(inner)) return inner.map(x => x?.text || '').join(' ')
                  }
                  return ''
                }).join(' ')
              }
              text = text.trim()
              if (text.length < 3) continue
              if (text.length > 2000) text = text.slice(0, 2000)
              insertMsg.run(agentId, sessionId, role, text, d.timestamp || '', filePath)
              msgCount++
            }
            db.exec('COMMIT')
          } catch (e2) {
            db.exec('ROLLBACK')
            console.error('[search-index] tx error:', e2.message)
          }
          upsertIndexed.run(filePath, mtime, msgCount)
          totalMessages += msgCount
        } catch (e3) {
          console.warn('[search-index] file skip:', filePath, e3.message)
        }
      }
    }
  } catch (e) {
    return { error: e.message, newFiles, updatedFiles, skippedFiles, totalMessages }
  }

  const total = db.prepare('SELECT COUNT(*) as n FROM messages').get()
  db.prepare("INSERT OR REPLACE INTO meta VALUES ('last_indexed_at', ?)").run(new Date().toISOString())
  return { newFiles, updatedFiles, skippedFiles, totalMessages, totalInDb: total?.n || 0 }
}
// ===== END Sprint 7 init =====

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
        skills: Array.isArray(a.skills) ? a.skills : [],
        // 没有配置 skills 数组 = 不限制，继承所有已安装技能
        skillsUnconstrained: !Array.isArray(a.skills),
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
  // GET /api/agent-live-activity?agent=id — 读取 agent 正在做什么（session jsonl 末尾）
  // ============================================
  if (pathname === '/api/agent-live-activity' && req.method === 'GET') {
    const agentId = url.searchParams.get('agent') || 'main'
    try {
      const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions')
      // 找最近修改的 session .jsonl 文件
      let latestFile = null
      let latestMtime = 0
      try {
        const files = fsSync.readdirSync(sessionsDir)
        for (const f of files) {
          if (!f.endsWith('.jsonl') || f.includes('.trajectory') || f.includes('.reset') || f.includes('.bak') || f.includes('.tmp') || f === 'sessions.json') continue
          const fpath = path.join(sessionsDir, f)
          const stat = fsSync.statSync(fpath)
          if (stat.mtimeMs > latestMtime) { latestMtime = stat.mtimeMs; latestFile = fpath }
        }
      } catch (e) { /* sessions dir missing */ }

      if (!latestFile) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ agentId, steps: [], msAgo: null }))
        return
      }

      // 读最后 12KB，避免读超大文件
      const READ_TAIL = 12 * 1024
      const stat = fsSync.statSync(latestFile)
      const fileSize = stat.size
      const readStart = Math.max(0, fileSize - READ_TAIL)
      const buf = Buffer.alloc(Math.min(READ_TAIL, fileSize))
      const fd = fsSync.openSync(latestFile, 'r')
      fsSync.readSync(fd, buf, 0, buf.length, readStart)
      fsSync.closeSync(fd)

      // 按行解析，跳过第一行（可能截断），取完整 JSON 行
      const rawLines = buf.toString('utf-8').split('\n')
      const lines = readStart > 0 ? rawLines.slice(1) : rawLines  // 截断偏移时丢掉首行残片

      const steps = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let obj
        try { obj = JSON.parse(trimmed) } catch { continue }
        if (obj.type !== 'message' || !obj.message) continue
        const msg = obj.message
        const ts = obj.timestamp || null

        if (msg.role === 'user') {
          // 触发消息
          const textPart = Array.isArray(msg.content) ? msg.content.find(c => c.type === 'text') : null
          const text = textPart?.text || ''
          steps.push({ type: 'trigger', text: text.slice(0, 120), timestamp: ts })
        } else if (msg.role === 'assistant') {
          for (const part of (Array.isArray(msg.content) ? msg.content : [])) {
            if (part.type === 'thinking') {
              steps.push({ type: 'thinking', text: (part.thinking || '').slice(0, 120), timestamp: ts })
            } else if (part.type === 'toolCall') {
              const inputStr = part.input ? JSON.stringify(part.input).slice(0, 100) : ''
              steps.push({ type: 'tool', name: part.name || '', text: inputStr, timestamp: ts })
            } else if (part.type === 'text') {
              const t = (part.text || '').trim()
              if (t && t !== 'NO_REPLY') steps.push({ type: 'text', text: t.slice(0, 120), timestamp: ts })
            }
          }
        } else if (msg.role === 'toolResult') {
          const textPart = Array.isArray(msg.content) ? msg.content.find(c => c.type === 'text') : null
          const text = (textPart?.text || '').trim().slice(0, 120)
          if (text) steps.push({ type: 'toolResult', name: msg.toolName || '', text, timestamp: ts })
        }
      }

      // 只返回最后 8 步
      const recentSteps = steps.slice(-8)
      const msAgo = latestMtime > 0 ? Date.now() - latestMtime : null

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ agentId, steps: recentSteps, msAgo, fileSize }))
    } catch (e) {
      console.error('[agent-live-activity] Error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ agentId, steps: [], msAgo: null, error: e.message }))
    }
    return
  }

  // ============================================
  // POST /api/agent-send-message — 通过 openclaw CLI 发消息给 agent
  // body: { agentId: string, message: string }
  // ============================================
  if (pathname === '/api/agent-send-message' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { agentId, message } = JSON.parse(body)
        if (!agentId || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: 'agentId 和 message 必填' }))
          return
        }
        // 后台启动 openclaw agent，不阻塞 HTTP 响应（agent 可能跑几十秒）
        const child = spawn('openclaw', [
          'agent',
          '--agent', agentId,
          '--message', message,
          '--session-key', `agent:${agentId}:main`,
        ], { detached: true, stdio: 'ignore' })
        child.unref()
        console.log(`[agent-send-message] dispatched to ${agentId}: ${message.slice(0, 80)}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, agentId, dispatched: true }))
      } catch (e) {
        console.error('[agent-send-message] Error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: e.message }))
      }
    })
    return
  }

  // ============================================
  // GET /api/agent-crons — 获取所有 Agent 的定时任务
  // ============================================
  if (pathname === '/api/agent-crons' && req.method === 'GET') {
    const agentFilter = url.searchParams.get('agent') || null
    try {
      const isWindows = os.platform() === 'win32'
      const command = isWindows ? 'openclaw.cmd' : 'openclaw'
      const result = await runCommand(command, ['cron', 'list', '--json'], 30000)
      if (!result.success) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jobs: [], error: result.error }))
        return
      }
      let rawOutput = result.stdout || result.stderr || ''
      const jsonStart = rawOutput.indexOf('{')
      if (jsonStart < 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jobs: [] }))
        return
      }
      const parsed = JSON.parse(rawOutput.slice(jsonStart))
      let jobs = parsed.jobs || []
      if (agentFilter) {
        jobs = jobs.filter(j => j.agentId === agentFilter)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jobs, total: jobs.length }))
    } catch (e) {
      console.error('[agent-crons] Error:', e.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jobs: [], error: e.message }))
    }
    return
  }

  // ============================================
  // GET /api/system/skill-readme?name=lark-im — 读取技能 SKILL.md
  // ============================================
  if (pathname === '/api/system/skill-readme' && req.method === 'GET') {
    const skillName = url.searchParams.get('name') || ''
    if (!skillName || skillName.includes('..') || skillName.includes('/')) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid skill name' }))
      return
    }
    try {
      const homeDir = os.homedir()
      const skillDir = path.join(homeDir, '.openclaw', 'skills', skillName)
      const skillMdPath = path.join(skillDir, 'SKILL.md')
      let content = ''
      let description = ''
      let tools = []
      try {
        content = fsSync.readFileSync(skillMdPath, 'utf8')
        // Extract frontmatter description
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
        if (fmMatch) {
          const fm = fmMatch[1]
          // Handle quoted description: description: "..." or description: >
          const quotedMatch = fm.match(/^description:\s*"([\s\S]*?)"\s*(?:\n|$)/m)
          const blockMatch = !quotedMatch && fm.match(/^description:\s*>\s*\n([\s\S]*?)(?=\n\w|\n---|\n$|$)/m)
          const inlineMatch = !quotedMatch && !blockMatch && fm.match(/^description:\s*(.+)/m)
          if (quotedMatch) description = quotedMatch[1].replace(/\\n/g, '\n').trim()
          else if (blockMatch) description = blockMatch[1].replace(/  /g, '').trim()
          else if (inlineMatch) description = inlineMatch[1].trim()
        }
        // Truncate content to 3000 chars for the preview
        if (content.length > 3000) content = content.slice(0, 3000) + '\n\n... (内容已截断)'
      } catch (_) { /* file not found */ }
      // List tools from references/
      try {
        const refsDir = path.join(skillDir, 'references')
        const refFiles = fsSync.readdirSync(refsDir)
        tools = refFiles.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
      } catch (_) { /* no references dir */ }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: skillName, description, content, tools }))
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: skillName, description: '', content: '', tools: [], error: e.message }))
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
  // 计费配置：GET / POST /api/billing-config
  // 存储在 ./billing-config.json（项目根目录），编辑后立即生效
  // ============================================
  const BILLING_CONFIG_PATH = path.join(__dirname, '..', 'billing-config.json')

  // 内置主流 provider 默认值（人民币 / 100 万 token；以官方价格 + 6.5 汇率粗算）
  const BILLING_DEFAULTS = {
    version: 1,
    models: {
      'MiniMax-M2.7': {
        mode: 'subscription_monthly',
        monthlyCNY: 140,
        quotaTokensPerMonth: 100000000,
        note: 'MiniMax 包月套餐：固定月费 + token 配额',
      },
      'deepseek-v4-pro': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 4,
        outputPriceCNYPerMillion: 16,
        discountFactor: 0.5,
        discountStartHour: 0,
        discountEndHour: 8,
        note: 'DeepSeek：标准价 + 北京时间 00:00-08:00 半价',
      },
      'deepseek-v3': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 1,
        outputPriceCNYPerMillion: 2,
        discountFactor: 0.5,
        discountStartHour: 0,
        discountEndHour: 8,
        note: 'DeepSeek V3：低价位 + 夜间折扣',
      },
      'claude-sonnet-4-6': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 21.6,
        outputPriceCNYPerMillion: 108,
        cacheReadPriceCNYPerMillion: 2.16,
        cacheWritePriceCNYPerMillion: 27,
        note: 'Anthropic Claude Sonnet 4.6 ($3/$15 per M token)',
      },
      'claude-opus-4': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 108,
        outputPriceCNYPerMillion: 540,
        note: 'Claude Opus 4 ($15/$75 per M token)',
      },
      'gpt-4o': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 18,
        outputPriceCNYPerMillion: 72,
        cacheReadPriceCNYPerMillion: 9,
        note: 'OpenAI GPT-4o ($2.5/$10 per M token, prompt cache 50% off)',
      },
      'gpt-4o-mini': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 1.08,
        outputPriceCNYPerMillion: 4.32,
        note: 'OpenAI GPT-4o-mini ($0.15/$0.6 per M token)',
      },
    },
    fallback: {
      mode: 'use_default',
      note: '未在上方配置的模型，使用 OpenClaw 自带计费',
    },
  }

  if (pathname === '/api/billing-config' && req.method === 'GET') {
    try {
      if (fsSync.existsSync(BILLING_CONFIG_PATH)) {
        const raw = fsSync.readFileSync(BILLING_CONFIG_PATH, 'utf-8')
        const cfg = JSON.parse(raw)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(cfg))
      } else {
        // 文件不存在 → 返回内置默认
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(BILLING_DEFAULTS))
      }
    } catch (e) {
      console.error('[billing-config GET] error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, ...BILLING_DEFAULTS }))
    }
    return
  }

  if (pathname === '/api/billing-config' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body)
        if (!cfg || typeof cfg !== 'object' || !cfg.models) {
          throw new Error('Invalid config: 必须包含 models 字段')
        }
        // 备份旧文件
        if (fsSync.existsSync(BILLING_CONFIG_PATH)) {
          fsSync.copyFileSync(BILLING_CONFIG_PATH, BILLING_CONFIG_PATH + '.bak')
        }
        fsSync.writeFileSync(BILLING_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8')
        console.log('[billing-config POST] saved, models:', Object.keys(cfg.models).length)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, path: BILLING_CONFIG_PATH }))
      } catch (e) {
        console.error('[billing-config POST] error:', e.message)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: e.message }))
      }
    })
    return
  }

  // GET /api/billing-config/defaults — 获取内置预设（用于"恢复默认"或新增模型时下拉选择）
  if (pathname === '/api/billing-config/defaults' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(BILLING_DEFAULTS))
    return
  }

  // ============================================
  // GET /api/cost-summary  Sprint 1
  // 返回：{ todayCNY, monthCNY, monthForecastCNY }
  // 数据来源：~/.openclaw/agents/*/sessions/*.jsonl 的 mtime + cache 累计 cost
  // ============================================
  if (pathname === '/api/cost-summary' && req.method === 'GET') {
    try {
      const result = await collectUsageStats()
      // 用 by-session jsonl mtime 聚合到日
      const AGENTS_DIR_LOCAL = path.join(OPENCLAW_DIR, 'agents')
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      const todayStartMs = today.getTime()
      const monthStartMs = monthStart.getTime()
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
      const dayOfMonth = today.getDate()

      let todayCost = 0
      let monthCost = 0
      // 扫所有 agent 的 sessions，按文件 mtime 聚合
      const agentDirs = fsSync.readdirSync(AGENTS_DIR_LOCAL).filter(d => {
        try { return fsSync.statSync(path.join(AGENTS_DIR_LOCAL, d)).isDirectory() } catch { return false }
      })
      for (const agent of agentDirs) {
        const sessionsDir = path.join(AGENTS_DIR_LOCAL, agent, 'sessions')
        if (!fsSync.existsSync(sessionsDir)) continue
        // 读 per-agent usage cache
        const cacheByUuid = new Map()
        try {
          const cachePath = path.join(sessionsDir, '.usage-cost-cache.json')
          if (fsSync.existsSync(cachePath)) {
            const cacheData = JSON.parse(fsSync.readFileSync(cachePath, 'utf-8'))
            for (const [filePath, entry] of Object.entries(cacheData.files || {})) {
              if (entry?.totals) {
                const basename = path.basename(filePath)
                const uuid = extractSessionUuid(basename)
                if (uuid) cacheByUuid.set(uuid, entry.totals.totalCost || 0)
              }
            }
          }
        } catch (e) { /* ignore */ }
        const files = fsSync.readdirSync(sessionsDir).filter(f => isSessionFile(f))
        for (const file of files) {
          const fp = path.join(sessionsDir, file)
          let stat
          try { stat = fsSync.statSync(fp) } catch { continue }
          if (stat.mtimeMs < monthStartMs) continue
          const uuid = extractSessionUuid(file)
          if (!uuid) continue
          const cost = cacheByUuid.get(uuid) || 0
          if (stat.mtimeMs >= todayStartMs) todayCost += cost
          monthCost += cost
        }
      }

      // 预估本月总费用：按当前已过天数线性外推
      const monthForecast = dayOfMonth > 0 ? (monthCost / dayOfMonth) * daysInMonth : monthCost

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        todayCNY: todayCost,
        monthCNY: monthCost,
        monthForecastCNY: monthForecast,
        daysInMonth,
        dayOfMonth,
        totalAllTime: result.totalCost,
      }))
    } catch (e) {
      console.error('[cost-summary] error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, todayCNY: 0, monthCNY: 0, monthForecastCNY: 0 }))
    }
    return
  }

  // ============================================
  // 文件管理 API
  // GET  /api/file-manager/tree      → 文件清单（带中文说明）
  // POST /api/file-manager/read      → 读取文件内容（body: { path }）
  // ============================================
  const HOME = os.homedir()
  // 把 ~ 替换为真实 home，并防穿越
  function resolveSafePath(p) {
    if (!p || typeof p !== 'string') throw new Error('invalid path')
    if (p.includes('..')) throw new Error('path traversal not allowed')
    let real = p
    if (real.startsWith('~/')) real = path.join(HOME, real.slice(2))
    if (real === '~') real = HOME
    // 必须在白名单根目录下
    const allowedRoots = [path.join(HOME, 'clawd'), path.join(HOME, '.openclaw')]
    const ok = allowedRoots.some(r => real === r || real.startsWith(r + path.sep))
    if (!ok) throw new Error('path outside allowed roots')
    return real
  }

  /** 文件清单（带中文说明 + 谁在用） */
  const FILE_MANIFEST = [
    {
      name: '🏠 工作车间',
      rootDesc: '你的工作目录 ~/clawd/，可直接编辑',
      groups: [
        {
          name: '顶层 Markdown 配置',
          items: [
            { path: '~/clawd/IDENTITY.md', cn: '身份卡', desc: '叶溪人设定义（名字、性格、背景）', usedBy: ['叶溪'] },
            { path: '~/clawd/SOUL.md', cn: '灵魂书', desc: '核心价值观，所有 agent 共享的世界观', usedBy: ['全员'] },
            { path: '~/clawd/USER.md', cn: '用户偏好', desc: '你（Allen）的个人偏好：称呼、语言、习惯', usedBy: ['全员'] },
            { path: '~/clawd/AGENTS.md', cn: '工作规则', desc: '全局工作守则（中文回复、危险操作要审批等）', usedBy: ['全员'] },
            { path: '~/clawd/TOOLS.md', cn: '工具注记', desc: '本机特有工具配置（不通用部分）', usedBy: ['全员'] },
            { path: '~/clawd/HEARTBEAT.md', cn: '心跳清单', desc: '心跳任务扫描这个文件看有无事项（空 = 无事）', usedBy: ['叶溪'] },
            { path: '~/clawd/MEMORY.md', cn: '长期记忆', desc: '重要事项备忘（项目历史、决策记录）', usedBy: ['全员'] },
            { path: '~/clawd/skills-lock.json', cn: '技能锁文件', desc: '锁定技能版本（防意外升级）', usedBy: ['OpenClaw 启动校验'] },
          ],
        },
        {
          name: '子目录',
          items: [
            { path: '~/clawd/agents/pm/IDENTITY.md', cn: '怡雯人设', desc: '产品经理 怡雯的身份配置', usedBy: ['怡雯'] },
            { path: '~/clawd/agents/developer/IDENTITY.md', cn: '瓦利人设', desc: '开发工程师 瓦利的身份配置', usedBy: ['瓦利'] },
            { path: '~/clawd/agents/tester/IDENTITY.md', cn: '奥托人设', desc: '前端测试 奥托的身份配置', usedBy: ['奥托'] },
            { path: '~/clawd/agents/inspector/IDENTITY.md', cn: '伯恩人设', desc: '巡检员 伯恩的身份配置', usedBy: ['伯恩'] },
            { path: '~/clawd/agents/archivist/IDENTITY.md', cn: '小波人设', desc: '档案员 小波的身份配置', usedBy: ['小波'] },
            { path: '~/clawd/agents/designer/IDENTITY.md', cn: '苏苏人设', desc: '美术设计师 苏苏的身份配置', usedBy: ['苏苏'] },
            { path: '~/clawd/admin/cron-tasks.md', cn: '定时任务清单', desc: '所有 cron 任务的人类可读列表', usedBy: ['全员参考'] },
            { path: '~/clawd/admin/change-log.md', cn: '变更日志', desc: '系统变更历史记录', usedBy: ['全员参考'] },
            { path: '~/clawd/admin/work-reminders.md', cn: '工作提醒', desc: '待办事项与提醒', usedBy: ['inspector / pm'] },
            { path: '~/clawd/admin/daily-task-summary-rule.md', cn: '日报生成规则', desc: '每日任务汇总脚本的规则', usedBy: ['archivist'] },
            { path: '~/clawd/admin/format-spec.md', cn: '格式规范', desc: '消息、报告、文档的格式约定', usedBy: ['全员'] },
            { path: '~/clawd/admin/calendar-events.md', cn: '日历事件', desc: '记录的重要日程事件', usedBy: ['pm'] },
            { path: '~/clawd/admin/project-state.md', cn: '项目状态总览', desc: '所有项目的状态汇总（人读）', usedBy: ['pm / inspector'] },
            { path: '~/clawd/admin/lark-cli-update-rule.md', cn: '飞书 CLI 升级规则', desc: 'lark CLI 自动升级的策略', usedBy: ['运维'] },
            { path: '~/clawd/admin/openclaw-issue-mention-forwarding.md', cn: 'OpenClaw issue 草稿', desc: '准备提交给 OpenClaw 上游的 issue', usedBy: ['Allen'] },
            { path: '~/clawd/admin/projects/README.md', cn: '项目档案说明', desc: 'projects/ 目录的说明文档', usedBy: ['查看者'] },
            { path: '~/clawd/admin/projects/health-monitor/state.json', cn: '健康监控项目状态', desc: 'health-monitor 项目当前阶段', usedBy: ['inspector 扫描'] },
            { path: '~/clawd/inspector/last_report.json', cn: '巡检最后报告', desc: '伯恩最后一次巡检的输出', usedBy: ['伯恩'] },
            { path: '~/clawd/scripts/check-task-reminders.py', cn: '待办提醒脚本', desc: '每 5 分钟扫描即将开始的任务', usedBy: ['main 心跳调用'] },
            { path: '~/clawd/scripts/gen-task-summary.py', cn: '任务汇总脚本', desc: '生成每日任务报告', usedBy: ['archivist'] },
            { path: '~/clawd/scripts/archive-old-projects.py', cn: '项目归档脚本', desc: '归档完成 7 天以上的项目', usedBy: ['archivist'] },
            { path: '~/clawd/scripts/inspect-projects.py', cn: '项目巡检脚本', desc: '扫描项目状态发现异常', usedBy: ['inspector'] },
            { path: '~/clawd/scripts/send-group-msg.py', cn: '群消息发送', desc: '通过飞书 API 向群里发消息', usedBy: ['全员 cron'] },
            { path: '~/clawd/scripts/update-project-state.py', cn: '项目状态更新', desc: '更新 admin/projects/*/state.json', usedBy: ['pm / dev'] },
            { path: '~/clawd/memory', cn: '永久记忆库目录', desc: 'agent 长期记忆 markdown 文件', usedBy: ['全员'], isDir: true },
          ],
        },
      ],
    },
    {
      name: '⚙️ 设备机房',
      rootDesc: 'OpenClaw 系统数据 ~/.openclaw/，不要手动改',
      groups: [
        {
          name: '核心配置',
          items: [
            { path: '~/.openclaw/openclaw.json', cn: '总配置文件', desc: '所有 agent / 模型 / 技能 / 端口配置，最重要的一个', usedBy: ['OpenClaw Gateway'] },
            { path: '~/.openclaw/exec-approvals.json', cn: '命令审批记录', desc: '你审批过的危险命令清单（避免重复问）', usedBy: ['Gateway exec policy'] },
            { path: '~/.openclaw/update-check.json', cn: '升级检查', desc: '上次检查新版本的时间', usedBy: ['自动升级模块'] },
            { path: '~/.openclaw/cron/jobs.json', cn: 'Cron 任务定义', desc: '所有定时任务的配置（最权威）', usedBy: ['cron 调度器'] },
            { path: '~/.openclaw/identity/device.json', cn: '设备身份', desc: '本机在 OpenClaw 网络的身份信息', usedBy: ['Gateway'] },
            { path: '~/.openclaw/devices/paired.json', cn: '设备配对', desc: '已配对的多设备列表', usedBy: ['跨设备同步'] },
            { path: '~/.openclaw/credentials/feishu-pairing.json', cn: '飞书配对', desc: '飞书 bot 配对凭证（敏感）', usedBy: ['feishu 插件'], sensitive: true },
            { path: '~/.openclaw/credentials/feishu-default-allowFrom.json', cn: '飞书白名单', desc: '允许哪些用户给 bot 发消息', usedBy: ['feishu 插件'], sensitive: true },
          ],
        },
        {
          name: '数据库 & 会话（不可读）',
          items: [
            { path: '~/.openclaw/memory/main.sqlite', cn: '叶溪记忆库', desc: 'main agent 的 SQLite 记忆数据库', usedBy: ['叶溪'], binary: true },
            { path: '~/.openclaw/memory/pm.sqlite', cn: '怡雯记忆库', desc: '怡雯的 SQLite 记忆库', usedBy: ['怡雯'], binary: true },
            { path: '~/.openclaw/memory/developer.sqlite', cn: '瓦利记忆库', desc: '瓦利的 SQLite 记忆库', usedBy: ['瓦利'], binary: true },
            { path: '~/.openclaw/flows/registry.sqlite', cn: '工作流注册表', desc: '工作流编排引擎数据库', usedBy: ['flows 插件'], binary: true },
            { path: '~/.openclaw/tasks/runs.sqlite', cn: '任务执行记录', desc: '所有任务运行历史', usedBy: ['任务系统'], binary: true },
            { path: '~/.openclaw/agents/main/sessions', cn: '叶溪会话目录', desc: '5000+ 个 .jsonl 文件，所有对话历史', usedBy: ['叶溪 + Dashboard'], isDir: true, sensitive: true },
          ],
        },
        {
          name: '日志',
          items: [
            { path: '~/.openclaw/logs/gateway.log', cn: '网关主日志', desc: 'Gateway 运行日志', usedBy: ['debug'] },
            { path: '~/.openclaw/logs/gateway.err.log', cn: '网关错误日志', desc: 'Gateway 异常和错误', usedBy: ['debug'] },
            { path: '~/.openclaw/logs/commands.log', cn: '命令执行日志', desc: 'CLI 命令执行历史', usedBy: ['debug'] },
            { path: '~/.openclaw/logs/config-health.json', cn: '配置健康检查', desc: 'openclaw.json 配置健康度', usedBy: ['Gateway'] },
          ],
        },
      ],
    },
  ]

  // 给清单填充实时元数据（大小、存在、mtime）
  function enrichManifest() {
    return FILE_MANIFEST.map(cat => ({
      ...cat,
      groups: cat.groups.map(g => ({
        ...g,
        items: g.items.map(item => {
          try {
            const real = resolveSafePath(item.path)
            const stat = fsSync.statSync(real)
            return {
              ...item,
              exists: true,
              isDir: stat.isDirectory(),
              size: stat.isFile() ? stat.size : null,
              entries: stat.isDirectory() ? (fsSync.readdirSync(real).length) : null,
              mtime: stat.mtimeMs,
            }
          } catch (e) {
            return { ...item, exists: false }
          }
        }),
      })),
    }))
  }

  if (pathname === '/api/file-manager/tree' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ categories: enrichManifest() }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // POST /api/file-manager/reveal — 用系统默认方式打开文件或在 Finder 显示
  // body: { path, mode: 'open' | 'reveal' }
  //   open    → 用默认 app 打开（文件→编辑器，目录→Finder）
  //   reveal  → 在 Finder 中定位该文件（高亮显示）
  if (pathname === '/api/file-manager/reveal' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const { path: p, mode } = JSON.parse(body)
        const real = resolveSafePath(p)
        const platform = os.platform()
        let cmd, args
        if (platform === 'darwin') {
          if (mode === 'reveal') {
            cmd = 'open'; args = ['-R', real]
          } else {
            cmd = 'open'; args = [real]
          }
        } else if (platform === 'win32') {
          if (mode === 'reveal') {
            cmd = 'explorer'; args = ['/select,', real]
          } else {
            cmd = 'explorer'; args = [real]
          }
        } else {
          // linux: 用 xdg-open 打开文件，或打开父目录
          if (mode === 'reveal') {
            cmd = 'xdg-open'; args = [path.dirname(real)]
          } else {
            cmd = 'xdg-open'; args = [real]
          }
        }
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
        child.unref()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, platform, mode, path: real }))
      } catch (e) {
        console.error('[file-manager/reveal] error:', e.message)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: e.message }))
      }
    })
    return
  }

  if (pathname === '/api/file-manager/read' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const { path: p } = JSON.parse(body)
        const real = resolveSafePath(p)
        const stat = fsSync.statSync(real)
        if (stat.isDirectory()) {
          // 目录 → 返回前 50 个子项
          const list = fsSync.readdirSync(real).slice(0, 50)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'dir', entries: list, totalCount: fsSync.readdirSync(real).length }))
          return
        }
        const MAX = 512 * 1024 // 512KB 上限
        if (stat.size > MAX) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'too_large', size: stat.size, message: `文件 ${(stat.size / 1024).toFixed(1)} KB 超过 512KB 预览上限` }))
          return
        }
        // 简单 binary 检测：扩展名或内容含 NUL
        const ext = path.extname(real).toLowerCase()
        const binaryExts = ['.sqlite', '.sqlite-shm', '.sqlite-wal', '.db', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.gz', '.exe', '.dylib']
        if (binaryExts.includes(ext)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'binary', size: stat.size, message: `二进制文件（${ext}）不支持预览` }))
          return
        }
        const content = fsSync.readFileSync(real, 'utf-8')
        if (content.includes('\x00')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'binary', size: stat.size, message: '检测到二进制内容（含 NUL 字节）' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          type: 'text',
          size: stat.size,
          mtime: stat.mtimeMs,
          ext,
          content,
        }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: e.message }))
      }
    })
    return
  }

  // ============================================
  // Sprint 4: 文件写入 API
  // ============================================

  // POST /api/file-manager/write — 写入文件（含自动备份）
  if (pathname === '/api/file-manager/write' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { path: p, content } = JSON.parse(body)
        if (typeof content !== 'string') throw new Error('content must be string')
        const MAX_WRITE = 512 * 1024
        if (content.length > MAX_WRITE) throw new Error(`内容超过 512KB 上限（${(content.length/1024).toFixed(1)}KB）`)

        // 可编辑扩展名白名单
        const real = (function resolveSafePathInner(p2) {
          if (!p2 || typeof p2 !== 'string') throw new Error('invalid path')
          if (p2.includes('..')) throw new Error('path traversal not allowed')
          let r = p2.startsWith('~/') ? path.join(os.homedir(), p2.slice(2)) : p2
          const allowed = [path.join(os.homedir(), 'clawd'), path.join(os.homedir(), '.openclaw')]
          if (!allowed.some(a => r === a || r.startsWith(a + path.sep))) throw new Error('path outside allowed roots')
          return r
        })(p)

        const ext = path.extname(real).toLowerCase()
        const editableExts = ['.md', '.json', '.py', '.txt', '.yaml', '.yml', '.sh', '.js', '.ts', '.env']
        if (!editableExts.includes(ext)) throw new Error(`不允许编辑 ${ext} 类型文件`)

        // 自动备份（仅文件存在时）
        let backupPath = null
        try {
          if (fsSync.existsSync(real)) {
            const ts = Date.now()
            backupPath = `${real}.bak.${ts}`
            fsSync.copyFileSync(real, backupPath)
          }
        } catch { /* 备份失败不影响写入 */ }

        fsSync.mkdirSync(path.dirname(real), { recursive: true })
        fsSync.writeFileSync(real, content, 'utf8')

        // 检测是否 IDENTITY.md（建议 agent reset）
        const isIdentity = path.basename(real) === 'IDENTITY.md'
        let resetHint = null
        if (isIdentity) {
          // 从路径推断 agent id：~/clawd/agents/{id}/IDENTITY.md 或 ~/clawd/IDENTITY.md
          const parts = real.split(path.sep)
          const agentIdx = parts.indexOf('agents')
          if (agentIdx >= 0 && parts[agentIdx + 1]) {
            resetHint = parts[agentIdx + 1]
          } else {
            resetHint = 'main' // ~/clawd/IDENTITY.md 对应 main
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, backupPath, resetHint, writtenBytes: content.length }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ============================================
  // #16: 文件备份管理 API
  // ============================================

  // GET /api/file-manager/backups?path=... — 列出某文件的所有备份（.bak.{ts} 格式）
  if (pathname === '/api/file-manager/backups' && req.method === 'GET') {
    try {
      const rawPath = url.searchParams.get('path') || ''
      if (!rawPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'path 参数必填' }))
        return
      }
      const real = rawPath.startsWith('~/') ? path.join(os.homedir(), rawPath.slice(2)) : rawPath
      const allowed = [path.join(os.homedir(), 'clawd'), path.join(os.homedir(), '.openclaw')]
      if (!allowed.some(a => real === a || real.startsWith(a + path.sep))) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'path outside allowed roots' }))
        return
      }
      const dir = path.dirname(real)
      const base = path.basename(real)
      const backups = []
      try {
        const files = fsSync.readdirSync(dir)
        for (const f of files) {
          // 备份文件格式：{base}.bak.{timestamp}
          if (f.startsWith(base + '.bak.')) {
            const tsStr = f.slice(base.length + 5) // ".bak." = 5 chars
            const ts = parseInt(tsStr, 10)
            if (!isNaN(ts)) {
              const fullPath = path.join(dir, f)
              const stat = fsSync.statSync(fullPath)
              backups.push({
                path: fullPath,
                displayPath: fullPath.replace(os.homedir(), '~'),
                ts,
                date: new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
                size: stat.size,
              })
            }
          }
        }
        // 最新的排在前面
        backups.sort((a, b) => b.ts - a.ts)
      } catch { /* 目录不存在 */ }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, backups, count: backups.length }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // POST /api/file-manager/restore — 从备份恢复（将 backupPath 复制回 targetPath）
  // body: { backupPath, targetPath }
  if (pathname === '/api/file-manager/restore' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { backupPath, targetPath } = JSON.parse(body)
        if (!backupPath || !targetPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'backupPath 和 targetPath 必填' }))
          return
        }
        const resolveP = (p) => p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
        const realBak = resolveP(backupPath)
        const realTgt = resolveP(targetPath)
        const allowed = [path.join(os.homedir(), 'clawd'), path.join(os.homedir(), '.openclaw')]
        if (!allowed.some(a => realBak.startsWith(a + path.sep)) ||
            !allowed.some(a => realTgt === a || realTgt.startsWith(a + path.sep))) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'path outside allowed roots' }))
          return
        }
        if (!fsSync.existsSync(realBak)) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: '备份文件不存在' }))
          return
        }
        // 恢复前先备份当前文件
        if (fsSync.existsSync(realTgt)) {
          fsSync.copyFileSync(realTgt, `${realTgt}.bak.${Date.now()}`)
        }
        fsSync.copyFileSync(realBak, realTgt)
        console.log(`[file-manager/restore] ${realBak} → ${realTgt}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, restored: realTgt.replace(os.homedir(), '~') }))
      } catch (e) {
        console.error('[file-manager/restore] error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ============================================
  // Sprint 6: 费用时间线 API
  // ============================================

  // GET /api/cost-timeline?days=30 — 按天聚合 token + 费用
  if (pathname === '/api/cost-timeline' && req.method === 'GET') {
    try {
      const days = Math.min(90, parseInt(new URL(req.url, 'http://localhost').searchParams.get('days') || '30', 10) || 30)
      const now = Date.now()
      const dayMs = 86400_000
      const buckets = {}

      // 初始化 days 个空桶
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now - i * dayMs)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        buckets[key] = { date: key, tokens: 0, cost: 0, byModel: {} }
      }

      const agentsDir = path.join(os.homedir(), '.openclaw', 'agents')
      const BILLING_DEFAULTS = { 'deepseek-v4-pro': 0.002, 'MiniMax-M2.7': 0.001, 'claude-sonnet-4-6': 0.004 }

      let billingConfig = {}
      try {
        const bcPath = path.join(process.cwd(), 'billing-config.json')
        billingConfig = JSON.parse(fsSync.readFileSync(bcPath, 'utf8'))
      } catch { /* 使用默认 */ }

      try {
        const agentDirs = fsSync.readdirSync(agentsDir, { withFileTypes: true })
          .filter(e => e.isDirectory()).map(e => e.name)

        for (const agentId of agentDirs) {
          // 优先读 .usage-cost-cache.json（轻量）
          const cacheFile = path.join(agentsDir, agentId, 'sessions', '.usage-cost-cache.json')
          try {
            const cache = JSON.parse(fsSync.readFileSync(cacheFile, 'utf8'))
            // cache 有 dailyUsage 字段（如果有的话）
            if (cache.dailyUsage) {
              for (const [dateKey, usage] of Object.entries(cache.dailyUsage)) {
                if (buckets[dateKey]) {
                  buckets[dateKey].tokens += (usage.totalTokens || 0)
                  buckets[dateKey].cost += (usage.totalCost || 0)
                }
              }
              continue
            }
          } catch { /* 没有缓存，改扫 jsonl */ }

          // 扫 session jsonl 文件
          const sessionsDir = path.join(agentsDir, agentId, 'sessions')
          let sessionFiles = []
          try { sessionFiles = fsSync.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl') && !f.startsWith('.')) } catch { continue }

          for (const sf of sessionFiles) {
            const sfPath = path.join(sessionsDir, sf)
            try {
              const stat = fsSync.statSync(sfPath)
              // 只扫 days 天内修改的文件
              if (now - stat.mtimeMs > days * dayMs + dayMs) continue
              const lines = fsSync.readFileSync(sfPath, 'utf8').split('\n').filter(Boolean)
              for (const line of lines) {
                try {
                  const entry = JSON.parse(line)
                  // 寻找 usage 类型条目
                  const ts = entry.ts || entry.timestamp || entry.created_at
                  if (!ts) continue
                  const d = new Date(ts)
                  const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
                  if (!buckets[dateKey]) continue

                  // 多种格式兼容
                  let tokens = 0, cost = 0, model = ''
                  if (entry.type === 'usage' || entry.usage) {
                    const u = entry.usage || entry
                    tokens = (u.input_tokens || u.inputTokens || 0) + (u.output_tokens || u.outputTokens || 0)
                    model = u.model || entry.model || ''
                    cost = u.cost || 0
                  } else if (entry.type === 'message' && entry.usage) {
                    tokens = (entry.usage.input_tokens || 0) + (entry.usage.output_tokens || 0)
                    model = entry.model || ''
                  } else { continue }

                  if (tokens === 0) continue
                  if (!cost && model) {
                    const rate = billingConfig[model]?.ratePerKToken
                      || BILLING_DEFAULTS[model] || 0.002
                    cost = (tokens / 1000) * rate
                  }
                  buckets[dateKey].tokens += tokens
                  buckets[dateKey].cost += cost
                } catch { /* 跳过单行异常 */ }
              }
            } catch { /* 跳过文件错误 */ }
          }
        }
      } catch { /* agentsDir 不存在 */ }

      const timeline = Object.values(buckets)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ timeline, days, generatedAt: Date.now() }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, timeline: [] }))
    }
    return
  }

  // ============================================
  // Sprint 2: 项目看板 API
  // ============================================

  // GET /api/projects/list — 扫描 ~/clawd/admin/projects/*/state.json
  if (pathname === '/api/projects/list' && req.method === 'GET') {
    try {
      const projectsDir = path.join(os.homedir(), 'clawd', 'admin', 'projects')
      const projects = []
      try {
        const entries = fsSync.readdirSync(projectsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const stateFile = path.join(projectsDir, entry.name, 'state.json')
          try {
            const raw = fsSync.readFileSync(stateFile, 'utf8')
            const state = JSON.parse(raw)
            const stat = fsSync.statSync(stateFile)
            projects.push({
              id: entry.name,
              name: state.name || state.project_name || entry.name,
              phase: state.phase || 'unknown',
              responsible_agent: state.responsible_agent || state.agent || null,
              blocked_reason: state.blocked_reason || null,
              retry_count: state.retry_count || 0,
              updated_at: state.updated_at || null,
              created_at: state.created_at || null,
              file_mtime: stat.mtimeMs,
              raw: state,
            })
          } catch { /* 跳过无法解析的 */ }
        }
      } catch { /* 目录不存在 */ }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ projects, total: projects.length, checkedAt: Date.now() }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, projects: [] }))
    }
    return
  }

  // GET /api/projects/state?id=xxx — 返回单个项目 state.json 全文
  if (pathname === '/api/projects/state' && req.method === 'GET') {
    try {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id')
      if (!id || !/^[a-zA-Z0-9_\-]+$/.test(id)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid id' }))
        return
      }
      const stateFile = path.join(os.homedir(), 'clawd', 'admin', 'projects', id, 'state.json')
      const raw = fsSync.readFileSync(stateFile, 'utf8')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(raw)
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Sprint 3: Cron 任务中心 API
  // ============================================

  // GET /api/cron/list — 读取 cron jobs + 最近执行记录
  if (pathname === '/api/cron/list' && req.method === 'GET') {
    try {
      const cronDir = path.join(os.homedir(), '.openclaw', 'cron')
      const jobsFile = path.join(cronDir, 'jobs.json')
      const stateFile = path.join(cronDir, 'jobs-state.json')
      const runsDir = path.join(cronDir, 'runs')

      let jobs = []
      try {
        const raw = fsSync.readFileSync(jobsFile, 'utf8')
        const parsed = JSON.parse(raw)
        jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || [])
      } catch { /* jobs.json 不存在或格式异常 */ }

      // 读取 jobs-state.json（含 nextRunAtMs / lastRunStatus）
      let jobsState = {}
      try {
        const stateRaw = fsSync.readFileSync(stateFile, 'utf8')
        jobsState = JSON.parse(stateRaw).jobs || {}
      } catch { /* 忽略 */ }

      // 为每个 job 读取最近 10 条执行记录（jsonl 格式）
      const jobsWithRuns = jobs.map(job => {
        const jobId = job.id || job.name
        const state = jobsState[jobId] || {}
        let runs = []
        try {
          const runFile = path.join(runsDir, `${jobId}.jsonl`)
          const lines = fsSync.readFileSync(runFile, 'utf8').trim().split('\n').filter(Boolean)
          runs = lines.slice(-10).reverse().map(l => {
            try { return JSON.parse(l) } catch { return null }
          }).filter(Boolean)
        } catch { /* 没有执行记录 */ }

        const failCount = runs.filter(r => r && (r.status === 'error' || r.status === 'failed')).length
        const consecutiveErrors = (state.state || {}).consecutiveErrors || 0
        const lastRun = runs[0] ? {
          status: runs[0].status,
          startedAt: runs[0].ts ? new Date(runs[0].ts).toISOString() : null,
          durationMs: runs[0].durationMs,
          message: runs[0].summary || runs[0].message || null,
          error: runs[0].status === 'error' ? (runs[0].summary || runs[0].error || null) : null,
        } : ((state.state || {}).lastRunAtMs ? {
          status: (state.state || {}).lastRunStatus || 'ok',
          startedAt: new Date((state.state || {}).lastRunAtMs).toISOString(),
          durationMs: (state.state || {}).lastDurationMs,
        } : null)

        return {
          ...job,
          runs: runs.map(r => ({
            status: r.status,
            startedAt: r.ts ? new Date(r.ts).toISOString() : null,
            durationMs: r.durationMs,
            message: r.summary || null,
            error: r.status === 'error' ? (r.summary || r.error || null) : null,
          })),
          failCount: Math.max(failCount, consecutiveErrors),
          lastRun,
          nextRunAtMs: (state.state || {}).nextRunAtMs || null,
        }
      })

      // 失败 >=3 次排最前
      jobsWithRuns.sort((a, b) => {
        const aFail = (a.failCount || 0) >= 3
        const bFail = (b.failCount || 0) >= 3
        if (aFail && !bFail) return -1
        if (!aFail && bFail) return 1
        return 0
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jobs: jobsWithRuns, total: jobsWithRuns.length, checkedAt: Date.now() }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, jobs: [] }))
    }
    return
  }

  // POST /api/cron/trigger — 立即触发一个 cron job
  if (pathname === '/api/cron/trigger' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body)
        if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'id required' })); return }
        const cp = require('child_process')
        cp.exec(`openclaw cron trigger --id "${id}"`, { timeout: 10000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message, stderr }))
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, stdout }))
          }
        })
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // POST /api/cron/pause — 暂停 cron job
  if (pathname === '/api/cron/pause' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body)
        if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'id required' })); return }
        const cp = require('child_process')
        cp.exec(`openclaw cron pause --id "${id}"`, { timeout: 10000 }, (err, stdout, stderr) => {
          if (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message, stderr })) }
          else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })) }
        })
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  // POST /api/cron/resume — 恢复 cron job
  if (pathname === '/api/cron/resume' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body)
        if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'id required' })); return }
        const cp = require('child_process')
        cp.exec(`openclaw cron resume --id "${id}"`, { timeout: 10000 }, (err, stdout, stderr) => {
          if (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message, stderr })) }
          else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })) }
        })
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  // ============================================
  // Sprint 7: GET /api/search — 全文搜索
  // ============================================
  if (pathname === '/api/search' && req.method === 'GET') {
    try {
      const q = (url.searchParams.get('q') || '').trim()
      const type = url.searchParams.get('type') || 'all'
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
      const results = { agents: [], messages: [] }

      if (!q) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ results, q, total: 0 }))
        return
      }

      const qLower = q.toLowerCase()

      // Agent search (instant, from config)
      if (type === 'all' || type === 'agents') {
        try {
          const configPath = path.join(OPENCLAW_DIR, 'openclaw.json')
          const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'))
          const agentList = Array.isArray(config.agents) ? config.agents : []
          for (const a of agentList) {
            const name = (a.name || a.id || '').toLowerCase()
            if (name.includes(qLower) || (a.id || '').includes(qLower)) {
              results.agents.push({ id: a.id, name: a.name || a.id, emoji: a.emoji || '', model: a.model || '' })
            }
          }
        } catch { /* ignore */ }
      }

      // FTS 对话历史搜索
      if (type === 'all' || type === 'messages') {
        try {
          const db = getSearchDb()
          if (db) {
            const ftsQ = q.replace(/["'*^()]/g, ' ').trim().split(/\s+/).filter(Boolean).map(w => `"${w}"*`).join(' ')
            if (ftsQ) {
              const rows = db.prepare(`
                SELECT m.agent_id, m.session_id, m.role, m.timestamp,
                  snippet(messages_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
                FROM messages_fts
                JOIN messages m ON m.id = messages_fts.rowid
                WHERE messages_fts MATCH ?
                ORDER BY rank
                LIMIT ?
              `).all(ftsQ, limit)
              results.messages = rows
            }
          }
        } catch (e) {
          console.warn('[search] FTS error:', e.message)
          results.messages = []
        }
      }

      // #9: 文档文件搜索（.md 文件：admin/ + memory/ + agent 目录）
      results.docs = []
      if (type === 'all' || type === 'docs') {
        try {
          const db = getSearchDb()
          if (db) {
            const ftsQ = q.replace(/["'*^()]/g, ' ').trim().split(/\s+/).filter(Boolean).map(w => `"${w}"*`).join(' ')
            if (ftsQ) {
              const rows = db.prepare(`
                SELECT d.path, d.title,
                  snippet(docs_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
                FROM docs_fts
                JOIN docs d ON d.id = docs_fts.rowid
                WHERE docs_fts MATCH ?
                ORDER BY rank
                LIMIT ?
              `).all(ftsQ, Math.min(limit, 10))
              results.docs = rows
            }
          }
        } catch (e) {
          console.warn('[search] docs FTS error:', e.message)
        }
      }

      const total = results.agents.length + results.messages.length + (results.docs?.length || 0)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ results, q, total }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Sprint 7: POST /api/search/index — 触发索引
  // ============================================
  if (pathname === '/api/search/index' && req.method === 'POST') {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const opts = body ? JSON.parse(body) : {}
        console.log('[search-index] build start, rebuild=', !!opts.rebuild)
        const result = doIndexMessages({ rebuild: !!opts.rebuild })
        // 同时索引 .md 文档文件（#9）
        const docResult = indexDocFiles()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, ...result, docs: docResult }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ============================================
  // Sprint 7: GET /api/search/status — 索引状态
  // ============================================
  if (pathname === '/api/search/status' && req.method === 'GET') {
    try {
      const db = getSearchDb()
      if (!db) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'SQLite unavailable', totalMessages: 0, totalFiles: 0 }))
        return
      }
      const total = db.prepare('SELECT COUNT(*) as n FROM messages').get()
      const files = db.prepare('SELECT COUNT(*) as n FROM indexed_files').get()
      const lastAt = db.prepare("SELECT value FROM meta WHERE key='last_indexed_at'").get()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, totalMessages: total?.n || 0, totalFiles: files?.n || 0, lastIndexedAt: lastAt?.value || null }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Sprint 7: GET /api/activity-timeline — Gantt 时间线
  // ============================================
  if (pathname === '/api/activity-timeline' && req.method === 'GET') {
    try {
      const hours = Math.min(parseInt(url.searchParams.get('hours') || '24'), 24 * 30)
      const since = Date.now() - hours * 3600 * 1000
      const sessions = []

      try {
        const agentIds = fsSync.readdirSync(AGENTS_DIR)
        for (const agentId of agentIds) {
          const sessDir = path.join(AGENTS_DIR, agentId, 'sessions')
          let files
          try { files = fsSync.readdirSync(sessDir) } catch { continue }

          for (const f of files) {
            if (!f.endsWith('.trajectory.jsonl')) continue
            const filePath = path.join(sessDir, f)
            try {
              const stat = fsSync.statSync(filePath)
              if (stat.mtimeMs < since) continue // quick filter

              const lines = fsSync.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
              let startTs = null, endTs = null, trigger = 'user'

              for (const line of lines) {
                try {
                  const d = JSON.parse(line)
                  if (d.type === 'session.started') { startTs = d.ts; trigger = d.data?.trigger || 'user' }
                  else if (d.type === 'session.ended') endTs = d.ts
                } catch { }
              }

              if (!startTs) continue
              const startMs = new Date(startTs).getTime()
              if (startMs < since) continue

              const endMs = endTs ? new Date(endTs).getTime() : Math.min(stat.mtimeMs, Date.now())
              sessions.push({
                agentId,
                sessionId: f.replace('.trajectory.jsonl', ''),
                startTs, endTs: endTs || null,
                startMs, endMs,
                durationMs: Math.max(endMs - startMs, 0),
                trigger,
              })
            } catch { }
          }
        }
      } catch (e) {
        console.error('[activity-timeline] scan error:', e.message)
      }

      sessions.sort((a, b) => a.startMs - b.startMs)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions, hours, generatedAt: Date.now(), total: sessions.length }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Sprint 8: GET /api/skill-usage — 技能调用排行榜（#8）
  // ============================================
  if (pathname === '/api/skill-usage' && req.method === 'GET') {
    try {
      const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 365)
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100)
      const data = buildToolCallStats(days)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ...data, ranked: data.ranked.slice(0, limit) }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Sprint 8: POST /api/system/auto-fix — 网关自动修复（#11）
  // ============================================
  if (pathname === '/api/system/auto-fix' && req.method === 'POST') {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { action } = body ? JSON.parse(body) : {}
        if (!action) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'action required' })); return }

        if (action === 'restart-gateway') {
          // 重启 OpenClaw 网关
          const { exec } = await import('child_process')
          exec('openclaw gateway restart', { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message, stderr })) }
            else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, stdout: stdout.trim(), action })) }
          })
          return
        }

        if (action === 'clear-locks') {
          // 清理 .lock 文件（OpenClaw 运行目录）
          const lockDirs = [OPENCLAW_DIR, path.join(os.homedir(), 'clawd')]
          let removed = []
          for (const dir of lockDirs) {
            try {
              for (const f of fsSync.readdirSync(dir)) {
                if (f.endsWith('.lock') || f.endsWith('.pid')) {
                  const p = path.join(dir, f)
                  try { fsSync.unlinkSync(p); removed.push(p) } catch { }
                }
              }
            } catch { }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, removed, action }))
          return
        }

        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `unknown action: ${action}` }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
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
  console.log('  GET  /api/agent-live-activity     - 读取 agent 当前正在做什么')
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