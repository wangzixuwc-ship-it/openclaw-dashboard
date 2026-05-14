<template>
  <el-drawer
    v-model="drawerVisible"
    :title="`Agent 详情：${displayAgentName}`"
    size="520px"
    direction="rtl"
    :close-on-click-modal="true"
    destroy-on-close
  >
    <template #header>
      <div class="drawer-title">
        <el-icon :size="20" :class="statusColorClass"><component :is="drawerAvatarIcon" /></el-icon>
        <span class="title-text">{{ displayAgentName }}</span>
        <el-tag
          :type="statusTagType"
          :effect="agent?.status === 'running' ? 'dark' : 'light'"
          size="small"
          class="status-badge"
        >
          <el-icon><component :is="statusIcon" /></el-icon>
          {{ displayStatus }}
        </el-tag>
      </div>
    </template>

    <!-- Loading state -->
    <div v-if="loadingHistory" class="loading-section">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在加载会话历史...</span>
    </div>

    <template v-if="agent">
      <!-- Session Info -->
      <el-card class="detail-section" shadow="never">
        <template #header>
          <div class="section-header">
            <el-icon><InfoFilled /></el-icon>
            会话信息
          </div>
        </template>

        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">当前任务</span>
            <span class="info-value monospace" :title="agent.label || agent.key">{{ agent.label || agent.key }}</span>
          </div>
          <div class="info-item" v-if="agent.model">
            <span class="info-label">模型</span>
            <span class="info-value">{{ agent.model }}</span>
          </div>
          <div class="info-item" v-if="agent.createdAt">
            <span class="info-label">创建时间</span>
            <span class="info-value">{{ formatTime(agent.createdAt) }}</span>
          </div>
          <div class="info-item" v-if="agent.lastActivity">
            <span class="info-label">最后活跃</span>
            <span class="info-value">{{ formatTime(agent.lastActivity) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">运行时长</span>
            <span class="info-value">{{ formattedDuration }}</span>
          </div>
        </div>
      </el-card>

      <!-- Token / 上下文使用 -->
      <el-card class="detail-section" shadow="never" v-if="agent.tokenUsage">
        <template #header>
          <div class="section-header">
            <el-icon><Coin /></el-icon>
            上下文使用
          </div>
        </template>

        <div class="token-usage-panel">
          <div class="token-stat-row">
            <div class="token-stat">
              <div class="stat-value">{{ agent.tokenUsage.current.toLocaleString() }}</div>
              <div class="stat-label">Used Tokens</div>
            </div>
            <div class="token-stat">
              <div class="stat-value">{{ agent.tokenUsage.max.toLocaleString() }}</div>
              <div class="stat-label">上下文上限</div>
            </div>
            <div class="token-stat">
              <div class="stat-value" :class="percentageClass">
                {{ agent.tokenUsage.percentage }}%
              </div>
              <div class="stat-label">使用率</div>
            </div>
          </div>

          <el-progress
            :percentage="agent.tokenUsage.percentage"
            :status="tokenProgressStatus"
            :stroke-width="12"
            :show-text="false"
            class="token-progress"
          />
        </div>
      </el-card>

      <!-- 消息预览 -->
      <el-card class="detail-section" shadow="never">
        <template #header>
          <div class="section-header">
            <el-icon><ChatDotRound /></el-icon>
            消息
            <span class="msg-count" v-if="recentMessages.length > 0">
              （{{ recentMessages.length }} 条）
            </span>
          </div>
        </template>

        <div v-if="loadingHistory" class="empty-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在加载消息...</span>
        </div>

        <el-empty v-else-if="recentMessages.length === 0" description="暂无消息" :image-size="60" />

        <div v-else class="messages-list">
          <!-- 用户消息：右对齐蓝色气泡 -->
          <div
            v-for="(msg, idx) in recentMessages"
            :key="idx"
            class="chat-row"
            :class="msg.role === 'user' ? 'chat-row-user' : 'chat-row-assistant'"
          >
            <div class="chat-bubble" :class="msg.role === 'user' ? 'bubble-user' : 'bubble-assistant'" :title="truncate(stripMarkdown(msg.content), 200)">
              <div class="markdown-body" v-html="renderMarkdown(msg.content)"></div>
            </div>
          </div>
        </div>
      </el-card>

      <!-- Extra Details -->
      <el-card class="detail-section" shadow="never" v-if="agent.details">
        <template #header>
          <div class="section-header">
            <el-icon><Document /></el-icon>
            原始详情
          </div>
        </template>
        <pre class="raw-details">{{ JSON.stringify(agent.details, null, 2) }}</pre>
      </el-card>

      <!-- Action Buttons -->
      <div class="action-bar">
        <el-button
          type="danger"
          :icon="Refresh"
          @click="handleResetSession"
          :loading="resetting"
        >
          重置会话
        </el-button>
        <el-button
          :icon="View"
          @click="loadHistory"
          :loading="loadingHistory"
        >
          加载历史
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch, type Component } from 'vue'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'
import DOMPurify from 'dompurify'
import type { AgentInfo } from '../stores/agent'
import { useAgentStore } from '../stores/agent'
import { ToolRestrictedError } from '../api/gateway'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  UserFilled,
  InfoFilled,
  Coin,
  ChatDotRound,
  Document,
  Refresh,
  View,
  Loading,
  CircleCheckFilled,
  Clock,
  WarningFilled,
  CircleCloseFilled,
  QuestionFilled,
  ChatLineSquare,
  User,
  Monitor,
  Finished,
  Avatar,
  Timer,
} from '@element-plus/icons-vue'

interface MessageItem {
  role: string
  content: string
}

const props = defineProps<{
  visible: boolean
  agentData: AgentInfo | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const store = useAgentStore()

// Local state
const drawerVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

const agent = computed(() => {
  // Always try to get latest from store
  if (!props.agentData) return null
  const latest = store.getAgentByKey(props.agentData.key)
  return latest || props.agentData
})

const historyCount = ref(0)
const recentMessages = ref<MessageItem[]>([])
const loadingHistory = ref(false)
const resetting = ref(false)

// Computed
const displayStatus = computed(() => {
  if (!agent.value) return '未知'
  const map: Record<string, string> = {
    running: '运行中',
    idle: '空闲',
    error: '错误',
    aborted: '已终止',
    unknown: '未知',
  }
  return map[agent.value.status] ?? agent.value.status
})

const statusTagType = computed(() => {
  if (!agent.value) return 'info'
  switch (agent.value.status) {
    case 'running': return 'success'
    case 'idle': return 'warning'
    case 'error': return 'danger'
    case 'aborted': return 'info'
    default: return 'info'
  }
})

const statusColorClass = computed(() => {
  if (!agent.value) return 'status-unknown'
  switch (agent.value.status) {
    case 'running': return 'status-running'
    case 'idle': return 'status-idle'
    case 'error': return 'status-error'
    case 'aborted': return 'status-aborted'
    default: return 'status-unknown'
  }
})

const statusIcon = computed(() => {
  if (!agent.value) return QuestionFilled
  switch (agent.value.status) {
    case 'running': return CircleCheckFilled
    case 'idle': return Clock
    case 'error': return WarningFilled
    case 'aborted': return CircleCloseFilled
    default: return QuestionFilled
  }
})

const formattedDuration = computed(() => {
  return store.formatDuration(agent.value?.elapsedMs)
})

const isSpecialAgent = computed(() => {
  return agent.value?.name === '副总' || agent.value?.name === '执行秘书'
})

const isCronSession = computed(() => {
  return agent.value?.key?.includes(':cron:')
})

const drawerAvatarIcon = computed(() => {
  if (isCronSession.value) return Timer
  if (isSpecialAgent.value) return Avatar
  return UserFilled
})

const displayAgentName = computed(() => {
  if (isCronSession.value) return '巡检员'
  return agent.value?.name || ''
})

const percentageClass = computed(() => {
  const p = agent.value?.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'text-danger'
  if (p >= 70) return 'text-warning'
  return 'text-success'
})

const tokenProgressStatus = computed(() => {
  const p = agent.value?.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'exception'
  if (p >= 70) return 'warning'
  return 'success'
})

// Role icon mapping
function roleIcon(msg: MessageItem): Component {
  switch (msg.role.toLowerCase()) {
    case 'user': return User
    case 'assistant': return ChatLineSquare
    case 'system': return Monitor
    default: return Finished
  }
}

// Message class
function messageClass(msg: MessageItem): string {
  switch (msg.role.toLowerCase()) {
    case 'user': return 'msg-user'
    case 'assistant': return 'msg-assistant'
    case 'system': return 'msg-system'
    default: return 'msg-other'
  }
}

// Helpers
function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function cleanContent(raw: string): string {
  if (!raw) return ''
  let text = raw
  // 1. 移除 thinking 标签及内容（兼容属性、可选空白）
  text = text.replace(/<\s*thinking[^>]*>[\s\S]*?<\/\s*thinking\s*>/gi, '')
  // 2. 移除 antThinking 标签及内容（兼容属性、可选空白）
  text = text.replace(/<\s*antThinking[^>]*>[\s\S]*?<\/\s*antThinking\s*>/gi, '')
  // 3. 移除 tool_call 标签及内容（XML 风格，兼容属性）
  text = text.replace(/<\s*tool_call[^>]*>[\s\S]*?<\/\s*tool_call\s*>/gi, '')
  // 4. 移除 tool_call 自闭合处理指令 <?tool_call ... ?>
  text = text.replace(/<\?\s*tool_call[\s\S]*?\?>/gi, '')
  // 5. 合并过多空行（保留一个空行作为段落分隔），防止相邻行意外形成表格
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  return text
}

function truncate(str: string, len: number): string {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '...' : str
}

/** 去除常见 markdown 语法，提取纯文本（用于 tooltip） */
function stripMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/^#{1,6}\s+/gm, '')           // 标题标记
    .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, '$2') // 粗体/斜体
    .replace(/`{1,3}(.+?)`{1,3}/g, '$1')   // 行内代码 / 代码块标记
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')  // 链接 [text](url) → text
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1') // 图片 ![alt](url) → alt
    .replace(/^>\s+/gm, '')                // 引用标记
    .replace(/[-*+]\s+/g, '')              // 无序列表标记
    .replace(/^\d+\.\s+/gm, '')            // 有序列表标记
    .replace(/\s{2,}/g, ' ')               // 合并空白
    .trim()
}

// Configure marked with highlight.js for code syntax highlighting
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext'
      return hljs.highlight(code, { language }).value
    },
  })
)

function renderMarkdown(content: string): string {
  if (!content) return ''
  try {
    const raw = marked.parse(content, { async: false }) as string
    return DOMPurify.sanitize(raw)
  } catch {
    // fallback: escape HTML 并作为纯文本显示
    return escapeHtml(content)
  }
}

/** 转义 HTML 特殊字符，防止 XSS */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (ch) => map[ch])
}

/**
 * 从 content 字段提取纯文本内容
 * 兼容多种格式：
 * 1. 字符串：直接返回
 * 2. 对象数组：[{"type":"text","text":"..."}, {"type":"thinking","thinking":"..."}, ...]
 * 3. 单个对象：{"text":"..."} 或 {"content":"..."}
 * 4. 其他：转为字符串
 */
function extractTextContent(content: unknown): string {
  // 1. 字符串直接返回
  if (typeof content === 'string') return content
  
  // 2. 对象数组：提取 type==="text" 的 text 字段
  if (Array.isArray(content)) {
    const textParts = content
      .filter((item: Record<string, unknown>) => {
        const type = String(item.type ?? '')
        return type === 'text'
      })
      .map((item: Record<string, unknown>) => String(item.text ?? item.content ?? ''))
      .join('\n')
    return textParts.trim()
  }
  
  // 3. 单个对象：尝试提取 text 或 content 字段
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>
    return String(obj.text ?? obj.content ?? '')
  }
  
  // 4. 其他情况转为字符串
  return String(content ?? '')
}

// Actions
async function loadHistory(): Promise<void> {
  if (!agent.value?.key) return
  loadingHistory.value = true
  try {
    const history = await store.fetchSessionHistory(agent.value.key)
    historyCount.value = history.length

    // 1. 过滤 tool 相关消息
    const TOOL_ROLES = ['tool', 'tool_calls', 'tool_result', 'function', 'assistant_tool']
    const filtered = (history as Record<string, unknown>[]).filter((item) => {
      const role = String(item.role ?? item.sender ?? '').toLowerCase()
      return !TOOL_ROLES.includes(role)
    })

    // 2. 归一化 + 清洗 assistant 消息
    const normalized = filtered.map((item) => {
      const role = String(item.role ?? item.sender ?? '').toLowerCase()
      let content = extractTextContent(item.content)

      // assistant 消息清洗 thinking 标签
      if (role === 'assistant') {
        content = cleanContent(content)
      }

      return {
        role: ['user', 'assistant', 'system'].includes(role) ? role : 'assistant',
        content,
      }
    })

    // 3. 过滤清洗后为空的，显示全部消息（REC-100）
    const cleanMessages = normalized.filter((msg) => msg.content.length > 0)
    recentMessages.value = cleanMessages.reverse()
  } finally {
    loadingHistory.value = false
  }
}

async function refreshStatus(): Promise<void> {
  if (!agent.value?.key) return
  resetting.value = true
  try {
    await store.fetchAgentStatus(agent.value.key)
  } finally {
    setTimeout(() => { resetting.value = false }, 500)
  }
}

async function handleResetSession(): Promise<void> {
  if (!agent.value?.key) return
  
  try {
    await ElMessageBox.confirm(
      `确定要重置 "${displayAgentName.value}" 的会话吗？这将执行命令：openclaw agent --agent ${agent.value.key.split(':')[1] || agent.value.key} --message "/reset"`,
      '重置会话',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    
    resetting.value = true
    await store.resetSession(agent.value.key)
    ElMessage.success('已执行重置命令')
    
    // 刷新状态
    await refreshStatus()
  } catch (e: any) {
    if (e !== 'cancel') {
      const errorMsg = e?.message || String(e)
      const errorCode = e?.code
      let userMessage = '重置会话失败'
      let configSteps: string[] = []

      // 1. 前置检测抛出的结构化错误
      if (e instanceof ToolRestrictedError || errorCode === 'TOOLS_RESTRICTED') {
        const toolName = e?.tool || 'sessions_send'
        userMessage = `⚠️ ${toolName} 工具不可用\n\nGateway 安全策略 (gateway.tools) 默认为 deny-allowlist 模式，\n未将 ${toolName} 加入允许列表。`
        configSteps = e?.steps || [
          '1. 编辑 Gateway 配置文件 (openclaw.yaml)',
          '2. 添加 gateway.tools.allow 配置',
          '3. 重启 Gateway',
        ]
      }
      // 2. 权限不足：operator.write scope
      else if (errorMsg.includes('missing scope: operator.write')) {
        userMessage = '权限不足：需要 operator.write 权限。请在 Gateway 配置中设置 gateway.controlUi.dangerouslyDisableDeviceAuth: true 并重启 Gateway，或者使用 openclaw devices approve --latest 批准设备配对请求。'
      }
      // 3. 工具被拒绝（广义关键词匹配）
      else if (/tool.*(not\s+)?available|sessions_send.*(denied|rejected|forbidden)|invoke.*(denied|rejected)|tools.*restrict|403|denied|forbidden/i.test(errorMsg)) {
        userMessage = `⚠️ sessions_send 工具不可用\n\nGateway 安全策略拒绝了该工具调用。`
        configSteps = [
          '1. 编辑 Gateway 配置文件 (openclaw.yaml / .openclaw.yaml)',
          '2. 添加以下配置：',
          '   gateway:',
          '     tools:',
          '       allow:',
          '         - sessions_send',
          '3. 重启 Gateway：openclaw gateway restart',
          '4. 配置文件路径：OpenClaw 安装目录下的 openclaw.yaml',
        ]
      }

      // 如果有配置步骤，用弹窗展示更详细的信息
      if (configSteps.length > 0) {
        await ElMessageBox.alert(
          `<div style="line-height:1.8;white-space:pre-wrap">${userMessage.replace(/\n/g, '<br/>')}</div>` +
          `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;">` +
          `<strong>解决方法：</strong></div>` +
          configSteps.map((s) => `<div style="margin-top:6px">${s.replace(/\n/g, '<br/>')}</div>`).join(''),
          '重置失败',
          {
            confirmButtonText: '我知道了',
            type: 'warning',
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => {}) // 忽略关闭弹窗
      } else {
        ElMessage.error(userMessage.replace(/\n/g, ' '))
      }

      console.error('[AgentDetailDrawer] resetSession error:', e)
    }
  } finally {
    resetting.value = false
  }
}

// Watch for drawer open
watch(drawerVisible, (val) => {
  if (val && agent.value) {
    // Load history on open
    loadHistory()
  }
})
</script>

<style scoped>
.drawer-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-primary);
}

.title-text {
  font-weight: 600;
  font-size: 16px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.status-badge {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.detail-section {
  margin-bottom: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.msg-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: normal;
}

.info-grid {
  display: grid;
  gap: 10px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
}

.info-item:last-child {
  border-bottom: none;
}

.info-label {
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.info-value {
  color: var(--text-primary);
  font-size: 13px;
  text-align: right;
  max-width: 65%;
  word-break: break-all;
}

.monospace {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
}

/* Token usage panel */
.token-usage-panel {
  padding: 4px 0;
}

.token-stat-row {
  display: flex;
  justify-content: space-around;
  margin-bottom: 16px;
}

.token-stat {
  text-align: center;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}

.token-progress {
  margin-top: 8px;
}

/* Messages list — 聊天气泡样式 */
.messages-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-row {
  display: flex;
}

.chat-row-user {
  justify-content: flex-end;
}

.chat-row-assistant {
  justify-content: flex-start;
}

.chat-bubble {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  position: relative;
}

/* 用户消息：蓝色气泡，右对齐 */
.bubble-user {
  background: #42a5f5;
  color: #fff;
  border-bottom-right-radius: 4px;
}

/* AI 回复：灰色气泡，左对齐 */
.bubble-assistant {
  background: #2d3748;
  color: #e2e8f0;
  border-bottom-left-radius: 4px;
}



/* Text colors */
.text-success { color: var(--el-color-success); }
.text-warning { color: var(--el-color-warning); }
.text-danger { color: var(--el-color-danger); }

/* Status colors */
.status-running { color: var(--el-color-success); }
.status-idle { color: var(--el-color-warning); }
.status-error { color: var(--el-color-danger); }
.status-aborted { color: var(--el-color-info); }
.status-unknown { color: var(--el-text-color-secondary); }

/* Action bar */
.action-bar {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-light);
}

.action-bar .el-button {
  flex: 1;
}

/* Loading */
.loading-section {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 20px;
  color: var(--text-secondary);
}

.empty-state {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 16px;
  color: var(--text-secondary);
}

/* Raw details */
.raw-details {
  background: var(--bg-elevated);
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
  color: var(--text-primary);
}
</style>

<!-- 非 scoped：v-html 渲染的 markdown 内容不受 scoped 限制 -->
<style>
/* ── Markdown 内容样式（适配深色主题 & 两种气泡底色） ── */
.markdown-body {
  line-height: 1.65;
  font-size: 13px;
}

/* ── 段落 ── */
.markdown-body p {
  margin: 0 0 8px;
}
.markdown-body p:last-child {
  margin-bottom: 0;
}

/* ── 标题 ── */
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 10px 0 6px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.01em;
}
.markdown-body h1 { font-size: 17px; }
.markdown-body h2 { font-size: 15.5px; }
.markdown-body h3 { font-size: 14.5px; }
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 { font-size: 13.5px; }

/* ── 列表（标记在内部，缩进一致）── */
.markdown-body ul,
.markdown-body ol {
  margin: 6px 0;
  padding-left: 0;
  list-style-position: inside;
}
.markdown-body li {
  margin: 3px 0;
}
.markdown-body li > p {
  margin: 2px 0;
  display: inline;
}
/* 嵌套列表缩进 */
.markdown-body ul ul,
.markdown-body ul ol,
.markdown-body ol ul,
.markdown-body ol ol {
  padding-left: 20px;
}

/* ── 任务列表（[x] / [ ]）── */
.markdown-body ul.contains-task-list {
  padding-left: 6px;
  list-style: none;
}
.markdown-body .task-list-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.markdown-body .task-list-item input[type="checkbox"] {
  margin-top: 3px;
  accent-color: var(--accent, #38bdf8);
}

/* ── 代码块（pre） ── */
.markdown-body pre {
  margin: 8px 0;
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.55;
  background: #1a1d2e !important;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.bubble-user .markdown-body pre {
  background: rgba(0, 0, 0, 0.35) !important;
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── inline code ── */
.markdown-body code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'JetBrains Mono', monospace;
  font-size: 12px;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
}
.bubble-user .markdown-body code {
  background: rgba(0, 0, 0, 0.2);
}

/* ── pre 内的 code 恢复无样式 ── */
.markdown-body pre code {
  padding: 0;
  background: none !important;
  border-radius: 0;
  font-size: inherit;
  color: inherit;
}

/* ── highlight.js 在气泡内微调 ── */
.markdown-body .hljs {
  background: transparent !important;
  padding: 0;
}

/* ── 加粗 / 斜体 ── */
.markdown-body strong {
  font-weight: 700;
}
.markdown-body em {
  font-style: italic;
}

/* ── 链接 ── */
.markdown-body a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  opacity: 0.88;
  transition: opacity 0.15s;
}
.markdown-body a:hover {
  opacity: 1;
}
.bubble-user .markdown-body a {
  text-decoration-color: rgba(255, 255, 255, 0.5);
}

/* ── 引用 ── */
.markdown-body blockquote {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--accent, #38bdf8);
  opacity: 0.88;
  border-radius: 0 4px 4px 0;
  background: rgba(255, 255, 255, 0.04);
}
.bubble-user .markdown-body blockquote {
  background: rgba(0, 0, 0, 0.1);
  border-left-color: rgba(255, 255, 255, 0.5);
}
.markdown-body blockquote p:last-child {
  margin-bottom: 0;
}

/* ── 水平线 ── */
.markdown-body hr {
  margin: 10px 0;
  border: none;
  height: 1px;
  background: rgba(255, 255, 255, 0.12);
}

/* ── 表格（清晰边框）── */
.markdown-body table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12.5px;
  width: 100%;
  display: block;
  overflow-x: auto;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
}
.markdown-body th,
.markdown-body td {
  padding: 7px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  text-align: left;
}
.bubble-assistant .markdown-body th,
.bubble-assistant .markdown-body td {
  border-color: rgba(255, 255, 255, 0.12);
}
.bubble-user .markdown-body th,
.bubble-user .markdown-body td {
  border-color: rgba(255, 255, 255, 0.18);
}
.markdown-body th {
  font-weight: 650;
  background: rgba(255, 255, 255, 0.07);
}
.bubble-user .markdown-body th {
  background: rgba(0, 0, 0, 0.15);
}
.markdown-body tr:nth-child(even) td {
  background: rgba(255, 255, 255, 0.03);
}
.bubble-user .markdown-body tr:nth-child(even) td {
  background: rgba(0, 0, 0, 0.08);
}

/* ── 图片 ── */
.markdown-body img {
  max-width: 100%;
  border-radius: 6px;
  margin: 8px 0;
}
</style>
